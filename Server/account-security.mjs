// Shared browser UI for the optional authenticator setup. Secrets remain only
// in the visible setup panel and are removed on acknowledgement or sign-out.
export const accountSecurityHTML = String.raw`
<details id="security-panel" class="account-security">
  <summary>账户安全<span id="security-state"></span></summary>
  <div class="security-content">
    <div id="security-off" hidden>
      <p>用「密码」或其他验证器生成登录验证码。</p>
      <button id="security-setup" type="button" class="security-primary">设置验证码</button>
    </div>
    <div id="security-setup-view" hidden>
      <p>保存到验证器后，输入生成的六位验证码。</p>
      <a id="security-apple" class="security-button security-primary" aria-disabled="true">添加到「密码」</a>
      <details class="security-manual"><summary>手动添加</summary><code id="security-secret" tabindex="0"></code></details>
      <label for="security-confirm-code">验证码</label>
      <input id="security-confirm-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" aria-label="验证码" required>
      <button id="security-enable" type="button" class="security-primary">确认开启</button>
      <button id="security-cancel" type="button" class="security-secondary">取消</button>
    </div>
    <div id="security-recovery-view" hidden>
      <p>保存这些恢复码。无法获取验证码时，每个恢复码可用于登录一次。</p>
      <div id="security-recovery-codes" class="security-recovery-codes"></div>
      <button id="security-saved" type="button" class="security-primary">已保存恢复码</button>
    </div>
    <div id="security-on" hidden>
      <p>验证码已开启</p>
      <details id="security-disable-details"><summary>关闭验证码</summary>
        <label for="security-disable-code">验证码或恢复码</label>
        <input id="security-disable-code" type="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="64" placeholder="验证码或恢复码">
        <button id="security-disable" type="button" class="security-secondary">确认关闭</button>
      </details>
    </div>
    <p id="security-message" class="security-message" role="status" aria-live="polite"></p>
  </div>
</details>`;

export const accountSecurityCSS = String.raw`
.account-security { margin: 20px 0 0; color: var(--ink, #17171b); text-align: left; }
.account-security > summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; padding: 12px 0; font-size: 15px; font-weight: 600; }
.account-security > summary::after { content: '+'; color: var(--muted, #77777d); font-size: 20px; font-weight: 400; }
.account-security[open] > summary::after { content: '−'; }
.account-security > summary::-webkit-details-marker { display: none; }
#security-state { margin-left: auto; color: var(--muted, #77777d); font-size: 13px; font-weight: 400; }
.security-content { padding: 0 0 4px; }
.account-security p { margin: 8px 0 14px; color: var(--muted, #77777d); font-size: 14px; line-height: 1.6; }
.account-security button, .account-security .security-button { box-sizing: border-box; display: flex; width: 100%; min-height: 50px; align-items: center; justify-content: center; margin: 10px 0 0; padding: 12px 18px; border: 0; border-radius: 999px; font: inherit; font-size: 15px; font-weight: 600; text-align: center; text-decoration: none; cursor: pointer; }
.account-security .security-primary { background: var(--accent, #6554ff); color: #fff; }
.account-security .security-secondary { background: rgba(120,120,128,.12); color: var(--ink, #17171b); }
.account-security button:disabled, .account-security a[aria-disabled="true"] { opacity: .5; cursor: default; }
.account-security a[aria-disabled="true"] { pointer-events: none; }
.account-security label { display: block; margin: 16px 0 6px; font-size: 14px; }
.account-security input { box-sizing: border-box; width: 100%; min-height: 50px; padding: 12px 16px; border: 1px solid var(--line, rgba(60,60,67,.16)); border-radius: 14px; background: var(--surface, #fff); color: var(--ink, #17171b); font: inherit; font-size: 16px; }
.account-security input:focus-visible, .account-security a:focus-visible, .account-security summary:focus-visible { outline: 3px solid var(--accent, #6554ff); outline-offset: 3px; }
.account-security input[aria-invalid="true"] { border-color: var(--urgent, #d93933); }
.security-manual, #security-disable-details { margin-top: 16px; font-size: 14px; }
.security-manual summary, #security-disable-details > summary { cursor: pointer; color: var(--muted, #77777d); }
.security-manual code, .security-recovery-codes code { display: block; padding: 12px; border-radius: 12px; background: rgba(120,120,128,.09); color: var(--ink, #17171b); font: 14px/1.7 ui-monospace, monospace; overflow-wrap: anywhere; user-select: all; -webkit-user-select: all; }
.security-manual code { margin-top: 10px; }
.security-recovery-codes { display: grid; gap: 6px; margin: 14px 0; }
.security-recovery-codes code { padding: 6px 12px; text-align: center; }
.account-security .security-message { min-height: 0; margin: 12px 0 0; }
.account-security .security-message:empty { display: none; }
.account-security .security-message[data-error="true"] { color: var(--urgent, #d93933); }
.account-security [hidden] { display: none !important; }
@media (prefers-color-scheme: dark) {
  .account-security .security-primary { color: #fff; background: #7563ff; }
}`;

