// LibTV Remote MCP 授权层（OAuth 2.1 授权码 + PKCE + 动态客户端注册）
//
// 参考并改编自 MIT 项目 redkiller79/dsh-libtv 的 lib/oauth.mjs，感谢原作者趟通这条链路。
// 关键事实（已实测 /.well-known/oauth-authorization-server）：
//   - 网关只认 OAuth 2.1 授权码 + PKCE 的 bearer token
//   - 端点：authorize / token / register(动态注册) / revoke，全部自动发现
//   - scopes 6 个，见下方 SCOPES
//   - 强制 Resource Indicators（RFC 8707）：authorize 和 token 都必须带 resource=https://mcp.liblib.tv/mcp
//
// 凭据写入 data/credentials.json（600 权限，Windows 忽略）。
// access token 约 1 小时过期，由 refresh token 静默续期。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { DATA_DIR } from './paths.mjs'

export const ISSUER = process.env.LIBTV_ISSUER || 'https://mcp.liblib.tv'
export const MCP_URL = process.env.LIBTV_MCP_URL || 'https://mcp.liblib.tv/mcp'

export const SCOPES = [
  'libtv:account:read',
  'libtv:project:read',
  'libtv:project:write',
  'libtv:media:write',
  'libtv:task:write',
  'libtv:export:write',
]

export const CRED_FILE = path.join(DATA_DIR, 'credentials.json')
const PORT = Number(process.env.LIBTV_OAUTH_PORT || 8765)
/** CLI 本地回环回调（npm run auth:login 用） */
const CLI_REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`
/** Web/网关回调：LibTV 只接受 loopback（127.0.0.1 / localhost），内网IP与公网域名会被
 *  动态注册以 invalid_redirect_uri 拒绝（实测）。因此 GATEWAY_PUBLIC_URL 必须是浏览器
 *  可访问的 loopback 地址；Docker 场景用端口映射 -p 8787:8787 时，浏览器访问
 *  http://127.0.0.1:8787 的回调会经端口映射回到容器。 */
function isLoopbackUrl(str) {
  try {
    const u = new URL(str)
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)
  } catch { return false }
}
export function webAuthAvailable() {
  const base = (process.env.GATEWAY_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  return isLoopbackUrl(base)
}
function webRedirectUri() {
  const base = (process.env.GATEWAY_PUBLIC_URL || '').trim().replace(/\/+$/, '')
  if (!base || !isLoopbackUrl(base)) return null // 非 loopback 一律不注册，避免拖累整体注册失败
  return `${base}/auth/callback`
}
/** 所有要注册的回调 URI（去重）：CLI 回环 + 可选 Web 回调 */
function allRedirectUris() {
  const web = webRedirectUri()
  return [...new Set([CLI_REDIRECT_URI, ...(web ? [web] : [])])]
}
const CLIENT_NAME = 'libtv-openai-gateway'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

export class AuthRequired extends Error {
  constructor(message) {
    super(message || 'LibTV 尚未授权，请先运行：npm run auth:login')
    this.name = 'AuthRequired'
    this.code = 'AUTH_REQUIRED'
  }
}

export function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
  } catch {
    return {}
  }
}

export function saveCreds(creds) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(CRED_FILE, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 })
  try { fs.chmodSync(CRED_FILE, 0o600) } catch { /* Windows 无 POSIX 权限位 */ }
}

export function clearCreds() {
  try { fs.unlinkSync(CRED_FILE) } catch { /* 本就不存在 */ }
}

let metaCache
export async function discover() {
  if (metaCache) return metaCache
  const res = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, {
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`读取授权服务器元数据失败：HTTP ${res.status}`)
  metaCache = await res.json()
  return metaCache
}

let resourceCache
export async function discoverResource() {
  if (resourceCache) return resourceCache
  try {
    const res = await fetch(`${ISSUER}/.well-known/oauth-protected-resource`, {
      headers: { accept: 'application/json' },
    })
    if (res.ok) { resourceCache = await res.json(); return resourceCache }
  } catch { /* 退回网关地址 */ }
  resourceCache = { resource: MCP_URL }
  return resourceCache
}

async function registerClient(meta, redirectUris) {
  if (!meta.registration_endpoint) throw new Error('授权服务器未提供动态注册端点')
  const res = await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: SCOPES.join(' '),
    }),
  })
  if (!res.ok) {
    throw new Error(`动态注册失败：HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)
  }
  const body = await res.json()
  const creds = loadCreds()
  Object.assign(creds, {
    client_id: body.client_id,
    client_secret: body.client_secret,
    redirect_uri: redirectUris[0],
    redirect_uris: redirectUris,
    issuer: meta.issuer,
    service: MCP_URL,
  })
  saveCreds(creds)
  return creds
}

