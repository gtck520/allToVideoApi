// 模型广场：服务端注入实时模型与参数契约，前端支持搜索、按模态筛选、查看原始契约、复制模型 ID。
// 免鉴权；不暴露账号信息，仅展示模型 id / 显示名 / 参数契约。
import { siteHtml } from './site.mjs'

const MODEL_JS = `
(() => {
  const data = JSON.parse(document.getElementById('site-data').textContent || '{}');
  const grid = document.getElementById('model-grid');
  const count = document.getElementById('model-count');
  const filterInput = document.getElementById('model-filter');
  let modality = 'all';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') }

  function paramsOf(c) {
    const out = [], seen = {};
    const schemas = (c && c.parameterSchemas) || (c && c.properties) || {};
    for (const op of Object.keys(schemas)) {
      const schema = schemas[op] || {};
      const props = schema.properties || (schema.schema && schema.schema.properties) || {};
      const required = schema.required || [];
      for (const name of Object.keys(props)) {
        if (seen[name]) continue;
        seen[name] = true;
        const d = (props[name] && typeof props[name] === 'object') ? props[name] : {};
        out.push({ name, op, type: d.type || d.typeName || '', values: d.enum || d.options || d.values || [], def: d.default, required: required.indexOf(name) >= 0, desc: d.description || d.title || '' });
      }
    }
    return out;
  }

  function chips(params) {
    if (!params.length) return '<p class="no-params">该模型未返回参数契约，可展开下方原始数据查看。</p>';
    return '<ul class="param-list">' + params.map(p => {
      const values = Array.isArray(p.values) ? p.values : [];
      const hasDef = p.def !== undefined && p.def !== null;
      const valueChips = values.map(v => '<span class="chip' + (hasDef && String(v) === String(p.def) ? ' default' : '') + '">' + esc(v) + '</span>').join(' ');
      const meta = [p.type, p.required ? '必填' : '', hasDef ? '默认 ' + String(p.def) : ''].filter(Boolean).join(' · ');
      return '<li><div class="param-name">' + esc(p.name) + (p.op ? '<small>' + esc(p.op) + '</small>' : '') + '</div><div class="param-values">' + (valueChips || '<span class="chip">任意值</span>') + (meta ? '<span class="desc">' + esc(meta) + '</span>' : '') + (p.desc ? '<span class="desc">' + esc(p.desc) + '</span>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }

  function card(m) {
    const params = paramsOf(m.contract);
    const raw = JSON.stringify(m.contract || {}, null, 2);
    const search = (m.id + ' ' + (m.display_name || '') + ' ' + params.map(p => p.name).join(' ')).toLowerCase();
    return '<article class="model-card" data-modality="' + esc(m.modality) + '" data-search="' + esc(search) + '">' +
      '<div class="model-head"><div><span class="pill ' + esc(m.modality) + '">' + (m.modality === 'image' ? '图像' : '视频') + '</span><div class="model-name">' + esc(m.id) + '</div></div>' +
      '<button type="button" class="copy-btn" data-copy="' + esc(m.id) + '" data-label="复制 ID">复制 ID</button></div>' +
      '<div class="model-meta">' + esc(m.display_name || '—') + (m.estimated_time ? ' · 预计 ' + esc(m.estimated_time) : '') + '</div>' +
      chips(params) +
      '<details><summary>查看原始参数契约</summary><pre>' + esc(raw) + '</pre></details></article>';
  }

  function render() {
    const q = (filterInput.value || '').trim().toLowerCase();
    const list = (data.models || []).filter(m => {
      if (modality !== 'all' && m.modality !== modality) return false;
      if (!q) return true;
      const search = (m.id + ' ' + (m.display_name || '') + ' ' + paramsOf(m.contract).map(p => p.name).join(' ')).toLowerCase();
      return search.indexOf(q) >= 0;
    });
    grid.innerHTML = list.map(card).join('') || '<div class="empty">没有匹配的模型，试试其他关键词。</div>';
    count.textContent = '共 ' + (data.models || []).length + ' 个模型 · 当前显示 ' + list.length + ' 个';
  }

  document.querySelectorAll('.filters button').forEach(b => b.addEventListener('click', () => {
    modality = b.dataset.modality;
    document.querySelectorAll('.filters button').forEach(x => x.classList.toggle('active', x === b));
    render();
  }));
  filterInput.addEventListener('input', render);
  if (data.error) {
    document.getElementById('model-error').classList.remove('hidden');
    document.getElementById('model-error-text').textContent = data.error;
  }
  document.getElementById('model-time').textContent = data.generated_at || '';
  render();
})();
`

/** models: [{ id, modality, display_name, estimated_time, contract }] */
export function modelsHtml({ models = [], error = '', generatedAt = '' } = {}) {
  return siteHtml({
    title: '模型广场 · LibTV OpenAI 兼容网关',
    active: 'models',
    data: { models, error, generated_at: generatedAt },
    body: `<div class="container">
      <section class="hero">
        <span class="eyebrow">MODEL EXPLORER</span>
        <h1>模型广场</h1>
        <p class="lead">LibTV 当前可用模型与实时参数契约。画幅、清晰度、时长、数量等取值以这里为准；网关不限制枚举，LibTV 升级后自动同步。</p>
        <div class="stat-row"><span id="model-count">加载中…</span><span id="model-time"></span></div>
      </section>

      <div id="model-error" class="hint hidden" style="border-left-color:var(--err)">
        模型列表获取失败：<span id="model-error-text"></span>。请先确认网关授权状态：<a href="/auth">前往授权页</a>。
      </div>

      <div class="toolbar">
        <input id="model-filter" type="search" placeholder="搜索模型 ID / 名称 / 参数（如 ratio、duration）" autocomplete="off">
        <div class="filters">
          <button type="button" data-modality="all" class="active">全部</button>
          <button type="button" data-modality="image">图像</button>
          <button type="button" data-modality="video">视频</button>
        </div>
        <a class="btn ghost" href="/models">刷新</a>
      </div>

      <div class="model-grid" id="model-grid"></div>

      <p class="hint">调用时把参数放进请求体的 <code>params</code> 对象原样透传，例如 <code>{"ratio":"9:16","resolution":"1K"}</code>。<code>size</code> / <code>n</code> / <code>seconds</code> 是 OpenAI 便利字段，优先级低于 <code>params</code>。完整调用示例见 <a href="/docs">API 文档</a>。</p>
      <div class="footer">模型数据来自 LibTV 实时契约 · <a href="/healthz">健康检查</a> · <a href="/docs.md">Markdown 文档</a></div>
    </div>`,
    script: MODEL_JS,
  })
}
