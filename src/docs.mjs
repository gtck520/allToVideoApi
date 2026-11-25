// 免鉴权接口文档：OpenAPI 3.0 规范 + Agent 友好的 Markdown + 可视化 HTML
// 全部为静态内容，不暴露任何账号/token/配置细节，可安全对外提供

const BASE_DESC = `LibTV OpenAI 兼容网关 —— 把 LibTV 的 MCP 生图/生视频能力暴露成 OpenAI 风格 HTTP 接口。
单用户自用，Bearer API key 鉴权。所有图像/视频生成由 LibTV 账号执行，模型能力以 GET /v1/models/{id} 实时返回为准。`

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'LibTV OpenAI 兼容网关 API',
    version: '0.3.0',
    description: BASE_DESC + `
\n## 对接要点（Agent 必读）
1. 鉴权：所有 /v1/* 接口需请求头 \`Authorization: Bearer <API_KEY>\`（API_KEY 由服务提供方给出）。
2. 模型发现：先 GET /v1/models 拿可用模型 id；再 GET /v1/models/{id} 看该模型当前支持的精确参数枚举（画幅 ratio、清晰度 resolution、时长 duration、数量 count 等）。网关不校验枚举，是否支持完全由 LibTV 决定。
3. 参数透传：任何生成接口的请求体都可带 \`params\` 对象，字段会原样透传给 LibTV（如 \`{"ratio":"9:16","resolution":"1K"}\`）。\`size\`/\`n\`/\`seconds\` 是 OpenAI 便利字段，优先级低于 \`params\`。
4. 图像生成/编辑是同步长轮询（一次请求返回最终结果，可能耗时数十秒~数分钟）；视频生成是异步任务（POST 返回 202 + id，再 GET 轮询到 succeeded）。
5. 结果 URL：默认返回 LibTV 原始公网直链；若服务方开启镜像，返回的 url 为本网关 /files/<jobId> 地址，source_url 保留原始地址。
6. 错误统一格式：\n\`\`\`json\n{"error":{"message":"...","type":"...","code":"..."}}\n\`\`\``,
  },
  servers: [{ url: '/', description: '当前服务地址（相对路径，实际 host 由部署决定）' }],
  tags: [
    { name: 'meta', description: '探活 / 文档 / 模型发现' },
    { name: 'images', description: '图像生成与编辑（OpenAI images 兼容）' },
    { name: 'videos', description: '视频生成（Sora 风格异步任务）' },
    { name: 'files', description: '结果文件读取' },
  ],
  components: {
    securitySchemes: { BearerAuth: { type: 'http', scheme: 'bearer', description: '部署方提供的 GATEWAY_API_KEY' } },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              message: { type: 'string', description: '可读错误信息' },
              type: { type: 'string', description: '错误类别，如 invalid_request_error / api_error' },
              code: { type: 'string', description: '机器可读错误码，如 invalid_api_key / not_found / not_ready' },
            },
            required: ['message', 'type', 'code'],
          },
        },
        required: ['error'],
      },
      Model: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '模型 key，用作请求的 model 字段' },
          object: { type: 'string', example: 'model' },
          owned_by: { type: 'string', example: 'libtv' },
          display_name: { type: 'string', description: '模型显示名' },
          estimated_time: { type: 'string', description: '预计耗时' },
          modality: { type: 'string', enum: ['image', 'video'] },
          input_contract: { type: 'object', description: '仅 detail=full 时附带：该模型完整参数契约，含所有枚举与默认值' },
        },
      },
      ImageRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          model: { type: 'string', description: '模型 id，省略则用服务端默认图像模型' },
          prompt: { type: 'string', description: '生成提示词（必填）' },
          size: { type: 'string', description: 'OpenAI 风格尺寸如 1024x1024，服务端就近映射为画幅 ratio', example: '1024x1024' },
          n: { type: 'integer', description: '生成数量，服务端映射为 count（LibTV 通常支持 1/2/4）', example: 1 },
          params: { type: 'object', description: 'LibTV 原生参数透传（优先级高于 size/n），字段以 GET /v1/models/{id} 为准', example: { ratio: '9:16', resolution: '1K', count: 2 } },
        },
      },
      ImageResponse: {
        type: 'object',
        properties: {
          created: { type: 'integer', description: 'Unix 时间戳（秒）' },
          data: { type: 'array', items: { type: 'object', properties: { url: { type: 'string', description: '结果图片地址' }, source_url: { type: 'string', description: 'LibTV 原始地址（开启镜像时存在）' } } } },
          libtv: { type: 'object', description: '扩展字段：job_id / model / node_key' },
        },
      },
      VideoRequest: {
        type: 'object',
        required: ['prompt'],
        description: '同时接受 application/json 与 multipart/form-data（后者供 New API 等 OpenAI 兼容中转使用）',
        properties: {
          model: { type: 'string', description: '模型 id，省略则用服务端默认视频模型' },
          prompt: { type: 'string', description: '生成提示词（必填）' },
          image: { type: 'string', format: 'binary', description: '可选参考图：multipart 文件 / 公网 URL / base64/dataURL（图生视频）' },
          size: { type: 'string', description: 'OpenAI 风格尺寸，映射为画幅 ratio' },
          width: { type: 'integer', description: 'New API 风格宽度，与 height 一起就近映射为 ratio' },
          height: { type: 'integer', description: 'New API 风格高度，与 width 一起就近映射为 ratio' },
          duration: { type: 'number', description: 'New API 风格时长（秒），与 seconds 等价', example: 5 },
          seconds: { type: 'number', description: 'OpenAI Sora 风格时长（秒），映射为 LibTV duration', example: 5 },
          seed: { type: 'integer', description: 'New API 可选字段；是否生效以模型契约为准' },
          fps: { type: 'integer', description: 'New API 可选字段；是否生效以模型契约为准' },
          response_format: { type: 'string', description: '兼容字段；结果始终以 url 形式返回' },
          user: { type: 'string', description: '兼容字段，不参与生成' },
          metadata: { type: 'object', description: '兼容字段，不参与生成' },
          params: { type: 'object', description: 'LibTV 原生参数透传（优先级最高）', example: { duration: 5, ratio: '16:9' } },
        },
      },
      VideoJob: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 id，用于 GET /v1/videos/{id}' },
          object: { type: 'string', example: 'video' },
          status: { type: 'string', enum: ['queued', 'in_progress', 'completed', 'failed'], description: 'OpenAI Sora 风格任务状态' },
          progress: { type: 'integer', description: '进度 0 / 50 / 100', example: 0 },
          model: { type: 'string' },
          created_at: { type: 'integer', format: 'unix-time', description: 'Unix 时间戳（秒）' },
          result: { type: 'object', description: 'completed 时含 url / width / height / node_key' },
          error: { type: 'object', description: 'failed 时含 message / code' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/': {
      get: { tags: ['meta'], summary: '站点首页（免鉴权）', security: [], description: '浏览器打开：模型广场 / API 文档 / 授权的顶部导航与最短对接路径。', responses: { 200: { description: 'HTML 首页' } } },
    },
    '/models': {
      get: { tags: ['meta'], summary: '模型广场（免鉴权）', security: [], description: '浏览器打开：实时模型列表与参数契约，支持搜索、按模态筛选、查看原始契约、复制模型 ID。', responses: { 200: { description: 'HTML 模型广场' } } },
    },
    '/healthz': {
      get: { tags: ['meta'], summary: '探活（免鉴权）', security: [], responses: { 200: { description: '服务状态、MCP 授权状态、并发槽位' } } },
    },
    '/auth': {
      get: { tags: ['meta'], summary: 'LibTV 授权页（免鉴权；已授权后锁定）', security: [], description: '给人用浏览器打开：展示当前授权状态与授权入口。首次未授权时可发起授权；授权成功后服务端生成 data/LibTV.lock，本页改为展示锁定状态，不再提供授权按钮。Docker 部署推荐在宿主机执行 npm run auth:login 并挂载 data/credentials.json 与 data/LibTV.lock。', responses: { 200: { description: 'HTML 授权页或授权锁定页' } } },
    },
    '/auth/status': {
      get: { tags: ['meta'], summary: '授权状态查询（免鉴权）', security: [], responses: { 200: { description: '{authorized, locked, lock:{channel,via,authorized_at,refresh_failures,max_refresh_failures,...}, scope, expires_at, has_refresh_token, redirect_uris, web_auth_available}' } } },
    },
    '/auth/start': {
      post: { tags: ['meta'], summary: '发起 Web 授权（免鉴权，需服务端配置 loopback 回调）', security: [], description: '返回官方 authorize URL；LibTV 只接受 127.0.0.1/localhost 回调，需服务端设置 GATEWAY_PUBLIC_URL 为 loopback 地址。授权锁生效后禁止调用。', responses: { 200: { description: '{authorize_url, state, redirect_uri}' }, 400: { description: '未配置可用的 loopback 回调地址' }, 409: { description: 'auth_locked：已授权且授权锁生效' } } },
    },
    '/auth/callback': {
      get: { tags: ['meta'], summary: 'OAuth 回调入口（免鉴权，官方调用）', security: [], description: '授权锁生效后仅放行锁生成前已发起的在途授权（state 一次性消费）；其他回调返回 409 锁定页。', responses: { 200: { description: 'HTML 结果页，凭据由服务端自动保存' }, 409: { description: '授权锁已生效' } } },
    },
    '/docs': {
      get: { tags: ['meta'], summary: '可视化接口文档（免鉴权）', security: [], responses: { 200: { description: 'HTML 文档页' } } },
    },
    '/openapi.json': {
      get: { tags: ['meta'], summary: 'OpenAPI 3.0 规范（免鉴权）', security: [], responses: { 200: { description: '本规范 JSON' } } },
    },
    '/docs.md': {
      get: { tags: ['meta'], summary: 'Markdown 接口文档（免鉴权，Agent 友好）', security: [], responses: { 200: { description: '纯文本 Markdown' } } },
    },
    '/v1/models': {
      get: {
        tags: ['meta'], summary: '列出可用模型',
        parameters: [{ name: 'detail', in: 'query', schema: { type: 'string', enum: ['full'] }, description: '传 full 时每个模型附带完整参数契约（枚举/默认值）' }],
        responses: { 200: { description: '模型列表', content: { 'application/json': { schema: { type: 'object', properties: { object: { type: 'string' }, data: { type: 'array', items: { $ref: '#/components/schemas/Model' } } } } } } }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/v1/models/{id}': {
      get: {
        tags: ['meta'], summary: '查看单个模型的实时参数契约',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: '模型 id，如 lib-image-2.5-f' }],
        responses: { 200: { description: '模型契约（input_contract.parameterSchemas.<op>.properties 为全部可用参数与枚举）' }, 404: { description: '模型不存在' } },
      },
    },
    '/v1/images/generations': {
      post: {
        tags: ['images'], summary: '文生图（同步长轮询，直接返回图片 URL）',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ImageRequest' } } } },
        responses: { 200: { description: '生成完成', content: { 'application/json': { schema: { $ref: '#/components/schemas/ImageResponse' } } } }, 500: { description: '生成失败（LibTV 错误原样透传，如算力不足）' }, 504: { description: '超时，任务保留可用 GET /v1/videos/{job_id} 查询' } },
      },
    },
    '/v1/images/edits': {
      post: {
        tags: ['images'], summary: '图像编辑（参考图 + prompt，同步长轮询）',
        description: '支持 multipart/form-data（字段名 image 为文件，prompt/model/size/params 为文本字段）或 application/json（image 为 URL/base64/dataURL，params 为对象）。',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { image: { type: 'string', format: 'binary', description: '参考图文件' }, prompt: { type: 'string' }, model: { type: 'string' }, size: { type: 'string' }, params: { type: 'string', description: 'JSON 字符串，如 {"ratio":"9:16"}' } }, required: ['image', 'prompt'] } }, 'application/json': { schema: { type: 'object', properties: { image: { type: 'string' }, prompt: { type: 'string' }, model: { type: 'string' }, params: { type: 'object' } }, required: ['image', 'prompt'] } } } },
        responses: { 200: { description: '编辑完成，结构同 ImageResponse（libtv.reference_node 为参考图画布节点）' }, 500: { description: '生成失败' } },
      },
    },
    '/v1/videos': {
      post: {
        tags: ['videos'], summary: '视频生成（异步任务，Sora 风格）',
        description: '同时支持 application/json 与 multipart/form-data（New API 等 OpenAI 兼容中转使用 multipart）。',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoRequest' } }, 'multipart/form-data': { schema: { $ref: '#/components/schemas/VideoRequest' } } } },
        responses: { 202: { description: '任务已接受，返回 VideoJob（status=queued/in_progress）', content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoJob' } } } }, 500: { description: '提交失败' } },
      },
    },
    '/v1/videos/{id}': {
      get: {
        tags: ['videos'], summary: '查询视频任务',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'VideoJob，completed 时 result.url 为结果地址' }, 404: { description: '任务不存在' } },
      },
    },
    '/v1/videos/{id}/content': {
      get: {
        tags: ['videos'], summary: '302 跳转到视频结果地址',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 302: { description: '跳转到结果 URL' }, 409: { description: '任务未完成，暂无内容' }, 404: { description: '任务不存在' } },
      },
    },
    '/files/{jobId}/{index}': {
      get: {
        tags: ['files'], summary: '读取结果文件（仅开启镜像时有效）',
        description: '鉴权支持 Bearer 头或 ?key=<API_KEY> 查询参数（便于 <img>/<video> 标签直接引用）。未开启镜像或无对应产物时 404。',
        parameters: [
          { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'index', in: 'path', required: false, schema: { type: 'integer' }, description: '产物序号，默认 0' },
          { name: 'key', in: 'query', required: false, schema: { type: 'string' }, description: 'API key（Bearer 头的替代方式）' },
        ],
        responses: { 200: { description: '文件内容（inline）' }, 404: { description: '无对应镜像文件' } },
      },
    },
  },
}

