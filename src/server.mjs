// OpenAI 兼容 HTTP 网关（零依赖 node:http）
// 路由：
//   GET  /healthz                    探活（含授权/额度状态摘要）
//   GET  /v1/models                  模型列表（动态发现 + 缓存）
//   POST /v1/images/generations      同步长轮询，OpenAI images 格式返回
//   POST /v1/images/edits            multipart 或 JSON(base64/url)，同步返回
//   POST /v1/videos                  异步任务，Sora 风格 {id, status}
//   GET  /v1/videos/{id}             查询任务；完成含 result.url
//   GET  /v1/videos/{id}/content     302 跳转到结果 URL
// 鉴权：Authorization: Bearer <GATEWAY_API_KEY>
import http from 'node:http'
import fs from 'node:fs'
import { config } from './config.mjs'
import { NonRetryableError } from './retry.mjs'
import { listModels, resolveModel, getModelContract, getModelContracts, generationSlots } from './libtv.mjs'
import { runJob, sizeToRatio, nToCount, getJob, publicView } from './orchestrator.mjs'
import { findMirrored } from './mirror.mjs'
import { openapi, markdownDoc, htmlDoc } from './docs.mjs'
import { initialize, callTool } from './mcp.mjs'

const MAX_BODY = 26 * 1024 * 1024 // 图片上传上限 25MB + 余量

// ---------- 基础工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function sendError(res, status, message, code, type = 'invalid_request_error') {
  sendJson(res, status, { error: { message, type, code } })
}

async function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new NonRetryableError('请求体超过大小上限', { httpStatus: 413 })); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 极简 multipart/form-data 解析（够用即可：取文件 part 与普通字段） */
function parseMultipart(body, contentType) {
  const m = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)
  if (!m) throw new NonRetryableError('multipart 缺少 boundary')
  const boundary = '--' + (m[1] || m[2]).trim()
  const parts = []
  let start = body.indexOf(boundary)
  while (start >= 0) {
    const next = body.indexOf(boundary, start + boundary.length)
    if (next < 0) break
    // part 内容位于 start+boundary 之后到 next 之前，去掉 CRLF
    const chunk = body.subarray(start + boundary.length, next)
    const headerEnd = chunk.indexOf('\r\n\r\n')
    if (headerEnd >= 0) {
      const headerText = chunk.subarray(0, headerEnd).toString('utf8')
      const content = chunk.subarray(headerEnd + 4, chunk.length - 2) // 去掉尾部 CRLF
      const nameMatch = headerText.match(/name="([^"]*)"/i)
      const fileMatch = headerText.match(/filename="([^"]*)"/i)
      const typeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i)
      parts.push({
        name: nameMatch?.[1] ?? '',
        filename: fileMatch?.[1] ?? null,
        contentType: typeMatch?.[1]?.trim() ?? null,
        data: content,
      })
    }
    start = next
  }
  return parts
}

