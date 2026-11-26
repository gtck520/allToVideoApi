// 极简 MCP Streamable HTTP 客户端
// 关键点（来自参考实现实测）：
//   1. initialize → notifications/initialized → tools/list 必须串行，否则被服务端拒绝
//   2. 响应可能是 application/json，也可能是 text/event-stream（SSE 的 data: 行）
//   3. 会话 id 在 mcp-session-id 响应头里，后续请求必须带上
//   4. HTTP 401 = token 被提前吊销，强制 refresh 后重发一次

import { MCP_URL, getAccessToken, AuthRequired } from './oauth.mjs'
import { logMcp } from './logger.mjs'

const PROTOCOL_VERSION = '2025-06-18'
const CLIENT_INFO = { name: 'libtv-mcp-probe', version: '0.1.0' }
export const TOOL_TIMEOUT_MS = Number(process.env.LIBTV_TOOL_TIMEOUT_MS || 20 * 60 * 1000)

let sessionId = null
let ready = false
let initQueue = Promise.resolve()

async function post(token, payload, { timeoutMs = 20000 } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  }
  if (sessionId) headers['mcp-session-id'] = sessionId
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const nextSession = res.headers.get('mcp-session-id')
    if (nextSession && nextSession !== sessionId) sessionId = nextSession
    return res
  } finally {
    clearTimeout(timer)
  }
}

async function parseResponse(res) {
  if (res.status === 202 || res.status === 204) return []
  if (!res.ok) return { __httpError: res.status, __body: (await res.text().catch(() => '')).slice(0, 500) }

  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('text/event-stream')) {
    const messages = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '')
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload) continue
        try { messages.push(JSON.parse(payload)) } catch { /* 非 JSON 的 data 行忽略 */ }
      }
    }
    return messages
  }
  const text = (await res.text()).trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return [{ __raw: text }]
  }
}

async function sendOnce(payload, timeoutMs) {
  let token = await getAccessToken()
  let res = await post(token, payload, { timeoutMs })
  if (res.status === 401) {
    token = await getAccessToken({ force: true }) // 强制刷新再试一次
    res = await post(token, payload, { timeoutMs })
  }
  const messages = await parseResponse(res)
  if (messages.length && messages[0]?.__httpError) {
    throw new Error(`MCP 返回 HTTP ${messages[0].__httpError}：${messages[0].__body}`)
  }
  return messages
}

export async function initialize() {
  return new Promise((resolve, reject) => {
    initQueue = initQueue.then(async () => {
      if (ready) return resolve({ alreadyReady: true })
      try {
        const messages = await sendOnce({
          jsonrpc: '2.0',
          id: 'probe-init',
          method: 'initialize',
          params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
        })
        await sendOnce({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
        ready = true
        resolve(messages[0] || {})
      } catch (err) {
        reject(err)
      }
    }, reject)
  })
}

export async function listTools() {
  await initialize()
  const messages = await sendOnce({ jsonrpc: '2.0', id: `probe-tools-${Date.now()}`, method: 'tools/list', params: {} })
  for (const msg of messages) {
    if (Array.isArray(msg?.result?.tools)) return msg.result
  }
  throw new Error(`tools/list 未返回工具清单：${JSON.stringify(messages).slice(0, 500)}`)
}

export async function callTool(name, args = {}, { timeoutMs = TOOL_TIMEOUT_MS, onProgress } = {}) {
  await initialize()
  const started = Date.now()
  let messages
  try {
    messages = await sendOnce(
      { jsonrpc: '2.0', id: `probe-call-${Date.now()}`, method: 'tools/call', params: { name, arguments: args } },
      timeoutMs,
    )
  } catch (err) {
    logMcp({ tool: name, method: 'tools/call', ok: false, ms: Date.now() - started, args, error: String(err.message || err).slice(0, 300) })
    throw err
  }
  for (const msg of messages) {
    if (msg?.error) {
      logMcp({ tool: name, method: 'tools/call', ok: false, ms: Date.now() - started, args, error: String(msg.error?.message || JSON.stringify(msg.error)).slice(0, 300) })
      return { ok: false, error: msg.error, elapsedMs: Date.now() - started, raw: msg }
    }
    if (msg?.result) {
      const result = msg.result
      logMcp({ tool: name, method: 'tools/call', ok: result.isError !== true, ms: Date.now() - started, args })
      onProgress?.(result)
      return { ok: result.isError !== true, result, elapsedMs: Date.now() - started, raw: msg }
    }
  }
  logMcp({ tool: name, method: 'tools/call', ok: false, ms: Date.now() - started, args, error: '未识别的响应' })
  return { ok: false, error: '未识别的响应', elapsedMs: Date.now() - started, raw: messages }
}

export function resetSession() {
  sessionId = null
  ready = false
  initQueue = Promise.resolve()
}

export { AuthRequired }
