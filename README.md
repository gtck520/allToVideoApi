# LibTV → OpenAI 兼容生成 API 网关

把 **LibTV 的远程 MCP 服务**转换成 **OpenAI 风格的 HTTP 生成接口**：图像生成、图像编辑、视频生成。单用户自用，Bearer API key 鉴权，零第三方依赖（Node ≥ 20 即可运行）。

如果你有若干 AI 服务想统一调用生图/生视频能力，而 LibTV 官方只提供 MCP、没有 REST API，这个网关就是那座桥：下游按 OpenAI 规范发请求，网关负责 OAuth、MCP 会话、工具编排、轮询和结果回传。

---

## 特性一览

- **OpenAI 兼容**：`POST /v1/images/generations`、`POST /v1/images/edits`、`POST /v1/videos` + `GET /v1/videos/{id}`（Sora 风格异步任务）。
- **能力实时发现**：`GET /v1/models/{id}` 返回该模型当前支持的**全部参数与枚举**（画幅 `ratio`、清晰度 `resolution`、时长 `duration`、数量 `count`）。网关不硬编码任何枚举，LibTV 升级无需改代码。
- **参数透传**：请求体的 `params` 对象原样透传给 LibTV，`size`/`n`/`seconds` 是可选的 OpenAI 便利字段。
- **零配置鉴权**：LibTV OAuth 2.1 扫码授权一次，refresh token 自动续期；对外只需一个 `GATEWAY_API_KEY`。
- **Agent 友好的免鉴权文档**：`/docs`（可视化）、`/openapi.json`（OpenAPI 3.0）、`/docs.md`（Markdown）。把链接丢给 Agent 就能自动对接。
- **生产级稳定性**：幂等重试、指数退避、任务持久化、重启恢复、并发保护、节点用完即删。

---

## 快速开始

```bash
# 0. 准备 Node >= 20，复制配置模板并填好自己的画布 uuid
cp .env.example .env
#    编辑 .env：LIBTV_PROJECT_ID=<你的画布 uuid>；GATEWAY_API_KEY=<自定义 key>

# 1. 首次授权（微信扫码一次，之后 refresh token 自动续期）
npm run auth:login

# 2. 查出自己的画布 uuid，填进 .env 的 LIBTV_PROJECT_ID（若还没有）
npm run call -- list_projects '{}'

# 3. 启动网关
npm start

# 4. 像调用 OpenAI 一样请求
curl -X POST http://127.0.0.1:8787/v1/images/generations \
  -H "Authorization: Bearer $GATEWAY_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"lib-image-2.5-f","prompt":"a cat on the moon"}'
```

> `GATEWAY_API_KEY` 若不设置，首次启动会自动生成并固化到 `data/gateway-key.json`，重启不变（该文件不会进仓库）。

**打开文档**：浏览器访问 <http://127.0.0.1:8787/docs>，或把 <http://127.0.0.1:8787/docs.md> / `/openapi.json` 发给 Agent。

---

## 授权页面与 Docker 部署

网关附带一个授权页 `GET /auth`（免鉴权，展示当前授权状态 + 授权入口）。关于授权，有一个 **LibTV 官方硬约束**必须知道：

> LibTV 的 OAuth 动态注册**只接受 loopback 回调**（`127.0.0.1:*` / `localhost:*`）。内网 IP（如 `192.168.x.x`）和公网域名都会被以 `invalid_redirect_uri` 拒绝（2026-11-25 实测）。

### 推荐方案：宿主机授权 + 挂载凭据（Docker）

在**宿主机**完成一次扫码，把凭据文件挂进容器。refresh token 会自动续期，通常一次授权长期有效：

```bash
# 1. 宿主机扫码授权（一次）
npm run auth:login

# 2. 启动容器，挂载凭据与配置（都不要打进镜像）
docker run -d --name libtv-gateway -p 8787:8787 \\
  -v $(pwd)/data/credentials.json:/app/data/credentials.json:ro \\
  -v $(pwd)/.env:/app/.env:ro \\
  libtv-openai-gateway

# 3. 打开授权页确认状态
#    http://127.0.0.1:8787/auth
```

