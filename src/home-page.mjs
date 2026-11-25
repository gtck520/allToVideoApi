// 默认首页：三个入口（模型广场 / API 文档 / 授权）+ 最短对接路径。免鉴权，零外部依赖。
import { siteHtml } from './site.mjs'

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }
function code(label, text) {
  return `<div class="code-block"><div class="code-head"><span>${esc(label)}</span><button type="button" class="copy-btn" data-copy="${esc(text)}" data-label="复制">复制</button></div><pre><code>${esc(text)}</code></pre></div>`
}

export function homeHtml() {
  const auth = 'Authorization: Bearer <API_KEY>'
  const models = `curl http://<HOST>/v1/models?detail=full -H "Authorization: Bearer $API_KEY"`
  const image = `curl -X POST http://<HOST>/v1/images/generations \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"prompt":"a cat on mars","params":{"ratio":"16:9","resolution":"1K"}}'`
  const video = `curl -X POST http://<HOST>/v1/videos \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"prompt":"ocean waves at sunset","params":{"duration":5}}'`

  return siteHtml({
    title: 'LibTV OpenAI 兼容网关 · 首页',
    active: 'home',
    body: `<div class="container">
      <section class="hero">
        <span class="eyebrow">OPENAI COMPATIBLE GATEWAY</span>
        <h1>LibTV OpenAI 兼容网关</h1>
        <p class="lead">把 LibTV 的图像生成、图像编辑与视频生成能力，转换成 OpenAI 风格的 HTTP 接口。单用户自用，一个 API key 即可对接。</p>
        <div class="stat-row"><span>◆ 文生图 / 图像编辑 / 视频生成</span><span>◆ 模型参数实时发现，网关不做枚举限制</span><span>◆ 文档与模型广场免鉴权浏览</span></div>
      </section>

      <div class="cards">
        <div class="card"><a href="/models"><span class="eyebrow">EXPLORE</span><h2>模型广场 →</h2><p>查看 LibTV 当前可用模型、实时参数契约（画幅 / 清晰度 / 时长 / 数量），一键复制模型 ID。</p><code>/models</code></a></div>
        <div class="card"><a href="/docs"><span class="eyebrow">REFERENCE</span><h2>API 文档 →</h2><p>左侧接口导航，右侧参数说明与 cURL / Node.js / Python 调用示例，适合人和 Agent 对接。</p><code>/docs · /docs.md · /openapi.json</code></a></div>
        <div class="card"><a href="/auth"><span class="eyebrow">SETUP</span><h2>授权 →</h2><p>查看当前授权状态与锁定情况，首次使用或授权失效时在这里重新授权。</p><code>/auth</code></a></div>
      </div>

      <h2>最短对接路径</h2>
      <p class="desc">所有业务接口都在请求头带同一个 key；文档、模型广场、探活接口无需鉴权。</p>
      ${code('HTTP Header', auth)}
      <h3>1 · 查模型与参数</h3>
      ${code('cURL', models)}
      <h3>2 · 文生图（同步返回 URL）</h3>
      ${code('cURL', image)}
      <h3>3 · 视频生成（异步任务）</h3>
      ${code('cURL', video)}
      <p class="hint">把 <code>http://&lt;你的服务地址&gt;/docs.md</code> 发给 Agent，它就能按文档自行完成对接。API key 由服务部署方提供，请勿写进公开代码。</p>

      <div class="footer">LibTV OpenAI 兼容网关 · 模型能力以 LibTV 实时契约为准 · <a href="/healthz">健康检查</a></div>
    </div>`,
  })
}
