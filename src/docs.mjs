// 免鉴权接口文档：OpenAPI 3.0 规范 + Agent 友好的 Markdown + 可视化 HTML
// 全部为静态内容，不暴露任何账号/token/配置细节，可安全对外提供

const BASE_DESC = `LibTV OpenAI 兼容网关 —— 把 LibTV 的 MCP 生图/生视频能力暴露成 OpenAI 风格 HTTP 接口。
单用户自用，Bearer API key 鉴权。所有图像/视频生成由 LibTV 账号执行，模型能力以 GET /v1/models/{id} 实时返回为准。`

export const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'LibTV OpenAI 兼容网关 API',
    version: '0.2.0',
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
        properties: {
          model: { type: 'string', description: '模型 id，省略则用服务端默认视频模型' },
          prompt: { type: 'string', description: '生成提示词（必填）' },
          image: { type: 'string', description: '可选参考图：公网 URL 或 base64/dataURL（图生视频）' },
          size: { type: 'string', description: 'OpenAI 风格尺寸，映射为画幅 ratio' },
          seconds: { type: 'number', description: '时长（秒），映射为 LibTV duration，以模型契约为准', example: 5 },
          params: { type: 'object', description: 'LibTV 原生参数透传（优先级高于 size/seconds）', example: { duration: 5, ratio: '16:9' } },
        },
      },
      VideoJob: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 id，用于 GET /v1/videos/{id}' },
          object: { type: 'string', example: 'video' },
          status: { type: 'string', enum: ['queued', 'processing', 'succeeded', 'failed'], description: '任务状态' },
          model: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          result: { type: 'object', description: 'succeeded 时含 url / width / height / node_key' },
          error: { type: 'object', description: 'failed 时含 message / code' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/healthz': {
      get: { tags: ['meta'], summary: '探活（免鉴权）', security: [], responses: { 200: { description: '服务状态、MCP 授权状态、并发槽位' } } },
    },
    '/auth': {
      get: { tags: ['meta'], summary: 'LibTV 授权页（免鉴权）', security: [], description: '给人用浏览器打开：展示当前授权状态与授权入口。Docker 部署推荐在宿主机执行 npm run auth:login 并挂载 data/credentials.json。', responses: { 200: { description: 'HTML 授权页' } } },
    },
    '/auth/status': {
      get: { tags: ['meta'], summary: '授权状态查询（免鉴权）', security: [], responses: { 200: { description: '{authorized, scope, expires_at, has_refresh_token, redirect_uris, web_auth_available}' } } },
    },
    '/auth/start': {
      post: { tags: ['meta'], summary: '发起 Web 授权（免鉴权，需服务端配置 loopback 回调）', security: [], description: '返回官方 authorize URL；LibTV 只接受 127.0.0.1/localhost 回调，需服务端设置 GATEWAY_PUBLIC_URL 为 loopback 地址。', responses: { 200: { description: '{authorize_url, state, redirect_uri}' }, 400: { description: '未配置可用的 loopback 回调地址' } } },
    },
    '/auth/callback': {
      get: { tags: ['meta'], summary: 'OAuth 回调入口（免鉴权，官方调用）', security: [], responses: { 200: { description: 'HTML 结果页，凭据由服务端自动保存' } } },
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
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoRequest' } } } },
        responses: { 202: { description: '任务已接受，返回 VideoJob（status=queued/processing）', content: { 'application/json': { schema: { $ref: '#/components/schemas/VideoJob' } } } }, 500: { description: '提交失败' } },
      },
    },
    '/v1/videos/{id}': {
      get: {
        tags: ['videos'], summary: '查询视频任务',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'VideoJob，succeeded 时 result.url 为结果地址' }, 404: { description: '任务不存在' } },
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

若返回 401 \`invalid_api_key\`，检查 key 是否与部署方给的一致。若返回 \`AUTH_REQUIRED\`（LibTV 侧未授权），需由部署方在 \`GET /auth\` 授权页完成一次扫码授权（或在宿主机执行 \`npm run auth:login\` 后挂载凭据）——这不是下游 Agent 能自行解决的，应提示部署方处理。

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
\`\`\`bash
curl -X POST http://<HOST>/v1/videos \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"model":"motion-3.1-lite","prompt":"ocean waves at sunset","params":{"duration":5}}'
\`\`\`
返回 \`202\` + \`{id, status, model, created_at, result?}\`（Sora 风格）。

### GET /v1/videos/{id} —— 查询视频任务
轮询到 \`status=succeeded\` 时 \`result.url\` 即结果地址；\`failed\` 时看 \`error\`。

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

/** 可视化 HTML：内嵌 Markdown 渲染（极简，零外部依赖），并链接 openapi.json / docs.md */
export function htmlDoc() {
  const mdEsc = esc(markdownDoc)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LibTV OpenAI 兼容网关 API 文档</title>
<style>
  :root{--bg:#0d1117;--fg:#c9d1d9;--muted:#8b949e;--accent:#58a6ff;--border:#30363d;--card:#161b22}
  @media (prefers-color-scheme: light){:root{--bg:#fff;--fg:#24292f;--muted:#57606a;--accent:#0969da;--border:#d0d7de;--card:#f6f8fa}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:32px 22px 80px}
  header{border-bottom:1px solid var(--border);padding-bottom:18px;margin-bottom:24px}
  h1{margin:0 0 8px;font-size:26px}
  .sub{color:var(--muted)}
  .links{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}
  .links a{color:var(--accent);text-decoration:none;border:1px solid var(--border);border-radius:6px;padding:6px 12px;font-size:13px}
  .links a:hover{border-color:var(--accent)}
  pre{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px 16px;overflow:auto;font:13px/1.5 ui-monospace,Consolas,monospace}
  code{font-family:ui-monospace,Consolas,monospace}
  h2{margin-top:34px;border-bottom:1px solid var(--border);padding-bottom:8px;font-size:20px}
  h3{margin-top:26px;font-size:17px}
  .md{white-space:pre-wrap;word-break:break-word}
  .badge{display:inline-block;background:var(--card);border:1px solid var(--border);border-radius:20px;padding:2px 10px;font-size:12px;color:var(--muted);margin-left:8px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>LibTV OpenAI 兼容网关 API <span class="badge">v0.2.0</span></h1>
    <div class="sub">图像生成 / 图像编辑 / 视频生成 · OpenAI 风格接口 · 免鉴权文档</div>
    <div class="links">
      <a href="/openapi.json">OpenAPI 3.0 JSON</a>
      <a href="/docs.md">Markdown（Agent 友好）</a>
      <a href="/healthz">健康检查</a>
    </div>
  </header>
  <script type="text/plain" id="docsrc">${mdEsc}</script>
  <div class="md" id="doc"></div>
</div>
<script>
// 极简 Markdown 渲染：代码块 + 标题 + 行内代码，够用即可
const el = document.getElementById('doc');
let html = document.getElementById('docsrc').textContent;
html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_,code)=>'<pre><code>'+code.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</code></pre>');
html = html.replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
html = html.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
el.innerHTML = html;
</script>
</body>
</html>`
}