配套的 `Dockerfile` 见仓库根目录。凭据、API key、任务记录全部通过 mount 提供，**镜像内不含任何私密数据**。

### 可选方案：页面直接授权

若网关跑在你本机（或 Docker 用 `-p 8787:8787` 映射到宿主机 loopback），可设置：

```bash
GATEWAY_PUBLIC_URL=http://127.0.0.1:8787
```

此时 `/auth` 页面会多出一个「跳转到官方授权」按钮：点它 → 微信扫码 → 官方回调 `/auth/callback` → 自动换取并保存凭据 → 页面显示结果。全程不用敲命令。相关路由：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/auth` | 授权页（免鉴权）：状态 + 授权入口 |
| GET | `/auth/status` | 授权状态 JSON：是否已授权、scope、到期时间、已注册回调 |
| POST | `/auth/start` | 发起授权，返回官方 authorize URL（需 `GATEWAY_PUBLIC_URL` 为 loopback） |
| GET | `/auth/callback` | 官方回调入口：换 token → 落盘 → 回显结果页 |

> `/auth/start` 与 `/auth/callback` 有 state + PKCE 保护，且 state 一次性消费；页面本身不展示任何 token。但授权页免鉴权意味着能访问网关的人都可以发起重新授权——**请勿把网关直接暴露到公网**，或在反向代理层限制 `/auth` 路径。

---

## 接口文档（免鉴权）

| 路径 | 格式 | 用途 |
|---|---|---|
| `/docs` | HTML | 人读的可视化文档页 |
| `/openapi.json` | OpenAPI 3.0 JSON | 机器解析，Agent 自动生成 SDK / 对接 |
| `/docs.md` | Markdown | 纯文本，Agent 直接读 |

这三个接口**无需 API key**，也不暴露任何账号、token 或配置细节，可安全对外提供。

### 接口一览（业务接口需 Bearer 鉴权）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/healthz` | 探活：MCP 状态、账号身份、并发槽位（免鉴权） |
| GET | `/v1/models` | 模型列表（动态发现，缓存 10 分钟）；`?detail=full` 附带每个模型的完整参数契约 |
| GET | `/v1/models/{id}` | **单模型实时参数契约**：`input_contract.parameterSchemas` 里是该模型当前支持的全部参数枚举与默认值 |
| POST | `/v1/images/generations` | 文生图，**同步长轮询** |
| POST | `/v1/images/edits` | 图生图/编辑：multipart（`image` 文件 + `prompt`）或 JSON（`image` 为 URL/base64/dataURL） |
| POST | `/v1/videos` | 文生视频（带 `image` 则图生视频），**异步**：返回 `{id, status}` |
| GET | `/v1/videos/{id}` | 查询任务；`succeeded` 时含 `result.url` |
| GET | `/v1/videos/{id}/content` | 完成后 302 跳转到结果 URL |
| GET | `/files/{jobId}[/{n}]` | 读取镜像结果（Bearer 或 `?key=`，供 `<img>` 等无法带 header 的场景） |

统一错误格式：`{"error":{"message","type","code"}}`。

---

## 模型能力发现与参数透传

**原则：网关零限制，能力以 LibTV 实时返回为准。**

下游能否用某个清晰度/画幅/时长，以 `GET /v1/models/{id}` 返回的契约为准；网关代码不写死任何枚举——LibTV 能力升级时这里自动反映，无需改网关。

```bash
# 1. 列出模型
curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8787/v1/models

# 2. 看某模型当前支持的参数与枚举
curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8787/v1/models/lib-image-2.5-f
# 关键字段：input_contract.parameterSchemas.<操作>.properties.<参数>.enum / .default
```

两种传参方式：

