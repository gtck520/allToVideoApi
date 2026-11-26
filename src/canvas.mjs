// 按日期画布归档：
//   CANVAS_BY_DATE=true 时，每天第一次生成会自动创建（或复用）一个
//   「CANVAS_NAME_PREFIX-YYYY-MM-DD」画布（如「API网关-2026-11-26」），
//   当天所有任务都进这个画布，方便在 LibTV 端按天归档与整体清理。
//   创建失败时降级用 .env 的 LIBTV_PROJECT_ID 兜底。
// 映射关系持久化在 data/canvases.json，重启不丢；并发下同一日期只创建一次。
import fs from 'node:fs'
import path from 'node:path'
import { toolJson } from './libtv.mjs'
import { config } from './config.mjs'

const MAP_FILE = path.join(config.DATA_DIR, 'canvases.json')
// 内存缓存：date -> Promise<projectId>，并发请求共用同一个创建流程
const pending = new Map()

function loadMap() {
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveMap(map) {
  fs.mkdirSync(path.dirname(MAP_FILE), { recursive: true })
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 2) + '\n')
}

/** 当天日期串（按东八区，避免服务器 UTC 时区导致跨天错位） */
export function todayKey(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

function canvasName(dateKey) {
  return `${config.CANVAS_NAME_PREFIX}-${dateKey}`
}

async function findProjectByName(name) {
  for (const page of [1, 2]) {
    const out = await toolJson('list_projects', { page, pageSize: 50, name })
    const list = out?.data?.projectMetaList || []
    const hit = list.find((p) => p.name === name)
    if (hit) return hit.uuid
    if (list.length < 50) break
  }
  return null
}

async function createDailyCanvas(dateKey) {
  const name = canvasName(dateKey)
  // 先查是否已存在（比如之前创建过但本地映射丢了；LibTV create_project 同名不合并）
  const existing = await findProjectByName(name).catch(() => null)
  if (existing) return existing
  const out = await toolJson('create_project', {
    name,
    idempotencyKey: `canvas-${dateKey}`.replace(/\./g, '-'),
    description: `all-to-videoApi 按日归档画布 ${dateKey}（当天生成自动进入，可整体删除）`,
  })
  const uuid = out?.project?.uuid ?? out?.uuid ?? out?.projectMeta?.uuid ?? null
  if (!uuid) {
    throw new Error(`create_project 返回缺 uuid：${JSON.stringify(out).slice(0, 300)}`)
  }
  console.error(`[canvas] 已创建当日画布「${name}」 ${uuid}`)
  return uuid
}

/**
 * 解析某日期对应的画布 projectId。
 * 失败（MCP 不可用等）时降级返回 config.PROJECT_ID，不阻塞生成。
 * @param {string} dateKey YYYY-MM-DD，缺省为今天
 */
export async function resolveDailyCanvas(dateKey = todayKey()) {
  if (!config.CANVAS_BY_DATE) return config.PROJECT_ID
  if (pending.has(dateKey)) return pending.get(dateKey)
  const task = (async () => {
    const map = loadMap()
    if (map[dateKey]) return map[dateKey]
    try {
      const uuid = await createDailyCanvas(dateKey)
      const fresh = loadMap()
      fresh[dateKey] = uuid
      saveMap(fresh)
      return uuid
    } catch (err) {
      console.error(`[canvas] 当日画布创建失败，降级用 LIBTV_PROJECT_ID：${err.message.slice(0, 200)}`)
      return config.PROJECT_ID
    }
  })()
  pending.set(dateKey, task)
  // 失败后清掉缓存，下次重试；成功则留着复用
  task.catch(() => pending.delete(dateKey))
  return task
}
