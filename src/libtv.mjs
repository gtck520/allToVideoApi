// LibTV 工具调用编排层：提交 / 轮询 / 取结果 / 模型发现
// 稳定性核心设计：
//   1. 提交重试复用同一幂等键（已实测：服务端幂等重放安全，算力不足等瞬时错误重放可恢复）
//   2. 终态失败用新幂等键重试（同键只会取回失败任务）
//   3. 轮询容忍连续网络错误，task_status 是权威源；超时不删除任务，异步查询可恢复续看
//   4. 401 刷新在 mcp.mjs 已处理；此处再叠加传输层指数退避
import { callTool } from './mcp.mjs'
import { withRetry, isRetryableToolText, NonRetryableError } from './retry.mjs'
import { config } from './config.mjs'
import { idempotencyKey } from './jobs.mjs'

export class TimeoutError extends Error {
  constructor(msg) { super(msg); this.code = 'timeout' }
}

/** 调用工具并解析 JSON 输出；isError 文本按可重试性分类 */
export async function toolJson(name, args, opts = {}) {
  const r = await callTool(name, args, opts)
  const text = r.result?.content?.map((c) => c.text || '').join('') || ''
  if (!r.ok) {
    if (isRetryableToolText(text)) throw new Error(text.slice(0, 500))
    throw new NonRetryableError(`${name} 失败：${text.slice(0, 500)}`)
  }
  try { return JSON.parse(text) } catch { return { __raw: text } }
}

/**
 * 提交生成任务（generation_submit）。
 * attempt > 0 时换新幂等键（旧键关联的任务已终态失败）。
 * @returns {{ taskId: string, accepted: boolean }}
 */
export async function submitGeneration({ jobId, kind, model, prompt, params, attempt = 0 }) {
  const key = idempotencyKey(jobId, 'submit', attempt)
  const args = {
    project_id: config.PROJECT_ID,
    idempotency_key: key,
    kind,
    request: { model, prompt, params: params || {} },
  }
  const out = await withRetry(
    () => toolJson('generation_submit', args),
    {
      attempts: config.SUBMIT_RETRIES,
      base: 2000, max: 20000,
      onRetry: (e, a, w) => console.error(`[submit ${jobId}] 重试 ${a}/${config.SUBMIT_RETRIES}，${w}ms 后：${e.message.slice(0, 150)}`),
    },
  )
  const taskId = out.task_id ?? out.taskId
  if (!taskId) {
    throw new NonRetryableError(`generation_submit 返回缺 task_id：${JSON.stringify(out).slice(0, 400)}`, { httpStatus: 502 })
  }
  return { taskId, accepted: out.status === 'accepted', idempotencyKey: key }
}

/**
 * create_node 提交（图像编辑走画布引用边）。
 * run=true 直接发起生成并返回 task_id；left 为引用的源图片节点。
 */
export async function createNodeRun({ jobId, model, prompt, params, referenceNodeIds, attempt = 0 }) {
  const key = idempotencyKey(jobId, 'node', attempt)
  const args = {
    name: `gw-${jobId}`,
    nodeType: 'image',
    idempotencyKey: key,
    model,
    // 注意：实测服务端拒绝 image 节点带 intent（"Node intent is only used for video nodes"）；
    // 图生图模式由引用边自动推导（"Image generation mode is derived from the final image references"）
    projectId: config.PROJECT_ID,
    prompt,
    params: params || {},
    left: referenceNodeIds,
    run: true,
  }
  const out = await withRetry(
    () => toolJson('create_node', args),
    {
      attempts: config.SUBMIT_RETRIES,
      base: 2000, max: 20000,
      onRetry: (e, a, w) => console.error(`[node ${jobId}] 重试 ${a}/${config.SUBMIT_RETRIES}，${w}ms 后：${e.message.slice(0, 150)}`),
    },
  )
  const taskId = out.task_id ?? out.taskId ?? out.taskIdOfRun ?? null
  if (!taskId) {
    // run=true 但没拿到 task_id：查节点信息过于复杂，直接报错让客户端重试（幂等键可恢复）
    throw new NonRetryableError(`create_node(run=true) 返回缺 task_id：${JSON.stringify(out).slice(0, 500)}`, { httpStatus: 502 })
  }
  return { taskId, nodeId: out.nodeId ?? out.node_id ?? null, idempotencyKey: key }
}