export const markdownDoc = `# LibTV OpenAI 兼容网关 API

把 LibTV 的 MCP 生图/生视频能力暴露为 OpenAI 风格 HTTP 接口。**单用户自用，Bearer API key 鉴权。**

## 1. 鉴权

所有 \`/v1/*\` 和 \`/files/*\` 接口需带请求头：

\`\`\`
Authorization: Bearer <API_KEY>
\`\`\`

API_KEY 由服务部署方提供。文档类接口（\`/docs\`、\`/docs.md\`、\`/openapi.json\`）、\`/healthz\` 与授权页 \`/auth\` 系列**无需鉴权**。

授权页有本地锁保护：首次未授权时可访问 \`/auth\`；授权成功后服务端生成 \`data/LibTV.lock\`，随后 \`/auth\` 只展示锁定状态、\`POST /auth/start\` 返回 409 \`auth_locked\`，防止重复授权覆盖当前账号。若 token 过期且无法续期，或 refresh 连续失败达到阈值（默认 3 次，\`AUTH_REFRESH_MAX_FAILURES\` 可调），网关会自动删除锁并清除凭据，届时 \`/auth\` 重新开放。

若返回 401 \`invalid_api_key\`，检查 key 是否与部署方给的一致。若返回 \`AUTH_REQUIRED\`（LibTV 侧未授权），请先看 \`GET /auth/status\` 的 \`locked\` 字段：为 \`false\` 时由部署方在 \`GET /auth\` 授权页完成一次扫码授权（或在宿主机执行 \`npm run auth:login\` 后挂载凭据与锁文件）；为 \`true\` 但接口仍报未授权，说明凭据异常，需在宿主机执行 \`npm run auth:logout\` 后再授权。这不是下游 Agent 能自行解决的，应提示部署方处理。

## 2. 对接流程（建议顺序）

1. \`GET /v1/models\` —— 列出当前可用模型 id（分 image / video）。
2. \`GET /v1/models/{id}\` —— 查看该模型**实时**支持的全部参数与枚举（画幅 \`ratio\`、清晰度 \`resolution\`、时长 \`duration\`、数量 \`count\`）。**合法取值以这里为准，网关不做任何限制**，LibTV 升级后这里会自动反映新能力。
3. 用模型 id 调生成接口；需要精确控制时把参数放进请求体的 \`params\` 对象原样透传。

## 3. 接口一览

### GET /healthz（免鉴权）
探活，返回服务状态、MCP 授权状态、并发槽位。

### GET /v1/models?detail=full
模型列表。传 \`detail=full\` 时每个模型附带 \`input_contract\`（完整参数契约）。

### GET /v1/models/{id}
单模型实时参数契约。关键字段：\`input_contract.parameterSchemas.<操作>.properties\`，其下每个参数的 \`enum\` / \`default\` 即为当前可用值。

### POST /v1/images/generations —— 文生图（同步）
\`\`\`bash
curl -X POST http://<HOST>/v1/images/generations \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"model":"lib-image-2.5-f","prompt":"a cat on mars","params":{"ratio":"16:9","resolution":"1K","count":1}}'
\`\`\`
请求体：\`prompt\`（必填）、\`model\`、\`size\`（OpenAI 便利字段）、\`n\`、\`params\`（透传，优先级高）。
响应：\`{created, data:[{url, source_url?}], libtv:{job_id,model,node_key}}\`。这是长轮询接口，可能耗时数十秒。

### POST /v1/images/edits —— 图像编辑（同步）
multipart（推荐）：\`image\` 文件字段 + \`prompt\` + 可选 \`model\`/\`size\`/\`params\`（params 为 JSON 字符串）。
\`\`\`bash
curl -X POST http://<HOST>/v1/images/edits \\
  -H "Authorization: Bearer $API_KEY" \\
  -F "image=@cat.png" -F "prompt=turn the cat blue" -F "model=lib-image-2.5-f"
\`\`\`
JSON 方式：\`image\` 为公网 URL / base64 / dataURL。响应结构同文生图。

### POST /v1/videos —— 视频生成（异步）
接受 JSON 或 multipart/form-data。New API 等 OpenAI 兼容中转使用后者，字段 \`duration\` / \`width\` / \`height\` 会被映射；\`params\` 可传 JSON 字符串。
\`\`\`bash
curl -X POST http://<HOST>/v1/videos \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"model":"motion-3.1-lite","prompt":"ocean waves at sunset","params":{"duration":5}}'

# New API 风格（multipart）
curl -X POST http://<HOST>/v1/videos \\
  -H "Authorization: Bearer $API_KEY" \\
  -F "model=motion-3.1-lite" -F "prompt=ocean waves at sunset" -F "duration=5"
\`\`\`
返回 \`202\` + \`{id, object:"video", status, progress, model, created_at, result?}\`（Sora 风格）。

### GET /v1/videos/{id} —— 查询视频任务
轮询到 \`status=completed\` 时 \`result.url\` 即结果地址；\`failed\` 时看 \`error\`。
状态为 OpenAI Sora 风格：\`queued\` / \`in_progress\` / \`completed\` / \`failed\`。

### GET /v1/videos/{id}/content —— 302 跳转结果
未完成返回 \`409\`，不存在返回 \`404\`。

### GET /files/{jobId}[/{index}] —— 读取结果文件
仅服务方开启镜像时有效。鉴权可用 \`?key=<API_KEY>\`（便于 \`<img>\` 直接引用）。

## 4. 错误格式

统一为 OpenAI 风格：
\`\`\`json
{"error":{"message":"可读信息","type":"invalid_request_error","code":"invalid_api_key"}}
\`\`\`
常见 code：\`invalid_api_key\`（401）、\`not_found\`（404）、\`not_ready\`（409）、\`timeout\`（504）、\`generation_failed\`（500）。
LibTV 返回的生成错误（如算力不足 \`COMMERCIAL_BLOCKED\`）会原样透传在 message 中。

## 5. 稳定性语义

- 提交层：指数退避重试并复用幂等键，同一参数重放不会重复扣费。
- 生成失败：自动换新幂等键重试一次。
- 视频任务落盘，服务重启后自动恢复轮询。
- 单账号并发上限由服务端信号量表控制，超限请求排队。

## 6. 结果 URL

默认直接返回 LibTV 原始公网直链。若服务方开启镜像，\`url\` 为本网关稳定地址、\`source_url\` 为原始地址。下游若需长期缓存，建议在开启镜像后保存 \`url\`。
`

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

