import { brandIcon } from './brand-icon.mjs';
import { accountSecurityHTML, accountSecurityCSS, accountSecurityJS } from './account-security.mjs';

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
  const overdue = target <= now;
  let seconds = Math.floor(Math.abs(target - now) / 1000);
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  const pad = value => String(value).padStart(2, '0');
  const clock = (days ? days + '天 ' : '') + pad(hours) + ':' + pad(minutes) + ':' + pad(seconds);
  return overdue ? '已逾期 ' + clock : clock;
}

export function visibleRecord(record, records) {
  if (!record || record.deletedAt || record.archivedAt) return false;
  if (!record.projectID) return true;
  const parent = records.find(value => value && value.id === record.projectID);
  return Boolean(parent && !parent.deletedAt && !parent.archivedAt);
}

export function compareActionRecords(left, right) {
  const finished = value => ['DONE', 'COMPLETED', 'CANCELLED'].includes(value?.status);
  const timestamp = value => { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; };
  const moment = record => {
    const due = effectiveDeadline(record);
    if (Number.isFinite(due)) return due;
    for (const value of [record?.remindAt, record?.scheduledAt, record?.targetDate]) {
      const parsed = Date.parse(value || '');
      if (Number.isFinite(parsed)) return parsed;
    }
    return NaN;
  };
  const pinned = Number(Boolean(right?.pinned)) - Number(Boolean(left?.pinned));
  if (pinned) return pinned;
  const completion = Number(finished(left)) - Number(finished(right));
  if (completion) return completion;
  const leftMoment = moment(left), rightMoment = moment(right);
  if (Number.isFinite(leftMoment) && Number.isFinite(rightMoment) && leftMoment !== rightMoment) return leftMoment - rightMoment;
  if (Number.isFinite(leftMoment) !== Number.isFinite(rightMoment)) return Number.isFinite(leftMoment) ? -1 : 1;
  const updated = timestamp(right?.updatedAt) - timestamp(left?.updatedAt);
  if (updated) return updated;
  const leftID = String(left?.id || ''), rightID = String(right?.id || '');
  return leftID < rightID ? -1 : leftID > rightID ? 1 : 0;
}