/**
 * generate_video 提交（图生视频：referenceImageNodes）。
 * run=true 服务端会等待到可播放或终态，调用本身可能挂起数分钟——超时后用同一幂等键重试恢复。
 */
export async function generateVideoRun({ jobId, model, prompt, params, referenceImageNodes = [], attempt = 0 }) {
  const key = idempotencyKey(jobId, 'video', attempt)
  const args = {
    name: `gw-${jobId}`,
    prompt,
    model,
    run: true,
    idempotencyKey: key,
    projectId: config.PROJECT_ID,
    params: params || {},
    ...(referenceImageNodes.length ? { referenceImageNodes } : {}),
  }
  const out = await withRetry(
    () => toolJson('generate_video', args, { timeoutMs: config.VIDEO_TIMEOUT_MS }),
    {
      attempts: config.SUBMIT_RETRIES,
      base: 3000, max: 30000,
      onRetry: (e, a, w) => console.error(`[video ${jobId}] 重试 ${a}/${config.SUBMIT_RETRIES}，${w}ms 后：${e.message.slice(0, 150)}`),
    },
  )
  const taskId = out.task_id ?? out.taskId
  return { taskId, result: out.result ?? null, artifacts: out.artifacts ?? null, idempotencyKey: key }
}

/** 轮询任务直到终态或超时 */
export async function waitForTask(taskId, { timeoutMs, onPoll } = {}) {
  const deadline = Date.now() + timeoutMs
  let consecutiveErrors = 0
  while (Date.now() < deadline) {
    let st
    try {
      st = await withRetry(() => toolJson('task_status', { task_id: taskId, project_id: config.PROJECT_ID }), { attempts: 2, base: 800 })
      consecutiveErrors = 0
    } catch (err) {
      consecutiveErrors++
      if (consecutiveErrors > config.POLL_MAX_ERRORS) throw new Error(`连续 ${consecutiveErrors} 次轮询失败：${err.message.slice(0, 200)}`)
      await new Promise((r) => setTimeout(r, config.POLL_INTERVAL_MS * 2))
      continue
    }
    const readiness = st.readiness
    onPoll?.(st)
    if (readiness === 'TERMINAL_READY') {
      if (st.outcome === 'SUCCEEDED') {
        return { ok: true, artifacts: st.artifacts || [], result: st.result, raw: st }
      }
      const summary = st.error?.summary || st.error?.code || '未知错误'
      const err = new Error(`生成失败：${summary}`)
      err.terminal = true
      err.raw = st
      throw err
    }
    // PROCESSING / 其他非终态 → 继续轮
    await new Promise((r) => setTimeout(r, config.POLL_INTERVAL_MS + Math.floor(Math.random() * 800)))
  }
  throw new TimeoutError(`任务 ${taskId} 在 ${Math.round(timeoutMs / 1000)}s 内未到终态（任务保留，可继续查询）`)
}

/** 从 artifacts 提取 node_key，再用 inspect_media 换取媒体直链 */
export async function fetchMediaFromArtifacts(artifacts) {
  const item = Array.isArray(artifacts) ? artifacts.find((a) => a.node_key) : null
  if (!item) throw new NonRetryableError(`artifacts 中没有 node_key：${JSON.stringify(artifacts).slice(0, 300)}`, { httpStatus: 502 })
  return fetchMediaUrl(item.node_key)
}

export async function fetchMediaUrl(nodeKey) {
  const info = await withRetry(
    () => toolJson('inspect_media', { node: nodeKey, projectId: config.PROJECT_ID }),
    { attempts: 3, base: 1000 },
  )
  const urls = info?.media?.urls || info?.evidence?.visual?.sourceUrl && [info.evidence.visual.sourceUrl] || []
  if (!urls.length) throw new NonRetryableError(`inspect_media 未返回 URL：${JSON.stringify(info).slice(0, 400)}`, { httpStatus: 502 })
  return {
    url: urls[0],
    width: info?.media?.dimensions?.width ?? info?.media?.metadata?.width ?? null,
    height: info?.media?.dimensions?.height ?? info?.media?.metadata?.height ?? null,
    nodeKey,
  }
}

