// Web 授权页面：展示当前授权状态 + 发起授权入口
// 纯静态 HTML + 少量内联 JS，零外部依赖；不含任何账号/token 信息。
//
// 两种授权方式：
//   A. 推荐（Docker 场景）：宿主机执行 npm run auth:login 扫码，把 data/credentials.json 挂载进容器。
//   B. 页面授权（仅当 GATEWAY_PUBLIC_URL 是 loopback 时可用）：点按钮跳官方授权，回调自动落凭据。
//      LibTV 只接受 127.0.0.1 / localhost 回调，拒绝内网 IP 与公网域名（实测）。

function shell(title, body, script = '') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  :root{--bg:#0d1117;--fg:#c9d1d9;--muted:#8b949e;--accent:#58a6ff;--border:#30363d;--card:#161b22;--ok:#3fb950;--err:#f85149;--warn:#d29922}
  @media (prefers-color-scheme: light){:root{--bg:#fff;--fg:#24292f;--muted:#57606a;--accent:#0969da;--border:#d0d7de;--card:#f6f8fa;--ok:#1a7f37;--err:#cf222e;--warn:#9a6700}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:40px 22px 80px}
  h1{font-size:24px;margin:0 0 6px}
  .sub{color:var(--muted);margin-bottom:28px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:22px 24px;margin-bottom:18px}
  .row{display:flex;justify-content:space-between;gap:16px;padding:7px 0;border-bottom:1px solid var(--border);font-size:14px}
  .row:last-child{border-bottom:0}
  .k{color:var(--muted);white-space:nowrap}
  .v{font-family:ui-monospace,Consolas,monospace;word-break:break-all;text-align:right}
  .badge{display:inline-block;border-radius:20px;padding:2px 12px;font-size:13px;font-weight:600}
  .badge.ok{background:rgba(63,185,80,.15);color:var(--ok)}
  .badge.no{background:rgba(248,81,73,.15);color:var(--err)}
  button{background:var(--accent);color:#fff;border:0;border-radius:7px;padding:11px 22px;font-size:15px;font-weight:600;cursor:pointer}
  button:hover{filter:brightness(1.1)}
  button:disabled{opacity:.55;cursor:not-allowed}
  button.ghost{background:transparent;color:var(--accent);border:1px solid var(--accent)}
  .hint{color:var(--muted);font-size:13px;margin-top:12px}
  .err{color:var(--err);background:rgba(248,81,73,.1);border:1px solid var(--err);border-radius:7px;padding:10px 14px;margin-top:14px;font-size:14px;display:none}
  .big{font-size:18px;font-weight:600;margin-bottom:10px}
  a{color:var(--accent)}
  code,pre{font-family:ui-monospace,Consolas,monospace}
  pre{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:12px 14px;overflow:auto;font-size:13px;margin:10px 0 0}
</style>
</head>
<body><div class="wrap">${body}</div><script>${script}</script></body>
</html>`
}

/** 授权首页：展示状态 + 两种授权方式 */
export function authPageHtml() {
  return shell(
    'LibTV 网关授权',
    `<h1>LibTV 网关授权</h1>
     <div class="sub">首次使用或授权失效时走一次官方扫码授权。凭据自动保存在服务端，之后所有接口无需再次授权。</div>
     <div class="card">
       <div class="row"><span class="k">当前状态</span><span class="v"><span id="state" class="badge no">检查中…</span></span></div>
       <div class="row"><span class="k">授权范围</span><span class="v" id="scope">—</span></div>
       <div class="row"><span class="k">Token 到期</span><span class="v" id="expiry">—</span></div>
       <div class="row"><span class="k">已注册回调</span><span class="v" id="redirect">—</span></div>
     </div>

     <div class="card" id="hostCard" style="display:none">
       <div class="big">方式一 · 宿主机授权（Docker 推荐）</div>
       <div class="hint">LibTV 官方只接受 127.0.0.1 / localhost 回调，不接受内网 IP 或公网域名。因此在 Docker 中部署时，请在<b>宿主机</b>完成扫码，再把凭据文件挂载进容器：</div>
       <pre>1. 宿主机执行：  npm run auth:login   （微信扫码，自动生成 data/LibTV.lock）
2. 确认凭据：    data/credentials.json + data/LibTV.lock
3. Docker 挂载： -v $(pwd)/data:/app/data   （不要加 :ro，续期回写/解锁需要写权限）</pre>
       <div class="hint">授权完成后点下面的按钮刷新状态。refresh token 会自动续期，通常无需再次扫码。</div>
       <div style="margin-top:14px"><button class="ghost" onclick="loadStatus()">刷新授权状态</button></div>
     </div>

     <div class="card" id="webCard" style="display:none">
       <div class="big">方式二 · 在本页面直接授权</div>
       <div class="hint">当前已配置 loopback 回调地址，可直接点按钮跳转官方授权页（微信扫码），完成后自动跳回并更新凭据。</div>
       <div style="margin-top:16px"><button id="btn" onclick="startAuth()">跳转到官方授权</button></div>
       <div class="err" id="err"></div>
     </div>

     <div class="card" style="font-size:13px;color:var(--muted)">
       授权凭据属于私密数据，不会出现在接口文档 (/docs) 或任何公开接口中。本页仅用于首次授权 / 重新授权。
     </div>`,
    `
    async function loadStatus(){
      try{
        const r=await fetch('/auth/status');
        const j=await r.json();
        // 页面打开期间若其他进程完成授权并上锁，直接刷新为锁定页
        if(j.locked){window.location.reload();return}
        const el=document.getElementById('state');
        if(j.authorized){el.textContent='已授权';el.className='badge ok'}
        else{el.textContent='未授权';el.className='badge no'}
        document.getElementById('scope').textContent=j.scope||'—';
        document.getElementById('expiry').textContent=j.expires_at||'—';
        document.getElementById('redirect').textContent=(j.redirect_uris||[]).join('  ·  ')||'—';
        document.getElementById('hostCard').style.display='block';
        if(j.web_auth_available) document.getElementById('webCard').style.display='block';
      }catch(e){
        const el=document.getElementById('state');
        el.textContent='状态获取失败';el.className='badge no';
      }
    }
    async function startAuth(){
      const btn=document.getElementById('btn');btn.disabled=true;btn.textContent='正在准备…';
      const err=document.getElementById('err');err.style.display='none';
      try{
        const r=await fetch('/auth/start',{method:'POST'});
        const j=await r.json();
        if(!r.ok) throw new Error(j.error?.message||'发起失败');
        window.location.href=j.authorize_url;
      }catch(e){
        err.textContent=e.message;err.style.display='block';btn.disabled=false;btn.textContent='跳转到官方授权';
      }
    }
    loadStatus();
    `,
  )
}

/** 授权锁已生效时展示：不再提供任何发起授权的入口 */
export function authLockedHtml(lock = {}) {
  const m = (s) => String(s ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const via = lock.via === 'web' ? 'Web 授权页' : lock.via === 'cli' ? '宿主机 CLI' : '—'
  return shell(
    'LibTV 已授权',
    `<h1>LibTV 已授权</h1>
     <div class="sub">授权成功后网关会生成 <code>data/LibTV.lock</code>，授权入口随之关闭，避免重复授权覆盖当前账号。</div>
     <div class="card">
       <div class="row"><span class="k">授权状态</span><span class="v"><span class="badge ok">已授权 · 已锁定</span></span></div>
       <div class="row"><span class="k">授权渠道</span><span class="v">${m(via)}</span></div>
       <div class="row"><span class="k">授权时间</span><span class="v">${m(lock.authorized_at)}</span></div>
       <div class="row"><span class="k">Refresh 失败</span><span class="v">${m(lock.refresh_failures)} / ${m(lock.max_refresh_failures)}</span></div>
     </div>
     <div class="card" style="font-size:14px">
       授权凭据由服务端自动续期，通常无需再次扫码。若 token 过期且无法续期，或 refresh 连续失败达到上限，
       网关会自动删除锁文件并清除凭据，届时本页会重新开放并提示授权。
       <div class="hint">确需更换账号：停止网关后在宿主机执行 <code>npm run auth:logout</code>（同时清除凭据与锁），再访问 <code>/auth</code>。</div>
     </div>
     <div class="card"><a href="/docs">查看接口文档</a> · <a href="/auth/status">授权状态 JSON</a></div>`,
  )
}

/** 授权结果页：回调完成后展示（成功/失败都在网关域名下） */
export function authResultHtml(ok, message, detail = '') {
  const m = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return shell(
    ok ? '授权完成' : '授权失败',
    `<h1>${ok ? '授权完成' : '授权失败'}</h1>
     <div class="sub">${ok ? '凭据已自动保存到服务端，可以关闭此页面。' : '本次授权未完成，可返回授权页重试。'}</div>
     <div class="card">
       <div class="big" style="color:${ok ? 'var(--ok)' : 'var(--err)'}">${ok ? '✓ ' + m(message) : '✗ ' + m(message)}</div>
       ${detail ? `<div class="hint" style="white-space:pre-wrap">${m(detail)}</div>` : ''}
     </div>
     <div class="card"><a href="/auth">返回授权页</a> · <a href="/docs">查看接口文档</a></div>`,
  )
}