export async function ensureClient() {
  const meta = await discover()
  const creds = loadCreds()
  const wanted = allRedirectUris()
  // 旧凭据只有单个 redirect_uri：只要包含 CLI 回环也算有效（Web 需要时再重注册）
  const registered = creds.redirect_uris || (creds.redirect_uri ? [creds.redirect_uri] : [])
  const covered = wanted.every((uri) => registered.includes(uri))
  if (creds.client_id && covered && creds.issuer === meta.issuer) return creds
  return registerClient(meta, wanted)
}

const b64url = (input) => Buffer.from(input).toString('base64url')
function makePkce() {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function openBrowser(url) {
  let cmd
  if (process.platform === 'win32') cmd = ['cmd', ['/c', 'start', '', url]]
  else if (process.platform === 'darwin') cmd = ['open', [url]]
  else cmd = ['xdg-open', [url]]
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref() } catch { /* 手工打开即可 */ }
}

function storeTokens(creds, token) {
  const expiresIn = Number(token.expires_in)
  creds.tokens = {
    access_token: token.access_token,
    refresh_token: token.refresh_token || creds.tokens?.refresh_token,
    token_type: token.token_type || 'Bearer',
    scope: token.scope,
    expires_at: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
    obtained_at: new Date().toISOString(),
  }
  saveCreds(creds)
  return creds.tokens
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

function waitForCallback(state) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
        return
      }
      const error = url.searchParams.get('error')
      const ok = !error
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><meta charset="utf-8"><title>LibTV 授权</title>' +
        `<body style="font:16px/1.7 system-ui,sans-serif;padding:48px;color:#111">` +
        `<h2 style="color:${ok ? '#07B8DD' : '#c33'}">${ok ? '授权完成' : '授权失败'}</h2>` +
        `<p>${ok ? '可以关闭此页面，回到终端继续。' : `错误：${escapeHtml(error || '')} ${escapeHtml(url.searchParams.get('error_description') || '')}`}</p>` +
        '</body>',
      )
      cleanup()
      if (error) return reject(new Error(`授权被拒绝：${error} ${url.searchParams.get('error_description') || ''}`))
      if (url.searchParams.get('state') !== state) return reject(new Error('OAuth state 校验失败'))
      const code = url.searchParams.get('code')
      if (!code) return reject(new Error('回调里没有 code 参数'))
      resolve(code)
    })
    const timer = setTimeout(() => { cleanup(); reject(new Error('授权超时（10 分钟未完成）')) }, LOGIN_TIMEOUT_MS)
    timer.unref?.()
    function cleanup() { clearTimeout(timer); server.close() }
    server.on('error', (err) => {
      cleanup()
      reject(new Error(`无法监听 127.0.0.1:${PORT}：${err.message}。请设置 LIBTV_OAUTH_PORT 换端口。`))
    })
    server.listen(PORT, '127.0.0.1')
  })
}

