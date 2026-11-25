# 开发文档（面向维护者与 Agent）

> 本文说明项目结构、实现机制与 LibTV 协议细节。**普通用户请看 [README.md](./README.md)**：安装、授权、部署和接口对接都在那里。

---

## 1. 项目定位

把 LibTV 的远程 MCP 服务转换成 OpenAI 风格的 HTTP 生成接口：**图像生成、图像编辑、视频生成**。

- 单用户自用，无账号系统；对外只有一个 `GATEWAY_API_KEY`，Bearer 鉴权。
- 零运行时第三方依赖，Node.js ≥ 20。
- 不暴露 LibTV 全量工具，只封装三条业务流水线；工具 schema 从不硬编码，能力以 LibTV 实时返回为准。

---

## 2. 目录结构

```text
bin/gateway.mjs        网关入口（npm start）
bin/libtv-probe.mjs    阶段 1 验证 CLI：auth / tools / probe / call / inspect / verify / cli
src/server.mjs         HTTP 服务：路由、Bearer 鉴权、multipart、免鉴权文档
src/docs.mjs           OpenAPI JSON + Markdown + HTML 文档内容（静态，无账号信息）
src/orchestrator.mjs   三条流水线（生成 / 编辑 / 视频）+ 重试编排 + 任务恢复
src/libtv.mjs          工具封装：提交 / 轮询 / 取媒体 URL / 模型发现 / 并发信号量
src/upload.mjs         参考图上传链：ticket → OSS 裸 PUT → complete → upload_media
src/mirror.mjs         结果镜像转存 + 本地过期清扫
src/cleanup.mjs        画布节点"用完即删"
src/jobs.mjs           任务持久化（data/jobs/*.json）+ 对外视图
src/retry.mjs          错误分类 + 指数退避
src/config.mjs         .env / 环境变量配置 + API key 固化
src/mcp.mjs            MCP 客户端：串行握手 / SSE / mcp-session-id / 401 刷新重发
src/oauth.mjs          OAuth 2.1：DCR / PKCE / token refresh / Web 授权
src/auth-lock.mjs      授权锁（data/LibTV.lock）+ refresh 失败计数
src/auth-page.mjs      /auth 授权页与锁定页 HTML
src/paths.mjs          项目内路径常量
recipes/*.json         阶段 1 验证配方（projectId 为环境变量占位符）
data/                  运行时数据（全部 gitignore，不入库）
```

---

## 3. 启动与命令

```bash
cp .env.example .env      # 填 GATEWAY_API_KEY、LIBTV_PROJECT_ID
npm run auth:login        # 首次扫码授权
npm start                 # 启动网关，默认 8787 端口
```

CLI：

| 命令 | 作用 |
|---|---|
| `npm run auth:status` | 查看授权状态、OAuth 元数据、锁状态 |
| `npm run auth:login` / `auth:logout` | 扫码授权 / 清除凭据与锁 |
| `npm run tools` | 拉取 `tools/list` 全量 schema 到 `data/tools.json` |
| `npm run probe` | 只读探活：`doctor` / `account_user` / `search_models` |
| `npm run inspect -- <name>` | 打印某个工具的完整 schema |
| `npm run call -- <tool> '<json>'` | 直接调用 MCP 工具（阶段 1 调试用） |
| `npm run verify -- <recipe>` | 执行配方（阶段 1 调试用，可能消耗额度） |

> `tools` / `probe` / `inspect` 不触发生成；`call` / `verify` 可能触发生成，注意账号额度。

---

## 4. HTTP 路由

免鉴权（在 `server.mjs` 的 API key 检查之前）：

```text
GET  /                    首页（入口导航 + 最短对接路径）
GET  /models              模型广场（实时模型 + 参数契约，前端筛选/复制 ID）
GET  /healthz             探活（含 MCP 状态、身份、并发槽位）
GET  /docs                HTML 文档
GET  /docs.md             Markdown 文档
GET  /openapi.json        OpenAPI 3.0
GET  /auth                授权页 / 授权锁页
GET  /auth/status         授权状态 JSON（含 locked / lock）
POST /auth/start          发起 Web 授权（锁定时 409 auth_locked）
GET  /auth/callback       OAuth 回调（锁定时仅放行在途 state）
```

需 `Authorization: Bearer <GATEWAY_API_KEY>`：

```text
GET  /v1/models                        动态模型列表，?detail=full 附带全部契约
GET  /v1/models/{id}                   单模型实时参数契约
POST /v1/images/generations            文生图，同步长轮询
POST /v1/images/edits                  图像编辑，multipart 或 JSON(base64/URL)
POST /v1/videos                        视频任务，异步
GET  /v1/videos/{id}                   任务查询
GET  /v1/videos/{id}/content           302 跳转结果
GET  /files/{jobId}[/{n}]              镜像文件（Bearer 或 ?key=）
```

统一错误格式：`{"error":{"message","type","code"}}`。

---

## 5. 核心实现链路

### 5.1 授权