function installAccountSecurity({ api, message = () => {}, onBusy = () => {} }) {
  const find = id => document.getElementById('security-' + id);
  const panel = find('panel');
  if (!panel) return { reset() {}, async refresh() {} };
  const state = find('state'), note = find('message');
  const off = find('off'), setup = find('setup-view'), recovery = find('recovery-view'), on = find('on');
  const confirmCode = find('confirm-code'), disableCode = find('disable-code');
  const apple = find('apple'), secret = find('secret'), codes = find('recovery-codes');
  let enabled = null, mode = 'idle', appleURI = '', busy = false, generation = 0, reportedBusy = false;

  function notify(text = '', error = false) {
    note.textContent = text;
    note.dataset.error = String(error);
    message(text, error);
  }
  function render() {
    off.hidden = enabled !== false || mode !== 'idle';
    setup.hidden = mode !== 'setup';
    recovery.hidden = mode !== 'recovery';
    on.hidden = enabled !== true || mode !== 'idle';
    state.textContent = enabled === true ? '已开启' : '';
    for (const control of panel.querySelectorAll('button, input')) control.disabled = busy;
    const canOpen = !busy && mode === 'setup' && Boolean(appleURI);
    apple.setAttribute('aria-disabled', String(!canOpen));
    apple.tabIndex = canOpen ? 0 : -1;
    if (canOpen) apple.setAttribute('href', appleURI);
    else apple.removeAttribute('href');
    // Hosts keep their Done/navigation action disabled until the only copy of
    // the recovery codes has been explicitly acknowledged.
    const shouldHold = busy || mode === 'recovery';
    if (shouldHold !== reportedBusy) {
      reportedBusy = shouldHold;
      onBusy(shouldHold);
    }
  }
  function clearSetup() {
    appleURI = '';
    secret.textContent = '';
    confirmCode.value = '';
    confirmCode.removeAttribute('aria-invalid');
    panel.querySelector('.security-manual').open = false;
    apple.removeAttribute('href');
  }
  function clearRecovery() {
    codes.replaceChildren();
  }
  function errorMessage(error) {
    const names = {
      INVALID_SECOND_FACTOR: '验证码或恢复码不正确，请重试。',
      INVALID_TOTP_CODE: '请输入六位验证码。',
      INVALID_TOTP_REQUEST: '请检查验证码后重试。',
      SECOND_FACTOR_REQUIRED: '请输入验证码或恢复码。',
      TOTP_SETUP_EXPIRED: '设置已过期，请重新开始。',
      TOTP_ALREADY_ENABLED: '验证码已开启，请刷新后重试。',
      RATE_LIMITED: '尝试次数较多，请稍后再试。',
      UNAUTHENTICATED: '请重新登录。'
    };
    return names[error?.code] || error?.message || '操作未完成，请稍后再试。';
  }
  async function perform(action) {
    if (busy) return;
    const ticket = generation;
    busy = true;
    render();
    notify();
    try {
      await action(() => ticket === generation);
    } catch (error) {
      if (ticket === generation) {
        if (error?.code === 'TOTP_SETUP_EXPIRED') {
          clearSetup();
          mode = 'idle';
        }
        notify(errorMessage(error), true);
      }
    } finally {
      if (ticket === generation) {
        busy = false;
        render();
      }
    }
  }
  find('setup').addEventListener('click', () => perform(async current => {
    const result = await api('totp/setup', {});
    if (!current()) return;
    const uri = new URL(result.appleURI);
    if (typeof result.secret !== 'string' || !/^[A-Z2-7]+$/.test(result.secret)
        || uri.protocol !== 'apple-otpauth:' || uri.hostname !== 'totp') {
      throw new Error('无法读取设置，请重试。');
    }
    clearSetup();
    clearRecovery();
    secret.textContent = result.secret;
    appleURI = uri.href;
    mode = 'setup';
    render();
  }));
  find('enable').addEventListener('click', () => {
    const code = confirmCode.value.trim();
    if (!/^[0-9]{6}$/.test(code)) {
      confirmCode.setAttribute('aria-invalid', 'true');
      notify('请输入六位验证码。', true);
      confirmCode.focus();
      return;
    }
    confirmCode.removeAttribute('aria-invalid');
    perform(async current => {
      const result = await api('totp/enable', { code });
      if (!current()) return;
      clearSetup();
      clearRecovery();
      enabled = true;
      mode = 'recovery';
      for (const value of result.recoveryCodes || []) {
        const row = document.createElement('code');
        row.textContent = String(value);
        row.tabIndex = 0;
        codes.append(row);
      }
    });
  });
  find('cancel').addEventListener('click', () => {
    if (busy) return;
    clearSetup();
    mode = 'idle';
    notify();
    render();
  });
  find('saved').addEventListener('click', () => {
    if (busy) return;
    clearSetup();
    clearRecovery();
    mode = 'idle';
    notify('验证码已开启。');
    render();
  });
  find('disable').addEventListener('click', () => {
    const code = disableCode.value.trim();
    if (!code) {
      notify('请输入验证码或恢复码。', true);
      disableCode.focus();
      return;
    }
    perform(async current => {
      try {
        await api('totp/disable', { code });
      } finally {
        if (current()) disableCode.value = '';
      }
      if (!current()) return;
      enabled = false;
      mode = 'idle';
      find('disable-details').open = false;
      clearSetup();
      clearRecovery();
      notify('验证码已关闭。');
    });
  });
  // Keep Enter local to this panel even if a host page wraps its content in a form.
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
    event.preventDefault();
    if (!busy) find(mode === 'setup' ? 'enable' : 'disable').click();
  });
  function reset() {
    generation += 1;
    busy = false;
    enabled = null;
    mode = 'idle';
    clearSetup();
    clearRecovery();
    disableCode.value = '';
    find('disable-details').open = false;
    panel.open = false;
    note.textContent = '';
    note.dataset.error = 'false';
    render();
  }
  async function refresh() {
    await perform(async current => {
      const result = await api('totp', undefined, 'GET');
      if (!current()) return;
      enabled = result.enabled === true;
      // Do not erase recovery codes before the user has acknowledged saving them.
      if (mode !== 'recovery') {
        clearSetup();
        mode = 'idle';
      }
    });
  }
  reset();
  return { reset, refresh };
}

export const accountSecurityJS = installAccountSecurity.toString();