/** 多图产物全部取回（count>1 时 artifacts 有多项） */
export async function fetchAllMedia(artifacts) {
  const keys = (Array.isArray(artifacts) ? artifacts : []).filter((a) => a?.node_key).map((a) => a.node_key)
  if (!keys.length) throw new NonRetryableError(`artifacts 中没有 node_key：${JSON.stringify(artifacts).slice(0, 300)}`, { httpStatus: 502 })
  return Promise.all(keys.map((k) => fetchMediaUrl(k)))
}

// ---- 模型发现（/v1/models 用，带缓存） ----
let modelCache = { at: 0, image: [], video: [] }
const contractCache = new Map() // modelKey -> { at, contract }

async function searchModels(nodeType, query) {
  const out = await withRetry(() => toolJson('search_models', { action: 'search', nodeType, query }), { attempts: 2, base: 1000 })
  return Array.isArray(out.matches) ? out.matches : Array.isArray(out.models) ? out.models : []
}

export async function listModels(force = false) {
  if (!force && Date.now() - modelCache.at < config.MODEL_CACHE_MS && modelCache.image.length) return modelCache
  // 关键：query 必须传空字符串，LibTV 会把非空 query 当作名称/描述过滤。
  // 之前传 'image'/'video' 只匹配到名字里带这些词的模型（图像 21 / 视频 5），
  // 漏掉了 wanx3.0、wanxiang-*、kling-*、seedance-*、jimeng-* 等大量模型。
  const [image, video] = await Promise.all([searchModels('image', ''), searchModels('video', '')])
  modelCache = { at: Date.now(), image, video }
  return modelCache
}

/**
 * 实时获取模型参数契约（get_model.inputContract）。
 * 下游选模型/参数的依据：parameterSchemas 里是 LibTV 当前支持的
 * ratio / resolution / duration / count 等枚举与默认值。
 * 网关不做任何限制——LibTV 能力升级后这里自动跟随。
 */
export async function getModelContract(modelKey) {
  const hit = contractCache.get(modelKey)
  if (hit && Date.now() - hit.at < config.MODEL_CACHE_MS) return hit.contract
  let out
  try {
    out = await withRetry(() => toolJson('get_model', { model: modelKey }), { attempts: 2, base: 1000 })
  } catch (err) {
    if (/MODEL_LOOKUP_FAILED|未找到模型/.test(err.message)) {
      throw new NonRetryableError(`模型不存在：${modelKey}`, { code: 'model_not_found', httpStatus: 404 })
    }
    throw err
  }
  if (out.ok === false || !out.inputContract) {
    throw new NonRetryableError(`模型 ${modelKey} 不存在或未返回契约：${JSON.stringify(out).slice(0, 300)}`, { code: 'model_not_found', httpStatus: 404 })
  }
  contractCache.set(modelKey, { at: Date.now(), contract: out.inputContract })
  return out.inputContract
}

/** 并发拉取多个模型契约（detail=full 用，限流防刷） */
export async function getModelContracts(modelKeys, concurrency = 6) {
  const out = {}
  let i = 0
  const workers = Array.from({ length: Math.min(concurrency, modelKeys.length) }, async () => {
    while (i < modelKeys.length) {
      const key = modelKeys[i++]
      try { out[key] = await getModelContract(key) } catch (err) { out[key] = { error: err.message.slice(0, 200) } }
    }
  })
  await Promise.all(workers)
  return out
}

export function resolveModel(requested, kind) {
  const list = kind === 'video' ? modelCache.video : modelCache.image
  if (!requested) return kind === 'video' ? config.DEFAULT_VIDEO_MODEL : config.DEFAULT_IMAGE_MODEL
  // 精确 modelKey / modelId / displayName 不区分大小写匹配
  const hit = list.find(
    (m) => [m.modelKey, m.modelId, m.displayName, m.modelName].some((v) => v && v.toLowerCase() === String(requested).toLowerCase()),
  )
  return hit ? (hit.modelId ?? hit.modelKey) : String(requested) // 不在列表里也透传，让服务端报权威错误
}

// ---- 并发信号量：单账号额度保护 ----
export class Semaphore {
  constructor(limit) { this.limit = limit; this.active = 0; this.queue = [] }
  async acquire() {
    if (this.active < this.limit) { this.active++; return }
    await new Promise((resolve) => this.queue.push(resolve))
    this.active++
  }
  release() {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

export const generationSlots = new Semaphore(config.MAX_CONCURRENT_GENERATIONS)