export function compareDeadlineRecords(left, right) {
  const finished = value => ['DONE', 'COMPLETED', 'CANCELLED'].includes(value?.status);
  const timestamp = value => { const parsed = Date.parse(value || ''); return Number.isFinite(parsed) ? parsed : 0; };
  const pinned = Number(Boolean(right?.pinned)) - Number(Boolean(left?.pinned));
  if (pinned) return pinned;
  const completion = Number(finished(left)) - Number(finished(right));
  if (completion) return completion;
  const leftMoment = effectiveDeadline(left), rightMoment = effectiveDeadline(right);
  if (Number.isFinite(leftMoment) && Number.isFinite(rightMoment) && leftMoment !== rightMoment) return leftMoment - rightMoment;
  if (Number.isFinite(leftMoment) !== Number.isFinite(rightMoment)) return Number.isFinite(leftMoment) ? -1 : 1;
  const updated = timestamp(right?.updatedAt) - timestamp(left?.updatedAt);
  if (updated) return updated;
  const leftID = String(left?.id || ''), rightID = String(right?.id || '');
  return leftID < rightID ? -1 : leftID > rightID ? 1 : 0;
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
      <img class="brand-mark" src="/app-icon.png" alt="" width="52" height="52">
      <div>
        <p class="eyebrow">WORKSPACE</p>
        <h1>工作坊</h1>
      </div>
    </header>

    <main id="main">
      <section id="login-view" class="login-grid" aria-labelledby="login-title">
        <div class="auth-card">
          <h2 id="login-title">登录工作坊</h2>
          <section id="recovery-view" hidden aria-labelledby="recovery-title">
            <p class="eyebrow">一次性账号恢复</p>
            <h3 id="recovery-title">创建新的通行密钥</h3>
            <p class="recovery-copy">此短时链接由服务器本机管理员生成。继续后使用系统验证创建通行密钥，不需要在网页输入原密码。</p>
            <button id="recover-passkey" class="primary full-width" type="button">使用系统验证继续</button>
            <button id="cancel-recovery" class="quiet full-width recovery-cancel" type="button">暂不恢复，返回普通登录</button>
            <p id="recovery-status" class="status" role="status" aria-live="polite"></p>
            <p class="privacy-note">链接只能成功使用一次，并会在十分钟后失效。通行密钥私钥始终留在系统钥匙串。</p>
          </section>
          <div id="login-options">
            <form id="password-form">
              <label for="email">账号邮箱</label>
              <input id="email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" maxlength="320" required>
              <label for="password">密码</label>
              <input id="password" name="password" type="password" autocomplete="current-password" maxlength="1024" required>
              <label id="confirm-password-label" for="confirm-password" hidden>确认密码</label>
              <input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" maxlength="1024" hidden disabled>
              <div id="login-code-field" hidden><label for="login-code">验证码</label><input id="login-code" autocomplete="one-time-code" inputmode="numeric" maxlength="32" placeholder="6 位验证码"><button id="recovery-code-toggle" class="auth-text-button" type="button">使用恢复码</button></div>
              <button id="password-submit" class="primary" type="submit">登录</button>
            </form>
            <div id="passkey-options">
              <div class="or" aria-hidden="true"><span>或</span></div>
              <button id="passkey-login" class="secondary" type="button">使用通行密钥登录</button>
            </div>
            <button id="registration-toggle" class="quiet full-width recovery-cancel" type="button">注册账号</button>
            <p id="login-status" class="status" role="status" aria-live="polite"></p>

          </div>
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

        ${accountSecurityHTML}

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

const nativeLoginHTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f2f2f7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
  <meta name="referrer" content="no-referrer">
  <title>登录工作坊</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/app.css">
  <script type="module" src="/native-login.js"></script>
</head>
<body class="native-auth-page">
  <main class="native-login-shell">
    <section class="native-login-card" aria-labelledby="native-login-title">
      <header class="auth-heading">
        <img class="auth-icon" src="/app-icon.png" alt="工作坊" width="88" height="88">
        <p class="auth-brand">工作坊</p>
        <h1 id="native-login-title">欢迎回来</h1>
        <p id="native-login-subtitle" class="auth-subtitle">让每一步，都有条理。</p>
      </header>
      <div id="native-login-options">
        <form id="native-password-form">
          <div class="native-fields">
            <div class="native-field">
              <label for="native-email">邮箱</label>
              <input id="native-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" autocorrect="off" maxlength="320" required>
            </div>
            <div class="native-field">
              <label for="native-password">密码</label>
              <input id="native-password" name="password" type="password" autocomplete="current-password" maxlength="1024" required>
            </div>
            <div id="native-confirm-field" class="native-field" hidden>
              <label for="native-confirm-password">确认</label>
              <input id="native-confirm-password" name="confirm-password" type="password" autocomplete="new-password" maxlength="1024" disabled>
            </div>
            <div id="native-code-field" class="native-field" hidden>
              <label for="native-code">验证码</label>
              <input id="native-code" name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="32" placeholder="6 位验证码">
            </div>
          </div>
          <button id="native-recovery-code-toggle" class="auth-text-button" type="button" hidden>使用恢复码</button>
          <button id="native-password-login" class="primary" type="submit">登录</button>
        </form>
        <button id="native-passkey-login" class="native-passkey" type="button">使用通行密钥</button>
        <button id="native-registration-toggle" class="auth-text-button" type="button">注册账号</button>
      </div>
      <section id="native-login-complete" hidden aria-label="登录完成">
        <p id="native-account" class="native-account"></p>
        <button id="native-add-passkey" class="native-passkey" type="button">添加通行密钥</button>
        ${accountSecurityHTML}
        <button id="native-return" class="primary" type="button">完成</button>
      </section>
      <p id="native-login-status" class="status" role="status" aria-live="polite"></p>
    </section>
  </main>
</body>
</html>`;

const webCSS = String.raw`:root {
  color-scheme: light dark;
  --paper: #f7f4ed; --surface: rgba(255,255,255,.84); --ink: #20211f; --muted: #666861;
  --line: rgba(32,33,31,.12); --accent: #6554ff; --accent-soft: #eeebff;
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
.full-width { width: 100%; }
.secondary { width: 100%; color: var(--accent); border-color: color-mix(in srgb, var(--accent) 25%, transparent); background: var(--accent-soft); }
.quiet { color: var(--ink); border-color: var(--line); background: var(--surface); }
.danger { color: var(--urgent); }
.or { display: flex; align-items: center; gap: .7rem; margin: 1.1rem 0; color: var(--muted); font-size: .78rem; }
.or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--line); }
.status { min-height: 1.35rem; margin: .9rem 0 0; color: var(--accent); font-weight: 650; }
.status.error { color: var(--urgent); }
.privacy-note { margin: 1rem 0 0; font-size: .76rem; line-height: 1.5; }
.recovery-copy { color: var(--muted); line-height: 1.65; }
.recovery-cancel { margin-top: .55rem; }
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
  :root { --paper: #171a18; --surface: rgba(33,38,35,.88); --ink: #f0f2ed; --muted: #adb3ac; --line: rgba(240,242,237,.13); --accent: #a59aff; --accent-soft: #29253f; --urgent: #ffaaa3; --urgent-soft: #4a2928; --shadow: 0 18px 60px rgba(0,0,0,.28); }
  .primary, .tabs button[aria-selected="true"] { color: white; background: #6554ff; }
}
body.native-auth-page {
  --paper: #f2f2f7; --surface: #fff; --ink: #000; --muted: #8e8e93;
  --line: rgba(60,60,67,.16); --accent: #6554ff; --urgent: #ff3b30;
  min-height: 100svh; background: var(--paper);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", system-ui, sans-serif;
  font-size: 17px; -webkit-text-size-adjust: 100%;
}
.native-login-shell { width: min(100%, 440px); margin: 0 auto; padding: max(32px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom)); }
.native-login-card { padding: 0; }
.native-login-card h1 { margin: 0; font-size: 30px; line-height: 1.2; font-weight: 700; letter-spacing: -.04em; }
.native-fields { padding: 0 16px; border-radius: 16px; background: var(--surface); }
.native-field { display: grid; grid-template-columns: 52px minmax(0,1fr); gap: 12px; align-items: center; min-height: 56px; }
.native-field + .native-field { border-top: 1px solid var(--line); }
.native-field label { margin: 0; font-size: 17px; font-weight: 400; }
.native-field input { min-width: 0; min-height: 56px; padding: 14px 0; border: 0; border-radius: 0; background: transparent; font-size: 17px; }
.native-field input:focus-visible { outline: 0; box-shadow: inset 0 -2px var(--accent); }
.native-login-card .primary { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; margin-top: 20px; padding: 14px 20px; border: 0; border-radius: 999px; color: white; background: #6554ff; font-size: 17px; line-height: 24px; font-weight: 600; }
.native-login-card button:disabled { opacity: .5; cursor: default; }
.native-passkey { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 52px; margin-top: 12px; padding: 14px 20px; border: 0; border-radius: 999px; color: var(--ink); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); font-size: 17px; line-height: 24px; font-weight: 600; }
.native-account { margin: 0; color: var(--muted); line-height: 1.5; overflow-wrap: anywhere; }
.native-login-card .status { min-height: 0; margin: 16px 0 0; font-size: 14px; line-height: 1.5; font-weight: 400; }
.native-login-card .status:empty { display: none; }

