// 任务持久化：每个 job 一个 JSON 文件（data/jobs/<id>.json）
// 设计要点：
//   - 视频等异步任务跨重启可恢复：task_status 是服务端权威源，重启后从 processing 状态继续轮询
//   - 幂等键与 task_id 持久化，重试/恢复绝不重复创建付费任务
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config, ensureDirs } from './config.mjs'

ensureDirs()

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

/** 新的幂等键；attempt > 0 时加后缀（终态失败后重试需要新键才不会取回失败任务） */
export function idempotencyKey(jobId, operation, attempt = 0) {
  const suffix = attempt > 0 ? `-a${attempt}` : ''
  return `gw-${jobId}-${operation}${suffix}`.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 200)
}

const jobs = new Map() // id -> state（内存为主，文件为持久层）

function filePath(id) {
  // 防路径穿越
  const safe = String(id).replace(/[^A-Za-z0-9_-]/g, '')
  return path.join(config.JOBS_DIR, `${safe}.json`)
}

export function saveJob(job) {
  job.updatedAt = new Date().toISOString()
  jobs.set(job.id, job)
  fs.writeFileSync(filePath(job.id), JSON.stringify(job, null, 2))
  return job
}

export function createJob({ type, model, params }) {
  const job = {
    id: newId(type === 'video' ? 'vid' : 'img'),
    type, // image | image-edit | video
    status: 'queued', // queued | processing | succeeded | failed
    createdAt: new Date().toISOString(),
    model,
    params,
    attempts: 0,
    events: [],
  }
  return saveJob(job)
}

export function getJob(id) {
  if (jobs.has(id)) return jobs.get(id)
  const file = filePath(id)
  if (fs.existsSync(file)) {
    try {
      const job = JSON.parse(fs.readFileSync(file, 'utf8'))
      jobs.set(id, job)
      return job
    } catch { return null }
  }
  return null
}

export function logEvent(job, message, data) {
  job.events.push({ at: new Date().toISOString(), message, ...(data ? { data } : {}) })
  if (job.events.length > 100) job.events.splice(0, job.events.length - 100) // 截断防膨胀
  saveJob(job)
}

/** 重启恢复：找出所有 processing/queued 的任务，由 orchestrator 重新接管轮询 */
export function loadResumableJobs() {
  const out = []
  for (const file of fs.readdirSync(config.JOBS_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const job = JSON.parse(fs.readFileSync(path.join(config.JOBS_DIR, file), 'utf8'))
      jobs.set(job.id, job)
      if (job.status === 'processing' && job.taskId) out.push(job)
    } catch { /* 跳过损坏文件 */ }
  }
  return out
}

/** 对外暴露的 job 视图（剥离内部事件详情） */
export function publicView(job) {
  const view = {
    id: job.id,
    status: job.status,
    model: job.model,
    type: job.type,
    created_at: Math.floor(new Date(job.createdAt).getTime() / 1000),
  }
  if (job.status === 'succeeded') {
    view.result = job.result
  }
  if (job.status === 'failed') {
    view.error = job.error
  }
  if (job.status === 'processing') {
    view.progress = job.progress ?? null
  }
  return view
}