1. `oauth.mjs` 从 `/.well-known/oauth-authorization-server` 自动发现端点，走 OAuth 2.1 授权码 + PKCE + 动态客户端注册。
2. 必须带 Resource Indicator：`resource=https://mcp.liblib.tv/mcp`，否则 `invalid_request`。
3. 注册多个 `redirect_uri`：CLI 回环 `http://127.0.0.1:8765/callback`，以及可选的 Web 回调 `${GATEWAY_PUBLIC_URL}/auth/callback`。LibTV 只接受 loopback，内网 IP / 公网域名会被 `invalid_redirect_uri` 拒绝。
4. 凭据写入 `data/credentials.json`（0600）；access token 约 1 小时，由 refresh token 静默续期。

### 5.2 授权锁

- 任一授权方式成功后 `auth-lock.mjs` 生成 `data/LibTV.lock`（仅非敏感元数据：channel/via/authorized_at/refresh_failures），`/auth` 随即关闭入口。
- `refresh` 单次失败累计到 `data/auth-state.json`，不立刻解锁；达到 `AUTH_REFRESH_MAX_FAILURES`（默认 3）才清凭据 + 删锁 + 抛 `AUTH_REQUIRED`，提示重新访问 `/auth`。
- token 过期无 refresh token、或 access token 被手工删除但锁还在，也会自动解锁，避免 `/auth` 永久不可用。
- `npm run auth:logout` 同时清凭据与锁，作为主动换账号的入口。

### 5.3 MCP 会话

`mcp.mjs`：

- `initialize → notifications/initialized → tools/list` 必须串行，否则服务端拒绝。
- 响应可能是 `application/json` 或 `text/event-stream`，两者都要解析；会话 id 从 `mcp-session-id` 响应头取并回传。
- HTTP 401 视为 token 被提前吊销，强制刷新后重发一次。

### 5.4 三条业务流水线

`orchestrator.mjs` 的 `runJob({ type, model, params, transient })`：

| type | 主链路 |
|---|---|
| `image` | `generation_submit(kind=image)` → `task_status` 轮询 → `artifacts[0].node_key` → `inspect_media` → URL |
| `image-edit` | 参考图 `upload_ticket` → OSS 裸 PUT → `upload_complete` → `upload_media` → `create_node(left:[参考节点])` → 同图像链路 |
| `video` | 纯文生视频 `generation_submit(kind=video)`；带参考图 `generate_video(referenceImageNodes)` → `task_status` → `inspect_media` |

成功后：可选镜像（`MIRROR_RESULTS=true`）→ 清理本次创建的画布节点（默认开）→ 封装结果。图片字节用 `transient` 传递，不写进任务文件。

### 5.5 任务状态机

- 处理中：`readiness=PROCESSING`，`outcome=null`。
- 成功终态：`readiness=TERMINAL_READY`，`outcome=SUCCEEDED`，`artifacts[].node_key` 才是取 URL 的凭据。
- 失败终态：`readiness=TERMINAL_READY`，`outcome=FAILED`，带 `error.code/summary`。
- `task_status.result` **不含媒体 URL**，必须再调 `inspect_media`。
- 任务落盘 `data/jobs/<id>.json`；`resumeJobs()` 在启动时恢复未完成的 processing 任务继续轮询。

---

## 6. 参数与能力发现

- `listModels()` / `getModelContract()` 调用 `search_models` / `get_model`，带缓存（`MODEL_CACHE_MS`）。
- `GET /v1/models/{id}` 返回 `input_contract.parameterSchemas`，其中 `properties.<参数>.enum / .default` 是画幅、清晰度、时长、数量等当前合法值。
- 请求体的 `params` 对象直接透传给 LibTV；`size` / `n` / `seconds` 只是 OpenAI 便利字段，优先级更低。网关不校验枚举，非法值由 LibTV 报错。
- LibTV 升级后能力自动反映，网关无需改代码。

---

## 7. 稳定性设计

1. **鉴权层**：401 强制刷新 + 重发；刷新失败计数与自动解锁（见 5.2）。
2. **提交层幂等重试**：瞬时错误（网络 / 5xx / `COMMERCIAL_BLOCKED 算力不足`）指数退避重试 4 次，**复用同一 `idempotency_key`**——实测同键重放安全，算力不足重放可恢复。
3. **终态失败重试**：FAILED 后换新幂等键再试 1 次（同键只会取回失败任务）。
4. **轮询容错**：`task_status` 连续失败 10 次才报错。
5. **任务持久化**：`data/jobs/*.json`，重启自动恢复未完成轮询。
6. **并发保护**：`Semaphore` 限制同时生成数（默认 3），超出排队，保护单账号额度。
7. **快速失败**：参数校验类错误不重试。

---

## 8. 配置