```jsonc
// 方式一：OpenAI 便利字段（size 就近映射画幅，n 映射数量）
{"model":"lib-image-2.5-f","prompt":"...","size":"1024x1024","n":1}

// 方式二：params 直接透传 LibTV 原始参数（优先级更高）
{"model":"lib-image-2.5-f","prompt":"...","params":{"ratio":"9:16","resolution":"1K","count":2}}
// 视频：{"model":"motion-3.1-lite","prompt":"...","params":{"duration":5}}
```

`params` 里的非法枚举由 LibTV 给出权威错误，网关原样透传。

---

## 公网 URL 与转存 / 清理机制

**唯一依赖公网 URL 的是生成结果**（LibTV 返回 `libtv-res.liblib.art` 直链）。当前策略：

- **默认直接返回 LibTV 原始直链**（自用/内网场景最简单，响应里同时带 `source_url` 字段冗余标注原始地址）。
- **镜像转存（可选）**：担心 URL 时效或部署公网时设 `MIRROR_RESULTS=true`——生成成功即转存到 `data/results/`，`url` 变为网关稳定地址 `http://<host>/files/<jobId>`，`source_url` 保留原始地址。读取接口 `GET /files/{jobId}[/{n}]` 仅镜像开启后有内容。
- **用完即删（画布，默认开）**：任务成功后自动删除本次创建的画布节点（生成节点 + 参考图节点），长期运行画布不堆积垃圾。
- **用完即删（本地）**：镜像开启时按 `FILES_RETENTION_HOURS`（默认 7 天）过期清扫；设 0 永久保留。
- **参考图不需要公网 URL**：下游传 multipart/base64 字节，网关经签名 OSS 直传；传 URL 也行（网关服务端下载再传）。

---

## 稳定性设计

1. **鉴权层**：LibTV OAuth access token 约 1 小时，401 时自动强制刷新并重发（`src/mcp.mjs`）。
2. **提交层幂等重试**：所有生成提交带幂等键，瞬时错误（网络/5xx/`COMMERCIAL_BLOCKED 算力不足`）按指数退避自动重试 4 次，**复用同一键**——实测服务端幂等重放安全，"算力不足"重放可恢复。
3. **终态失败重试**：任务终态 FAILED 时换**新幂等键**自动重试 1 次（同键只会取回失败任务）。
4. **轮询容错**：`task_status` 连续失败容忍 10 次后才报错。
5. **任务持久化**：每个任务落盘 `data/jobs/<id>.json`；**重启自动恢复**未完成视频任务的轮询。
6. **并发保护**：信号量限制同时进行的生成数（默认 3），保护单账号额度；超出的排队。
7. **参数校验快速失败**：校验类错误不重试，直接返回给调用方。

---

## 配置

复制 `.env.example` 为 `.env`，可用项：

| 变量 | 说明 | 默认 |
|---|---|---|
| `GATEWAY_API_KEY` | 对外 Bearer key | 自动生成到 `data/gateway-key.json` |
| `GATEWAY_PORT` | 监听端口 | `8787` |
| `LIBTV_PROJECT_ID` | **必填**，画布 uuid（`list_projects` 查询） | 无 |
| `DEFAULT_IMAGE_MODEL` / `DEFAULT_VIDEO_MODEL` | 默认模型 | `lib-image-2.6-a` / `motion-3.1-lite` |
| `MAX_CONCURRENT_GENERATIONS` | 并发上限 | `3` |
| `SUBMIT_RETRIES` | 提交层重试次数 | `4` |
| `FAILED_TASK_RETRIES` | 终态失败重试次数 | `1` |
| `POLL_INTERVAL_MS` | 轮询间隔 | `3000` |
| `IMAGE_TIMEOUT_MS` / `VIDEO_TIMEOUT_MS` | 图像/视频超时 | 5 分钟 / 25 分钟 |
| `MIRROR_RESULTS` | 是否镜像转存结果 | `false` |
| `FILES_RETENTION_HOURS` | 镜像保留时长（0=永久） | `168` |
| `CLEANUP_CANVAS_NODES` | 完成后删画布节点 | `true` |

---

## 隐私与安全

