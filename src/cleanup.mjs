// 画布清理："用完就删"
// 生成成功后删除本次任务在画布上创建的节点（生成节点 + 参考图节点），
// 避免长期运行后画布堆积垃圾节点。删除是尽力而为：失败只记日志，不影响任务结果
// （下游已经先拿到镜像/URL，画布节点此时已无用途）。
import { toolJson } from './libtv.mjs'
import { idempotencyKey } from './jobs.mjs'
import { config } from './config.mjs'
import { withRetry } from './retry.mjs'

async function deleteNode(nodeKey, jobId, tag) {
  if (!nodeKey) return false
  try {
    await withRetry(
      () => toolJson('delete_node', {
        node: nodeKey,
        idempotencyKey: idempotencyKey(`${jobId}-${tag}-${nodeKey}`.slice(0, 200), 'del'),
        projectId: config.PROJECT_ID,
      }),
      { attempts: 3, base: 1000 },
    )
    return true
  } catch (err) {
    console.error(`[cleanup] 删除节点 ${nodeKey} 失败（不影响任务）：${err.message.slice(0, 150)}`)
    return false
  }
}

/** 清理一个任务产生的所有画布节点 */
export async function cleanupJobNodes(job) {
  if (!config.CLEANUP_CANVAS_NODES) return { deleted: 0 }
  const keys = [...new Set([job.result?.node_key, job.referenceNodeId].filter(Boolean))]
  let deleted = 0
  for (const key of keys) {
    if (await deleteNode(key, job.id, 'cleanup')) deleted++
  }
  return { deleted, total: keys.length }
}