export async function login({ onAuthorizeUrl } = {}) {
  const meta = await discover()
  const creds = await ensureClient()
  const { resource } = await discoverResource()
  const { verifier, challenge } = makePkce()
  const state = b64url(crypto.randomBytes(16))

  const authorizeUrl = new URL(meta.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', creds.client_id)
  authorizeUrl.searchParams.set('redirect_uri', CLI_REDIRECT_URI)
  authorizeUrl.searchParams.set('scope', SCOPES.join(' '))
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('resource', resource || MCP_URL) // 强制，缺了会 invalid_request

  const waiting = waitForCallback(state)
  await new Promise((r) => setTimeout(r, 150)) // 给回调端口一点启动时间
  const target = authorizeUrl.toString()
  onAuthorizeUrl?.(target)
  if (process.env.LIBTV_OPEN_BROWSER !== '0') openBrowser(target)

  const code = await waiting
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: CLI_REDIRECT_URI,
    client_id: creds.client_id,
    code_verifier: verifier,
    resource: resource || MCP_URL,
  })
  if (creds.client_secret) form.set('client_secret', creds.client_secret)
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form,
  })
  if (!res.ok) throw new Error(`换取 token 失败：HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)
  return storeTokens(loadCreds(), await res.json())
}

let refreshing = null
async function refresh(creds) {
  const meta = await discover()
  const refreshToken = creds.tokens?.refresh_token
  if (!refreshToken) throw new AuthRequired()
  const { resource } = await discoverResource()
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: creds.client_id,
    resource: resource || MCP_URL,
  })
  if (creds.client_secret) form.set('client_secret', creds.client_secret)
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    clearCreds()
    throw new AuthRequired(`授权已失效（refresh HTTP ${res.status} ${body.slice(0, 200)}），请重新运行 npm run auth:login`)
  }
  return storeTokens(creds, await res.json())
}

// force=true 用于服务端提前吊销 token（401）的场景
export async function getAccessToken({ force = false } = {}) {
  const creds = loadCreds()
  if (!creds.tokens?.access_token) throw new AuthRequired()
  const expiresAt = creds.tokens.expires_at
  const stillFresh = typeof expiresAt !== 'number' || expiresAt - 60_000 > Date.now()
  if (!force && stillFresh) return creds.tokens.access_token
  if (!refreshing) refreshing = refresh(loadCreds()).finally(() => { refreshing = null })
  return (await refreshing).access_token
}

export function authSummary() {
  const creds = loadCreds()
  return {
    service: MCP_URL,
    clientId: creds.client_id || null,
    authorized: Boolean(creds.tokens?.access_token),
    scope: creds.tokens?.scope || null,
    expiresAt: creds.tokens?.expires_at ? new Date(creds.tokens.expires_at).toISOString() : null,
    hasRefreshToken: Boolean(creds.tokens?.refresh_token),
    redirectUris: creds.redirect_uris || (creds.redirect_uri ? [creds.redirect_uri] : []),
  }
}

// ---------------- Web 授权流程（Docker / 页面触发）----------------
// 内存中的待授权会话：state -> { verifier, redirectUri, createdAt }。
// 授权是低频操作；进程重启后 pending 失效，用户在页面重新点一次即可。
const pendingWebLogins = new Map()
const WEB_LOGIN_TTL_MS = 10 * 60 * 1000

function prunePending() {
  const now = Date.now()
  for (const [state, v] of pendingWebLogins) {
    if (now - v.createdAt > WEB_LOGIN_TTL_MS) pendingWebLogins.delete(state)
  }
}

/** 发起 Web 授权：返回官方 authorize URL + state，凭据由 /auth/callback 落地 */
export async function startWebLogin() {
  const web = webRedirectUri()
  if (!web) {
    throw new NonRetryableErrorWeb(
      'Web 授权需要 GATEWAY_PUBLIC_URL 为浏览器可访问的 loopback 地址（如 http://127.0.0.1:8787；LibTV 只接受 127.0.0.1/localhost 回调，拒绝内网 IP 与公网域名）。' +
      'Docker 部署请改用：在宿主机执行 npm run auth:login 扫码授权，再把 data/credentials.json 挂载进容器（推荐），无需页面授权。',
    )
  }
  const meta = await discover()
  const creds = await ensureClient() // 确保 Web 回调已注册进 client
  const { resource } = await discoverResource()
  const { verifier, challenge } = makePkce()
  const state = b64url(crypto.randomBytes(16))
  prunePending()
  pendingWebLogins.set(state, { verifier, redirectUri: web, createdAt: Date.now() })

  const authorizeUrl = new URL(meta.authorization_endpoint)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', creds.client_id)
  authorizeUrl.searchParams.set('redirect_uri', web)
  authorizeUrl.searchParams.set('scope', SCOPES.join(' '))
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')
  authorizeUrl.searchParams.set('resource', resource || MCP_URL)
  return { authorizeUrl: authorizeUrl.toString(), state, redirectUri: web, expiresInMs: WEB_LOGIN_TTL_MS }
}

class NonRetryableErrorWeb extends Error {
  constructor(message) { super(message); this.name = 'AuthConfigError'; this.code = 'auth_config_error' }
}

/** 完成 Web 授权：校验 state → 用 code 换 token → 落盘。返回授权摘要。 */
export async function completeWebLogin({ state, code, error, errorDescription }) {
  prunePending()
  if (!state) throw new Error('回调缺少 state 参数')
  const pending = pendingWebLogins.get(state)
  if (!pending) throw new Error('授权会话不存在或已过期，请重新发起授权')
  pendingWebLogins.delete(state) // 一次性消费，防重放
  if (error) throw new Error(`授权被拒绝：${error} ${errorDescription || ''}`)
  if (!code) throw new Error('回调缺少 code 参数')

  const meta = await discover()
  const creds = loadCreds()
  const { resource } = await discoverResource()
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: creds.client_id,
    code_verifier: pending.verifier,
    resource: resource || MCP_URL,
  })
  if (creds.client_secret) form.set('client_secret', creds.client_secret)
  const res = await fetch(meta.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: form,
  })
  if (!res.ok) throw new Error(`换取 token 失败：HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`)
  storeTokens(creds, await res.json())
  // 授权凭据已更新：让 MCP 会话失效，下次调用会用新 token 重握手
  return authSummary()
}
