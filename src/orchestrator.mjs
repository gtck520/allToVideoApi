// 编排层：三条流水线
//   image      : generation_submit → 轮询 → inspect_media（实测已验证）
//   image-edit : 上传图→挂画布→create_node(run=true, 引用边) → 轮询 → inspect_media
//   video      : 纯文生视频走 generation_submit(kind=video)；带参考图走 generate_video(referenceImageNodes)
// 失败重试策略：终态失败换新幂等键自动重试 FAILED_TASK_RETRIES 次；瞬时错误在同一键内重试（libtv.mjs 内处理）
import { config, ensureDirs } from './config.mjs'
import { createJob, getJob, saveJob, logEvent, publicView, loadResumableJobs } from './jobs.mjs'
import { submitGeneration, createNodeRun, generateVideoRun, waitForTask, fetchAllMedia, fetchMediaUrl, generationSlots, TimeoutError } from './libtv.mjs'
import { resolveDailyCanvas } from './canvas.mjs'
import { uploadImageToCanvas } from './upload.mjs'
import { mirrorUrl } from './mirror.mjs'
import { scheduleCanvasCleanup } from './cleanup.mjs'
import { NonRetryableError } from './retry.mjs'

ensureDirs()

/** 产物取回：多图并行取全部，单图走单个 */
async function multiResult(st, projectId) {
  const keys = (st.artifacts || []).filter((a) => a?.node_key)
  if (keys.length > 1) return fetchAllMedia(st.artifacts, projectId)
  return fetchMediaUrl(keys[0]?.node_key ?? st.artifacts?.[0]?.node_key, projectId)
}

