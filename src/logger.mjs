// 网关日志：HTTP 访问日志 + MCP 出站日志
// 写入 data/logs/<kind>-YYYY-MM-DD.log，JSON Lines，方便用 grep / jq 排查。
// 只记关键元数据：方法、路径、状态码、耗时、模型、prompt 片段、MCP 工具名、错误信息等。
// 不记 Authorization / Cookie / token 等敏感头，不记图片字节、不落盘任何凭据。
import fs from 'node:fs'
import path from 'node:path'
import { LOGS_DIR } from './config.mjs'

const SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|token|password|secret|credential|credentials)$/i
const MAX_STRING_LEN = 300

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + '…' : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Buffer.isBuffer(value)) return `<buffer ${value.length}B>`
  if (Array.isArray(value)) {
    if (depth > 4) return '[deep]'
    return value.slice(0, 30).map((x) => redact(x, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth > 4) return '[deep]'
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEYS.test(k)) out[k] = '***'
      else out[k] = redact(v, depth + 1)
    }
    return out
  }
  return String(value)
}

function write(kind, entry) {
  try {
    if (!LOGS_DIR) return
    const date = new Date().toISOString().slice(0, 10)
    const file = path.join(LOGS_DIR, `${kind}-${date}.log`)
    fs.mkdirSync(LOGS_DIR, { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry, kind }) + '\n')
  } catch (err) {
    // 日志写盘失败不影响业务
    console.error(`[logger] 写入 ${kind} 日志失败：${err.message.slice(0, 120)}`)
  }
}

export function logRequest(entry) {
  write('http', redact(entry))
}

export function logMcp(entry) {
  write('mcp', redact(entry))
}

/** 清扫过期日志（启动时 + 定时调用），0 = 永久保留 */
export function sweepExpiredLogs(retentionHours = 24 * 7) {
  if (!retentionHours || retentionHours <= 0) return { removed: 0 }
  if (!LOGS_DIR || !fs.existsSync(LOGS_DIR)) return { removed: 0 }
  const cutoff = Date.now() - retentionHours * 3600 * 1000
  let removed = 0
  for (const file of fs.readdirSync(LOGS_DIR)) {
    if (!file.endsWith('.log')) continue
    const full = path.join(LOGS_DIR, file)
    try {
      const stat = fs.statSync(full)
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.rmSync(full, { force: true })
        removed++
      }
    } catch { /* 跳过 */ }
  }
  return { removed }
}