.auth-heading { text-align: center; margin: 8px 0 32px; }
.auth-icon { display: block; margin: 0 auto 20px; border-radius: 22px; box-shadow: 0 12px 32px rgba(0,160,255,.16); }
.auth-brand { color: var(--muted); font-size: 14px; font-weight: 600; margin: 0 0 8px; }
.auth-subtitle { color: var(--muted); font-size: 15px; margin: 12px 0 0; line-height: 1.5; }
.auth-text-button { display: block; width: 100%; min-height: 44px; margin-top: 8px; border: 0; padding: 10px; background: transparent; color: var(--accent); font-size: 15px; }
.login-grid { display: block; max-width: 420px; margin: 0 auto; }
.auth-card h2 { font-size: 28px; margin: 0 0 24px; text-align: center; }
.auth-card .primary, .auth-card .secondary { width: 100%; min-height: 52px; border-radius: 999px; line-height: 24px; font-size: 17px; }
.auth-card .secondary { color: var(--ink); background: var(--surface); border-color: var(--line); }
.auth-card #registration-toggle { border: 0; background: transparent; color: var(--accent); box-shadow: none; }
body:has(#login-view:not([hidden])) .site-header { justify-content: center; padding: 16px 0 28px; }
body:has(#login-view:not([hidden])) .brand-mark { width: 64px; height: 64px; padding: 0; border-radius: 16px; }
.native-login-card .native-account { text-align: center; margin-bottom: 16px; }
${accountSecurityCSS}
@media (prefers-color-scheme: dark) {
  body.native-auth-page { --paper: #000; --surface: #1c1c1e; --ink: #fff; --muted: #98989e; --line: rgba(84,84,88,.65); --accent: #a59aff; --urgent: #ff453a; }
}`;

const effectiveDeadlineSource = effectiveDeadline.toString();
const formatCountdownSource = formatCountdown.toString();
const visibleRecordSource = visibleRecord.toString();
const compareActionRecordsSource = compareActionRecords.toString();
const compareDeadlineRecordsSource = compareDeadlineRecords.toString();
const webJS = String.raw`(() => {
  'use strict';
  ${accountSecurityJS}
  const effectiveDeadline = ${effectiveDeadlineSource};
  const formatCountdown = ${formatCountdownSource};
  const visibleRecord = ${visibleRecordSource};
  const compareActionRecords = ${compareActionRecordsSource};
  const compareDeadlineRecords = ${compareDeadlineRecordsSource};
  const state = { token: '', account: '', displayName: '', workspace: null, revision: null, loadingToken: '', recoveryToken: '', registration: false, authBusy: false };
  const finished = new Set(['DONE', 'COMPLETED', 'CANCELLED']);
  const actionKinds = new Set(['PROJECT', 'TASK', 'MILESTONE', 'REMINDER']);
  const kindNames = { PROJECT: '行动组', TASK: '行动', MILESTONE: '里程碑', REMINDER: '提醒', DEADLINE: 'DDL' };
  const statusNames = { PLANNED: '计划中', ACTIVE: '进行中', WAITING: '等待中', PAUSED: '已暂停', COMPLETED: '已完成', TODO: '待行动', IN_PROGRESS: '进行中', DONE: '已完成', CANCELLED: '已取消', OPEN: '待处理' };
  const errorNames = { SECOND_FACTOR_REQUIRED: '请输入「密码」中的验证码或恢复码。', INVALID_SECOND_FACTOR: '验证码或恢复码不正确，请重试。', INVALID_CREDENTIALS: '账号或密码不正确。', INVALID_EMAIL: '请输入有效的邮箱。', INVALID_PASSWORD: '密码需要 8–1024 个字符。', ACCOUNT_EXISTS: '此邮箱已注册，请登录。', INVALID_REGISTRATION: '请检查邮箱和密码。', UNAUTHENTICATED: '会话已失效，请重新登录。', INVALID_PASSKEY: '通行密钥验证失败。', INVALID_CHALLENGE: '验证请求已过期，请重试。', INVALID_RECOVERY_TOKEN: '一次性恢复链接无效或已经过期。', PASSKEY_LIMIT: '此账号已达到通行密钥数量上限。', PASSKEY_EXISTS: '这枚通行密钥已经注册。', RATE_LIMITED: '尝试次数过多，请稍后再试。' };
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
    security.reset();
    state.token = ''; state.account = ''; state.displayName = ''; state.workspace = null; state.revision = null;
    save('gw-session', ''); save('gw-account', ''); save('gw-display-name', '');
  }
  function beginSession(session) {
    if (!session || typeof session.accessToken !== 'string' || !session.accessToken) throw new Error('服务器没有返回有效会话。');
    state.token = session.accessToken; state.account = session.account || ''; state.displayName = session.displayName || '';
    save('gw-session', state.token); save('gw-account', state.account); save('gw-display-name', state.displayName);
    security.reset(); security.refresh();
  }
  function recoveryFromLocation() {
    const parameters = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const supplied = parameters.get('passkey-recovery');
    if (supplied !== null) history.replaceState(null, '', location.pathname + location.search);
    if (supplied === null) return { token: '', invalid: false };
    return /^[A-Za-z0-9_-]{43}$/.test(supplied) ? { token: supplied, invalid: false } : { token: '', invalid: true };
  }
  function showLogin(message, error) {
    if (state.registration && !state.authBusy) setRegistration(false);
    byID('workspace-view').hidden = true; byID('login-view').hidden = false;
    byID('recovery-view').hidden = true; byID('login-options').hidden = false;
    setMessage(byID('login-status'), message || '', error); byID('password').value = '';
    byID('login-code-field').hidden = true; byID('login-code').value = '';
  }
  function showRecovery(message, error) {
    byID('workspace-view').hidden = true; byID('login-view').hidden = false;
    byID('login-options').hidden = true; byID('recovery-view').hidden = false;
    setMessage(byID('recovery-status'), message || '', error);
  }
  function showWorkspace() {
    byID('login-view').hidden = true; byID('workspace-view').hidden = false;
    byID('account-label').textContent = state.displayName ? state.displayName + ' · ' + state.account : state.account;
  }
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
    const target = effectiveDeadline(record); const isFinished = finished.has(record.status); const overdue = !isFinished && Number.isFinite(target) && target <= Date.now();
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
    const allRecords = state.workspace && Array.isArray(state.workspace.records) ? state.workspace.records : [];
    const records = allRecords.filter(record => visibleRecord(record, allRecords));
    const actions = records.filter(record => actionKinds.has(record.kind)).sort(compareActionRecords);
    const deadlines = records.filter(record => record.kind === 'DEADLINE').sort(compareDeadlineRecords);
    const actionList = byID('actions-list'); actionList.replaceChildren(...(actions.length ? actions.map(recordCard) : [empty('目前没有行动。')]));
    const deadlineList = byID('deadlines-list'); deadlineList.replaceChildren(...(deadlines.length ? deadlines.map(deadlineCard) : [empty('目前没有 DDL。')]));
    const overdue = deadlines.filter(record => !finished.has(record.status) && effectiveDeadline(record) <= Date.now()).length;
    byID('action-count').textContent = String(actions.length); byID('deadline-count').textContent = String(deadlines.length);
    byID('overdue-badge').hidden = overdue === 0; byID('overdue-badge').textContent = overdue + ' 逾期'; updateCountdowns();
  }
  function updateCountdowns() {
    document.querySelectorAll('.countdown[data-target]').forEach(node => {
      const target = Number(node.dataset.target); node.textContent = formatCountdown(target);
      node.closest('.record-card').classList.toggle('overdue', target <= Date.now());
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
  function setRegistration(value) {
    if (state.authBusy) return;
    state.registration = value;
    byID('login-title').textContent = value ? '创建账号' : '登录工作坊';
    byID('login-code-field').hidden = true; byID('login-code').value = '';
    byID('password-submit').textContent = value ? '注册账号' : '登录';
    byID('registration-toggle').textContent = value ? '已有账号？登录' : '注册账号';
    byID('password').autocomplete = value ? 'new-password' : 'current-password';
    byID('password').minLength = value ? 8 : 0;
    byID('password').placeholder = value ? '至少 8 个字符' : '';
    byID('confirm-password-label').hidden = !value;
    byID('confirm-password').hidden = !value;
    byID('confirm-password').disabled = !value;
    byID('confirm-password').required = value;
    byID('passkey-options').hidden = value;
    byID('password').value = ''; byID('confirm-password').value = '';
    setMessage(byID('login-status'), '');
  }
  function setAuthBusy(value) {
    state.authBusy = value;
    for (const id of ['email', 'password', 'login-code', 'password-submit', 'registration-toggle']) byID(id).disabled = value;
    byID('confirm-password').disabled = value || !state.registration;
    byID('passkey-login').disabled = value || !window.PublicKeyCredential || !navigator.credentials;
  }
  const security = installAccountSecurity({ api: (path, body, method = 'POST') => api(path, { body, method }),
    onBusy: value => { byID('logout').disabled = value; byID('register-passkey').disabled = value || !window.PublicKeyCredential; } });
  async function passwordLogin(event) {
    event.preventDefault();
    if (state.authBusy) return;
    const email = byID('email').value.trim(), password = byID('password').value, registering = state.registration;
    if (registering && password !== byID('confirm-password').value) {
      setMessage(byID('login-status'), '两次输入的密码不一致。', true); return;
    }
    setAuthBusy(true); let needsCode = false;
    setMessage(byID('login-status'), registering ? '正在注册…' : '正在登录…');
    try {
      const code = byID('login-code').value.trim();
      const session = await api(registering ? 'accounts' : 'session', { method: 'POST', authenticated: false, body: { email, password, ...(!registering && code ? { code } : {}) } });
      beginSession(session); await loadWorkspace(false);
      if (registering && state.token) {
        setMessage(byID('app-status'), '账号已创建，可添加通行密钥，或在账户安全中设置验证码。');
        byID('register-passkey').focus();
      }
    } catch (error) {
      needsCode = ['SECOND_FACTOR_REQUIRED', 'INVALID_SECOND_FACTOR'].includes(error.code);
      clearSession();
      if (needsCode) { byID('login-code-field').hidden = false; byID('login-code').value = ''; }
      setMessage(byID('login-status'), error.message, true);
    } finally {
      setAuthBusy(false);
      if (!needsCode) { byID('password').value = ''; byID('login-code').value = ''; }
      else byID('login-code').focus();
      byID('confirm-password').value = '';
    }
  }
  async function passkeyLogin() {
    if (state.authBusy) return; setAuthBusy(true); setMessage(byID('login-status'), '正在请求通行密钥…');
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('此浏览器不支持通行密钥。');
      const challenge = await api('passkeys/login/options', { method: 'POST', authenticated: false, body: {} });
      const credential = await navigator.credentials.get({ publicKey: requestOptions(challenge.options) });
      if (!credential) throw new Error('没有取得通行密钥。');
      const session = await api('passkeys/login/verify', { method: 'POST', authenticated: false, body: { challengeID: challenge.challengeID, credential: authenticationCredential(credential) } });
      beginSession(session); await loadWorkspace(false);
    } catch (error) { setMessage(byID('login-status'), error.name === 'NotAllowedError' ? '已取消通行密钥验证。' : error.message, true); }
    finally { setAuthBusy(false); }
  }
  async function registerPasskey() {
    const button = byID('register-passkey'); button.disabled = true; byID('security-panel').inert = true; setMessage(byID('app-status'), '正在创建通行密钥…');
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('此浏览器不支持通行密钥。');
      const challenge = await api('passkeys/register/options', { method: 'POST', body: {} });
      const credential = await navigator.credentials.create({ publicKey: creationOptions(challenge.options) });
      if (!credential) throw new Error('没有创建通行密钥。');
      await api('passkeys/register/verify', { method: 'POST', body: { challengeID: challenge.challengeID, credential: registrationCredential(credential) } });
      setMessage(byID('app-status'), '新通行密钥已保存，可以在下次登录时使用。');
    } catch (error) { setMessage(byID('app-status'), error.name === 'NotAllowedError' ? '已取消创建通行密钥。' : error.message, true); }
    finally { button.disabled = false; byID('security-panel').inert = false; }
  }
  async function recoverPasskey() {
    const button = byID('recover-passkey'); button.disabled = true; setMessage(byID('recovery-status'), '正在准备系统验证…');
    try {
      if (!state.recoveryToken) throw Object.assign(new Error(errorNames.INVALID_RECOVERY_TOKEN), { code: 'INVALID_RECOVERY_TOKEN' });
      if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('此浏览器不支持通行密钥。');
      const challenge = await api('passkeys/recovery/options', { method: 'POST', authenticated: false, body: { token: state.recoveryToken } });
      const credential = await navigator.credentials.create({ publicKey: creationOptions(challenge.options) });
      if (!credential) throw new Error('没有创建通行密钥。');
      const session = await api('passkeys/recovery/verify', { method: 'POST', authenticated: false,
        body: { token: state.recoveryToken, challengeID: challenge.challengeID, credential: registrationCredential(credential) } });
      state.recoveryToken = ''; beginSession(session); await loadWorkspace(false);
      setMessage(byID('app-status'), '新通行密钥已创建并完成登录。');
    } catch (error) {
      const message = error.name === 'NotAllowedError' ? '已取消创建通行密钥；恢复链接在有效期内仍可重试。' : error.message;
      if (error.code === 'INVALID_RECOVERY_TOKEN') { state.recoveryToken = ''; showLogin(message, true); }
      else setMessage(byID('recovery-status'), message, true);
    } finally { button.disabled = false; }
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
  byID('recovery-code-toggle').addEventListener('click', () => {
    const input = byID('login-code'), recovery = input.inputMode !== 'text';
    input.inputMode = recovery ? 'text' : 'numeric'; input.autocomplete = recovery ? 'off' : 'one-time-code';
    input.placeholder = recovery ? 'XXXX-XXXX-XXXX-XXXX' : '6 位验证码'; input.value = '';
    byID('recovery-code-toggle').textContent = recovery ? '使用验证码' : '使用恢复码'; input.focus();
  });
  byID('registration-toggle').addEventListener('click', () => setRegistration(!state.registration));
  byID('password-form').addEventListener('submit', passwordLogin); byID('passkey-login').addEventListener('click', passkeyLogin);
  byID('recover-passkey').addEventListener('click', recoverPasskey);
  byID('cancel-recovery').addEventListener('click', () => { state.recoveryToken = ''; showLogin('', false); });
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
  const recovery = recoveryFromLocation(); state.recoveryToken = recovery.token;
  state.token = saved('gw-session'); state.account = saved('gw-account'); state.displayName = saved('gw-display-name'); selectView(saved('gw-view') === 'deadlines' ? 'deadlines' : 'actions');
  if (!window.PublicKeyCredential || !navigator.credentials) {
    byID('passkey-login').disabled = true; byID('passkey-login').textContent = '此浏览器不支持通行密钥';
    byID('register-passkey').disabled = true; byID('recover-passkey').disabled = true;
    byID('recover-passkey').textContent = '此浏览器不支持通行密钥';
  }
  if (state.recoveryToken) showRecovery('', false);
  else if (recovery.invalid) showLogin('一次性恢复链接格式无效。', true);
  else if (state.token) loadWorkspace(false); else showLogin('', false);
})();`;

// A separate, memory-only client keeps browser-to-app authorization independent
// of the read-only website's tab session and workspace data.
const nativeLoginJS = String.raw`(() => {
  'use strict';
  ${accountSecurityJS}
  const byID = id => document.getElementById(id);
  const parameters = new URLSearchParams(location.search);
  const codeChallenge = parameters.get('code_challenge'), requestState = parameters.get('state');
  const valid = /^[A-Za-z0-9_-]{43}$/;
  const errorNames = { SECOND_FACTOR_REQUIRED: '请输入「密码」中的验证码或恢复码。', INVALID_SECOND_FACTOR: '验证码或恢复码不正确，请重试。', INVALID_CREDENTIALS: '账号或密码不正确。', INVALID_EMAIL: '请输入有效的邮箱。', INVALID_PASSWORD: '密码需要 8–1024 个字符。', ACCOUNT_EXISTS: '此邮箱已注册，请登录。', INVALID_REGISTRATION: '请检查邮箱和密码。', UNAUTHENTICATED: '验证已失效，请重新登录。',
    INVALID_PASSKEY: '通行密钥验证失败。', INVALID_CHALLENGE: '验证请求已过期，请重试。',
    INVALID_WEB_AUTH_REQUEST: '登录请求无效，请返回 App 重新开始。', INVALID_ORIGIN: '请从工作坊打开此登录页。',
    RATE_LIMITED: '尝试次数过多，请稍后再试。' };
  let temporaryToken = '', callbackURL = '', busy = false, expiresAt = 0, registration = false, pendingSession = null, securityBusy = false, disposed = false;
  function message(text, error = false) { byID('native-login-status').textContent = text; byID('native-login-status').classList.toggle('error', error); }
  function setBusy(value) {
    busy = value;
    byID('native-password-login').disabled = value;
    byID('native-password-login').textContent = value ? (registration ? '正在注册…' : '正在登录…') : (registration ? '注册账号' : '登录');
    byID('native-email').disabled = value;
    byID('native-password').disabled = value;
    byID('native-code').disabled = value;
    byID('native-confirm-password').disabled = value || !registration;
    byID('native-registration-toggle').disabled = value;
    byID('native-passkey-login').disabled = value || !window.PublicKeyCredential || !navigator.credentials;
  }
  async function api(path, body, token = '', method = 'POST', keepalive = false) {
    const response = await fetch('/api/native/v1/' + path, { method, cache: 'no-store', credentials: 'omit', redirect: 'error', keepalive,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    let envelope; try { envelope = await response.json(); } catch {}
    if (!response.ok) { const error = new Error(errorNames[envelope?.error?.code] || '连接暂时不可用，请重试。'); error.code = envelope?.error?.code; throw error; }
    return envelope?.data;
  }
  function bytes(value) {
    const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  function base64url(value) {
    let binary = ''; for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
  }
  function assertion(credential) {
    return { id: credential.id, rawId: base64url(credential.rawId), type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined, clientExtensionResults: credential.getClientExtensionResults(),
      response: { clientDataJSON: base64url(credential.response.clientDataJSON), authenticatorData: base64url(credential.response.authenticatorData),
        signature: base64url(credential.response.signature), userHandle: credential.response.userHandle ? base64url(credential.response.userHandle) : null } };
  }
  async function clearTemporarySession() {
    const token = temporaryToken; temporaryToken = '';
    if (token) { try { await api('session', undefined, token, 'DELETE', true); } catch {} }
  }
  async function authorize(session) {
    if (!session || typeof session.accessToken !== 'string' || !session.accessToken) throw new Error('服务器未返回有效会话。');
    if (disposed) { await api('session', undefined, session.accessToken, 'DELETE', true).catch(() => {}); throw new Error('登录页面已关闭。'); }
    temporaryToken = session.accessToken;
    const result = await api('web-auth/authorize', { codeChallenge, state: requestState }, temporaryToken);
    // The server revokes the browser bearer in the same transaction that issues
    // this short-lived code. Never put the bearer into a URL or browser storage.
    temporaryToken = '';
    if (disposed) throw new Error('登录页面已关闭。');
    const callback = new URL(result.callbackURL);
    if (callback.protocol !== 'guangyi-workspace:' || callback.hostname !== 'auth' || callback.pathname !== '/callback' ||
      callback.username || callback.password || callback.port || callback.hash ||
      [...callback.searchParams.keys()].length !== 2 || callback.searchParams.getAll('code').length !== 1 || callback.searchParams.getAll('state').length !== 1 ||
      !valid.test(callback.searchParams.get('code') || '') || callback.searchParams.get('state') !== requestState) throw new Error('返回链接无效，请返回 App 重新开始。');
    callbackURL = callback.href; expiresAt = Date.now() + 90000;
    byID('native-login-options').hidden = true; byID('native-login-complete').hidden = false;
    byID('native-login-title').textContent = '已登录';
    byID('native-login-subtitle').textContent = '准备好了，继续你的工作坊。';
    byID('native-account').textContent = session.account || session.displayName || '';
    message('');
    byID('native-return').focus();
  }
  const security = installAccountSecurity({ api: (path, body, method = 'POST') => api(path, body, temporaryToken, method),
    onBusy: value => { securityBusy = value; byID('native-return').disabled = value || busy; byID('native-add-passkey').disabled = value || busy || !window.PublicKeyCredential; } });
  async function showEnrollment(session) {
    if (!session?.accessToken) throw new Error('服务器未返回有效会话。');
    temporaryToken = session.accessToken; pendingSession = session;
    byID('native-login-options').hidden = true; byID('native-login-complete').hidden = false;
    byID('native-login-title').textContent = registration ? '账号已创建' : '已登录';
    byID('native-login-subtitle').textContent = '添加通行密钥，下次登录更轻松。';
    byID('native-account').textContent = session.account;
    byID('native-add-passkey').hidden = false; byID('security-panel').hidden = false;
    await security.refresh();
  }
  async function login(work, offerSecurity = false) {
    if (busy) return; setBusy(true); message(''); let needsCode = false;
    try {
      const session = await work();
      if (disposed) { if (session?.accessToken) await api('session', undefined, session.accessToken, 'DELETE', true).catch(() => {}); return; }
      if (offerSecurity) await showEnrollment(session);
      else { byID('native-add-passkey').hidden = true; byID('security-panel').hidden = true; await authorize(session); }
    } catch (error) {
      needsCode = ['SECOND_FACTOR_REQUIRED', 'INVALID_SECOND_FACTOR'].includes(error.code);
      if (needsCode) { byID('native-code-field').hidden = false; byID('native-recovery-code-toggle').hidden = false; byID('native-code').value = ''; }
      message(error.name === 'NotAllowedError' ? '已取消登录。' : error.message, true);
    } finally {
      if (!needsCode) { byID('native-password').value = ''; byID('native-code').value = ''; }
      byID('native-confirm-password').value = '';
      if (!pendingSession) await clearTemporarySession();
      setBusy(false);
      byID('native-return').disabled = securityBusy;
      byID('native-add-passkey').disabled = securityBusy || !window.PublicKeyCredential;
      if (needsCode) byID('native-code').focus();
    }
  }
  byID('native-password-form').addEventListener('submit', event => {
    event.preventDefault();
    const email = byID('native-email').value.trim(), password = byID('native-password').value;
    if (registration && password !== byID('native-confirm-password').value) {
      message('两次输入的密码不一致。', true); return;
    }
    const code = byID('native-code').value.trim();
    login(() => api(registration ? 'accounts' : 'session', { email, password, ...(!registration && code ? { code } : {}) }), true);
  });
  byID('native-recovery-code-toggle').addEventListener('click', () => {
    const input = byID('native-code'), recovery = input.inputMode !== 'text';
    input.inputMode = recovery ? 'text' : 'numeric'; input.autocomplete = recovery ? 'off' : 'one-time-code';
    input.placeholder = recovery ? 'XXXX-XXXX-XXXX-XXXX' : '6 位验证码'; input.value = '';
    byID('native-recovery-code-toggle').textContent = recovery ? '使用验证码' : '使用恢复码'; input.focus();
  });
  byID('native-registration-toggle').addEventListener('click', () => {
    if (busy) return;
    registration = !registration;
    byID('native-login-title').textContent = registration ? '开始你的工作坊' : '欢迎回来';
    byID('native-login-subtitle').textContent = registration ? '从这里，开始有条理的每一天。' : '让每一步，都有条理。';
    byID('native-code-field').hidden = true; byID('native-recovery-code-toggle').hidden = true; byID('native-code').value = '';
    byID('native-password').autocomplete = registration ? 'new-password' : 'current-password';
    byID('native-password').minLength = registration ? 8 : 0;
    byID('native-password').placeholder = registration ? '至少 8 个字符' : '';
    byID('native-confirm-field').hidden = !registration;
    byID('native-confirm-password').required = registration;
    byID('native-passkey-login').hidden = registration;
    byID('native-registration-toggle').textContent = registration ? '已有账号？登录' : '注册账号';
    byID('native-password').value = ''; byID('native-confirm-password').value = '';
    message(''); setBusy(false);
  });
  byID('native-passkey-login').addEventListener('click', () => login(async () => {
    if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('此浏览器不支持通行密钥，请使用账号密码。');
    const challenge = await api('passkeys/login/options', {});
    const options = { ...challenge.options, challenge: bytes(challenge.options.challenge),
      allowCredentials: (challenge.options.allowCredentials || []).map(value => ({ ...value, id: bytes(value.id) })) };
    const credential = await navigator.credentials.get({ publicKey: options });
    if (!credential) throw new Error('未取得通行密钥，请重试。');
    return api('passkeys/login/verify', { challengeID: challenge.challengeID, credential: assertion(credential) });
  }));
  byID('native-add-passkey').addEventListener('click', async () => {
    if (busy || securityBusy || !temporaryToken) return;
    busy = true; byID('security-panel').inert = true; byID('native-add-passkey').disabled = true; byID('native-return').disabled = true; message('');
    try {
      const challenge = await api('passkeys/register/options', {}, temporaryToken);
      const options = { ...challenge.options, challenge: bytes(challenge.options.challenge), user: { ...challenge.options.user, id: bytes(challenge.options.user.id) },
        excludeCredentials: (challenge.options.excludeCredentials || []).map(value => ({ ...value, id: bytes(value.id) })) };
      const credential = await navigator.credentials.create({ publicKey: options });
      if (!credential) throw new Error('未创建通行密钥，请重试。');
      const proof = { id: credential.id, rawId: base64url(credential.rawId), type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment || undefined, clientExtensionResults: credential.getClientExtensionResults(),
        response: { clientDataJSON: base64url(credential.response.clientDataJSON), attestationObject: base64url(credential.response.attestationObject),
          transports: typeof credential.response.getTransports === 'function' ? credential.response.getTransports() : undefined } };
      await api('passkeys/register/verify', { challengeID: challenge.challengeID, credential: proof }, temporaryToken);
      byID('native-add-passkey').textContent = '通行密钥已添加'; message('下次可使用通行密钥登录。');
    } catch (error) { message(error.name === 'NotAllowedError' ? '已取消添加，可继续完成注册。' : error.message, true); }
    finally { busy = false; byID('security-panel').inert = false; byID('native-add-passkey').disabled = securityBusy; byID('native-return').disabled = securityBusy; }
  });
  byID('native-return').addEventListener('click', async () => {
    if (busy || securityBusy) return;
    if (pendingSession) {
      busy = true; byID('native-return').disabled = true;
      try { await authorize(pendingSession); pendingSession = null; security.reset(); }
      catch (error) { message(error.message, true); return; }
      finally { busy = false; byID('native-return').disabled = securityBusy; }
    }
    if (!callbackURL || Date.now() >= expiresAt) { callbackURL = ''; byID('native-return').disabled = true; message('登录已过期，请关闭后重试。', true); return; }
    location.assign(callbackURL);
  });
  window.addEventListener('pagehide', () => { disposed = true; byID('native-password').value = ''; byID('native-confirm-password').value = ''; byID('native-code').value = ''; security.reset(); pendingSession = null; clearTemporarySession(); });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  setBusy(false);
  if (parameters.get('code_challenge_method') !== 'S256' || !valid.test(codeChallenge || '') || !valid.test(requestState || '') ||
    [...parameters.keys()].length !== 3 || ['code_challenge', 'code_challenge_method', 'state'].some(key => parameters.getAll(key).length !== 1)) {
    byID('native-login-options').hidden = true; message('登录请求无效，请返回 App 重新开始。', true);
  }
})();`;

const favicon = String.raw`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#00fdff"/><stop offset="1" stop-color="#0096ff"/></linearGradient></defs><rect width="120" height="120" rx="28" fill="url(#b)"/><g fill="white"><rect x="21" y="43" width="20" height="52" rx="10"/><rect x="51" y="24" width="20" height="71" rx="10"/><rect x="81" y="53" width="20" height="42" rx="10"/></g></svg>`;

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
  ['/app-icon.png', { type: 'image/png', body: brandIcon }],
  ['/', { type: 'text/html; charset=utf-8', body: webHTML }],
  ['/index.html', { type: 'text/html; charset=utf-8', body: webHTML }],
  ['/native-login', { type: 'text/html; charset=utf-8', body: nativeLoginHTML }],
  ['/native-login.js', { type: 'text/javascript; charset=utf-8', body: nativeLoginJS }],
  ['/app.css', { type: 'text/css; charset=utf-8', body: webCSS }],
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: webJS }],
  ['/favicon.svg', { type: 'image/svg+xml; charset=utf-8', body: favicon }]
]);

export function webAsset(path) {
  const asset = assets.get(path);
  return asset ? { body: asset.body, headers: { ...headers, 'Content-Type': asset.type } } : undefined;
}