// ── 文档页数据：导航顺序与示例 ────────────────────────────────────────────────

const NAV = [
  { group: '开始使用', items: [
    { id: 'overview', title: '概览', icon: '⌂' },
    { id: 'quickstart', title: '快速开始', icon: '⚡' },
    { id: 'guide-auth', title: '鉴权与授权', icon: '🔑' },
    { id: 'guide-models', title: '模型与参数', icon: '◇' },
    { id: 'guide-errors', title: '错误与稳定性', icon: '!' },
  ] },
  { group: '服务与文档', items: [
    { path: '/healthz', method: 'get' },
    { path: '/auth', method: 'get' },
    { path: '/auth/status', method: 'get' },
    { path: '/auth/start', method: 'post' },
    { path: '/auth/callback', method: 'get' },
    { path: '/docs', method: 'get' },
    { path: '/openapi.json', method: 'get' },
    { path: '/docs.md', method: 'get' },
  ] },
  { group: '模型', items: [
    { path: '/v1/models', method: 'get' },
    { path: '/v1/models/{id}', method: 'get' },
  ] },
  { group: '图像', items: [
    { path: '/v1/images/generations', method: 'post' },
    { path: '/v1/images/edits', method: 'post' },
  ] },
  { group: '视频', items: [
    { path: '/v1/videos', method: 'post' },
    { path: '/v1/videos/{id}', method: 'get' },
    { path: '/v1/videos/{id}/content', method: 'get' },
  ] },
  { group: '文件', items: [
    { path: '/files/{jobId}/{index}', method: 'get' },
  ] },
]

