# LibTV 生成 API 网关

把 **LibTV 的生图 / 改图 / 生视频能力**包装成 **OpenAI 风格的 HTTP 接口**，供你自己的应用、脚本或 Agent 调用。

- 图像生成：`POST /v1/images/generations`
- 图像编辑：`POST /v1/images/edits`
- 视频生成：`POST /v1/videos` + `GET /v1/videos/{id}`

只需一个 API key，扫码授权一次即可长期使用。适合**单用户自用**，无账号系统、无第三方运行时依赖（Node.js ≥ 20 即可）。

仓库地址：<https://gitee.com/konger520/all-to-video-api.git>

> 💬 **对接或部署遇到问题？** ——扫码加好友聊聊（备注 **LibTV网关**）  
> 另外如果你在做 **AI 短剧 / 批量视频**，欢迎试试我的短剧工具 **[auto.kanglan.vip](https://auto.kanglan.vip)** —— 复刻解析轻松制作！
>
> 短剧工具本身免费，但是生成费用需要自己承担。

|   |   |   |
| - | - | - |

> |                    扫码加好友（备注：LibTV网关）                    |                        关注公众号（陈程序员大康）                       |
> | :-----------------------------------------------------: | :--------------------------------------------------------: |
> | <img src="docs/images/wechat-qrcode.jpg" width="180" /> | <img src="docs/images/official-account.jpg" width="180" /> |
> |                    **微信号: kan28256**                    |                        **获取最新自动化教程**                       |

---

## 你能用它做什么

- 用 OpenAI 兼容的方式调用 LibTV，不用自己处理扫码登录、令牌续期、任务轮询。
- 在请求里直接指定模型、画幅、清晰度、时长等参数；**支持哪些值由 LibTV 实时决定**，可先查询再调用。
- 图像接口同步返回结果；视频接口返回任务 id，再用任务 id 查询结果。
- 把 `/docs.md` 或 `/openapi.json` 发给 Agent，它就能自动学会对接。

---

## 一、准备条件

1. Node.js **20 或更高版本**（`node -v` 查看）。
2. 一个 LibTV 账号，并能微信扫码授权。
3. LibTV 账号中有一个可用画布，且账号有可用算力/额度。
4. 可选：Docker（如果你想用容器部署）。

> 项目零第三方依赖，**不需要 `npm install`**。

---

## 二、安装与配置

```bash
git clone https://gitee.com/konger520/all-to-video-api.git
cd all-to-video-api
cp .env.example .env
```

编辑 `.env`，至少先设置你自己的 API key：

```env
GATEWAY_API_KEY=sk-your-own-secret-key
GATEWAY_PORT=8787
```

`GATEWAY_API_KEY` 是你对外提供服务的口令，下游调用时必须用 `Authorization: Bearer <这个 key>`。若不设置，首次启动会自动生成一个并保存到 `data/gateway-key.json`。

`LIBTV_PROJECT_ID`（画布 uuid）可以先留空，完成下面的授权后再查询填写。

---

## 三、授权（只需一次）

### 方式一：命令行扫码（推荐）

```bash
npm run auth:login
```

终端会打印一个官方授权链接并尝试自动打开浏览器；用微信扫码确认后，凭据自动保存到本机 `data/credentials.json`，之后 refresh token 会静默续期，通常不用再次扫码。

接着查出你的画布 uuid，填进 `.env` 的 `LIBTV_PROJECT_ID`：

```bash
npm run call -- list_projects '{}'
```

在输出的 JSON 里找到 `uuid` 字段（不是数字 `id`），复制进去即可。

随时可检查授权状态：

```bash
npm run auth:status
```

> 授权成功后网关会生成 `data/LibTV.lock`，`/auth` 授权页随即锁定，不能重复授权。如果授权过期或刷新连续失败，网关会自动删除这个锁并提示你重新访问 `/auth` 授权。确需更换账号时，执行 `npm run auth:logout`（会同时清除凭据和锁）。

### 方式二：网页授权（可选）

如果你在本机运行（或 Docker 映射端口到本机），可在 `.env` 中设置：

```env
GATEWAY_PUBLIC_URL=http://127.0.0.1:8787
```

启动网关后打开 <http://127.0.0.1:8787/auth>，点击「跳转到官方授权」→ 微信扫码 → 回调后凭据自动落盘。

> LibTV 官方只接受 `127.0.0.1` / `localhost` 回调，内网 IP 和公网域名会被拒绝。因此Docker / 服务器部署请优先用方式一，在宿主机扫码后挂载凭据。

---

## 四、启动服务

```bash
npm start
```

看到类似输出即启动成功：

```text
✓ LibTV OpenAI 兼容网关已启动
  地址        : http://127.0.0.1:8787
  授权页      : http://127.0.0.1:8787/auth （已锁定 ...）
  接口文档    : http://127.0.0.1:8787/docs  |  /docs.md  |  /openapi.json
```

检查服务是否正常：

```bash
curl http://127.0.0.1:8787/healthz
```

---

## 五、查看接口文档

服务默认首页是**模型广场**，顶部导航可在首页、模型广场、API 文档、授权之间切换。以下页面**不需要 API key**：

| 地址                                   | 用途                                                              |
| ------------------------------------ | --------------------------------------------------------------- |
| <http://127.0.0.1:8787/>             | 首页：三个入口 + 最短对接路径                                                |
| <http://127.0.0.1:8787/models>       | 模型广场：查看实时模型与参数契约、筛选、一键复制模型 ID                                   |
| <http://127.0.0.1:8787/docs>         | 浏览器打开的可视化文档：左侧接口导航，右侧说明 / 参数 / cURL·Node.js·Python 示例，支持搜索与明暗主题 |
| <http://127.0.0.1:8787/docs.md>      | Markdown 文本，适合直接发给 Agent                                        |
| <http://127.0.0.1:8787/openapi.json> | OpenAPI 3.0 JSON，适合自动生成客户端                                      |

把 `http://<你的服务地址>/docs.md` 发给 Agent，它就能按文档完成对接。

---

## 六、对接 API

所有业务接口都带请求头：

```text
Authorization: Bearer <GATEWAY_API_KEY>
```

基础地址默认为 `http://127.0.0.1:8787`。

### 1. 查模型和参数

```bash
# 模型列表
curl -H "Authorization: Bearer $GATEWAY_API_KEY" \
  http://127.0.0.1:8787/v1/models

# 某个模型当前支持的参数（画幅、清晰度、时长、数量等枚举）
curl -H "Authorization: Bearer $GATEWAY_API_KEY" \
  http://127.0.0.1:8787/v1/models/lib-image-2.6-a
```

返回里的 `input_contract.parameterSchemas` 就是该模型当前可用的参数与取值。**网关不限制枚举，能不能用完全以这里为准**；LibTV 升级后这里会自动更新。

### 2. 文生图

```bash
curl -X POST http://127.0.0.1:8787/v1/images/generations \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "z-image",
    "prompt": "a cat on the moon",
    "params": {"ratio": "16:9", "quality": "1K", "count": 1}
  }'
```

响应示例：

```json
{
  "created": 1760000000,
  "data": [{"url": "https://libtv-res.liblib.art/....png", "source_url": "https://libtv-res.liblib.art/....png"}],
  "libtv": {"job_id": "img_xxx", "model": "z-image", "node_key": "..."}
}
```

也可以用 OpenAI 风格便利字段：`size`（就近映射画幅）、`n`（数量）；同时传 `params` 时以 `params` 为准。

### 3. 图像编辑 / 图生图

用 multipart 上传参考图：

```bash
curl -X POST http://127.0.0.1:8787/v1/images/edits \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -F "image=@cat.png" \
  -F "prompt=turn the cat blue" \
  -F "model=lib-image-2.6-a" \
  -F 'params={"ratio":"1:1"}'
```

也可以传 JSON，`image` 支持 URL、base64 或 data URL：

```json
{
  "model": "lib-image-2.6-a",
  "prompt": "turn the cat blue",
  "image": "https://example.com/cat.png"
}
```

### 4. 视频生成（异步）

```bash
# 创建任务
curl -X POST http://127.0.0.1:8787/v1/videos \
  -H "Authorization: Bearer $GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"motion-3.1-lite","prompt":"ocean waves at sunset","params":{"duration":5}}'

# 返回 {"id":"vid_xxx","status":"processing",...}

# 查询任务
curl -H "Authorization: Bearer $GATEWAY_API_KEY" \
  http://127.0.0.1:8787/v1/videos/vid_xxx
```

任务 `status` 为 `succeeded` 时，响应中的 `result.url` 就是视频地址；也可直接访问 `/v1/videos/{id}/content` 跳转到结果。带 `image` 字段即可做图生视频。

### 5. 用 OpenAI SDK 调用

```bash
npm install openai
```

```js
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.GATEWAY_API_KEY,
  baseURL: 'http://127.0.0.1:8787/v1',
})

const result = await client.images.generate({
  model: 'lib-image-2.6-a',
  prompt: 'a cat on the moon',
})
console.log(result.data[0].url)
```

> SDK 的类型定义可能不包含本网关的 `params` 扩展字段；需要完整控制画幅/清晰度/时长时，用 `curl` 或原生 `fetch` 直接发 JSON 更方便。

### 6. 接口一览

| 方法   | 路径                        | 说明                           |
| ---- | ------------------------- | ---------------------------- |
| GET  | `/healthz`                | 探活（免鉴权）                      |
| GET  | `/v1/models`              | 模型列表；`?detail=full` 附带全部参数契约 |
| GET  | `/v1/models/{id}`         | 单个模型的实时参数契约                  |
| POST | `/v1/images/generations`  | 文生图，同步返回                     |
| POST | `/v1/images/edits`        | 图像编辑，同步返回                    |
| POST | `/v1/videos`              | 创建视频任务，异步返回                  |
| GET  | `/v1/videos/{id}`         | 查询视频任务                       |
| GET  | `/v1/videos/{id}/content` | 跳转到视频结果                      |
| GET  | `/files/{jobId}[/{n}]`    | 读取本地镜像结果（仅在开启镜像时有内容）         |

错误统一为 `{"error":{"message","type","code"}}` 格式。

### 7. 接入 New API

本网关本身就是 OpenAI 兼容上游，可以直接作为 New API 的渠道使用，不需要再套一层转换。

**渠道配置**：

| 项               | 填什么                                                        |
| --------------- | ---------------------------------------------------------- |
| 渠道类型            | `OpenAI`（OpenAI Compatible）                                |
| 代理地址 / Base URL | `http://<服务器IP>:8787` —— **只填到根路径**，不要带 `/v1`，New API 会自己拼 |
| 密钥              | `/www/all-to-videoApi/.env` 里的 `GATEWAY_API_KEY`           |
| 模型列表            | 拉取后勾选需要的模型；图像模型和视频模型分开勾选，模型名与 `/v1/models` 返回的 id 保持一致     |

**图像生成**：走 `/v1/images/generations`，标准字段 `model` / `prompt` / `n` / `size` 均可直接用；`n` 映射为 LibTV 的 `count`，`size` 就近映射为画幅。更精细的控制（清晰度、比例、数量枚举）放 `params` 透传。低成本批量生成优先用 `z-image`（默认 1K，可选 2K/4K），不要用 `seedream-4.5`。

**视频生成**：走 `/v1/videos`，同时接受 JSON 和 `multipart/form-data`。New API 发过来的 `duration`、`width`、`height` 会被映射为 LibTV 参数，`image` 字段支持文件或 URL/base64。任务返回 OpenAI Sora 风格：

```json
{ "id": "vid-...", "object": "video", "status": "queued", "progress": 0, "model": "...", "created_at": 1764000000 }
```

轮询 `GET /v1/videos/{id}`，`status=completed` 且 `progress=100` 时从 `result.url` 取结果。状态枚举为 `queued` / `in_progress` / `completed` / `failed`。

**几个注意点**：

- 结果默认返回 **LibTV 原始公网 URL**，网关不做转存。若下游必须拿到本网关可下载的链接，需开启 `MIRROR_RESULTS=true`，并通过 `/files/{jobId}` 读取（该路径支持 `?key=<API_KEY>`）。
- 若授权过期或 refresh 连续失败，网关会返回 `AUTH_REQUIRED` 并自动解锁 `/auth`，需要部署方重新扫码，New API 侧无法自行恢复。
- 如果 New API 版本较旧、没有视频渠道支持，图像部分仍可正常接入；视频需升级到支持 `/v1/videos` 的版本。

---

## 七、Docker 部署

先在**宿主机**完成一次扫码授权（见第三节），再把整个 `data` 目录挂进容器：

```bash
# 构建镜像
docker build -t libtv-openai-gateway .

# 运行（data 不要加 :ro：续期要回写凭据，授权失效时要删除锁）
docker run -d --name libtv-gateway -p 8787:8787 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env:/app/.env:ro \
  libtv-openai-gateway
```

然后访问 <http://127.0.0.1:8787/docs> 查看文档，或 <http://127.0.0.1:8787/auth> 查看授权状态。

- 镜像内**不含任何凭据、API key 或运行记录**，全部来自挂载。
- 如果确实想在页面里授权，把 `GATEWAY_PUBLIC_URL=http://127.0.0.1:8787` 写进 `.env` 并映射端口；但一般不需要。
- **不要把网关直接暴露到公网**，`/auth` 是免鉴权入口。

### Jenkins 自动部署（本项目服务器）

仓库根目录的 `Jenkinsfile` 已接入 Jenkins，任务名为 `all-to-video-api-deploy`，从 `main` 分支构建：

- 源码与数据统一放在宿主机 `/www/all-to-videoApi`，容器内挂载为 `/app`；`.env` 与 `data/` 在镜像重建时保留。
- 构建参数：`HOST_PORT`（默认 `8787`）、`LIBTV_PROJECT_ID`（仅首次初始化 `.env` 时写入）、`FORCE_REBUILD`（强制无缓存构建）。
- 每次推送到 `main` 后手动触发该任务即可重新部署；流水线会构建镜像、替换容器，并从容器内部检查 `/healthz` 与 `/docs.md`。
- 对外 API key 在 `/www/all-to-videoApi/.env` 的 `GATEWAY_API_KEY`；首次部署自动生成，不会打印到构建日志。
- 若授权过期导致锁自动解除，可用 SSH 端口转发后在本地浏览器重新授权：

```bash
ssh -L 8787:127.0.0.1:8787 <用户名>@<服务器>
# 浏览器打开 http://127.0.0.1:8787/auth 扫码
```

---

## 八、常用配置

在 `.env` 中设置（完整示例见 `.env.example`）：

| 变量                                            | 说明                                                                    | 默认                                    |
| --------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| `GATEWAY_API_KEY`                             | 对外 Bearer key                                                         | 自动生成到 `data/gateway-key.json`         |
| `GATEWAY_PORT`                                | 监听端口                                                                  | `8787`                                |
| `LIBTV_PROJECT_ID`                            | **必填**，画布 uuid（开启按日期归档后作为兜底画布）                                        | 无                                     |
| `CANVAS_BY_DATE`                              | `true` 时每天自动创建「CANVAS_NAME_PREFIX-YYYY-MM-DD」画布，当天生成进当天画布，方便按天归档/整体清理 | `true`                                |
| `CANVAS_NAME_PREFIX`                          | 按日期画布的名称前缀                                                            | `API网关`                               |
| `DEFAULT_IMAGE_MODEL` / `DEFAULT_VIDEO_MODEL` | 不传 `model` 时的默认模型                                                     | `lib-image-2.6-a` / `motion-3.1-lite` |
| `MIRROR_RESULTS`                              | `true` 时把结果转存到本地并暴露 `/files/...`                                      | `false`                               |
| `FILES_RETENTION_HOURS`                       | 本地镜像保留时长，`0` 为永久                                                      | `168`                                 |
| `CLEANUP_CANVAS_NODES`                        | 是否清理画布节点；`false` 则永久保留，方便在 LibTV 复查                                   | `true`                                |
| `CANVAS_NODE_RETENTION_HOURS`                 | 仅上面为 `true` 时生效：`0`=立即删除，`N`=保留 N 小时后自动删除                             | `0`                                   |
| `LOG_RETENTION_HOURS`                         | HTTP 访问日志与 MCP 出站日志保留时长，`0` 为永久                                       | `168`                                 |
| `MAX_CONCURRENT_GENERATIONS`                  | 同时进行的生成数上限                                                            | `3`                                   |
| `AUTH_REFRESH_MAX_FAILURES`                   | 刷新连续失败多少次后要求重新授权                                                      | `3`                                   |

**结果地址**：默认直接返回 LibTV 的原始公网直链；如需稳定地址或担心直链时效，设 `MIRROR_RESULTS=true`，此时结果会转存到 `data/results/`，接口返回 `http://<你的服务地址>/files/<任务id>`。

**画布归档**：默认 `CANVAS_BY_DATE=true`，每天第一次生成时自动在 LibTV 创建（或复用）一个「API网关-2026-11-26」这样的日期画布，当天所有任务都落在里面；画布 uuid 的映射存在 `data/canvases.json`，重启不丢。想清理历史生成时，直接在 LibTV 删除整天的画布即可。创建失败（网络/权限）时自动降级用 `LIBTV_PROJECT_ID` 指定的画布，不影响生成。

**画布节点留存**：默认生成成功后立即删除本次创建的画布节点。若想在 LibTV 里复查生成结果、保留证据，设 `CLEANUP_CANVAS_NODES=false` 可永久保留；若只想暂存一段时间，保持 `CLEANUP_CANVAS_NODES=true` 并设 `CANVAS_NODE_RETENTION_HOURS=24`（示例为保留 24 小时），到期的节点会在服务启动时及每 10 分钟由后台自动清理，重启不会丢失清理计划。

**日志留存**：网关会把两类日志按天写入 `data/logs/`，默认保留 7 天，可用 `LOG_RETENTION_HOURS` 调整（`0` 表示永久）：

- `http-YYYY-MM-DD.log`：收到的 HTTP 请求，含方法、路径、状态码、耗时、来源 IP、请求体字节数、模型、prompt 片段、任务 id、错误信息；


- `mcp-YYYY-MM-DD.log`：去 LibTV 的 MCP 请求，含工具名、参数摘要、是否成功、耗时、错误信息。  
  日志只记元数据，不记录 `Authorization`、Cookie、图片字节等敏感内容。

---

## 九、常见问题

| 现象                             | 处理                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------ |
| 返回 `401 invalid_api_key`       | 检查请求头是否带了正确的 `GATEWAY_API_KEY`                                                 |
| 返回 `AUTH_REQUIRED`             | 查看 `/auth/status`：未锁定时访问 `/auth` 重新扫码；已锁定但接口仍报错时执行 `npm run auth:logout` 后重新授权 |
| 访问 `/auth` 只看到「已授权」            | 这是正常现象：授权成功后授权页会锁定，防止覆盖当前账号                                                    |
| 提示 `COMMERCIAL_BLOCKED` / 算力不足 | LibTV 账号额度不足，与网关无关，充值或领取活动额度后恢复                                                |
| 视频任务返回 `409 not_ready`         | 视频是异步的，继续用任务 id 查询，直到 `status=succeeded`                                       |
| 图像接口返回 `504`                   | 生成超出等待时间，任务已保留，可用返回的 job id 通过 `/v1/videos/{id}` 继续查                           |
| Docker 里页面授权不显示按钮              | LibTV 只接受 loopback 回调，请在宿主机扫码并挂载 `data`                                        |

---

## 十、隐私与安全

- 凭据、API key、任务记录、授权锁都保存在本地 `data/`，已被 `.gitignore` 排除，**不会进入仓库或 Docker 镜像**。
- `data/credentials.json` 含你的 LibTV 令牌，切勿提交、分享或上传。
- `/docs`、`/docs.md`、`/openapi.json` 不含任何账号信息，可安全提供给下游 Agent。
- 本项目为单用户自用工具；把个人账号能力转给他人使用前，请确认符合 LibTV 服务条款。

---

## 开发文档

如果你想了解项目结构、实现细节、LibTV MCP 实测约束、重试/持久化机制，请阅读 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 许可

本项目为单用户自用工具。OAuth 实现改编自 MIT 许可项目 `redkiller79/dsh-libtv`，已在源码署名。
