// 结果镜像与本地文件管理
// 设计：
//   - 生成成功后立刻把 LibTV 结果 URL 的字节转存到 data/results/<jobId>/<序号>.<ext>
//   - 下游通过网关稳定地址 GET /files/<jobId>（或 /files/<jobId>/<n>）读取，不依赖 LibTV 域的时效
//   - 过期镜像按 FILES_RETENTION_HOURS 清扫（"用完就删"），启动时 + 每日各扫一次
import fs from 'node:fs'
import path from 'node:path'
import { config, RESULTS_DIR } from './config.mjs'
import { withRetry } from './retry.mjs'

const EXT_BY_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4' }

function jobDir(jobId) {
  const safe = String(jobId).replace(/[^A-Za-z0-9_-]/g, '')
  return path.join(RESULTS_DIR, safe)
}

/** 转存一个结果 URL；返回 { filePath, contentType, bytes } */
export async function mirrorUrl(jobId, url, index = 0) {
  const res = await withRetry(() => fetch(url), { attempts: 3, base: 1500 })
  if (!res.ok) throw new Error(`镜像下载 HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  const ext = EXT_BY_MIME[contentType.split(';')[0].trim()] || (url.match(/\.(png|jpe?g|webp|mp4)(\?|$)/i)?.[1] ? '.' + url.match(/\.(png|jpe?g|webp|mp4)(\?|$)/i)[1].toLowerCase() : '.bin')
  const dir = jobDir(jobId)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${index}${ext}`)
  fs.writeFileSync(filePath, buf)
  return { filePath, contentType, bytes: buf.length }
}

/** 读取镜像：返回 { filePath, contentType } 或 null */
export function findMirrored(jobId, index = 0) {
  const dir = jobDir(jobId)
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter((f) => f.startsWith(`${index}.`))
  if (!files.length) return null
  const filePath = path.join(dir, files[0])
  const ext = path.extname(files[0]).toLowerCase()
  const mime = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0] || 'application/octet-stream'
  return { filePath, contentType: mime }
}

/** 清扫过期镜像 */
export function sweepExpiredFiles(retentionHours = config.FILES_RETENTION_HOURS) {
  if (!retentionHours || retentionHours <= 0) return { removed: 0 }
  const cutoff = Date.now() - retentionHours * 3600 * 1000
  let removed = 0
  if (!fs.existsSync(RESULTS_DIR)) return { removed }
  for (const dir of fs.readdirSync(RESULTS_DIR)) {
    const full = path.join(RESULTS_DIR, dir)
    try {
      const stat = fs.statSync(full)
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        fs.rmSync(full, { recursive: true, force: true })
        removed++
      }
    } catch { /* 跳过 */ }
  }
  return { removed }
}
