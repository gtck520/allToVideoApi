// 画布节点保留/清理策略：
//   CLEANUP_CANVAS_NODES=false           → 永不删除，留在 LibTV 画布上便于复查/留证
//   true + CANVAS_NODE_RETENTION_HOURS=0 → 生成成功后立即删除（默认，原行为）
//   true + CANVAS_NODE_RETENTION_HOURS=N → 保留 N 小时后由后台清扫删除
// 删除是尽力而为：失败只记日志，不影响任务结果。
import fs from 'node:fs'
import path from 'node:path'
import { toolJson } from './libtv.mjs'
import { idempotencyKey, logEvent } from './jobs.mjs'
import { config } from './config.mjs'
import { withRetry } from './retry.mjs'

async function deleteNode(nodeKey, jobId, tag, projectId) {
  if (!nodeKey) return false
  try {
    await withRetry(
      () => toolJson('delete_node', {
        node: nodeKey,
        idempotencyKey: idempotencyKey(`${jobId}-${tag}-${nodeKey}`.slice(0, 200), 'del'),
        projectId: projectId || config.PROJECT_ID,
      }),
      { attempts: 3, base: 1000 },
    )
    return true
  } catch (err) {
    console.error(`[cleanup] 删除节点 ${nodeKey} 失败（不影响任务）：${err.message.slice(0, 150)}`)
    return false
  }
}

/** 立即清理一个任务产生的所有画布节点（生成节点 + 参考图节点） */
export async function cleanupJobNodes(job) {
  if (!config.CLEANUP_CANVAS_NODES) return { deleted: 0, total: 0, mode: 'disabled' }
  const keys = [...new Set([job.result?.node_key, job.referenceNodeId].filter(Boolean))]
  const pid = job.projectId
  let deleted = 0
  for (const key of keys) {
    if (await deleteNode(key, job.id, 'cleanup', pid)) deleted++
  }
  return { deleted, total: keys.length, mode: 'immediate' }
}

/**
 * 任务成功后写入清理计划：
 * - disabled：节点永久保留
 * - immediate：立即删除
 * - delayed：写 canvasCleanupAt，交给后台定时清扫
 */
export async function scheduleCanvasCleanup(job) {
  if (!config.CLEANUP_CANVAS_NODES) {
    job.canvasCleanup = { mode: 'disabled', reason: 'CLEANUP_CANVAS_NODES=false', at: new Date().toISOString() }
    job.cleanedUp = false
    return { mode: 'disabled' }
  }
  const hours = config.CANVAS_NODE_RETENTION_HOURS
  if (!(hours > 0)) {
    const c = await cleanupJobNodes(job)
    job.cleanedUp = c.total === 0 || c.deleted === c.total
    job.canvasCleanup = { mode: 'immediate', deleted: c.deleted, total: c.total, at: new Date().toISOString() }
    return { ...c, mode: 'immediate' }
  }
  const at = new Date(Date.now() + hours * 3600 * 1000).toISOString()
  job.canvasCleanup = { mode: 'delayed', retainHours: hours, scheduledAt: at }
  job.canvasCleanupAt = at
  job.cleanedUp = false
  return { mode: 'delayed', at, retainHours: hours }
}

/** 后台清扫：处理到期的延迟清理任务（启动时 + 定时调用），跨重启仍有效 */
export async function sweepExpiredCanvasNodes() {
  if (!config.CLEANUP_CANVAS_NODES) return { cleaned: 0, failed: 0 }
  if (!fs.existsSync(config.JOBS_DIR)) return { cleaned: 0, failed: 0 }
  const now = Date.now()
  let cleaned = 0
  let failed = 0
  for (const file of fs.readdirSync(config.JOBS_DIR)) {
    if (!file.endsWith('.json')) continue
    let job
    try { job = JSON.parse(fs.readFileSync(path.join(config.JOBS_DIR, file), 'utf8')) } catch { continue }
    if (job.status !== 'succeeded' || job.cleanedUp || !job.canvasCleanupAt) continue
    const due = new Date(job.canvasCleanupAt).getTime()
    if (!Number.isFinite(due) || due > now) continue
    let c
    try { c = await cleanupJobNodes(job) } catch { continue }
    const done = c.total === 0 || c.deleted === c.total
    job.canvasCleanup = {
      ...(job.canvasCleanup || {}),
      mode: 'delayed-swept',
      deleted: c.deleted,
      total: c.total,
      sweptAt: new Date().toISOString(),
    }
    if (done) {
      job.cleanedUp = true
      delete job.canvasCleanupAt
      cleaned++
    } else {
      failed++
      job.canvasCleanupAt = new Date(now + 3600 * 1000).toISOString() // 删除失败，1 小时后重试
    }
    logEvent(job, `画布节点延迟清理：${c.deleted}/${c.total} 个节点已删除`, {
      mode: 'delayed-swept', deleted: c.deleted, total: c.total, done,
    })
  }
  return { cleaned, failed }
}
