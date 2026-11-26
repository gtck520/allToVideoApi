// 网关启动入口：node bin/gateway.mjs 或 npm start
import { config, ensureDirs } from '../src/config.mjs'
import { startServer } from '../src/server.mjs'
import { resumeJobs } from '../src/orchestrator.mjs'
import { sweepExpiredFiles } from '../src/mirror.mjs'
import { sweepExpiredCanvasNodes } from '../src/cleanup.mjs'
import { sweepExpiredLogs } from '../src/logger.mjs'
import { resetSession, initialize } from '../src/mcp.mjs'
import { authLockInfo } from '../src/auth-lock.mjs'

ensureDirs()
resetSession()

// 本地镜像"用完就删"：启动时清一次 + 每 6 小时清一次
sweepExpiredFiles()
setInterval(() => {
  const { removed } = sweepExpiredFiles()
  if (removed) console.error(`[mirror] 已清理 ${removed} 个过期镜像目录`)
}, 6 * 3600 * 1000).unref()

// 日志留存：启动时清一次过期日志 + 每 6 小时清一次
sweepExpiredLogs()
setInterval(() => {
  const { removed } = sweepExpiredLogs()
  if (removed) console.error(`[logger] 已清理 ${removed} 个过期日志文件`)
}, 6 * 3600 * 1000).unref()

// 画布节点延迟清理：启动时清一次 + 每 10 分钟清一次（策略由 CLEANUP_CANVAS_NODES / CANVAS_NODE_RETENTION_HOURS 决定）
sweepExpiredCanvasNodes().catch((e) => console.error(`[canvas] 启动清扫失败：${e.message.slice(0, 150)}`))
setInterval(() => {
  sweepExpiredCanvasNodes()
    .then(({ cleaned, failed }) => {
      if (cleaned || failed) console.error(`[canvas] 延迟清理：${cleaned} 个任务完成，${failed} 个任务待重试`)
    })
    .catch((e) => console.error(`[canvas] 清扫失败：${e.message.slice(0, 150)}`))
}, 10 * 60 * 1000).unref()

const server = startServer()

server.listen(config.PORT, async () => {
  console.error(`✓ LibTV OpenAI 兼容网关已启动`)
  console.error(`  地址        : http://127.0.0.1:${config.PORT}`)
  console.error(`  API key     : ${config.API_KEY.slice(0, 12)}...（Bearer 鉴权，完整值见环境变量 GATEWAY_API_KEY 或 data/gateway-key.json）`)
  console.error(`  画布 project: ${config.PROJECT_ID}`)
  console.error(`  画布归档    : ${config.CANVAS_BY_DATE ? `按日期（${config.CANVAS_NAME_PREFIX}-YYYY-MM-DD，当日生成进当日画布）` : '固定单画布'}`)
  console.error(`  默认图像模型: ${config.DEFAULT_IMAGE_MODEL} / 默认视频模型: ${config.DEFAULT_VIDEO_MODEL}`)
  console.error(`  并发上限    : ${config.MAX_CONCURRENT_GENERATIONS}`)
  console.error(`  画布节点    : ${!config.CLEANUP_CANVAS_NODES ? '永久保留（可复查）' : config.CANVAS_NODE_RETENTION_HOURS > 0 ? `保留 ${config.CANVAS_NODE_RETENTION_HOURS} 小时后清理` : '完成后立即清理'}`)
  console.error(`  日志留存    : data/logs/（HTTP 访问 + MCP 出站，保留 ${config.LOG_RETENTION_HOURS || '永久'} 小时）`)
  const lock = authLockInfo()
  console.error(`  授权页  : http://127.0.0.1:${config.PORT}/auth （${lock.locked ? `已锁定，via=${lock.via || '—'}，refresh 失败 ${lock.refresh_failures}/${lock.max_refresh_failures}` : '未授权，可访问'}）`)
  console.error(`  接口文档: http://127.0.0.1:${config.PORT}/docs  |  /docs.md  |  /openapi.json`)
  console.error(`  接口:`)
  console.error(`    GET  /healthz`)
  console.error(`    GET  /v1/models`)
  console.error(`    POST /v1/images/generations   {model?, prompt, size?, n?}   同步返回`)
  console.error(`    POST /v1/images/edits         multipart(image,prompt)      同步返回`)
  console.error(`    POST /v1/videos               {model?, prompt, image?, size?, seconds?} 异步`)
  console.error(`    GET  /v1/videos/{id}          查询任务 / GET /v1/videos/{id}/content 跳转结果`)
  console.error(`    GET  /files/{jobId}[/{n}]     读取镜像结果（Bearer 或 ?key=）`)

  resumeJobs() // 恢复上次未完成视频任务的轮询
  // 后台预热 MCP 会话，避免第一个请求承担握手延迟
  initialize().catch((e) => console.error(`[warmup] MCP 预热失败（首个请求会重试）：${e.message.slice(0, 150)}`))
})

// 优雅退出：不再接受新连接，在途请求最多等 10s
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.error(`\n收到 ${sig}，正在关闭…`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 10000).unref()
  })
}