/** OpenAI size → LibTV ratio 枚举的宽松映射 */
export function sizeToRatio(size) {
  if (!size) return undefined
  if (/^\d+:\d+$/.test(size)) return size
  const m = String(size).match(/^(\d+)x(\d+)$/i)
  if (!m) return undefined
  const [, w, h] = m.map(Number)
  const ratio = w / h
  // 常用画幅就近匹配
  const table = [['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16], ['4:3', 4 / 3], ['3:4', 3 / 4], ['3:2', 3 / 2], ['2:3', 2 / 3], ['21:9', 21 / 9]]
  let best = table[0]
  for (const t of table) if (Math.abs(t[1] - ratio) < Math.abs(best[1] - ratio)) best = t
  return best[0]
}

/** OpenAI n → LibTV count 枚举（实测 enum [1,2,4]） */
export function nToCount(n) {
  const v = Math.max(1, Math.min(4, Number(n) || 1))
  if (v <= 1) return 1
  if (v === 2) return 2
  return 4
}

async function runPipeline(job, transient = {}) {
  logEvent(job, '开始处理', { model: job.model })
  job.status = 'processing'
  saveJob(job)

  for (let attempt = 0; attempt <= config.FAILED_TASK_RETRIES; attempt++) {
    try {
      let media
      const pid = job.projectId
      if (job.type === 'image') {
        const { taskId } = await submitGeneration({
          jobId: job.id, kind: 'image', model: job.model, prompt: job.params.prompt, params: job.params.libtvParams, attempt, projectId: pid,
        })
        job.taskId = taskId
        saveJob(job)
        logEvent(job, `已提交任务 ${taskId}（尝试 ${attempt + 1}）`)
        const st = await waitForTask(taskId, { timeoutMs: config.IMAGE_TIMEOUT_MS, projectId: pid, onPoll: (s) => { job.progress = s.readiness } })
        media = await multiResult(st, pid)
      } else if (job.type === 'image-edit') {
        // 1. 上传参考图（上传层内部自带重试与幂等）；图片字节在 transient，不进持久化
        const { nodeId } = await uploadImageToCanvas(transient.imageBytes, transient.fileName, job.id + (attempt > 0 ? `-a${attempt}` : ''), pid)
        logEvent(job, `参考图已挂画布 node=${nodeId}`)
        job.referenceNodeId = nodeId
        // 2. 建节点并直接发起生成
        const { taskId } = await createNodeRun({
          jobId: job.id, model: job.model, prompt: job.params.prompt, params: job.params.libtvParams, referenceNodeIds: [nodeId], attempt, projectId: pid,
        })
        job.taskId = taskId
        saveJob(job)
        logEvent(job, `编辑任务已提交 ${taskId}（尝试 ${attempt + 1}）`)
        const st = await waitForTask(taskId, { timeoutMs: config.IMAGE_TIMEOUT_MS, projectId: pid, onPoll: (s) => { job.progress = s.readiness } })
        media = await multiResult(st, pid)
      } else if (job.type === 'video') {
        let out
        if (job.params.referenceNodeId) {
          // 图生视频：generate_video + referenceImageNodes（服务端等待到终态，超时由同幂等键恢复）
          out = await generateVideoRun({
            jobId: job.id, model: job.model, prompt: job.params.prompt, params: job.params.libtvParams,
            referenceImageNodes: [job.params.referenceNodeId], attempt, projectId: pid,
          })
        } else {
          // 纯文生视频：generation_submit(kind=video)，params={} 用默认值
          const { taskId } = await submitGeneration({
            jobId: job.id, kind: 'video', model: job.model, prompt: job.params.prompt, params: job.params.libtvParams, attempt, projectId: pid,
          })
          out = { taskId }
        }
        job.taskId = out.taskId
        saveJob(job)
        logEvent(job, `视频任务已提交 ${out.taskId}（尝试 ${attempt + 1}）`)
        const st = await waitForTask(out.taskId, { timeoutMs: config.VIDEO_TIMEOUT_MS, projectId: pid, onPoll: (s) => { job.progress = s.readiness } })
        media = await multiResult(st, pid)
      }

      job.status = 'succeeded'
      const items = Array.isArray(media) ? media : [media]
      // 1. 镜像转存（先落袋，再清理画布）：LibTV URL 时效未知，下游用网关稳定地址
      if (config.MIRROR_RESULTS) {
        for (let i = 0; i < items.length; i++) {
          try {
            const m = await mirrorUrl(job.id, items[i].url, i)
            items[i].localFile = m.filePath
            items[i].contentType = m.contentType
            logEvent(job, `镜像完成 [${i}]`, { bytes: m.bytes })
          } catch (err) {
            logEvent(job, `镜像失败 [${i}]（不影响返回原始 URL）：${err.message.slice(0, 150)}`)
          }
        }
      }
      const toView = (item, i) => ({
        url: item.localFile ? `/files/${job.id}${i > 0 ? `/${i}` : ''}` : item.url, // 网关稳定地址（服务端按请求 host 补全）
        source_url: item.url, // LibTV 原始地址（时效未知）
        width: item.width,
        height: item.height,
        node_key: item.nodeKey,
        projectId: job.projectId,
      })
      job.result = {
        ...toView(items[0], 0),
        ...(items.length > 1 ? { all: items.map((m, i) => toView(m, i)) } : {}),
      }
      logEvent(job, '完成', { url: job.result.url })
      saveJob(job)
      // 2. 画布节点保留策略：永久保留 / 立即清理 / 延迟清理（尽力而为，失败不影响结果）
      try {
        const c = await scheduleCanvasCleanup(job)
        if (c.mode === 'immediate') {
          logEvent(job, `画布清理：${c.deleted}/${c.total} 个节点已删除`)
        } else if (c.mode === 'delayed') {
          logEvent(job, `画布节点保留至 ${c.at}（${c.retainHours} 小时后清理）`, { mode: 'delayed' })
        } else if (c.mode === 'disabled') {
          logEvent(job, '画布节点已保留（CLEANUP_CANVAS_NODES=false，可手动复查）', { mode: 'disabled' })
        }
        saveJob(job)
      } catch { /* 忽略 */ }
      return job
    } catch (err) {
      const isTimeout = err instanceof TimeoutError
      const canRetry = !isTimeout && err.terminal && attempt < config.FAILED_TASK_RETRIES
      logEvent(job, `尝试 ${attempt + 1} 失败：${err.message.slice(0, 300)}`, { terminal: !!err.terminal, willRetry: canRetry })
      if (isTimeout) {
        // 超时不算终态：任务保留在 processing，客户端可继续 GET 查询（视频场景）
        job.status = 'processing'
        job.progress = 'unknown'
        saveJob(job)
        return job
      }
      if (!canRetry) {
        job.status = 'failed'
        job.error = { message: err.message.slice(0, 500), code: err instanceof NonRetryableError ? err.code : (err.terminal ? 'generation_failed' : 'internal_error') }
        saveJob(job)
        return job
      }
      // 终态失败 → 换新幂等键重试
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  return job
}

/** 占槽执行（并发保护 + 兜底异常转 failed）
 *  params 必须是 JSON 可序列化的持久化字段；图片字节等大对象放 transient，不落盘 */
export async function runJob({ type, model, params, transient = {} }) {
  const job = createJob({ type, model, params })
  // 按日期画布归档：任务落进「前缀-创建日」画布（失败降级 LIBTV_PROJECT_ID）
  job.projectId = await resolveDailyCanvas()
  await generationSlots.acquire()
  try {
    return await runPipeline(job, transient)
  } catch (err) {
    job.status = 'failed'
    job.error = { message: String(err.message || err).slice(0, 500), code: 'internal_error' }
    logEvent(job, '流水线异常终止', { stack: String(err.stack).slice(0, 500) })
    saveJob(job)
    return job
  } finally {
    generationSlots.release()
  }
}

/** 重启恢复：继续轮询未完成的视频任务（仅更新持久化状态，不阻塞启动） */
export function resumeJobs() {
  const resumable = loadResumableJobs()
  for (const job of resumable) {
    console.error(`[resume] 恢复轮询任务 ${job.id}（taskId=${job.taskId}）`)
    generationSlots.acquire().then(async () => {
      try {
        const pid = job.projectId
        const st = await waitForTask(job.taskId, { timeoutMs: config.VIDEO_TIMEOUT_MS, projectId: pid })
        const medias = await fetchAllMedia(st.artifacts, pid)
        const first = medias[0]
        job.status = 'succeeded'
        if (config.MIRROR_RESULTS) {
          try {
            const m = await mirrorUrl(job.id, first.url, 0)
            job.result = { url: `/files/${job.id}`, source_url: first.url, width: first.width, height: first.height, node_key: first.nodeKey }
            logEvent(job, '镜像完成（恢复流程）', { bytes: m.bytes })
          } catch { job.result = { url: first.url, width: first.width, height: first.height, node_key: first.nodeKey } }
        } else {
          job.result = { url: first.url, width: first.width, height: first.height, node_key: first.nodeKey }
        }
        try { await scheduleCanvasCleanup(job) } catch { /* 忽略 */ }
      } catch (err) {
        job.status = 'failed'
        job.error = { message: err.message.slice(0, 500), code: 'generation_failed' }
      }
      saveJob(job)
    }).finally(() => generationSlots.release())
  }
}

export { publicView, getJob }
