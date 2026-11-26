// 上传链路：upload_ticket → 分片直传 OSS → upload_complete → upload_media（挂画布节点）
// 实测要点（来自 upload_ticket 工具描述）：
//   - 分片字节必须"裸"PUT：不带 Content-Type / Content-MD5 等任何头，多带一个头就 SignatureDoesNotMatch
//   - upload_complete 返回 file_ref，upload_media 用它把媒体挂到画布，产生节点 ID
import { toolJson } from './libtv.mjs'
import { withRetry, NonRetryableError } from './retry.mjs'
import { config } from './config.mjs'
import { idempotencyKey } from './jobs.mjs'

/** 从 upload_ticket 输出中稳健提取分片 URL 列表（不依赖具体字段名） */
function extractPartUrls(output) {
  const urls = []
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /^https?:\/\//.test(v) && /part|upload|oss|sign/i.test(k + ' ' + JSON.stringify(Object.keys(node)))) {
        urls.push(v)
      } else if (typeof v === 'object') {
        visit(v)
      }
    }
  }
  visit(output)
  return [...new Set(urls)].sort((a, b) => {
    const pa = a.match(/[?&]partNumber=(\d+)/)?.[1] ?? a.match(/part[-_]?(\d+)/i)?.[1] ?? '0'
    const pb = b.match(/[?&]partNumber=(\d+)/)?.[1] ?? b.match(/part[-_]?(\d+)/i)?.[1] ?? '0'
    return Number(pa) - Number(pb)
  })
}

async function putPart(url, bytes) {
  // 关键：裸 PUT，任何附加头都会导致签名不匹配（实测文档明确警告）
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'PUT', body: bytes })
      if (res.ok) return
      const body = await res.text().catch(() => '')
      if (res.status >= 500 || res.status === 429) throw new Error(`OSS ${res.status}: ${body.slice(0, 200)}`)
      throw new NonRetryableError(`OSS PUT ${res.status}: ${body.slice(0, 300)}`, { httpStatus: 502 })
    } catch (err) {
      if (err instanceof NonRetryableError) throw err
      if (attempt === 2) throw err
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }
}

/**
 * 上传一张图并挂到画布，返回 { nodeId, resourceId }
 * @param {Buffer} bytes 图片字节
 * @param {string} fileName 文件名（带扩展名）
 * @param {string} jobId 用于幂等键
 */
export async function uploadImageToCanvas(bytes, fileName, jobId, projectId) {
  const fileSize = bytes.length
  if (fileSize > 200 * 1024 * 1024) throw new NonRetryableError('图片超过 200MB 上限')
  if (fileSize === 0) throw new NonRetryableError('图片内容为空')
  const pid = projectId || config.PROJECT_ID

  // 1. 申请签名分片 URL（幂等安全：纯资源创建）
  const ticket = await withRetry(
    () => toolJson('upload_ticket', { file_name: fileName, file_size: fileSize, projectId: pid }),
    { attempts: 3, base: 1000, onRetry: (e, a, w) => console.error(`[upload] ticket 重试 ${a}，${w}ms 后：${e.message.slice(0, 120)}`) },
  )
  const uploadId = ticket.upload_id ?? ticket.uploadId ?? ticket.uploadID
  const path_ = ticket.path ?? ticket.filePath ?? ticket.key
  if (!uploadId || !path_) {
    throw new NonRetryableError(`upload_ticket 返回缺 upload_id/path：${JSON.stringify(ticket).slice(0, 400)}`, { httpStatus: 502 })
  }
  const partUrls = extractPartUrls(ticket)
  if (!partUrls.length) {
    throw new NonRetryableError(`upload_ticket 未返回可用的分片 URL：${JSON.stringify(ticket).slice(0, 600)}`, { httpStatus: 502 })
  }

  // 2. 分片直传（单分片最常见；多分片按 part_size 切）
  const partSize = ticket.part_size ?? ticket.partSize ?? 5 * 1024 * 1024
  if (partUrls.length === 1) {
    await putPart(partUrls[0], bytes)
  } else {
    for (let i = 0; i < partUrls.length; i++) {
      await putPart(partUrls[i], bytes.subarray(i * partSize, (i + 1) * partSize))
    }
  }

  // 3. 完成上传，拿 file_ref
  const completed = await withRetry(
    () => toolJson('upload_complete', { path: path_, upload_id: uploadId }),
    { attempts: 3, base: 1000 },
  )
  const fileRef = completed.file_ref ?? completed.fileRef ?? completed.ref
  if (!fileRef) {
    throw new NonRetryableError(`upload_complete 返回缺 file_ref：${JSON.stringify(completed).slice(0, 400)}`, { httpStatus: 502 })
  }

  // 4. 挂到画布产生节点（幂等：upload_media 支持 idempotencyKey 重放；节点名必须唯一，用 jobId 防冲突）
  const key = idempotencyKey(jobId, 'uploadmedia')
  const nodeName = `gw-${jobId}-ref`
  const media = await withRetry(
    () => toolJson('upload_media', { name: nodeName, idempotencyKey: key, fileRef, mediaType: 'image', projectId: pid }),
    { attempts: 3, base: 1500 },
  )
  const nodeId = media.nodeId ?? media.node_id ?? media.resourceId ?? media.resource_id
  if (!nodeId) {
    throw new NonRetryableError(`upload_media 返回缺 nodeId：${JSON.stringify(media).slice(0, 500)}`, { httpStatus: 502 })
  }
  return { nodeId, resourceId: media.resourceId ?? media.resource_id ?? null, fileRef, status: media.status }
}