function sectionId(method, path) {
  return ((method || 'guide') + '-' + (path || '')).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function opKey(item) { return `${item.method} ${item.path}` }

const SAMPLES = {
  'get /healthz': { url: '/healthz', langs: ['curl'] },
  'get /auth': { url: '/auth', langs: ['curl'] },
  'get /auth/status': { url: '/auth/status', langs: ['curl'] },
  'post /auth/start': { method: 'POST', url: '/auth/start', langs: ['curl'] },
  'get /auth/callback': { url: '/auth/callback?code=<CODE>&state=<STATE>', langs: [], custom: '由 LibTV 官方在授权完成后回调，调用方无需手动请求。' },
  'get /docs': { url: '/docs', langs: ['curl'] },
  'get /openapi.json': { url: '/openapi.json', langs: ['curl'] },
  'get /docs.md': { url: '/docs.md', langs: ['curl'] },
  'get /v1/models': { url: '/v1/models?detail=full', langs: ['curl', 'node', 'python'] },
  'get /v1/models/{id}': {
    url: { curl: '/v1/models/lib-image-2.5-f', node: '/v1/models/lib-image-2.5-f', python: '/v1/models/lib-image-2.5-f' },
    langs: ['curl', 'node', 'python'],
  },
  'post /v1/images/generations': {
    method: 'POST', url: '/v1/images/generations', langs: ['curl', 'node', 'python'],
    body: { model: 'lib-image-2.5-f', prompt: 'a cat on mars', params: { ratio: '16:9', resolution: '1K', count: 1 } },
  },
  'post /v1/images/edits': {
    method: 'POST', url: '/v1/images/edits', langs: ['curl', 'node', 'python'],
    form: { image: '@/path/to/cat.png', prompt: 'turn the cat blue', model: 'lib-image-2.5-f' },
  },
  'post /v1/videos': {
    method: 'POST', url: '/v1/videos', langs: ['curl', 'node', 'python'],
    body: { model: 'motion-3.1-lite', prompt: 'ocean waves at sunset', params: { duration: 5, ratio: '16:9' } },
  },
  'get /v1/videos/{id}': {
    url: { curl: '/v1/videos/$JOB_ID', node: '/v1/videos/${JOB_ID}', python: '/v1/videos/{job_id}' },
    langs: ['curl', 'node', 'python'], pathNote: '把 JOB_ID 换成 POST /v1/videos 返回的任务 id。',
  },
  'get /v1/videos/{id}/content': {
    url: { curl: '/v1/videos/$JOB_ID/content', node: '/v1/videos/${JOB_ID}/content', python: '/v1/videos/{job_id}/content' },
    langs: ['curl'], pathNote: '把 JOB_ID 换成任务 id；未完成返回 409，完成后 302 跳转到结果地址。',
  },
  'get /files/{jobId}/{index}': {
    url: { curl: '/files/$JOB_ID/0?key=$API_KEY', node: '/files/${JOB_ID}/0?key=${process.env.API_KEY}', python: '/files/{job_id}/0?key={api_key}' },
    langs: ['curl'], pathNote: '仅在服务方开启镜像时有效；也可用 Bearer 头代替 ?key=。',
  },
}

const RESPONSES = {
  'get /healthz': { ok: true, auth: { authorized: true, locked: true }, slots: { running: 0, limit: 1 } },
  'get /auth/status': { authorized: true, locked: true, lock: { channel: 'libtv', via: 'cli', refresh_failures: 0, max_refresh_failures: 3 }, scope: '...', expires_at: 0 },
  'post /auth/start': { authorize_url: 'https://.../authorize?...', state: '...', redirect_uri: 'http://127.0.0.1:8787/auth/callback' },
  'get /v1/models': { object: 'list', data: [{ id: 'lib-image-2.5-f', object: 'model', owned_by: 'libtv', modality: 'image' }, { id: 'motion-3.1-lite', object: 'model', owned_by: 'libtv', modality: 'video' }] },
  'get /v1/models/{id}': { id: 'lib-image-2.5-f', object: 'model', modality: 'image', input_contract: { parameterSchemas: { generation: { properties: { ratio: { enum: ['1:1', '9:16', '16:9'] }, resolution: { enum: ['1K', '2K'] }, count: { enum: [1, 2, 4] } } } } } },
  'post /v1/images/generations': { created: 1764000000, data: [{ url: 'https://.../image.png' }], libtv: { job_id: '...', model: 'lib-image-2.5-f', node_key: '...' } },
  'post /v1/images/edits': { created: 1764000000, data: [{ url: 'https://.../edited.png' }], libtv: { job_id: '...', model: 'lib-image-2.5-f', node_key: '...', reference_node: '...' } },
  'post /v1/videos': { id: 'job-...', object: 'video', status: 'queued', progress: 0, model: 'motion-3.1-lite', created_at: 1764000000 },
  'get /v1/videos/{id}': { id: 'job-...', object: 'video', status: 'completed', progress: 100, model: 'motion-3.1-lite', created_at: 1764000000, result: { url: 'https://.../video.mp4', width: 1280, height: 720, node_key: '...' } },
  'get /v1/videos/{id}/content': null,
  'get /files/{jobId}/{index}': null,
}

const ENDPOINT_NOTES = {
  'get /auth': ['授权成功后服务端写入 data/LibTV.lock，页面随即锁定，不再提供授权按钮。'],
  'post /auth/start': ['LibTV 只接受 127.0.0.1 / localhost 回调；服务端 GATEWAY_PUBLIC_URL 必须是 loopback 地址。'],
  'get /v1/models': ['传 detail=full 才会附带 input_contract（完整参数契约），普通列表更轻量。'],
  'get /v1/models/{id}': ['合法取值以 input_contract.parameterSchemas.<操作>.properties 下的 enum / default 为准，网关不做枚举校验。'],
  'post /v1/images/generations': ['同步长轮询：一次请求等到生成完成，通常耗时数十秒到数分钟。', 'size / n 是 OpenAI 便利字段；需要精确控制时用 params 透传，优先级更高。'],
  'post /v1/images/edits': ['支持 multipart/form-data（推荐）与 application/json（image 为 URL / base64 / dataURL）。'],
  'post /v1/videos': ['异步任务：立即返回 202 和任务 id，再用 GET /v1/videos/{id} 轮询。', 'Timeout 后任务仍保留，可用任务 id 继续查询。'],
  'get /v1/videos/{id}': ['status=completed 时 result.url 为结果地址；failed 时查看 error。', '状态为 OpenAI Sora 风格：queued / in_progress / completed / failed。'],
  'get /v1/videos/{id}/content': ['浏览器可直接打开；未完成返回 409，不存在返回 404。'],
  'get /files/{jobId}/{index}': ['鉴权可用 Bearer 头或 ?key=<API_KEY>，后者便于 <img> / <video> 标签引用。'],
}

// ── 示例生成 ──────────────────────────────────────────────────────────────────

function sampleUrl(sample, lang) {
  if (!sample.url) return '/'
  return typeof sample.url === 'string' ? sample.url : (sample.url[lang] || sample.url.curl)
}
function isProtected(path) { return path.startsWith('/v1/') || path.startsWith('/files/') }

function curlExample(item, sample) {
  const method = (sample.method || item.method || 'GET').toUpperCase()
  const parts = [`curl ${sample.curlFlags ? sample.curlFlags + ' ' : ''}-X ${method} "http://<HOST>${sampleUrl(sample, 'curl')}"`]
  if (isProtected(item.path) && !sampleUrl(sample, 'curl').includes('key=')) parts.push('-H "Authorization: Bearer $API_KEY"')
  if (sample.body) {
    parts.push('-H "Content-Type: application/json"')
    parts.push(`-d '${JSON.stringify(sample.body, null, 2)}'`)
  } else if (sample.form) {
    for (const [k, v] of Object.entries(sample.form)) parts.push(`-F "${k}=${v}"`)
  }
  return parts.map((p, i) => `${i ? '  ' : ''}${p}${i < parts.length - 1 ? ' \\' : ''}`).join('\n')
}

function nodeExample(item, sample) {
  const method = (sample.method || item.method || 'GET').toUpperCase()
  const lines = []
  if (sample.form) {
    lines.push("import { readFile } from 'node:fs/promises'")
    lines.push('')
    lines.push('const form = new FormData()')
    for (const [k, v] of Object.entries(sample.form)) {
      if (k === 'image') lines.push(`form.append('image', new Blob([await readFile('cat.png')]), 'cat.png')`)
      else lines.push(`form.append('${k}', ${JSON.stringify(v)})`)
    }
    lines.push('')
  }
  lines.push(`const res = await fetch('http://<HOST>${sampleUrl(sample, 'node')}', {`)
  lines.push(`  method: '${method}',`)
  lines.push('  headers: {')
  lines.push('    Authorization: `Bearer ${process.env.API_KEY}`,')
  if (sample.body) lines.push("    'Content-Type': 'application/json',")
  lines.push('  },')
  if (sample.body) lines.push(`  body: JSON.stringify(${JSON.stringify(sample.body, null, 2)}),`)
  if (sample.form) lines.push('  body: form,')
  lines.push('})')
  lines.push('const data = await res.json()')
  lines.push('console.log(res.status, data)')
  return lines.join('\n')
}

function pyLiteral(v) {
  if (v === null) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`
  return `{${Object.entries(v).map(([k, val]) => `'${k}': ${pyLiteral(val)}`).join(', ')}}`
}

function pythonExample(item, sample) {
  const method = (sample.method || item.method || 'GET').toLowerCase()
  const lines = ['import os', 'import requests', '']
  lines.push(`r = requests.${method}(`)
  lines.push(`    "http://<HOST>${sampleUrl(sample, 'python')}",`)
  lines.push('    headers={"Authorization": f"Bearer {os.environ[\'API_KEY\']}"},')
  if (sample.body) lines.push(`    json=${pyLiteral(sample.body)},`)
  if (sample.form) {
    lines.push('    files={"image": open("cat.png", "rb")},')
    const data = Object.fromEntries(Object.entries(sample.form).filter(([k]) => k !== 'image'))
    lines.push(`    data=${pyLiteral(data)},`)
  }
  lines.push('    timeout=600,')
  lines.push(')')
  lines.push('print(r.status_code, r.json())')
  return lines.join('\n')
}

function buildSamples(item) {
  const sample = SAMPLES[opKey(item)] || { url: item.path, langs: ['curl'] }
  if (sample.custom) return { custom: sample.custom }
  const out = {}
  for (const lang of sample.langs || ['curl']) {
    out[lang] = lang === 'curl' ? curlExample(item, sample) : lang === 'node' ? nodeExample(item, sample) : pythonExample(item, sample)
  }
  if (sample.pathNote) out._note = sample.pathNote
  return out
}

// ── 组件 ──────────────────────────────────────────────────────────────────────

const LANG_LABELS = { curl: 'cURL', node: 'Node.js', python: 'Python' }

function codeBlock(code, label) {
  return `<div class="code-block"><div class="code-head"><span>${esc(label || '示例')}</span><button type="button" class="copy-btn">复制</button></div><pre><code>${esc(code)}</code></pre></div>`
}

function codeTabs(samples) {
  const note = samples._note ? `<p class="hint">${esc(samples._note)}</p>` : ''
  const langs = Object.keys(samples).filter(l => l !== '_note')
  if (!langs.length) return note
  return `${note}<div class="code-tabs"><div class="tab-bar">${langs.map((l, i) => `<button type="button" class="tab${i === 0 ? ' active' : ''}" data-lang="${l}">${LANG_LABELS[l] || l}</button>`).join('')}<button type="button" class="copy-btn">复制</button></div>${langs.map((l, i) => `<div class="tab-panel${i ? ' hidden' : ''}" data-panel="${l}"><pre><code>${esc(samples[l])}</code></pre></div>`).join('')}</div>`
}

function resolveRef(ref) {
  if (!ref || !ref.startsWith('#/')) return null
  return ref.replace(/^#\//, '').split('/').reduce((o, k) => o && o[k], openapi)
}

function paramRows(op) {
  const rows = []
  for (const p of op.parameters || []) {
    rows.push({ name: p.name, where: p.in === 'path' ? 'path' : p.in === 'query' ? 'query' : p.in, required: !!p.required, type: p.schema?.type || '', values: p.schema?.enum?.join(' / ') || '', desc: p.description || '' })
  }
  for (const media of Object.values(op.requestBody?.content || {})) {
    let schema = media.schema
    if (schema?.$ref) schema = resolveRef(schema.$ref)
    const required = schema?.required || []
    for (const [name, raw] of Object.entries(schema?.properties || {})) {
      const p = raw.$ref ? resolveRef(raw.$ref) : raw
      let values = p.enum ? p.enum.join(' / ') : ''
      if (!values && p.example !== undefined) values = `例：${typeof p.example === 'object' ? JSON.stringify(p.example) : p.example}`
      rows.push({ name, where: 'body', required: required.includes(name), type: p.type || (p.$ref ? 'object' : ''), values, desc: p.description || '' })
    }
  }
  return rows
}

function paramsTable(rows) {
  if (!rows.length) return ''
  return `<h3>请求参数</h3><div class="table-scroll"><table><thead><tr><th>字段</th><th>位置</th><th>类型 / 可选值</th><th>说明</th></tr></thead><tbody>${rows.map(r => `<tr><td><code>${esc(r.name)}</code>${r.required ? '<span class="required">必填</span>' : ''}</td><td><span class="where">${esc(r.where)}</span></td><td>${esc([r.type, r.values].filter(Boolean).join(' · '))}</td><td>${esc(r.desc)}</td></tr>`).join('')}</tbody></table></div>`
}

function endpointHtml(item) {
  const key = opKey(item)
  const op = openapi.paths[item.path]?.[item.method] || {}
  const id = sectionId(item.method, item.path)
  const title = op.summary || item.title || item.path
  const auth = (op.security && op.security.length === 0) || !isProtected(item.path) ? '免鉴权' : 'Bearer'
  const samples = buildSamples(item)
  const notes = ENDPOINT_NOTES[key] || []
  const response = RESPONSES[key]
  const statusRows = Object.entries(op.responses || {}).map(([code, r]) => `<tr><td><span class="status ${code.startsWith('2') ? 'ok' : ''}">${code}</span></td><td>${esc(r.description || '')}</td></tr>`).join('')
  const keywords = `${item.method} ${item.path} ${title} ${op.description || ''} ${notes.join(' ')}`.replace(/[{}]/g, '').toLowerCase()
  return `<section class="section endpoint" id="${id}" data-keywords="${esc(keywords)}">
  <div class="endpoint-head">
    <div class="endpoint-title"><span class="method ${item.method}">${item.method.toUpperCase()}</span><h2>${esc(item.path)}</h2></div>
    <span class="pill ${auth === '免鉴权' ? 'public' : ''}">${auth}</span>
  </div>
  <p class="lead">${esc(title)}</p>
  ${op.description ? `<p class="desc">${esc(op.description)}</p>` : ''}
  ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  ${paramsTable(paramRows(op))}
  <h3>调用示例</h3>
  ${samples.custom ? `<p class="desc">${esc(samples.custom)}</p>` : codeTabs(samples)}
  ${response ? `<h3>响应示例</h3>${codeBlock(JSON.stringify(response, null, 2), '200 / application/json')}` : key === 'get /v1/videos/{id}/content' || key === 'get /files/{jobId}/{index}' ? '<h3>响应</h3><p class="desc">成功返回二进制内容或 302 跳转；失败按统一错误格式返回 JSON。</p>' : ''}
  ${statusRows ? `<h3>状态码</h3><div class="table-scroll"><table><thead><tr><th>HTTP</th><th>含义</th></tr></thead><tbody>${statusRows}</tbody></table></div>` : ''}
</section>`
}

function guide(id, title, body, keywords) {
  return `<section class="section guide" id="${id}" data-keywords="${esc((title + ' ' + keywords).toLowerCase())}"><h2>${esc(title)}</h2>${body}</section>`
}

function guideSections() {
  const curl = `curl http://<HOST>/v1/models -H "Authorization: Bearer $API_KEY"`
  const gen = `curl -X POST http://<HOST>/v1/images/generations \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"prompt":"a cat on mars","params":{"ratio":"16:9","resolution":"1K"}}'`
  const video = `curl -X POST http://<HOST>/v1/videos \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"prompt":"ocean waves at sunset","params":{"duration":5}}'`
  const poll = `curl http://<HOST>/v1/videos/<JOB_ID> -H "Authorization: Bearer $API_KEY"`
  return [
    guide('overview', '概览', `<p class="desc">把 LibTV 的 MCP 生图 / 生视频能力暴露成 OpenAI 风格 HTTP 接口。<strong>单用户自用，Bearer API key 鉴权</strong>，模型能力以 LibTV 实时契约为准。</p>
      <div class="cards"><div class="card"><span class="card-tag">IMAGE</span><b>图像生成</b><p>文生图，同步返回图片 URL</p><code>POST /v1/images/generations</code></div><div class="card"><span class="card-tag">EDIT</span><b>图像编辑</b><p>参考图 + prompt，同步返回</p><code>POST /v1/images/edits</code></div><div class="card"><span class="card-tag">VIDEO</span><b>视频生成</b><p>异步任务，轮询取结果</p><code>POST /v1/videos</code></div></div>
      <div class="links"><a href="/openapi.json">OpenAPI 3.0</a><a href="/docs.md">Markdown（Agent 友好）</a><a href="/healthz">健康检查</a></div>`, '简介 能力 图像 视频'),
    guide('quickstart', '快速开始', `<ol class="steps"><li>从服务部署方取得 <code>API_KEY</code>，所有 <code>/v1/*</code> 请求都带 <code>Authorization: Bearer &lt;API_KEY&gt;</code>。</li><li>先查模型，再查该模型的实时参数契约（画幅、清晰度、时长、数量）。</li><li>文生图是同步长轮询；视频是异步任务，用返回的任务 id 轮询。</li></ol>
      <h3>1. 列出模型</h3>${codeBlock(curl, 'cURL')}
      <h3>2. 文生图</h3>${codeBlock(gen, 'cURL')}
      <h3>3. 生成视频并提交轮询</h3>${codeBlock(video, 'cURL')}${codeBlock(poll, 'cURL')}`, '入门 示例 curl'),
    guide('guide-auth', '鉴权与授权', `<p class="desc">文档与探活接口免鉴权；业务接口使用部署方提供的单个 API key：</p>${codeBlock('Authorization: Bearer <API_KEY>', 'HTTP Header')}
      <p class="desc">LibTV 侧授权由部署方完成。首次未授权时访问 <code>/auth</code> 扫码；成功后服务端写入 <code>data/LibTV.lock</code>，授权页随即锁定，防止重复授权覆盖当前账号。token 过期且无法续期，或 refresh 连续失败达到阈值时，网关自动清除凭据与锁并重新开放 <code>/auth</code>。</p>
      <p class="hint">下游 Agent 遇到 <code>AUTH_REQUIRED</code> 时不要自行重试，应提示部署方查看 <code>GET /auth/status</code> 并处理。</p>`, 'api key bearer token 扫码 lock'),
    guide('guide-models', '模型与参数', `<p class="desc">网关不硬编码任何模型枚举：先 <code>GET /v1/models</code> 拿模型 id，再 <code>GET /v1/models/{id}</code> 查看实时参数契约。关键路径是 <code>input_contract.parameterSchemas.&lt;操作&gt;.properties</code>，每个参数的 <code>enum</code> / <code>default</code> 就是当前可用值。</p>
      <p class="desc">生成请求可带 <code>params</code> 对象原样透传给 LibTV；<code>size</code> / <code>n</code> / <code>seconds</code> 只是 OpenAI 便利字段，优先级低于 <code>params</code>。LibTV 升级后无需改网关代码即可使用新能力。</p>`, 'models 契约 ratio resolution duration count 透传'),
    guide('guide-errors', '错误与稳定性', `<p class="desc">错误统一为 OpenAI 风格：</p>${codeBlock('{"error":{"message":"可读信息","type":"invalid_request_error","code":"invalid_api_key"}}', 'JSON')}
      <div class="table-scroll"><table><thead><tr><th>code</th><th>HTTP</th><th>含义</th></tr></thead><tbody><tr><td><code>invalid_api_key</code></td><td>401</td><td>API key 不匹配</td></tr><tr><td><code>not_found</code></td><td>404</td><td>任务 / 文件不存在</td></tr><tr><td><code>not_ready</code></td><td>409</td><td>任务未完成 / 授权页已锁定</td></tr><tr><td><code>timeout</code></td><td>504</td><td>生成超时，任务仍可查询</td></tr><tr><td><code>generation_failed</code></td><td>500</td><td>LibTV 生成失败，message 原样透传</td></tr></tbody></table></div>
      <ul class="notes"><li>提交层指数退避重试并复用幂等键，重放不会重复扣费。</li><li>视频任务落盘，服务重启后自动恢复轮询。</li><li>单账号并发由服务端信号量表控制，超限请求排队。</li></ul>`, '错误 code 重试 幂等 并发'),
  ].join('')
}

function navHtml() {
  return NAV.map(group => `<div class="nav-group"><div class="nav-group-title">${esc(group.group)}</div>${group.items.map(item => {
    const id = item.id || sectionId(item.method, item.path)
    const title = item.title || (openapi.paths[item.path]?.[item.method]?.summary || item.path)
    const method = item.method ? `<span class="method ${item.method}">${item.method.toUpperCase()}</span>` : `<span class="nav-dot">${item.icon || '·'}</span>`
    const keywords = `${title} ${item.path || ''} ${item.method || ''}`.toLowerCase()
    return `<a class="nav-item" href="#${id}" data-target="${id}" data-keywords="${esc(keywords)}">${method}<span class="nav-text">${esc(title)}</span></a>`
  }).join('')}</div>`).join('')
}

function endpointSections() {
  return NAV.flatMap(g => g.items).filter(i => i.path).map(endpointHtml).join('')
}

const DOC_CSS = `
  :root{--bg:#0b0f19;--fg:#e6edf3;--muted:#9aa7b8;--accent:#58a6ff;--border:#263041;--card:#121926;--soft:#0f1521;--shadow:rgba(0,0,0,.35);color-scheme:dark}
  @media (prefers-color-scheme: light){:root:not([data-theme]){--bg:#ffffff;--fg:#1f2328;--muted:#636c76;--accent:#0969da;--border:#d8dee4;--card:#f6f8fa;--soft:#fbfcfd;--shadow:rgba(31,35,40,.08);color-scheme:light}}
  :root[data-theme=light]{--bg:#ffffff;--fg:#1f2328;--muted:#636c76;--accent:#0969da;--border:#d8dee4;--card:#f6f8fa;--soft:#fbfcfd;--shadow:rgba(31,35,40,.08);color-scheme:light}
  :root[data-theme=dark]{--bg:#0b0f19;--fg:#e6edf3;--muted:#9aa7b8;--accent:#58a6ff;--border:#263041;--card:#121926;--soft:#0f1521;--shadow:rgba(0,0,0,.35);color-scheme:dark}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  a{color:var(--accent);text-decoration:none}
  code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
  .app{display:flex;min-height:100vh}
  .sidebar{width:286px;flex:0 0 286px;position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--border);background:var(--soft);padding:22px 14px 40px}
  .brand{display:flex;align-items:center;gap:10px;padding:0 8px 18px;border-bottom:1px solid var(--border);margin-bottom:16px}
  .logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#4f8cff,#9a67ff);color:#fff;display:grid;place-items:center;font-weight:800;font-size:15px}
  .brand b{font-size:15px;display:block;line-height:1.3}
  .brand small{color:var(--muted);font-size:11px}
  .search{position:relative;margin:0 6px 18px}
  .search input{width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--fg);padding:8px 12px 8px 32px;font-size:13px;outline:none}
  .search input:focus{border-color:var(--accent)}
  .search span{position:absolute;left:11px;top:7px;color:var(--muted);font-size:14px}
  .nav-group{margin-bottom:18px}
  .nav-group-title{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0 10px;margin-bottom:6px;font-weight:700}
  .nav-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:7px;color:var(--fg);font-size:13px;line-height:1.4}
  .nav-item:hover{background:var(--card)}
  .nav-item.active{background:var(--card);color:var(--accent);box-shadow:inset 2px 0 0 var(--accent)}
  .nav-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .nav-dot{width:34px;text-align:center;color:var(--muted)}
  .method{display:inline-block;min-width:38px;text-align:center;border-radius:5px;padding:1px 5px;font:700 10px/1.6 ui-monospace,Consolas,monospace;letter-spacing:.04em}
  .method.get{color:#1a7f37;background:rgba(26,127,55,.14)}
  .method.post{color:#0969da;background:rgba(9,105,218,.14)}
  .method.delete{color:#cf222e;background:rgba(207,34,46,.14)}
  :root[data-theme=dark] .method.get{color:#56d364;background:rgba(86,211,100,.14)}
  :root[data-theme=dark] .method.post{color:#79c0ff;background:rgba(121,192,255,.14)}
  @media (prefers-color-scheme: dark){:root:not([data-theme]) .method.get{color:#56d364}:root:not([data-theme]) .method.post{color:#79c0ff}}
  .main{flex:1;min-width:0}
  .topbar{position:sticky;top:0;z-index:5;height:56px;display:flex;align-items:center;gap:14px;padding:0 32px;border-bottom:1px solid var(--border);background:var(--bg);backdrop-filter:blur(8px)}
  .menu-btn{display:none;background:none;border:1px solid var(--border);color:var(--fg);border-radius:6px;padding:4px 9px}
  .crumb{color:var(--muted);font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crumb b{color:var(--fg)}
  .topbar a,.topbar button{font-size:12px;border:1px solid var(--border);border-radius:6px;padding:5px 10px;background:var(--card);color:var(--fg);cursor:pointer}
  .topbar a:hover,.topbar button:hover{border-color:var(--accent);color:var(--accent)}
  .top-brand{display:flex;align-items:center;gap:8px;color:var(--fg);font-size:13px;white-space:nowrap}
  .top-logo{width:27px;height:27px;border-radius:8px;background:linear-gradient(135deg,#4f8cff,#9a67ff);color:#fff;display:grid;place-items:center;font-weight:800;font-size:11px}
  .top-nav{display:flex;align-items:center;gap:2px;flex:1;min-width:0;overflow-x:auto}
  .top-nav a{border-color:transparent;background:transparent;color:var(--muted);font-size:13px}
  .top-nav a:hover{background:var(--card);color:var(--fg)}
  .top-nav a.active{background:var(--card);color:var(--accent);font-weight:600}
  .top-actions{display:flex;align-items:center;gap:7px}
  main{max-width:1080px;margin:0 auto;padding:34px 36px 100px}
  .section{scroll-margin-top:76px;padding-bottom:34px;margin-bottom:34px;border-bottom:1px solid var(--border)}
  .section:last-child{border-bottom:none}
  h1{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}
  h2{font-size:20px;margin:0 0 12px;line-height:1.4}
  h3{font-size:14px;margin:26px 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
  .lead{font-size:15px;margin:0 0 8px}
  .desc{color:var(--muted);margin:0 0 12px}
  .hint{color:var(--muted);font-size:12px;background:var(--card);border-left:3px solid var(--accent);padding:8px 12px;border-radius:0 6px 6px 0;margin:10px 0}
  p code,li code,td code{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:1px 5px;font-size:12px;color:var(--accent)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;margin:20px 0}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
  .card b{display:block;margin:6px 0 2px}
  .card p{color:var(--muted);margin:0 0 10px;font-size:13px}
  .card code{font-size:11px}
  .card-tag{font:700 10px ui-monospace,Consolas,monospace;color:var(--accent);letter-spacing:.08em}
  .links{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}
  .links a{border:1px solid var(--border);border-radius:7px;padding:5px 11px;font-size:12px;background:var(--card)}
  .links a:hover{border-color:var(--accent)}
  .steps{padding-left:20px;color:var(--muted)}
  .steps li{margin:5px 0}
  .endpoint-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
  .endpoint-title{display:flex;align-items:center;gap:10px;min-width:0}
  .endpoint-title h2{font-family:ui-monospace,Consolas,monospace;font-size:17px;margin:0;word-break:break-all}
  .pill{border:1px solid var(--border);border-radius:20px;padding:2px 9px;font-size:11px;color:var(--accent);white-space:nowrap}
  .pill.public{color:var(--muted)}
  .notes{margin:10px 0;padding-left:18px;color:var(--muted)}
  .notes li{margin:3px 0}
  .table-scroll{overflow:auto;border:1px solid var(--border);border-radius:8px}
  table{border-collapse:collapse;width:100%;font-size:12px}
  th,td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--border);vertical-align:top}
  th{background:var(--card);color:var(--muted);font-weight:600;white-space:nowrap}
  tr:last-child td{border-bottom:none}
  .required{color:#cf222e;font-size:10px;margin-left:6px}
  :root[data-theme=dark] .required{color:#ff7b72}
  .where{color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:11px}
  .status{font-family:ui-monospace,Consolas,monospace;color:var(--muted)}
  .status.ok{color:#1a7f37}
  :root[data-theme=dark] .status.ok{color:#56d364}
  .code-block,.code-tabs{border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--card);margin:10px 0 16px}
  .code-head,.tab-bar{display:flex;align-items:center;gap:2px;background:var(--soft);border-bottom:1px solid var(--border);padding:5px 8px}
  .code-head span{font-size:11px;color:var(--muted);margin-left:8px;flex:1}
  .tab{padding:5px 11px;border:0;background:transparent;color:var(--muted);border-radius:6px;cursor:pointer;font-size:12px}
  .tab.active{background:var(--card);color:var(--accent);font-weight:600}
  .copy-btn{margin-left:auto;border:1px solid var(--border);background:var(--card);color:var(--muted);border-radius:6px;padding:4px 9px;cursor:pointer;font-size:11px}
  .copy-btn:hover{color:var(--accent);border-color:var(--accent)}
  .code-head .copy-btn{margin-left:0}
  pre{margin:0;padding:14px 16px;overflow:auto;font-size:12px;line-height:1.6;tab-size:2}
  .hidden{display:none}
  @media (max-width:900px){
    .app{display:block}
    .sidebar{position:fixed;z-index:20;left:0;top:0;width:min(86vw,300px);height:100vh;transform:translateX(-100%);transition:transform .2s;box-shadow:var(--shadow)}
    .sidebar.open{transform:none}
    .menu-btn{display:block}
    .topbar{padding:0 14px;gap:10px}
    .top-brand b{display:none}
    .top-actions a{display:none}
    main{padding:24px 18px 80px}
    h1{font-size:23px}
  }
`

const DOC_JS = `
(() => {
  const root = document.documentElement;
  const themeBtn = document.getElementById('theme-btn');
  const saved = localStorage.getItem('lt-docs-theme');
  if (saved) root.dataset.theme = saved;
  themeBtn.addEventListener('click', () => {
    const dark = getComputedStyle(root).colorScheme === 'dark';
    root.dataset.theme = dark ? 'light' : 'dark';
    localStorage.setItem('lt-docs-theme', root.dataset.theme);
    themeBtn.textContent = dark ? '☀' : '☾';
  });
  themeBtn.textContent = getComputedStyle(root).colorScheme === 'dark' ? '☀' : '☾';

  document.querySelectorAll('.code-tabs').forEach(tabs => {
    tabs.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      tabs.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.lang));
    }));
  });
  async function copyText(text) {
    text = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) { /* 继续走回退 */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }
  document.querySelectorAll('.copy-btn').forEach(btn => btn.addEventListener('click', async () => {
    const box = btn.closest('.code-tabs, .code-block');
    const panel = box && box.querySelector('.tab-panel:not(.hidden) pre, .code-block pre');
    if (!panel) return;
    const ok = await copyText(panel.textContent);
    btn.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { btn.textContent = '复制'; }, 1500);
  }));

  const search = document.getElementById('filter');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('hidden', !!q && !item.dataset.keywords.includes(q));
    });
    document.querySelectorAll('.nav-group').forEach(g => {
      g.classList.toggle('hidden', !g.querySelector('.nav-item:not(.hidden)'));
    });
  });

  const links = [...document.querySelectorAll('.nav-item')];
  const sections = links.map(a => document.getElementById(a.dataset.target)).filter(Boolean);
  const setActive = id => {
    const link = links.find(a => a.dataset.target === id);
    if (!link) return;
    links.forEach(a => a.classList.toggle('active', a === link));
  };
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setActive(visible[0].target.id);
  }, { rootMargin: '-70px 0px -65% 0px' });
  sections.forEach(s => observer.observe(s));
  setActive(sections[0]?.id);

  const sidebar = document.getElementById('sidebar');
  document.getElementById('menu-btn').addEventListener('click', () => sidebar.classList.toggle('open'));
  sidebar.addEventListener('click', e => { if (e.target.closest('.nav-item')) sidebar.classList.remove('open'); });
})();
`

/** 可视化文档：左侧接口导航 + 右侧指南/接口说明/参数表/调用示例，零外部依赖。 */
export function htmlDoc() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(openapi.info.title)} · API 参考</title>
<style>${DOC_CSS}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="brand"><div class="logo">LT</div><div><b>LibTV API</b><small>OpenAI 兼容网关 · v${esc(openapi.info.version)}</small></div></div>
    <div class="search"><span>⌕</span><input id="filter" type="search" placeholder="搜索接口 / 路径 / 方法" autocomplete="off"></div>
    <nav>${navHtml()}</nav>
  </aside>
  <div class="main">
    <header class="topbar">
      <button type="button" class="menu-btn" id="menu-btn">☰</button>
      <a class="top-brand" href="/"><span class="top-logo">LT</span><b>LibTV API</b></a>
      <nav class="top-nav">
        <a href="/">首页</a><a href="/models">模型广场</a><a href="/docs" class="active">API 文档</a><a href="/auth">授权</a>
      </nav>
      <div class="top-actions">
        <button type="button" id="theme-btn" title="切换主题">☾</button>
        <a href="/openapi.json">OpenAPI</a>
        <a href="/docs.md">Markdown</a>
      </div>
    </header>
    <main>
      ${guideSections()}
      ${endpointSections()}
    </main>
  </div>
</div>
<script>${DOC_JS}</script>
</body>
</html>`
}
