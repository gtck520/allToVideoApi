// 网关配置：支持 .env 文件 + 环境变量，零依赖
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 极简 .env 加载（不覆盖已有环境变量）
function loadDotEnv() {
  const file = path.join(PROJECT_ROOT, '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    const key = m[1]
    let value = m[2]
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
loadDotEnv()

const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v))

function resolveApiKey() {
  const fromEnv = process.env.GATEWAY_API_KEY
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  // 未配置时自动生成并持久化，保证重启后 key 稳定
  const keyFile = path.join(PROJECT_ROOT, 'data', 'gateway-key.json')
  if (fs.existsSync(keyFile)) {
    try { return JSON.parse(fs.readFileSync(keyFile, 'utf8')).api_key } catch { /* 落入重新生成 */ }
  }
  const generated = `sk-libtv-${crypto.randomBytes(24).toString('hex')}`
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, JSON.stringify({ api_key: generated, generatedAt: new Date().toISOString() }, null, 2))
  console.error(`[config] 未设置 GATEWAY_API_KEY，已自动生成并写入 data/gateway-key.json（也可复制到 .env 固化）`)
  return generated
}

export const config = {
  PROJECT_ROOT,
  DATA_DIR: path.join(PROJECT_ROOT, 'data'),
  JOBS_DIR: path.join(PROJECT_ROOT, 'data', 'jobs'),

  // 鉴权：OpenAI 风格 Bearer key，单用户自用
  API_KEY: resolveApiKey(),

  PORT: num(process.env.GATEWAY_PORT, 8787),

  // LibTV 画布（uuid，list_projects 返回的 uuid 字段；不接受数字 id）
  // 必须从环境变量 / .env 配置；此处不硬编码任何账号相关值
  PROJECT_ID: process.env.LIBTV_PROJECT_ID || '',

  // 模型默认值（可被请求里的 model 覆盖；均来自 2026-11-25 实测 search_models）
  DEFAULT_IMAGE_MODEL: process.env.DEFAULT_IMAGE_MODEL || 'lib-image-2.6-a',
  DEFAULT_VIDEO_MODEL: process.env.DEFAULT_VIDEO_MODEL || 'motion-3.1-lite',

  // 轮询与超时
  POLL_INTERVAL_MS: num(process.env.POLL_INTERVAL_MS, 3000),
  IMAGE_TIMEOUT_MS: num(process.env.IMAGE_TIMEOUT_MS, 5 * 60 * 1000),
  VIDEO_TIMEOUT_MS: num(process.env.VIDEO_TIMEOUT_MS, 25 * 60 * 1000),

  // 稳定性
  MAX_CONCURRENT_GENERATIONS: num(process.env.MAX_CONCURRENT_GENERATIONS, 3), // 单账号额度保护
  SUBMIT_RETRIES: num(process.env.SUBMIT_RETRIES, 4),       // 提交层重试（幂等键复用）
  FAILED_TASK_RETRIES: num(process.env.FAILED_TASK_RETRIES, 1), // 终态失败后的自动重试（新幂等键）
  POLL_MAX_ERRORS: num(process.env.POLL_MAX_ERRORS, 10),    // 连续轮询失败容忍次数

  // 模型缓存
  MODEL_CACHE_MS: num(process.env.MODEL_CACHE_MS, 10 * 60 * 1000),

  // 结果镜像与清理
  // 默认关闭：直接返回 LibTV 原始直链（当前自用/内网场景最简单）。
  // 未来部署到公网或担心 URL 时效时再开启：生成完成即转存到 data/results/，
  // 对下游暴露网关自己的稳定地址 GET /files/<jobId>
  MIRROR_RESULTS: (process.env.MIRROR_RESULTS ?? 'false') === 'true',
  // 本地镜像保留时长（小时），0 = 永久保留；过期文件在启动时和每日清扫
  FILES_RETENTION_HOURS: num(process.env.FILES_RETENTION_HOURS, 24 * 7),
  // 生成成功后删除本次在画布上创建的节点（生成节点 + 参考图节点），保持画布干净
  CLEANUP_CANVAS_NODES: (process.env.CLEANUP_CANVAS_NODES ?? 'true') !== 'false',
}

export const RESULTS_DIR = path.join(PROJECT_ROOT, 'data', 'results')

export function ensureDirs() {
  for (const dir of [config.DATA_DIR, config.JOBS_DIR, RESULTS_DIR]) fs.mkdirSync(dir, { recursive: true })
}
