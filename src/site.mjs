// 站点共享外壳：统一顶部导航（首页 / 模型广场 / API 文档 / 授权）、主题与复制能力。
// 零外部依赖，所有页面免鉴权，不含任何账号/token 信息。

export const SITE_CSS = `
  :root{--bg:#0b0f19;--fg:#e6edf3;--muted:#9aa7b8;--accent:#58a6ff;--border:#263041;--card:#121926;--soft:#0f1521;--ok:#56d364;--err:#ff7b72;color-scheme:dark}
  @media (prefers-color-scheme: light){:root:not([data-theme]){--bg:#fff;--fg:#1f2328;--muted:#636c76;--accent:#0969da;--border:#d8dee4;--card:#f6f8fa;--soft:#fbfcfd;--ok:#1a7f37;--err:#cf222e;color-scheme:light}}
  :root[data-theme=light]{--bg:#fff;--fg:#1f2328;--muted:#636c76;--accent:#0969da;--border:#d8dee4;--card:#f6f8fa;--soft:#fbfcfd;--ok:#1a7f37;--err:#cf222e;color-scheme:light}
  :root[data-theme=dark]{--bg:#0b0f19;--fg:#e6edf3;--muted:#9aa7b8;--accent:#58a6ff;--border:#263041;--card:#121926;--soft:#0f1521;--ok:#56d364;--err:#ff7b72;color-scheme:dark}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  a{color:var(--accent);text-decoration:none}
  code,pre{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
  .site-top{position:sticky;top:0;z-index:20;height:58px;display:flex;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid var(--border);background:var(--bg)}
  .site-brand{display:flex;align-items:center;gap:9px;color:var(--fg);font-size:14px;white-space:nowrap}
  .site-logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#4f8cff,#9a67ff);color:#fff;display:grid;place-items:center;font-weight:800;font-size:13px}
  .site-nav{display:flex;align-items:center;gap:3px;flex:1;min-width:0;overflow-x:auto}
  .site-nav a{padding:6px 13px;border-radius:7px;color:var(--muted);font-size:13px;white-space:nowrap}
  .site-nav a:hover{background:var(--card);color:var(--fg)}
  .site-nav a.active{background:var(--card);color:var(--accent);font-weight:600}
  .site-actions{display:flex;align-items:center;gap:8px}
  .site-actions button,.site-actions a{background:var(--card);border:1px solid var(--border);border-radius:7px;color:var(--fg);padding:5px 10px;font-size:12px;cursor:pointer}
  .site-actions button:hover,.site-actions a:hover{border-color:var(--accent);color:var(--accent)}
  .site-main{min-height:calc(100vh - 58px)}
  .container{max-width:1120px;margin:0 auto;padding:40px 26px 90px}
  h1{font-size:30px;line-height:1.3;margin:0 0 10px;letter-spacing:-.02em}
  h2{font-size:19px;margin:0 0 12px}
  h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:24px 0 10px}
  p{margin:0 0 12px}
  .desc{color:var(--muted)}
  .hint{color:var(--muted);font-size:12px;background:var(--card);border-left:3px solid var(--accent);padding:8px 12px;border-radius:0 6px 6px 0;margin:12px 0}
  .btn{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;border:1px solid var(--accent);border-radius:8px;padding:8px 15px;font-size:13px;cursor:pointer}
  .btn:hover{filter:brightness(1.08)}
  .btn.ghost{background:var(--card);color:var(--fg);border-color:var(--border)}
  .btn.ghost:hover{border-color:var(--accent);color:var(--accent)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:14px;margin:22px 0}
  .card{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:18px 20px}
  .card a{display:block;color:var(--fg)}
  .card a:hover h2{color:var(--accent)}
  .card b,.card h2{display:block;margin:8px 0 4px}
  .card p{color:var(--muted);font-size:13px;margin:0 0 12px}
  .card code,.card .arrow{font-size:12px;color:var(--accent)}
  .eyebrow{font:700 10px/1.6 ui-monospace,Consolas,monospace;letter-spacing:.1em;color:var(--accent)}
  .hero{padding:14px 0 6px}
  .hero .lead{font-size:16px;color:var(--muted);max-width:720px}
  .stat-row{display:flex;gap:18px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:16px}
  .stat-row b{color:var(--fg)}
  .pill{display:inline-block;border:1px solid var(--border);border-radius:20px;padding:2px 10px;font-size:11px;color:var(--muted)}
  .pill.image{color:#1a7f37;border-color:rgba(26,127,55,.35)}
  .pill.video{color:#8250df;border-color:rgba(130,80,223,.35)}
  :root[data-theme=dark] .pill.image{color:#56d364}
  :root[data-theme=dark] .pill.video{color:#d2a8ff}
  .toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:22px 0 18px}
  .toolbar input{background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--fg);padding:9px 13px;font-size:13px;min-width:260px;outline:none}
  .toolbar input:focus{border-color:var(--accent)}
  .filters{display:flex;gap:6px;flex-wrap:wrap}
  .filters button{background:var(--card);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:5px 13px;font-size:12px;cursor:pointer}
  .filters button.active{background:var(--accent);border-color:var(--accent);color:#fff}
  .model-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
  .model-card{background:var(--card);border:1px solid var(--border);border-radius:11px;padding:16px 18px;min-width:0}
  .model-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
  .model-name{font:600 13px/1.5 ui-monospace,Consolas,monospace;word-break:break-all;margin:2px 0}
  .model-meta{color:var(--muted);font-size:12px;min-height:20px}
  .copy-btn{background:var(--soft);border:1px solid var(--border);border-radius:6px;color:var(--muted);padding:4px 9px;font-size:11px;cursor:pointer;white-space:nowrap}
  .copy-btn:hover{color:var(--accent);border-color:var(--accent)}
  .param-list{list-style:none;padding:0;margin:12px 0 0;border-top:1px solid var(--border)}
  .param-list li{display:grid;grid-template-columns:minmax(88px,auto) 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px}
  .param-list li:last-child{border-bottom:0}
  .param-name{font-family:ui-monospace,Consolas,monospace;color:var(--fg)}
  .param-name small{display:block;color:var(--muted);font-family:inherit}
  .param-values{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .chip{background:var(--bg);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font:11px ui-monospace,Consolas,monospace}
  .chip.default{border-color:var(--accent);color:var(--accent)}
  .no-params{color:var(--muted);font-size:12px;margin:10px 0 0}
  details{margin-top:10px;font-size:12px}
  summary{cursor:pointer;color:var(--muted)}
  pre{background:var(--soft);border:1px solid var(--border);border-radius:8px;padding:12px 14px;overflow:auto;font-size:12px;line-height:1.6;margin:8px 0 0}
  .code-block{border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--card);margin:12px 0 18px}
  .code-head{display:flex;align-items:center;background:var(--soft);border-bottom:1px solid var(--border);padding:5px 8px}
  .code-head span{font-size:11px;color:var(--muted);margin-left:8px;flex:1}
  .code-head .copy-btn{margin-left:0}
  .empty{text-align:center;color:var(--muted);padding:60px 20px;border:1px dashed var(--border);border-radius:11px}
  .hidden{display:none}
  .footer{border-top:1px solid var(--border);margin-top:50px;padding-top:18px;color:var(--muted);font-size:12px}
  @media (max-width:900px){
    .site-top{padding:0 14px;gap:10px}
    .site-brand b{display:none}
    .site-nav a{padding:5px 8px;font-size:12px}
    .site-actions a{display:none}
    .container{padding:26px 16px 70px}
    h1{font-size:24px}
    .toolbar input{min-width:100%;width:100%}
    .model-grid{grid-template-columns:1fr}
  }
`

