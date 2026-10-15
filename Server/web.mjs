// Browser-compatible and stringified into the client bundle below. Date-only
// deadlines end at 23:59:59 in the record's timezone, matching the Swift model.
export function effectiveDeadline(record) {
  if (!record || typeof record.dueDate !== 'string') return NaN;
  const parsed = Date.parse(record.dueDate);
  if (!Number.isFinite(parsed) || !record.dateOnly) return parsed;
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: record.timezone || 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
  }
  const fields = Object.fromEntries(formatter.formatToParts(new Date(parsed))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
  const wallTarget = Date.UTC(fields.year, fields.month - 1, fields.day + 1, 0, 0, 0);
  let estimate = wallTarget;
  for (let index = 0; index < 4; index += 1) {
    const current = Object.fromEntries(formatter.formatToParts(new Date(estimate))
      .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
    const rendered = Date.UTC(current.year, current.month - 1, current.day,
      current.hour, current.minute, current.second);
    estimate = wallTarget - (rendered - estimate);
  }
  return estimate - 1000;
}

export function formatCountdown(target, now = Date.now()) {
  if (!Number.isFinite(target)) return '未设置截止';
  const overdue = target < now;
  let seconds = Math.floor(Math.abs(target - now) / 1000);
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  const pad = value => String(value).padStart(2, '0');
  const clock = (days ? days + '天 ' : '') + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  return overdue ? '已逾期 ' + clock : clock;
}

const webHTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f7f4ed">
  <meta name="description" content="广益 WorkSpace 网页版：行动与 DDL 倒计时。">
  <title>广益 WorkSpace</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/app.css">
  <script type="module" src="/app.js"></script>
</head>
<body>
  <a class="skip-link" href="#main">跳到主要内容</a>
  <div class="shell">
    <header class="site-header">
      <div class="brand-mark" aria-hidden="true">益</div>
      <div>
        <p class="eyebrow">GUANGYI WORKSPACE</p>
        <h1>行动有序，截止清晰</h1>
      </div>
    </header>

    <main id="main">
      <section id="login-view" class="login-grid" aria-labelledby="login-title">
        <div class="hero-card">
          <p class="eyebrow">同账号资料</p>
          <h2 id="login-title">回到你的工作空间</h2>
          <p class="hero-copy">登录后读取服务器上的行动与 DDL。倒计时会在当前页面按秒更新，资料正文不会写入浏览器长期存储。</p>
          <div class="feature-row">
            <span>行动 + 行动组</span><span>DDL 秒级倒计时</span><span>通行密钥</span>
          </div>
        </div>
        <div class="auth-card">
          <form id="password-form">
            <label for="email">账号邮箱</label>
            <input id="email" name="email" type="email" inputmode="email" autocomplete="username" required>
            <label for="password">密码</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>
            <button class="primary" type="submit">使用密码登录</button>
          </form>
          <div class="or" aria-hidden="true"><span>或</span></div>
          <button id="passkey-login" class="secondary" type="button">使用通行密钥登录</button>
          <p id="login-status" class="status" role="status" aria-live="polite"></p>
          <p class="privacy-note">会话令牌只保存在此浏览器标签页；关闭标签页后自动清除。</p>
        </div>
      </section>

      <section id="workspace-view" hidden aria-labelledby="workspace-title">
        <div class="workspace-header">
          <div>
            <p id="account-label" class="eyebrow"></p>
            <h2 id="workspace-title">我的工作空间</h2>
            <p id="sync-label" class="muted"></p>
          </div>
          <div class="toolbar" aria-label="账号操作">
            <button id="refresh" class="quiet" type="button">刷新</button>
            <button id="register-passkey" class="quiet" type="button">创建新通行密钥</button>
            <button id="logout" class="quiet danger" type="button">退出</button>
          </div>
        </div>

        <nav class="tabs" role="tablist" aria-label="工作空间主入口">
          <button id="actions-tab" role="tab" aria-selected="true" aria-controls="actions-panel" data-view="actions" type="button">行动 <span id="action-count" class="tab-count">0</span></button>
          <button id="deadlines-tab" role="tab" aria-selected="false" aria-controls="deadlines-panel" data-view="deadlines" type="button">DDL <span id="deadline-count" class="tab-count">0</span><span id="overdue-badge" class="overdue-badge" hidden>0 逾期</span></button>
        </nav>

        <p id="app-status" class="status" role="status" aria-live="polite"></p>
        <section id="actions-panel" role="tabpanel" aria-labelledby="actions-tab">
          <div class="section-heading"><div><p class="eyebrow">NEXT ACTIONS</p><h3>行动</h3></div><p>行动组、行动、里程碑与提醒集中在这里。</p></div>
          <div id="actions-list" class="card-list"></div>
        </section>
        <section id="deadlines-panel" role="tabpanel" aria-labelledby="deadlines-tab" hidden>
          <div class="section-heading"><div><p class="eyebrow">DEADLINES</p><h3>DDL</h3></div><p>重要截止内容优先显示；倒计时每秒刷新。</p></div>
          <div id="deadlines-list" class="deadline-grid"></div>
        </section>
      </section>
    </main>
    <footer>广益 WorkSpace · 服务器快照只读视图</footer>
  </div>
</body>
</html>`;

const webCSS = String.raw`:root {
  color-scheme: light dark;
  --paper: #f7f4ed; --surface: rgba(255,255,255,.84); --ink: #20211f; --muted: #666861;
  --line: rgba(32,33,31,.12); --accent: #315b4c; --accent-soft: #dfe9e2;
  --urgent: #a53832; --urgent-soft: #f6dfdc; --shadow: 0 18px 60px rgba(31,39,33,.10);
  font-family: ui-rounded, "SF Pro Rounded", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; min-height: 100vh; color: var(--ink); background:
  radial-gradient(circle at 12% 0%, rgba(129,164,139,.24), transparent 32rem),
  radial-gradient(circle at 100% 18%, rgba(207,157,112,.18), transparent 28rem), var(--paper); }
button, input { font: inherit; }
button { cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 2px; }
.skip-link { position: fixed; top: .5rem; left: .5rem; z-index: 20; transform: translateY(-200%); padding: .7rem 1rem; border-radius: .7rem; color: white; background: var(--accent); }
.skip-link:focus { transform: none; }
.shell { width: min(1120px, calc(100% - 2rem)); margin: 0 auto; padding: max(1.2rem, env(safe-area-inset-top)) 0 2rem; }
.site-header { display: flex; align-items: center; gap: 1rem; padding: 1rem 0 2.4rem; }
.brand-mark { display: grid; place-items: center; width: 3.2rem; aspect-ratio: 1; border-radius: 1rem; color: #fff; background: var(--accent); font-size: 1.35rem; font-weight: 800; box-shadow: var(--shadow); }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: clamp(1.35rem, 2.3vw, 2rem); letter-spacing: -.035em; }
h2 { margin-bottom: .8rem; font-size: clamp(2rem, 5vw, 3.8rem); line-height: 1.02; letter-spacing: -.055em; }
h3 { margin-bottom: 0; font-size: clamp(1.55rem, 3vw, 2.2rem); letter-spacing: -.04em; }
.eyebrow { margin-bottom: .35rem; color: var(--accent); font-size: .72rem; font-weight: 800; letter-spacing: .15em; }
.muted, .privacy-note, .section-heading > p { color: var(--muted); }
.login-grid { display: grid; grid-template-columns: minmax(0,1.35fr) minmax(18rem,.65fr); gap: 1.2rem; }
.hero-card, .auth-card, .workspace-header, .tabs, .record-card { border: 1px solid var(--line); background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(20px); }
.hero-card, .auth-card { border-radius: 1.6rem; padding: clamp(1.4rem, 4vw, 3rem); }
.hero-card { min-height: 25rem; display: flex; flex-direction: column; justify-content: center; overflow: hidden; position: relative; }
.hero-card::after { content: ""; position: absolute; width: 15rem; height: 15rem; right: -5rem; bottom: -6rem; border-radius: 50%; background: var(--accent-soft); opacity: .75; }
.hero-copy { max-width: 35rem; color: var(--muted); font-size: 1.06rem; line-height: 1.7; }
.feature-row { display: flex; flex-wrap: wrap; gap: .55rem; margin-top: 1.4rem; position: relative; z-index: 1; }
.feature-row span, .tag { padding: .45rem .7rem; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: .78rem; font-weight: 700; }
.auth-card form { display: grid; gap: .55rem; }
label { margin-top: .55rem; font-weight: 700; }
input { width: 100%; padding: .85rem .9rem; border: 1px solid var(--line); border-radius: .8rem; color: var(--ink); background: color-mix(in srgb, var(--surface) 88%, transparent); }
.primary, .secondary, .quiet { min-height: 2.8rem; border-radius: .85rem; border: 1px solid transparent; padding: .65rem 1rem; font-weight: 750; }
.primary { margin-top: .8rem; color: white; background: var(--accent); }
.secondary { width: 100%; color: var(--accent); border-color: color-mix(in srgb, var(--accent) 25%, transparent); background: var(--accent-soft); }
.quiet { color: var(--ink); border-color: var(--line); background: var(--surface); }
.danger { color: var(--urgent); }
.or { display: flex; align-items: center; gap: .7rem; margin: 1.1rem 0; color: var(--muted); font-size: .78rem; }
.or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.status { min-height: 1.35rem; margin: .9rem 0 0; color: var(--accent); font-weight: 650; }
.status.error { color: var(--urgent); }
.privacy-note { margin: 1rem 0 0; font-size: .76rem; line-height: 1.5; }
.workspace-header { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; padding: 1.3rem 1.4rem; border-radius: 1.4rem; }
.workspace-header h2 { margin: 0; font-size: clamp(1.7rem, 4vw, 2.8rem); }
.toolbar { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: .55rem; }
.tabs { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; margin: 1.1rem 0 1.4rem; padding: .45rem; border-radius: 1.1rem; box-shadow: none; }
.tabs button { min-height: 3.2rem; border: 0; border-radius: .8rem; color: var(--muted); background: transparent; font-weight: 800; }
.tabs button[aria-selected="true"] { color: white; background: var(--accent); box-shadow: 0 7px 22px rgba(49,91,76,.22); }
.tab-count { display: inline-grid; place-items: center; min-width: 1.5rem; height: 1.5rem; margin-left: .3rem; padding: 0 .35rem; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent); font-size: .72rem; }
.overdue-badge { margin-left: .35rem; padding: .25rem .48rem; border-radius: 999px; color: white; background: var(--urgent); font-size: .68rem; }
.section-heading { display: flex; justify-content: space-between; align-items: flex-end; gap: 1rem; margin: 0 .2rem 1rem; }
.section-heading > p { max-width: 27rem; margin-bottom: .2rem; text-align: right; }
.card-list, .deadline-grid { display: grid; gap: .85rem; }
.deadline-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
.record-card { border-radius: 1.15rem; padding: 1.15rem; box-shadow: 0 9px 35px rgba(31,39,33,.07); }
.record-card.pinned { border-color: color-mix(in srgb, var(--accent) 42%, transparent); }
.record-card.overdue { border-color: color-mix(in srgb, var(--urgent) 35%, transparent); background: color-mix(in srgb, var(--urgent-soft) 72%, var(--surface)); }
.record-card.finished { opacity: .68; box-shadow: none; }
.record-top { display: flex; justify-content: space-between; align-items: flex-start; gap: .8rem; }
.record-title { margin: 0; font-size: 1.03rem; line-height: 1.4; overflow-wrap: anywhere; }
.kind-label { flex: 0 0 auto; color: var(--accent); font-size: .7rem; font-weight: 800; letter-spacing: .06em; }
.record-summary { margin: .55rem 0 0; color: var(--muted); line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.record-meta { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: .8rem; color: var(--muted); font-size: .78rem; }
.deadline-date { margin: .7rem 0 .25rem; color: var(--muted); font-size: .86rem; }
.countdown { display: block; margin-top: .2rem; color: var(--accent); font-variant-numeric: tabular-nums; font-size: clamp(1.45rem, 4vw, 2.25rem); letter-spacing: -.035em; }
.overdue .countdown { color: var(--urgent); }
.empty { padding: 2.6rem 1rem; border: 1px dashed var(--line); border-radius: 1.1rem; color: var(--muted); text-align: center; }
footer { padding: 2.5rem 0 1rem; color: var(--muted); font-size: .75rem; text-align: center; }
@media (max-width: 760px) {
  .shell { width: min(100% - 1rem, 42rem); }
  .site-header { padding-bottom: 1.2rem; }
  .login-grid, .deadline-grid { grid-template-columns: 1fr; }
  .hero-card { min-height: auto; }
  .workspace-header, .section-heading { align-items: flex-start; flex-direction: column; }
  .toolbar { justify-content: flex-start; }
  .section-heading > p { text-align: left; }
}
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; } }
@media (prefers-color-scheme: dark) {
  :root { --paper: #171a18; --surface: rgba(33,38,35,.88); --ink: #f0f2ed; --muted: #adb3ac; --line: rgba(240,242,237,.13); --accent: #93c5ad; --accent-soft: #253f34; --urgent: #ffaaa3; --urgent-soft: #4a2928; --shadow: 0 18px 60px rgba(0,0,0,.28); }
  .primary, .tabs button[aria-selected="true"] { color: #10251d; }
}`;

const effectiveDeadlineSource = effectiveDeadline.toString();
const formatCountdownSource = formatCountdown.toString();
const webJS = String.raw`(() => {
  'use strict';
  const effectiveDeadline = ${effectiveDeadlineSource};
  const formatCountdown = ${formatCountdownSource};
  const state = { token: '', account: '', displayName: '', workspace: null, revision: null, loadingToken: '' };
  const finished = new Set(['DONE', 'COMPLETED', 'CANCELLED']);
  const actionKinds = new Set(['PROJECT', 'TASK', 'MILESTONE', 'REMINDER']);
  const kindNames = { PROJECT: '行动组', TASK: '行动', MILESTONE: '里程碑', REMINDER: '提醒', DEADLINE: 'DDL' };
  const statusNames = { PLANNED: '计划中', ACTIVE: '进行中', WAITING: '等待中', PAUSED: '已暂停', COMPLETED: '已完成', TODO: '待行动', IN_PROGRESS: '进行中', DONE: '已完成', CANCELLED: '已取消', OPEN: '待处理' };
  const errorNames = { INVALID_CREDENTIALS: '账号或密码不正确。', UNAUTHENTICATED: '会话已失效，请重新登录。', INVALID_PASSKEY: '通行密钥验证失败。', INVALID_CHALLENGE: '验证请求已过期，请重试。', PASSKEY_LIMIT: '此账号已达到通行密钥数量上限。', PASSKEY_EXISTS: '这枚通行密钥已经注册。', RATE_LIMITED: '尝试次数过多，请稍后再试。' };
  const byID = id => document.getElementById(id);
  function saved(key) { try { return sessionStorage.getItem(key) || ''; } catch { return ''; } }
  function save(key, value) { try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); } catch {} }
  function setMessage(target, message, error) { target.textContent = message || ''; target.classList.toggle('error', Boolean(error)); }
  function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; }
  function base64url(value) {
    const bytes = new Uint8Array(value); let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  }
  function bytes(value) {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = atob(base64); return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  function creationOptions(options) {
    const result = Object.assign({}, options, { challenge: bytes(options.challenge), user: Object.assign({}, options.user, { id: bytes(options.user.id) }) });
    result.excludeCredentials = (options.excludeCredentials || []).map(item => Object.assign({}, item, { id: bytes(item.id) }));
    return result;
  }
  function requestOptions(options) {
    const result = Object.assign({}, options, { challenge: bytes(options.challenge) });
    result.allowCredentials = (options.allowCredentials || []).map(item => Object.assign({}, item, { id: bytes(item.id) }));
    return result;
  }
  function registrationCredential(credential) {
    return { id: credential.id, rawId: base64url(credential.rawId), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: { clientDataJSON: base64url(credential.response.clientDataJSON), attestationObject: base64url(credential.response.attestationObject),
        transports: typeof credential.response.getTransports === 'function' ? credential.response.getTransports() : undefined } };
  }
  function authenticationCredential(credential) {
    return { id: credential.id, rawId: base64url(credential.rawId), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: { clientDataJSON: base64url(credential.response.clientDataJSON), authenticatorData: base64url(credential.response.authenticatorData),
        signature: base64url(credential.response.signature), userHandle: credential.response.userHandle ? base64url(credential.response.userHandle) : null } };
  }
  async function api(path, options) {
    const settings = options || {}; const headers = { Accept: 'application/json' };
    if (settings.authenticated !== false && state.token) headers.Authorization = 'Bearer ' + state.token;
    if (settings.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch('/api/native/v1/' + path, { method: settings.method || 'GET', headers,
      body: settings.body === undefined ? undefined : JSON.stringify(settings.body), cache: 'no-store', credentials: 'omit', redirect: 'error' });
    let envelope = null; try { envelope = await response.json(); } catch {}
    if (!response.ok) {
      const code = envelope && envelope.error && envelope.error.code || 'REQUEST_FAILED';
      const error = new Error(errorNames[code] || '请求失败（' + response.status + '）。'); error.code = code; error.status = response.status; throw error;
    }
    return envelope && envelope.data !== undefined ? envelope.data : envelope;
  }
  function clearSession() {
    state.token = ''; state.account = ''; state.displayName = ''; state.workspace = null; state.revision = null;
    save('gw-session', ''); save('gw-account', ''); save('gw-display-name', '');
  }
  function beginSession(session) {
    if (!session || typeof session.accessToken !== 'string' || !session.accessToken) throw new Error('服务器没有返回有效会话。');
    state.token = session.accessToken; state.account = session.account || ''; state.displayName = session.displayName || '';
    save('gw-session', state.token); save('gw-account', state.account); save('gw-display-name', state.displayName);
  }
  function showLogin(message, error) {
    byID('workspace-view').hidden = true; byID('login-view').hidden = false;
    setMessage(byID('login-status'), message || '', error); byID('password').value = '';
  }
  function showWorkspace() {
    byID('login-view').hidden = true; byID('workspace-view').hidden = false;
    byID('account-label').textContent = state.displayName ? state.displayName + ' · ' + state.account : state.account;
  }
  function live(record) { return record && !record.deletedAt && !record.archivedAt; }
  function timestamp(value) { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; }
  function recordCard(record) {
    const card = element('article', 'record-card' + (record.pinned ? ' pinned' : '') + (finished.has(record.status) ? ' finished' : ''));
    const top = element('div', 'record-top'); top.append(element('h4', 'record-title', record.title || '未命名'));
    top.append(element('span', 'kind-label', kindNames[record.kind] || record.kind)); card.append(top);
    if (record.summary) card.append(element('p', 'record-summary', record.summary));
    const meta = element('div', 'record-meta'); meta.append(element('span', '', statusNames[record.status] || record.status));
    if (record.pinned) meta.append(element('span', '', '已置顶')); if (record.tags && record.tags.length) meta.append(element('span', '', record.tags.slice(0, 3).join(' · ')));
    card.append(meta); return card;
  }
  function absoluteDeadline(record, target) {
    if (!Number.isFinite(target)) return '未设置截止时间';
    let formatter; const zone = record.timezone || 'Asia/Shanghai';
    try { formatter = new Intl.DateTimeFormat('zh-CN', record.dateOnly ? { timeZone: zone, year: 'numeric', month: 'long', day: 'numeric' } : { timeZone: zone, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { formatter = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    return formatter.format(new Date(record.dateOnly ? Date.parse(record.dueDate) : target)) + (record.dateOnly ? ' 当日结束前' : '');
  }
  function deadlineCard(record) {
    const target = effectiveDeadline(record); const isFinished = finished.has(record.status); const overdue = !isFinished && Number.isFinite(target) && target < Date.now();
    const card = element('article', 'record-card' + (record.pinned ? ' pinned' : '') + (isFinished ? ' finished' : '') + (overdue ? ' overdue' : ''));
    const top = element('div', 'record-top'); top.append(element('h4', 'record-title', record.title || '未命名 DDL'));
    top.append(element('span', 'kind-label', isFinished ? (statusNames[record.status] || record.status) : overdue ? '已逾期' : '进行中')); card.append(top);
    if (record.summary) card.append(element('p', 'record-summary', record.summary));
    card.append(element('p', 'deadline-date', absoluteDeadline(record, target)));
    const countdown = element('time', 'countdown', isFinished ? (statusNames[record.status] || record.status) : formatCountdown(target));
    countdown.setAttribute('aria-live', 'off'); if (!isFinished && Number.isFinite(target)) countdown.dataset.target = String(target); card.append(countdown);
    const meta = element('div', 'record-meta'); if (record.timezone) meta.append(element('span', '', record.timezone));
    if (record.projectID) meta.append(element('span', '', '已关联行动组')); card.append(meta); return card;
  }
  function empty(text) { return element('p', 'empty', text); }
  function render() {
    const records = state.workspace && Array.isArray(state.workspace.records) ? state.workspace.records.filter(live) : [];
    const actions = records.filter(record => actionKinds.has(record.kind)).sort((left, right) => Number(right.pinned) - Number(left.pinned) || Number(finished.has(left.status)) - Number(finished.has(right.status)) || timestamp(right.updatedAt) - timestamp(left.updatedAt));
    const deadlines = records.filter(record => record.kind === 'DEADLINE').sort((left, right) => Number(finished.has(left.status)) - Number(finished.has(right.status)) || Number(right.pinned) - Number(left.pinned) || effectiveDeadline(left) - effectiveDeadline(right));
    const actionList = byID('actions-list'); actionList.replaceChildren(...(actions.length ? actions.map(recordCard) : [empty('目前没有行动。')]));
    const deadlineList = byID('deadlines-list'); deadlineList.replaceChildren(...(deadlines.length ? deadlines.map(deadlineCard) : [empty('目前没有 DDL。')]));
    const overdue = deadlines.filter(record => !finished.has(record.status) && effectiveDeadline(record) < Date.now()).length;
    byID('action-count').textContent = String(actions.length); byID('deadline-count').textContent = String(deadlines.length);
    byID('overdue-badge').hidden = overdue === 0; byID('overdue-badge').textContent = overdue + ' 逾期'; updateCountdowns();
  }
  function updateCountdowns() {
    document.querySelectorAll('.countdown[data-target]').forEach(node => {
      const target = Number(node.dataset.target); node.textContent = formatCountdown(target);
      node.closest('.record-card').classList.toggle('overdue', target < Date.now());
    });
  }
  async function loadWorkspace(silent) {
    const requestedToken = state.token;
    if (!requestedToken || state.loadingToken === requestedToken) return;
    state.loadingToken = requestedToken;
    if (!silent) setMessage(byID('app-status'), '正在读取服务器快照…');
    try {
      const remote = await api('workspace');
      if (state.token !== requestedToken) return;
      if (!remote || !remote.snapshot || !Array.isArray(remote.snapshot.records)) throw new Error('服务器快照格式不正确。');
      state.workspace = remote.snapshot; state.revision = remote.revision; showWorkspace(); render();
      byID('sync-label').textContent = '服务器 revision ' + remote.revision + ' · ' + new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date()) + ' 更新';
      setMessage(byID('app-status'), silent ? '' : '已取得最新资料。');
    } catch (error) {
      if (state.token !== requestedToken) return;
      if (error.status === 401) { clearSession(); showLogin('会话已失效，请重新登录。', true); }
      else setMessage(byID('app-status'), error.message, true);
    } finally { if (state.loadingToken === requestedToken) state.loadingToken = ''; }
  }
  async function passwordLogin(event) {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    setMessage(byID('login-status'), '正在登录…');
    try {
      const session = await api('session', { method: 'POST', authenticated: false, body: { email: byID('email').value.trim(), password: byID('password').value } });
      beginSession(session); await loadWorkspace(false);
    } catch (error) { clearSession(); setMessage(byID('login-status'), error.message, true); }
    finally { button.disabled = false; byID('password').value = ''; }
  }
  async function passkeyLogin() {
    const button = byID('passkey-login'); button.disabled = true; setMessage(byID('login-status'), '正在请求通行密钥…');
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('此浏览器不支持通行密钥。');
      const challenge = await api('passkeys/login/options', { method: 'POST', authenticated: false, body: {} });
      const credential = await navigator.credentials.get({ publicKey: requestOptions(challenge.options) });
      if (!credential) throw new Error('没有取得通行密钥。');
      const session = await api('passkeys/login/verify', { method: 'POST', authenticated: false, body: { challengeID: challenge.challengeID, credential: authenticationCredential(credential) } });
      beginSession(session); await loadWorkspace(false);
    } catch (error) { setMessage(byID('login-status'), error.name === 'NotAllowedError' ? '已取消通行密钥验证。' : error.message, true); }
    finally { button.disabled = false; }
  }
  async function registerPasskey() {
    const button = byID('register-passkey'); button.disabled = true; setMessage(byID('app-status'), '正在创建通行密钥…');
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('此浏览器不支持通行密钥。');
      const challenge = await api('passkeys/register/options', { method: 'POST', body: {} });
      const credential = await navigator.credentials.create({ publicKey: creationOptions(challenge.options) });
      if (!credential) throw new Error('没有创建通行密钥。');
      await api('passkeys/register/verify', { method: 'POST', body: { challengeID: challenge.challengeID, credential: registrationCredential(credential) } });
      setMessage(byID('app-status'), '新通行密钥已保存，可以在下次登录时使用。');
    } catch (error) { setMessage(byID('app-status'), error.name === 'NotAllowedError' ? '已取消创建通行密钥。' : error.message, true); }
    finally { button.disabled = false; }
  }
  async function logout() {
    const token = state.token; try { if (token) await api('session', { method: 'DELETE' }); } catch {}
    clearSession(); showLogin('已安全退出。', false);
  }
  function selectView(view) {
    const deadlines = view === 'deadlines'; byID('actions-tab').setAttribute('aria-selected', String(!deadlines)); byID('deadlines-tab').setAttribute('aria-selected', String(deadlines));
    byID('actions-tab').tabIndex = deadlines ? -1 : 0; byID('deadlines-tab').tabIndex = deadlines ? 0 : -1;
    byID('actions-panel').hidden = deadlines; byID('deadlines-panel').hidden = !deadlines; save('gw-view', view);
  }
  byID('password-form').addEventListener('submit', passwordLogin); byID('passkey-login').addEventListener('click', passkeyLogin);
  byID('register-passkey').addEventListener('click', registerPasskey); byID('refresh').addEventListener('click', () => loadWorkspace(false)); byID('logout').addEventListener('click', logout);
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => selectView(button.dataset.view)));
  byID('workspace-view').querySelector('.tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'ArrowLeft' || event.key === 'Home' ? byID('actions-tab') : byID('deadlines-tab');
    selectView(target.dataset.view); target.focus();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.token) loadWorkspace(true); });
  setInterval(updateCountdowns, 1000);
  setInterval(() => { if (state.token && !document.hidden) loadWorkspace(true); }, 30000);
  state.token = saved('gw-session'); state.account = saved('gw-account'); state.displayName = saved('gw-display-name'); selectView(saved('gw-view') === 'deadlines' ? 'deadlines' : 'actions');
  if (!window.PublicKeyCredential || !navigator.credentials) {
    byID('passkey-login').disabled = true; byID('passkey-login').textContent = '此浏览器不支持通行密钥';
    byID('register-passkey').disabled = true;
  }
  if (state.token) loadWorkspace(false); else showLogin('', false);
})();`;

const favicon = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#315b4c"/><path d="M20 14h24v7c0 7-4 10-8 12 4 2 8 5 8 12v6H20v-6c0-7 4-10 8-12-4-2-8-5-8-12zm6 7c0 5 3 7 6 9 3-2 6-4 6-9zm6 15c-3 2-6 4-6 9h12c0-5-3-7-6-9z" fill="#fff"/></svg>`;

const headers = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; manifest-src 'self'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
});

const assets = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: webHTML }],
  ['/index.html', { type: 'text/html; charset=utf-8', body: webHTML }],
  ['/app.css', { type: 'text/css; charset=utf-8', body: webCSS }],
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: webJS }],
  ['/favicon.svg', { type: 'image/svg+xml; charset=utf-8', body: favicon }]
]);

export function webAsset(path) {
  const asset = assets.get(path);
  return asset ? { body: asset.body, headers: { ...headers, 'Content-Type': asset.type } } : undefined;
}