| 变量 | 说明 | 默认 |
|---|---|---|
| `GATEWAY_API_KEY` | 对外 Bearer key | 自动生成到 `data/gateway-key.json` |
| `GATEWAY_PORT` | 监听端口 | `8787` |
| `LIBTV_PROJECT_ID` | **必填**，画布 uuid（`list_projects` 的 `uuid`） | 无 |
| `DEFAULT_IMAGE_MODEL` / `DEFAULT_VIDEO_MODEL` | 默认模型 | `lib-image-2.6-a` / `motion-3.1-lite` |
| `MAX_CONCURRENT_GENERATIONS` | 并发上限 | `3` |
| `SUBMIT_RETRIES` | 提交层重试次数 | `4` |
| `FAILED_TASK_RETRIES` | 终态失败重试次数 | `1` |
| `POLL_INTERVAL_MS` | 轮询间隔 | `3000` |
| `IMAGE_TIMEOUT_MS` / `VIDEO_TIMEOUT_MS` | 图像 / 视频超时 | `300000` / `1500000` |
| `MODEL_CACHE_MS` | 模型契约缓存 | `600000` |
| `AUTH_REFRESH_MAX_FAILURES` | refresh 连续失败解锁阈值 | `3` |
| `GATEWAY_PUBLIC_URL` | Web 授权页回调基址（仅 loopback 有效） | 空 |
| `MIRROR_RESULTS` | 是否镜像转存结果 | `false` |
| `FILES_RETENTION_HOURS` | 镜像保留时长，`0` 永久 | `168` |
| `CLEANUP_CANVAS_NODES` | 完成后删画布节点 | `true` |

---

## 9. LibTV MCP 实测约束（2026-11-25）

- `tools/list` 实际返回 **70 个工具**（社区文档说 86）；网关只依赖：`generation_submit` / `create_node` / `generate_video` / `task_status` / `inspect_media` / `search_models` / `get_model` / `upload_ticket` / `upload_complete` / `upload_media` / `delete_node` / `doctor`。
- 工具参数命名风格不一致：`generation_submit` / `task_status` 用 snake_case；`inspect_media` / `upload_media` / `create_node` 用 camelCase（如 `projectId`）。
- `generation_submit` 必填 `project_id` / `idempotency_key` / `kind` / `request{model,prompt,params}`；图数量是 `params.count`，枚举 `[1,2,4]`。
- `get_capabilities` 的真实参数是 `capabilityId` / `query` / `detail`，没有 `type`。
- 图像节点**不接受 `intent`**（`Node intent is only used for video nodes`）；图生图靠引用边 `left:[源节点id]` 表达。
- `upload_media` 节点名必须唯一（`NODE_NAME_CONFLICT`），网关用 jobId 命名。
- OSS 分片直传必须是裸 PUT，附加签名头会 `SignatureDoesNotMatch`。
- `inspect_media` 返回 `media.urls[0]`，为无签名公网直链。
- 图像约 1 分钟出结果，视频模型预估约 3 分钟。

---

## 10. 开发验证方法（避免消耗额度）

优先做无消耗检查：

```bash
node --check src/*.mjs bin/*.mjs     # 语法
npm run auth:status                  # 授权状态与元数据
npm run tools                        # 工具 schema 落盘（不触发生成）
npm run probe                        # 只读探活
npm run inspect -- generation_submit # 查看单工具 schema
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/docs.md
curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8787/v1/models?detail=full
```

授权锁的回归测试应在**隔离目录**里跑（复制 `src/` 到临时项目根，独立的 `data/`），用 mock 的 token 端点验证 refresh 失败计数与自动解锁，不要碰真实凭据，也不要调用任何生成工具。

需要真实生成验证时，等账号额度恢复后**一次性**跑完：文生图、图像编辑、视频异步任务、镜像读取（如启用）、画布节点清理。账号算力耗尽时所有生成会被 `COMMERCIAL_BLOCKED` 拦截，这不是网关缺陷。

---

## 11. 已知边界

- 结果为 `libtv-res.liblib.art` 直链，目前无签名；需长期缓存就开 `MIRROR_RESULTS=true`。
- 视频是异步 job 风格；图像是同步长轮询，超过 `IMAGE_TIMEOUT_MS` 返回 504 但任务保留，可继续查。
- Docker 部署推荐挂载整个 `data` 目录；单独把 `LibTV.lock` bind mount 会成为挂载点，容器内删除可能失败，导致授权失效后无法自动解锁。
- `/auth` 免鉴权；不要把网关直接暴露公网，或在反向代理层限制该路径。

---

## 12. 隐私与安全

- `.gitignore` / `.dockerignore` 排除 `.env`、`data/credentials.json`、`data/gateway-key.json`、整个 `data/`（含 `LibTV.lock` 与运行记录）、`.workbuddy/`。
- 源码不硬编码任何账号 uuid / token / key；`LIBTV_PROJECT_ID` 必须来自环境变量，配方里用 `{{env.LIBTV_PROJECT_ID}}`。
- `/docs` 系列是静态内容，不含账号信息；`/auth/status` 隐去原始 refresh 错误文本。
- OAuth 实现改编自 MIT 许可项目 `redkiller79/dsh-libtv`，已在源码署名。

---

## 13. 许可

本项目为单用户自用工具；第三方代码署名见上文与源码注释。