const SITE_JS = `
(() => {
  const root = document.documentElement;

  // 主题切换（没有主题按钮的页面也要能复制，不能提前 return）
  const btn = document.getElementById('site-theme');
  if (btn) {
    const key = 'lt-docs-theme';
    const saved = localStorage.getItem(key);
    if (saved) root.dataset.theme = saved;
    const sync = () => { btn.textContent = getComputedStyle(root).colorScheme === 'dark' ? '☀' : '☾' };
    sync();
    btn.addEventListener('click', () => {
      const dark = getComputedStyle(root).colorScheme === 'dark';
      root.dataset.theme = dark ? 'light' : 'dark';
      localStorage.setItem(key, root.dataset.theme);
      sync();
    });
  }

  // 复制：HTTP 局域网地址不是安全上下文，navigator.clipboard 不可用，
  // 必须回退到 execCommand。暴露给其他页面脚本复用。
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
  window.__ltCopyText = copyText;

  // 事件委托：模型卡片由后续脚本动态生成，直接绑定会抓不到按钮
  document.addEventListener('click', async (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[data-copy]') : null;
    if (!b) return;
    const label = b.dataset.label || '复制';
    const ok = await copyText(b.dataset.copy);
    b.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { b.textContent = label }, 1500);
  });
})();
`

/** 生成带统一导航的完整 HTML。data 会以 JSON 注入 #site-data，脚本内可读取。 */
export function siteHtml({ title, active = '', body = '', data = null, script = '', extraCss = '' }) {
  const nav = [['home', '/', '首页'], ['models', '/models', '模型广场'], ['docs', '/docs', 'API 文档'], ['auth', '/auth', '授权']]
  const payload = data === null ? '' : `<script type="application/json" id="site-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${SITE_CSS}${extraCss}</style>
</head>
<body>
<header class="site-top">
  <a class="site-brand" href="/"><span class="site-logo">LT</span><b>LibTV API</b></a>
  <nav class="site-nav">${nav.map(([key, href, label]) => `<a href="${href}"${key === active ? ' class="active"' : ''}>${label}</a>`).join('')}</nav>
  <div class="site-actions"><button type="button" id="site-theme" title="切换明暗主题">☾</button></div>
</header>
<main class="site-main">${body}</main>
${payload}
<script>${SITE_JS}</script>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`
}
