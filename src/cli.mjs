// 官方 LibTV CLI 路线评估
// CLI 包（libtv-cli-skill.zip）只是命令手册 + 安装脚本；真正的二进制按平台从官方静态站下载。
// 这里把二进制装到项目内 data/cli/，不碰全局 PATH 和 ~/.libtv，便于两条路线隔离对比。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DATA_DIR, PROJECT_ROOT } from './paths.mjs'

const CLI_DIR = path.join(DATA_DIR, 'cli')
const BASE = 'https://liblibai-web-static.liblib.cloud/cli'
const BIN_NAME = process.platform === 'win32' ? 'libtv.exe' : 'libtv'

function platformZip(platform, arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'libtv-windows-arm64.zip' : 'libtv-windows-amd64.zip'
  if (platform === 'darwin') return arch === 'arm64' ? 'libtv-macos-arm64.zip' : 'libtv-macos-x64.zip'
  if (platform === 'linux') return arch === 'arm64' ? 'libtv-linux-arm64.zip' : 'libtv-linux-x64.zip'
  throw new Error(`不支持的平台：${platform}/${arch}`)
}

async function latestVersion() {
  const res = await fetch(`${BASE}/latest/manifest.json`)
  if (!res.ok) throw new Error(`读取 latest manifest 失败：HTTP ${res.status}`)
  const manifest = await res.json()
  return manifest.version
}

function findBinary(dir) {
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name)
      if (entry.isDirectory()) {
        const found = walk(p)
        if (found) return found
      } else if (entry.name === 'libtv' || entry.name === 'libtv.exe') {
        return p
      }
    }
    return null
  }
  return walk(dir)
}

export async function installCli() {
  fs.mkdirSync(CLI_DIR, { recursive: true })
  const binPath = path.join(CLI_DIR, BIN_NAME)
  if (fs.existsSync(binPath)) {
    console.log(JSON.stringify({ ok: true, alreadyInstalled: true, binPath: path.relative(PROJECT_ROOT, binPath) }, null, 2))
    return
  }
  const version = process.env.LIBTV_CLI_VERSION || await latestVersion()
  const zipName = platformZip(process.platform, process.arch)
  const url = `${BASE}/${version}/${zipName}`
  console.error(`→ 下载官方 CLI：${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载 CLI 失败：HTTP ${res.status}`)
  const zipPath = path.join(CLI_DIR, zipName)
  fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))

  // 用 PowerShell 解压（Windows）或 unzip（Unix）
  const extractDir = path.join(CLI_DIR, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })
  if (process.platform === 'win32') {
    const ps = `Expand-Archive -Path "${zipPath}" -DestinationPath "${extractDir}" -Force`
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`解压失败：${r.stderr}`)
  } else {
    const r = spawnSync('unzip', ['-o', '-q', zipPath, '-d', extractDir], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`解压失败：${r.stderr}`)
  }
  const found = findBinary(extractDir)
  if (!found) throw new Error(`压缩包里没找到 ${BIN_NAME}：${extractDir}`)
  fs.copyFileSync(found, binPath)
  if (process.platform !== 'win32') fs.chmodSync(binPath, 0o755)
  console.log(JSON.stringify({ ok: true, version, url, binPath: path.relative(PROJECT_ROOT, binPath) }, null, 2))
}

export function probeCli() {
  const binPath = path.join(CLI_DIR, BIN_NAME)
  if (!fs.existsSync(binPath)) throw new Error('CLI 未安装，请先运行：npm run cli:install')
  const commands = [
    ['--help', []],
    ['project', ['list']],
    ['model', ['search', '--type', 'image']],
    ['model', ['search', '--type', 'video']],
  ]
  const results = []
  for (const [label, args] of commands) {
    const argv = label === '--help' ? ['--help'] : [label, ...args]
    const r = spawnSync(binPath, argv, { encoding: 'utf8', timeout: 60000, env: { ...process.env, LIBTV_CONFIG_DIR: path.join(DATA_DIR, 'cli-config') } })
    results.push({
      command: `libtv ${argv.join(' ')}`.trim(),
      status: r.status,
      stdout: (r.stdout || '').slice(0, 4000),
      stderr: (r.stderr || '').slice(0, 2000),
    })
    console.error(`→ libtv ${label} ... (exit ${r.status})`)
  }
  const outFile = path.join(DATA_DIR, 'runs', `${new Date().toISOString().replace(/[:.]/g, '-')}-cli-probe.json`)
  fs.writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`)
  console.log(JSON.stringify({ results, savedTo: path.relative(PROJECT_ROOT, outFile) }, null, 2))
}