项目按"单用户自用 + 可开源"设计，**任何账号凭据与运行数据都不会进入仓库**：

- `.gitignore` 已排除：`.env`、`data/credentials.json`（OAuth token）、`data/gateway-key.json`（API key）、整个 `data/`（任务记录、prompt、生成结果、CLI 二进制）、`.workbuddy/`（开发笔记）。
- 源码中**不硬编码任何账号 uuid / token / key**，画布 uuid 必须从环境变量读取。
- 对外文档接口 `/docs`、`/docs.md`、`/openapi.json` 为纯静态内容，不含任何私密信息。
- 若你已授权过，`data/credentials.json` 含 access_token / refresh_token——**切勿提交或分享**；换机器部署时重新扫码授权即可。
- 仓库中 `recipes/*.json` 的 `projectId` 为 `{{env.LIBTV_PROJECT_ID}}` 占位符，不含真实值。

> 注意：把个人账号能力转成对他人提供的服务可能触及平台服务条款。请确保使用场景符合 LibTV 用户协议。

---

## 目录结构

```
bin/gateway.mjs        网关入口（npm start）
bin/libtv-probe.mjs    授权/验证 CLI（npm run auth:* / tools / probe / call / verify ...）
src/server.mjs         HTTP 服务：鉴权 / 路由 / 免鉴权文档 / multipart
src/docs.mjs           OpenAPI JSON + Markdown + HTML 文档内容
src/orchestrator.mjs   三条流水线（生成/编辑/视频）+ 重试编排
src/libtv.mjs          工具封装：提交/轮询/取 URL/模型发现/信号量
src/upload.mjs         上传链：ticket → OSS 裸 PUT → complete → 挂画布
src/mirror.mjs         结果镜像转存 + 本地过期清扫
src/cleanup.mjs        画布节点"用完即删"
src/jobs.mjs           任务持久化（data/jobs/）
src/retry.mjs          错误分类 + 指数退避
src/config.mjs         .env / 环境变量配置
src/mcp.mjs            MCP 客户端（会话保活 / SSE / 401 刷新）
src/oauth.mjs          OAuth 2.1（改编自 MIT 项目 redkiller79/dsh-libtv，已署名）
recipes/*.json         阶段 1 验证配方
```

---

## 实现备注（LibTV MCP 实测发现，2026-11-25）

- `tools/list` 实际 70 个工具（社区文档说 86）——schema 会漂移，网关只依赖最小工具集合：`generation_submit` / `create_node` / `generate_video` / `task_status` / `inspect_media` / `search_models` / `get_model` / `upload_ticket` / `upload_complete` / `upload_media`。
- `task_status.result` 里没有媒体 URL，要用 `artifacts[0].node_key` → `inspect_media` 换 `media.urls[0]`。
- 工具参数命名不一致：`generation_submit`/`task_status` 用 snake_case，`inspect_media`/`upload_media`/`create_node` 用 camelCase。
- **图像节点不接受 `intent` 参数**（"Node intent is only used for video nodes"）；图生图模式由引用边 `left:[源节点id]` 推导。
- `upload_media` 节点名必须唯一（同名报 NODE_NAME_CONFLICT），网关用 jobId 命名。
- OSS 分片直传必须是"裸" PUT（附加头会 SignatureDoesNotMatch）。
- 图像生成约 1 分钟内出结果；视频模型预估 3 分钟。

## 已知边界

- 账号算力（额度）耗尽时所有生成被 `COMMERCIAL_BLOCKED` 拦截——这不是网关问题，充值/领活动额度后即恢复。
- 结果 URL 在 `libtv-res.liblib.art` 域，目前无签名；若下游要长期缓存建议开启镜像。
- 视频为异步 job 句柄风格（类 Sora）；图像为同步长轮询，超过 `IMAGE_TIMEOUT_MS` 返回 504 并保留任务可续查。

## 许可

本项目为单用户自用工具。OAuth 实现改编自 MIT 许可项目 `redkiller79/dsh-libtv`，已在源码署名。
