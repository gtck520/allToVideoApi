// LibTV 授权锁：授权成功后生成 data/LibTV.lock，之后不再允许访问 /auth 发起授权。
//
// 设计要点：
//   - 锁文件只记录非敏感元数据（渠道、时间、刷新失败次数），绝不写 token / key / 账号标识。
//   - data/ 已被 .gitignore / .dockerignore 排除，锁文件不会进入仓库或镜像。
//   - refresh 连续失败达到阈值（AUTH_REFRESH_MAX_FAILURES，默认 3）或 token 过期且无法续期时，
//     网关自动删除锁 + 清除凭据，/auth 随即重新开放。
//   - 如需主动换账号：宿主机执行 npm run auth:logout（会同时删凭据和锁）。

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './paths.mjs'

export const LOCK_FILE = path.join(DATA_DIR, 'LibTV.lock')
const STATE_FILE = path.join(DATA_DIR, 'auth-state.json')
const DEFAULT_MAX_REFRESH_FAILURES = 3

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function writeJson(file, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`, { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* Windows 无 POSIX 权限位 */ }
}

function readState() {
  const s = readJson(STATE_FILE)
  return s && typeof s === 'object' ? s : {}
}

function writeState(state) {
  writeJson(STATE_FILE, state)
}

/** 连续 refresh 失败的最大容忍次数；超过即解除授权并开放 /auth */
export function maxRefreshFailures() {
  const n = Number(process.env.AUTH_REFRESH_MAX_FAILURES)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MAX_REFRESH_FAILURES
}

export function readLock() {
  const lock = readJson(LOCK_FILE)
  return lock && typeof lock === 'object' ? lock : null
}

export function isAuthLocked() {
  return fs.existsSync(LOCK_FILE)
}

/** 授权成功后上锁（幂等：重复调用只更新时间，不会解锁） */
export function acquireAuthLock({ via = 'cli' } = {}) {
  const lock = {
    channel: 'libtv',
    version: 1,
    authorized_at: new Date().toISOString(),
    via,
    refresh_failures: 0,
    max_refresh_failures: maxRefreshFailures(),
  }
  writeJson(LOCK_FILE, lock)
  writeState({ refresh_failures: 0 })
  return lock
}

/** 解除授权：删除锁并重置失败计数，/auth 重新开放 */
export function releaseAuthLock(reason = '') {
  let removed = false
  try { fs.unlinkSync(LOCK_FILE); removed = true } catch { /* 本就不存在 */ }
  writeState({
    refresh_failures: 0,
    last_release_at: new Date().toISOString(),
    reason: String(reason).slice(0, 200),
  })
  return removed
}

/** 供 /auth/status、CLI auth status 使用，不含任何私密信息 */
export function authLockInfo() {
  const lock = readLock()
  const state = readState()
  const base = {
    locked: Boolean(lock),
    channel: lock?.channel || 'libtv',
    refresh_failures: Number(state.refresh_failures) || 0,
    max_refresh_failures: maxRefreshFailures(),
  }
  if (!lock) {
    return { ...base, authorized_at: null, via: null, last_failure_at: null, last_failure_reason: null }
  }
  return {
    ...base,
    authorized_at: lock.authorized_at || null,
    via: lock.via || null,
    last_failure_at: state.last_failure_at || null,
    last_failure_reason: state.last_failure_reason || null,
  }
}

/** 记录一次 refresh 失败；返回是否已达解除授权阈值 */
export function recordRefreshFailure(message = '') {
  const state = readState()
  const failures = (Number(state.refresh_failures) || 0) + 1
  const max = maxRefreshFailures()
  writeState({
    ...state,
    refresh_failures: failures,
    last_failure_at: new Date().toISOString(),
    last_failure_reason: String(message).slice(0, 200),
  })
  return { failures, max, exhausted: failures >= max }
}

/** refresh 成功后清零失败计数 */
export function resetRefreshFailures() {
  const state = readState()
  writeState({ ...state, refresh_failures: 0 })
}