/** 解析请求体为统一参数对象；图片字段统一转 {bytes, fileName} */
async function parseImageRequest(req, bodyBuf) {
  const contentType = req.headers['content-type'] || ''
  let fields = {}
  let image = null // { bytes, fileName }

  if (contentType.includes('multipart/form-data')) {
    for (const p of parseMultipart(bodyBuf, contentType)) {
      if (p.filename !== null && p.data.length > 0) {
        if (p.name === 'image' || !image) image = { bytes: p.data, fileName: p.filename || 'upload.png' }
      } else {
        fields[p.name] = p.data.toString('utf8')
      }
    }
  } else {
    const json = JSON.parse(bodyBuf.toString('utf8') || '{}')
    fields = json
    if (json.image) {
      if (/^https?:\/\//.test(json.image)) {
        const res = await fetch(json.image)
        if (!res.ok) throw new NonRetryableError(`下载参考图失败：HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        image = { bytes: buf, fileName: 'reference' + (json.image.match(/\.(png|jpe?g|webp)$/i)?.[0] || '.png') }
      } else {
        const dataUrl = String(json.image).match(/^data:([^;]+);base64,(.*)$/s)
        const b64 = dataUrl ? dataUrl[2] : String(json.image)
        image = { bytes: Buffer.from(b64, 'base64'), fileName: 'upload.png' }
      }
    }
  }
  return { fields, image }
}

// ---------- 路由处理 ----------
function checkAuth(req, url) {
  const header = req.headers.authorization || ''
  const m = header.match(/^Bearer\s+(.+)$/i)
  if (m && m[1] === config.API_KEY) return true
  // /files 支持 ?key= 查询参数（浏览器 <img> 等无法带 header 的场景）
  if (url.searchParams.get('key') === config.API_KEY) return true
  return false
}

/** 把 job 结果里的相对地址（/files/...）按请求 host 补全为绝对地址 */
function absolutize(host, view) {
  if (!host) return view
  const base = `http://${host}`
  if (typeof view?.result?.url === 'string' && view.result.url.startsWith('/')) {
    view.result.url = base + view.result.url
    if (Array.isArray(view.result.all)) {
      view.result.all = view.result.all.map((x) => ({ ...x, url: x.url?.startsWith('/') ? base + x.url : x.url }))
    }
  }
  return view
}

/** 提供镜像文件：/files/<jobId>[/<index>] */
function serveFile(req, res, jobId, indexStr) {
  const index = Math.max(0, parseInt(indexStr || '0', 10) || 0)
  const found = findMirrored(jobId, index)
  if (!found) { sendError(res, 404, `镜像文件不存在（任务 ${jobId} 第 ${index} 个产物）`, 'not_found'); return }
  const stat = fs.statSync(found.filePath)
  res.writeHead(200, {
    'content-type': found.contentType,
    'content-length': stat.size,
    'cache-control': 'private, max-age=86400',
    'disposition': 'inline',
  })
  fs.createReadStream(found.filePath).pipe(res)
}

async function handleModels(res, url) {
  const { image, video } = await listModels()
  const toModel = (m, modality) => ({
    id: m.modelId ?? m.modelKey,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'libtv',
    display_name: m.displayName ?? m.modelName,
    estimated_time: m.estimatedTime,
    modality,
  })
  const data = [...image.map((m) => toModel(m, 'image')), ...video.map((m) => toModel(m, 'video'))]
  // ?detail=full：附带每个模型当前的完整参数契约（清晰度/画幅/时长枚举等，实时来自 LibTV）
  if (url.searchParams.get('detail') === 'full') {
    const contracts = await getModelContracts(data.map((m) => m.id))
    for (const m of data) m.input_contract = contracts[m.id] ?? null
  }
  sendJson(res, 200, { object: 'list', data })
}

async function handleModelDetail(res, id) {
  const contract = await getModelContract(id)
  sendJson(res, 200, {
    object: 'model',
    id,
    owned_by: 'libtv',
    input_contract: contract,
    // 便捷提示：parameterSchemas.<op> 的 properties 即该模型当前支持的全部参数与枚举
    usage: '请求体的 params 字段可透传这里的任何参数（如 ratio/resolution/duration/count），由 LibTV 实时校验，网关不做限制',
  })
}

/** 合并 LibTV 参数：便利映射（size/n/seconds）打底，客户端 params 透传覆盖。
 *  网关不校验枚举——是否支持由 LibTV 实时判断（见 GET /v1/models/{id}）。 */
function mergeLibtvParams(convenience, raw) {
  return { ...convenience, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) }
}

function parseMaybeJson(v) {
  if (v && typeof v === 'object') return v
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try { return JSON.parse(v) } catch { return undefined }
  }
  return undefined
}

async function handleImageGeneration(req, res, bodyBuf) {
  let body
  try { body = JSON.parse(bodyBuf.toString('utf8') || '{}') } catch { throw new NonRetryableError('请求体不是合法 JSON') }
  const prompt = body.prompt
  if (!prompt || !String(prompt).trim()) throw new NonRetryableError('prompt 不能为空')

  const model = resolveModel(body.model, 'image')
  const libtvParams = mergeLibtvParams(
    { ratio: sizeToRatio(body.size), count: nToCount(body.n) },
    body.params,
  )

  const job = await runJob({ type: 'image', model, params: { prompt, libtvParams, openai: { size: body.size, n: body.n } } })

  if (job.status === 'processing') {
    // 同步接口超时兜底：任务保留，客户端可带 job id 再查
    sendError(res, 504, `图像生成超时未到终态，任务已保留：可用 GET /v1/videos/${job.id} 继续查询`, 'timeout', 'api_error')
    return
  }
  if (job.status === 'failed') {
    sendError(res, 500, job.error.message, job.error.code, 'api_error')
    return
  }
  const items = (job.result.all || [job.result]).map((x) => ({
    url: absolutize(req?.headers?.host, { result: { url: x.url } }).result.url,
    ...(x.source_url ? { source_url: x.source_url } : {}),
  }))
  sendJson(res, 200, { created: Math.floor(new Date(job.createdAt).getTime() / 1000), data: items, libtv: { job_id: job.id, model, node_key: job.result.node_key } })
}

async function handleImageEdit(req, res, bodyBuf) {
  const { fields, image } = await parseImageRequest(req, bodyBuf)
  const prompt = fields.prompt
  if (!prompt || !String(prompt).trim()) throw new NonRetryableError('prompt 不能为空')
  if (!image) throw new NonRetryableError('缺少参考图：multipart 传 image 文件，或 JSON 的 image 字段（URL/base64/dataURL）')

  const model = resolveModel(fields.model, 'image')
  // multipart 里 params 是 JSON 字符串、JSON 请求里是对象——parseMaybeJson 两种都能处理
  const libtvParams = mergeLibtvParams({ ratio: sizeToRatio(fields.size) }, parseMaybeJson(fields.params))
  const job = await runJob({ type: 'image-edit', model, params: { prompt, libtvParams }, transient: { imageBytes: image.bytes, fileName: image.fileName } })
  if (job.status === 'processing') {
    sendError(res, 504, `图像编辑超时未到终态，任务已保留：可用 GET /v1/videos/${job.id} 继续查询`, 'timeout', 'api_error')
    return
  }
  if (job.status === 'failed') {
    sendError(res, 500, job.error.message, job.error.code, 'api_error')
    return
  }
  const items = (job.result.all || [job.result]).map((x) => ({
    url: absolutize(req?.headers?.host, { result: { url: x.url } }).result.url,
    ...(x.source_url ? { source_url: x.source_url } : {}),
  }))
  sendJson(res, 200, { created: Math.floor(new Date(job.createdAt).getTime() / 1000), data: items, libtv: { job_id: job.id, model, reference_node: job.referenceNodeId } })
}

async function handleVideoCreate(req, res, bodyBuf) {
  let body
  try { body = JSON.parse(bodyBuf.toString('utf8') || '{}') } catch { throw new NonRetryableError('请求体不是合法 JSON') }
  const prompt = body.prompt
  if (!prompt || !String(prompt).trim()) throw new NonRetryableError('prompt 不能为空')

  const model = resolveModel(body.model, 'video')
  const libtvParams = mergeLibtvParams(
    { ratio: sizeToRatio(body.size), ...(body.seconds ? { duration: Number(body.seconds) } : {}) },
    body.params,
  )

  // 可选参考图：URL 或 base64（图生视频）
  let referenceNodeId = null
  if (body.image) {
    const { uploadImageToCanvas } = await import('./upload.mjs')
    let bytes, fileName
    if (/^https?:\/\//.test(body.image)) {
      const r = await fetch(body.image)
      if (!r.ok) throw new NonRetryableError(`下载参考图失败：HTTP ${r.status}`)
      bytes = Buffer.from(await r.arrayBuffer())
      fileName = 'reference.png'
    } else {
      bytes = Buffer.from(String(body.image).replace(/^data:[^;]+;base64,/, ''), 'base64')
      fileName = 'upload.png'
    }
    const up = await uploadImageToCanvas(bytes, fileName, 'vidref' + Date.now().toString(36))
    referenceNodeId = up.nodeId
  }

  const job = await runJob({ type: 'video', model, params: { prompt, libtvParams, referenceNodeId } })
  if (job.status === 'failed') {
    sendError(res, 500, job.error.message, job.error.code, 'api_error')
    return
  }
  sendJson(res, job.status === 'succeeded' ? 200 : 202, absolutize(req.headers.host, publicView(job)))
}

async function handleVideoGet(req, res, id, redirect) {
  const job = getJob(id)
  if (!job) { sendError(res, 404, `任务不存在：${id}`, 'not_found'); return }
  if (redirect) {
    if (job.status === 'succeeded' && (job.result?.url || job.result?.source_url)) {
      // 优先 302 到网关镜像地址；未开镜像时跳 LibTV 原始地址
      const target = job.result.url?.startsWith('/') ? `http://${req.headers.host}${job.result.url}` : (job.result.url || job.result.source_url)
      res.writeHead(302, { location: target })
      res.end()
    } else {
      sendError(res, 409, `任务未完成（${job.status}），暂无内容可取`, 'not_ready')
    }
    return
  }
  sendJson(res, 200, absolutize(req.headers.host, publicView(job)))
}

async function handleHealth(res) {
  let mcp = 'ok'
  let identity = null
  try {
    await initialize()
    const r = await callTool('doctor', {})
    const text = r.result?.content?.map((c) => c.text || '').join('') || ''
    try {
      const d = JSON.parse(text)
      identity = { status: d.status, nickname: d.identity?.nickname, member: d.identity?.accounts?.accounts?.[0]?.memberAccount?.memberName ?? null }
    } catch { /* 忽略 */ }
  } catch (e) { mcp = `error: ${e.message.slice(0, 120)}` }
  sendJson(res, 200, {
    status: mcp === 'ok' ? 'ok' : 'degraded',
    mcp,
    identity,
    slots: { active: generationSlots.active, queued: generationSlots.queue.length, limit: generationSlots.limit },
  })
}

// ---------- 服务器 ----------
export function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const route = `${req.method} ${url.pathname}`
    const started = Date.now()
    try {
      // 免鉴权：探活 + 接口文档（Agent 可直接读取对接）
      if (route === 'GET /healthz') return await handleHealth(res)
      if (route === 'GET /docs') {
        const body = Buffer.from(htmlDoc(), 'utf8')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'public, max-age=300' })
        return void res.end(body)
      }
      if (route === 'GET /openapi.json') return void sendJson(res, 200, openapi)
      if (route === 'GET /docs.md') {
        const body = Buffer.from(markdownDoc, 'utf8')
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-length': body.length, 'cache-control': 'public, max-age=300' })
        return void res.end(body)
      }

      if (!checkAuth(req, url)) {
        sendError(res, 401, '无效的 API key：请以 Authorization: Bearer <GATEWAY_API_KEY> 方式携带', 'invalid_api_key', 'invalid_request_error')
        return
      }

      // 镜像文件读取（Bearer 或 ?key= 均可）
      const fileMatch = url.pathname.match(/^\/files\/([A-Za-z0-9_-]+)(?:\/(\d+))?$/)
      if (req.method === 'GET' && fileMatch) {
        return serveFile(req, res, fileMatch[1], fileMatch[2])
      }

      if (route === 'GET /v1/models') return await handleModels(res, url)

      // 单个模型的实时参数契约：GET /v1/models/lib-image-2.6-a
      const modelDetail = url.pathname.match(/^\/v1\/models\/([A-Za-z0-9._-]+)$/)
      if (req.method === 'GET' && modelDetail) {
        return await handleModelDetail(res, modelDetail[1])
      }

      if (route === 'POST /v1/images/generations') {
        const buf = await readBody(req)
        return await handleImageGeneration(req, res, buf)
      }
      if (route === 'POST /v1/images/edits') {
        const buf = await readBody(req)
        return await handleImageEdit(req, res, buf)
      }
      if (route === 'POST /v1/videos') {
        const buf = await readBody(req)
        return await handleVideoCreate(req, res, buf)
      }
      const videoGet = url.pathname.match(/^\/v1\/videos\/([A-Za-z0-9_-]+)(\/content)?$/)
      if (req.method === 'GET' && videoGet) {
        return await handleVideoGet(req, res, videoGet[1], !!videoGet[2])
      }

      sendError(res, 404, `未知路由：${route}`, 'not_found')
    } catch (err) {
      const status = err instanceof NonRetryableError ? err.httpStatus || 400 : 500
      const code = err instanceof NonRetryableError ? err.code : 'internal_error'
      console.error(`[http] ${route} ${status} ${Date.now() - started}ms :: ${err.message.slice(0, 200)}`)
      if (!res.headersSent) sendError(res, status, err.message.slice(0, 500), code, status >= 500 ? 'api_error' : 'invalid_request_error')
    }
  })
  return server
}
