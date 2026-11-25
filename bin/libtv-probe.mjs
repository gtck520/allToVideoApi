#!/usr/bin/env node
// 阶段1验证工具主入口
//   auth status | login | logout   授权管理
//   tools                          拉取全量 tools/list 并落盘
//   probe                          只读探活：doctor / account_user / search_models
//   inspect <name>                 打印单个工具的完整 schema
//   call <name> '<json>'           调用任意工具（参数用 JSON 传入）
//   verify <recipe>                按配方跑生成链路，全程记录耗时
//   cli install | probe            官方 CLI 路线评估

import fs from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT, DATA_DIR, TOOLS_FILE, RUNS_DIR, RECIPES_DIR, ensureDataDirs } from '../src/paths.mjs'
import { authSummary, login, clearCreds, AuthRequired, discover, discoverResource } from '../src/oauth.mjs'
import { listTools, callTool, resetSession } from '../src/mcp.mjs'

ensureDataDirs()

const [group, cmd, ...rest] = process.argv.slice(2)

function now() { return new Date().toISOString().replace(/[:.]/g, '-') }
function out(obj) { console.log(JSON.stringify(obj, null, 2)) }
function fail(msg) { console.error(`✗ ${msg}`); process.exit(1) }

function saveRun(label, payload) {
  const file = path.join(RUNS_DIR, `${now()}-${label}.json`)
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`)
  console.error(`  ↳ 记录已保存：${path.relative(PROJECT_ROOT, file)}`)
  return file
}

// 从 MCP tool result 里抽取可读文本，便于日志与占位符解析
function resultText(result) {
  if (!result) return ''
  if (result.structuredContent) return JSON.stringify(result.structuredContent)
  const contents = result.content
  if (!Array.isArray(contents)) return typeof result === 'string' ? result : JSON.stringify(result)
  return contents.map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n')
}

function tryJson(text) {
  try { return JSON.parse(text) } catch { return text }
}

async function loadTools() {
  if (!fs.existsSync(TOOLS_FILE)) fail('还没有 tools.json，请先运行：npm run tools')
  return JSON.parse(fs.readFileSync(TOOLS_FILE, 'utf8'))
}

function findTools(tools, keywords) {
  const kw = keywords.map((k) => k.toLowerCase())
  return tools.filter((t) => {
    const s = `${t.name} ${t.description || ''}`.toLowerCase()
    return kw.every((k) => s.includes(k))
  })
}

// 列出候选工具名，供配方里的 "toolPick" 使用
function pickTool(tools, keywords, override) {
  if (override) {
    const exact = tools.find((t) => t.name === override)
    if (!exact) fail(`配方指定的工具 ${override} 不在 tools.json 里`)
    return exact.name
  }
  const found = findTools(tools, keywords)
  if (found.length === 0) fail(`找不到匹配工具：${keywords.join(' + ')}（可用 npm run inspect <name> 查）`)
  if (found.length > 1) {
    console.error(`  候选工具（取第一个）：${found.map((t) => t.name).join(', ')}`)
  }
  return found[0].name
}

// 深度取值：a.b.0.c 形式的路径
function dig(obj, dotted) {
  if (!dotted) return undefined
  return String(dotted).split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj)
}

// 解析配方参数里的 {{...}} 占位符：{{steps.<id>.<path>}} / {{env.<NAME>}} / {{ctx.<key>}}
function resolveArgs(args, ctx) {
  if (args == null) return args
  if (typeof args === 'string') {
    return args.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
      const key = expr.trim()
      if (key.startsWith('steps.')) {
        const value = dig(ctx.steps, key.slice(6))
        return value === undefined ? `{{UNRESOLVED:${key}}}` : typeof value === 'object' ? JSON.stringify(value) : String(value)
      }
      if (key.startsWith('env.')) return process.env[key.slice(4)] ?? ''
      if (key.startsWith('ctx.')) {
        const value = ctx[key.slice(4)]
        return value === undefined ? `{{UNRESOLVED:${key}}}` : typeof value === 'object' ? JSON.stringify(value) : String(value)
      }
      return `{{UNRESOLVED:${key}}}`
    })
  }
  if (Array.isArray(args)) return args.map((a) => resolveArgs(a, ctx))
  if (typeof args === 'object') {
    return Object.fromEntries(Object.entries(args).map(([k, v]) => [k, resolveArgs(v, ctx)]))
  }
  return args
}

async function cmdAuthStatus() {
  const summary = authSummary()
  const meta = await discover().catch((e) => ({ error: e.message }))
  const resourceMeta = await discoverResource().catch((e) => ({ error: e.message }))
  out({ summary, authorizationServer: meta, protectedResource: resourceMeta })
}

async function cmdAuthLogin() {
  console.error('正在打开 LibTV 授权页；如未自动打开，请复制下面的 URL 到浏览器，用微信扫码确认：')
  await login({ onAuthorizeUrl: (url) => console.error(`\n${url}\n`) })
  out({ ok: true, ...authSummary() })
}

function cmdAuthLogout() {
  clearCreds()
  resetSession()
  out({ ok: true, message: '本地凭据与 LibTV.lock 授权锁已清除，可重新访问 /auth 授权' })
}

async function cmdTools() {
  const list = await listTools()
  const tools = list.tools || []
  const payload = {
    fetchedAt: new Date().toISOString(),
    protocolHints: { instructions: list.instructions || null, serverInfo: list.serverInfo || null },
    count: tools.length,
    tools,
  }
  fs.writeFileSync(TOOLS_FILE, `${JSON.stringify(payload, null, 2)}\n`)
  saveRun('tools-list', { count: tools.length, names: tools.map((t) => t.name) })

  // 按文件名前缀做粗分类，便于快速定位生成/上传/导出工具
  const groups = {}
  for (const t of tools) {
    const key = t.name.split('_')[0]
    ;(groups[key] ||= []).push(t.name)
  }
  out({ savedTo: path.relative(PROJECT_ROOT, TOOLS_FILE), count: tools.length, groups, instructions: list.instructions || null })
}

async function cmdProbe() {
  // 参数按 data/tools.json 的真实 schema 填写（2026-11-25 实测校准）
  const checks = [
    { label: 'doctor', name: 'doctor', args: {} },
    { label: 'capabilities_image', name: 'get_capabilities', args: { capabilityId: 'image-creation', detail: 'summary' } },
    { label: 'search_models_image', name: 'search_models', args: { action: 'search', nodeType: 'image', query: 'image' } },
    { label: 'search_models_video', name: 'search_models', args: { action: 'search', nodeType: 'video', query: 'video' } },
  ]
  const results = []
  for (const check of checks) {
    const { label, name, args } = check
    if (!name) fail(`check ${label} 缺少 name`)
    console.error(`→ ${label} (工具: ${name})`)
    const r = await callTool(name, args)
    const text = resultText(r.result)
    results.push({ label, tool: name, args, ok: r.ok, elapsedMs: r.elapsedMs, text: tryJson(text) })
    console.error(`  ${r.ok ? '✓' : '✗'} ${r.elapsedMs}ms`)
  }
  saveRun('probe', results)
  out(results)
}

async function cmdInspect() {
  const name = cmd || rest[0]
  if (!name) fail('用法：npm run inspect -- doctor')
  const { tools } = await loadTools()
  const tool = tools.find((t) => t.name === name)
  if (!tool) fail(`工具 ${name} 不存在，共 ${tools.length} 个工具`)
  out(tool)
}

async function cmdCall() {
  const name = cmd || rest[0]
  const argsJson = (cmd ? rest : rest.slice(1)).join(' ')
  if (!name) fail("用法：npm run call -- <toolName> '{\"prompt\":\"...\"}'")
  let args = {}
  if (argsJson) {
    try { args = JSON.parse(argsJson) } catch (e) { fail(`参数不是合法 JSON：${e.message}`) }
  }
  console.error(`→ ${name}`)
  const r = await callTool(name, args)
  const text = resultText(r.result)
  const payload = { tool: name, args, ok: r.ok, elapsedMs: r.elapsedMs, text: tryJson(text), raw: r.result }
  saveRun(`call-${name}`, payload)
  out(payload)
}

async function cmdVerify() {
  const recipeName = cmd || rest[0] || 'image'
  const file = path.join(RECIPES_DIR, `${recipeName}.json`)
  if (!fs.existsSync(file)) fail(`配方不存在：${path.relative(PROJECT_ROOT, file)}`)
  const recipe = JSON.parse(fs.readFileSync(file, 'utf8'))
  const { tools } = await loadTools()
  // context 自身也可能含 {{env.X}} 占位符（如 projectId），先解析一遍再用于 step 参数展开
  const ctx = { steps: {}, ...resolveArgs(recipe.context || {}, { steps: {} }) }

  console.error(`▶ 配方：${recipe.name || recipeName}（${recipe.steps.length} 步）`)
  const log = { recipe: recipeName, startedAt: new Date().toISOString(), steps: [], ok: true }

  for (const step of recipe.steps) {
    const name = pickTool(tools, step.match || [step.tool], step.tool)
    const args = resolveArgs(step.args || {}, ctx)
    console.error(`→ [${step.id}] ${name}  ${JSON.stringify(args).slice(0, 200)}`)
    const r = await callTool(name, args, { timeoutMs: step.timeoutMs })
    const text = resultText(r.result)
    const parsed = tryJson(text)
    ctx.steps[step.id] = parsed
    const entry = {
      id: step.id, tool: name, args, ok: r.ok, elapsedMs: r.elapsedMs,
      result: parsed, unresolved: JSON.stringify(args).includes('{{UNRESOLVED'),
    }
    log.steps.push(entry)
    if (!r.ok || entry.unresolved) log.ok = false
    console.error(`  ${r.ok ? '✓' : '✗'} ${r.elapsedMs}ms${entry.unresolved ? '  ⚠ 有未解析占位符' : ''}`)
    if (!r.ok) break
  }

  log.finishedAt = new Date().toISOString()
  const saved = saveRun(`verify-${recipeName}`, log)
  out({ ok: log.ok, steps: log.steps.map((s) => ({ id: s.id, tool: s.tool, ok: s.ok, elapsedMs: s.elapsedMs })), log: path.relative(PROJECT_ROOT, saved) })
}

async function cmdCli() {
  if (cmd === 'install') {
    const { installCli } = await import('../src/cli.mjs')
    return installCli()
  }
  if (cmd === 'probe') {
    const { probeCli } = await import('../src/cli.mjs')
    return probeCli()
  }
  fail('用法：npm run cli:install 或 npm run cli:probe')
}

async function main() {
  if (!group) {
    console.log(`阶段1验证工具
  npm run auth:status          查看授权状态与 OAuth 元数据
  npm run auth:login           微信扫码授权（一次即可）
  npm run tools                拉取全量工具 schema 到 data/tools.json
  npm run probe                只读探活（doctor / account_user / models）
  npm run inspect -- <name>    查看某个工具的完整参数 schema
  npm run call -- <name> '<json>'  调用任意工具
  npm run verify -- image      按配方跑生成链路（image/video/export）
  npm run cli:install          安装官方 CLI 到 data/cli/
  npm run cli:probe            对比评估 CLI 路线`)
    return
  }
  switch (group) {
    case 'auth':
      if (cmd === 'status') return cmdAuthStatus()
      if (cmd === 'login') return cmdAuthLogin()
      if (cmd === 'logout') return cmdAuthLogout()
      fail('auth 子命令：status | login | logout')
      break
    case 'tools': return cmdTools()
    case 'probe': return cmdProbe()
    case 'inspect': return cmdInspect()
    case 'call': return cmdCall()
    case 'verify': return cmdVerify()
    case 'cli': return cmdCli()
    default: fail(`未知命令：${group}`)
  }
}

main().catch((err) => {
  if (err instanceof AuthRequired || /尚未授权|授权已失效/.test(err.message)) {
    console.error(`\n✗ 需要授权：${err.message}`)
    console.error('  运行：npm run auth:login\n')
  } else {
    console.error(`\n✗ ${err.stack || err.message}\n`)
  }
  process.exit(1)
})
