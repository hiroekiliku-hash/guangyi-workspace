import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createNativeServer, issuePasskeyRecovery, apnsDelivery, totpCode, effectiveDeadline, formatCountdown, visibleRecord, compareActionRecords, compareDeadlineRecords } from './server.mjs';
let app, origin, token;
const password = 'test-only-password-not-a-production-credential';
const registeredDeviceID = randomUUID();
let reminderPushCount = 0, reminderPayloads = [], workspacePushes = [], workspaceCollapseIDs = [], pushResult = { accepted: true, expired: false };
before(async () => {
  app = createNativeServer({ databasePath: ':memory:', adminEmail: 'owner@test.invalid', adminPassword: password,
    sendPush: async (_device, payload, collapseID) => {
      if (payload.kind === 'WORKSPACE_SYNC') { workspacePushes.push(payload); workspaceCollapseIDs.push(collapseID); }
      else { assert.equal(payload.aps.category, 'WORKSPACE_REMINDER'); reminderPushCount++; reminderPayloads.push(payload); }
      return pushResult;
    } });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  origin = 'http://127.0.0.1:' + app.server.address().port;
});
after(async () => { await app.flushPushes(); app.close(); });
async function call(path, method = 'GET', body, auth = token, revision, sourceDeviceID) {
  const response = await fetch(origin + '/api/native/v1/' + path, { method, headers: {
    ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(revision !== undefined ? { 'If-Match': '"' + revision + '"' } : {}),
    ...(sourceDeviceID ? { 'X-Workspace-Device-ID': sourceDeviceID } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, value: await response.json() };
}
test('app-content public manifest has a stable revision and conditional caching', async () => {
  const response = await fetch(origin + '/api/native/v1/app-content');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('set-cookie'), null);
  const bytes = Buffer.from(await response.arrayBuffer());
  const manifest = JSON.parse(bytes.toString('utf8'));
  assert.equal(manifest.protocol, 'WORKSHOP-CONTENT/1');
  assert.match(manifest.revision, /^[a-f0-9]{64}$/);
  assert.ok(manifest.entries.length > 0 && manifest.entries.length <= 32);
  assert.equal(new Set(manifest.entries.map(entry => entry.id)).size, manifest.entries.length);
  assert.equal(manifest.revision, createHash('sha256').update(JSON.stringify(manifest.entries)).digest('hex'));
  const etag = response.headers.get('etag');
  assert.equal(etag, `"${createHash('sha256').update(bytes).digest('hex')}"`);
  for (const condition of [etag, 'W/' + etag, '"unrelated", ' + etag, '*']) {
    const cached = await fetch(origin + '/api/native/v1/app-content', { headers: { 'If-None-Match': condition } });
    assert.equal(cached.status, 304); assert.equal(await cached.text(), ''); assert.equal(cached.headers.get('etag'), etag);
  }
});
test('app-content packages match manifest bytes and integrity hashes without authentication', async () => {
  const manifest = await (await fetch(origin + '/api/native/v1/app-content')).json();
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    assert.match(entry.id, /^[a-z0-9][a-z0-9-]{0,79}$/);
    assert.match(entry.kind, /^[a-z][a-z0-9-]{0,39}$/);
    assert.ok(Number.isSafeInteger(entry.version) && entry.version >= 1);
    assert.ok(Number.isSafeInteger(entry.minimumContentVersion) && entry.minimumContentVersion >= 1);
    assert.ok(entry.byteCount <= 1024 * 1024);
    const path = origin + '/api/native/v1/app-content/' + entry.id;
    const response = await fetch(path);
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    totalBytes += bytes.length;
    assert.equal(bytes.length, entry.byteCount);
    assert.equal(response.headers.get('content-length'), String(bytes.length));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const packet = JSON.parse(bytes.toString('utf8'));
    for (const field of ['id', 'kind', 'version', 'minimumContentVersion']) assert.equal(packet[field], entry[field]);
    assert.equal(packet.protocol, manifest.protocol);
    assert.ok(packet.payload && typeof packet.payload === 'object');
    const head = await fetch(path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal(head.headers.get('etag'), response.headers.get('etag'));
    const unchanged = await fetch(path, { headers: { 'If-None-Match': response.headers.get('etag') } });
    assert.equal(unchanged.status, 304); assert.equal(await unchanged.text(), '');
  }
  assert.ok(totalBytes <= 4 * 1024 * 1024);
});
test('app-content cannot upload or select arbitrary paths and does not modify account data', async () => {
  const prior = app.db.prepare('SELECT * FROM workspaces ORDER BY user_id').all();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await fetch(origin + '/api/native/v1/app-content/demo-course', { method,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload: { title: 'must not publish' } }) });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
    assert.equal((await response.json()).error, 'APP_CONTENT_READ_ONLY');
  }
  for (const suffix of ['unknown', 'demo-course/extra', '%2Fetc%2Fpasswd', 'Demo-Course', 'demo-course.json', '%2e%2e%2Fserver.mjs']) {
    const response = await fetch(origin + '/api/native/v1/app-content/' + suffix);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, 'APP_CONTENT_NOT_FOUND');
  }
  assert.deepEqual(app.db.prepare('SELECT * FROM workspaces ORDER BY user_id').all(), prior);
  assert.equal((await call('workspace', 'GET', undefined, '')).status, 401);
});
test('web countdown uses the record timezone and reports overdue values', () => {
  const timed = { dueDate: '2026-10-15T04:05:06.000Z', dateOnly: false, timezone: 'Asia/Shanghai' };
  assert.equal(effectiveDeadline(timed), Date.parse(timed.dueDate));
  const shanghai = { dueDate: '2026-10-15T00:00:00.000Z', dateOnly: true, timezone: 'Asia/Shanghai' };
  assert.equal(new Date(effectiveDeadline(shanghai)).toISOString(), '2026-10-15T15:59:59.000Z');
  const newYorkDST = { dueDate: '2026-03-08T12:00:00.000Z', dateOnly: true, timezone: 'America/New_York' };
  assert.equal(new Date(effectiveDeadline(newYorkDST)).toISOString(), '2026-03-09T03:59:59.000Z');
  assert.equal(formatCountdown(Date.UTC(2026, 0, 3, 2, 3, 4), Date.UTC(2026, 0, 1)), '2天 02:03:04');
  assert.equal(formatCountdown(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1)), '已逾期 00:00:00');
  assert.equal(formatCountdown(Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1, 0, 0, 1)), '已逾期 00:00:01');
  assert.equal(formatCountdown(NaN), '未设置截止');
});
test('web hierarchy and sorting match native importance and parent visibility', () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z');
  const group = { id: '20', kind: 'PROJECT', title: '行动组', status: 'ACTIVE', updatedAt: new Date(now + 30_000).toISOString() };
  const action = { id: '30', kind: 'TASK', title: '普通行动', status: 'TODO', updatedAt: new Date(now + 20_000).toISOString() };
  const reminder = { id: '40', kind: 'REMINDER', title: '有时间的提醒', status: 'OPEN', remindAt: new Date(now + 3_600_000).toISOString() };
  const milestone = { id: '10', kind: 'MILESTONE', title: '置顶里程碑', status: 'PLANNED', pinned: true };
  const completed = { id: '50', kind: 'TASK', title: '已完成行动', status: 'DONE', updatedAt: new Date(now + 60_000).toISOString() };
  assert.deepEqual([action, completed, reminder, group, milestone].sort(compareActionRecords).map(value => value.title),
    ['置顶里程碑', '有时间的提醒', '行动组', '普通行动', '已完成行动']);
  const hiddenGroup = { ...group, archivedAt: new Date(now).toISOString() };
  const child = { ...action, projectID: hiddenGroup.id };
  assert.equal(visibleRecord(child, [hiddenGroup, child]), false);
  assert.equal(visibleRecord(child, [group, child]), true);
  const later = { id: 'd2', status: 'OPEN', dueDate: new Date(now + 7_200_000).toISOString(), dateOnly: false };
  const sooner = { id: 'd1', status: 'OPEN', dueDate: new Date(now + 3_600_000).toISOString(), dateOnly: false, updatedAt: new Date(now).toISOString() };
  const sameDueNewer = { id: 'd3', status: 'OPEN', dueDate: sooner.dueDate, dateOnly: false, updatedAt: new Date(now + 10_000).toISOString() };
  const pinnedDone = { id: 'd0', status: 'DONE', pinned: true, dueDate: new Date(now - 3_600_000).toISOString(), dateOnly: false };
  assert.deepEqual([later, sooner, sameDueNewer, pinnedDone].sort(compareDeadlineRecords).map(value => value.id), ['d0', 'd3', 'd1', 'd2']);
});
test('web UI is self-contained, protected by strict headers and leaves APIs authenticated', async () => {
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const html = await page.text();
  assert.match(html, /id="actions-tab"/); assert.match(html, /id="deadlines-tab"/);
  assert.match(html, /使用通行密钥登录/); assert.doesNotMatch(html, /https?:\/\//);
  const script = await fetch(origin + '/app.js');
  assert.match(script.headers.get('content-type'), /^text\/javascript/);
  const source = await script.text();
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /navigator\.credentials\.get/); assert.match(source, /navigator\.credentials\.create/);
  assert.match(source, /passkey-recovery/); assert.match(source, /history\.replaceState/);
  assert.match(source, /sessionStorage/); assert.doesNotMatch(source, /localStorage/);
  assert.doesNotMatch(source, /If-Match/); assert.doesNotMatch(source, /method:\s*['"]PUT['"]/);
  const style = await fetch(origin + '/app.css');
  assert.match(style.headers.get('content-type'), /^text\/css/); assert.match(await style.text(), /prefers-reduced-motion/);
  const head = await fetch(origin + '/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  assert.equal((await call('workspace', 'GET', undefined, '')).status, 401);
});
test('authentication rejects missing and incorrect credentials, returns a scoped session', async () => {
  assert.equal((await call('workspace', 'GET', undefined, '')).status, 401);
  assert.equal((await call('session', 'POST', { email: 'owner@test.invalid', password: 'incorrect' }, '')).status, 401);
  const result = await call('session', 'POST', { email: 'owner@test.invalid', password }, '');
  assert.equal(result.status, 200); token = result.value.data.accessToken;
  assert.equal((await call('workspace')).value.data.revision, 0);
});
test('workspace writes require a version and reject stale concurrent uploads', async () => {
  const snapshot = (await call('workspace')).value.data.snapshot;
  const record = { id: randomUUID(), kind: 'REMINDER', title: '原生提醒', version: 1, status: 'OPEN', body: '', timezone: 'Asia/Shanghai',
    notificationsEnabled: true, dateOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), remindAt: new Date(Date.now() + 600000).toISOString() };
  snapshot.records = [record];
  assert.equal((await call('workspace', 'PUT', { snapshot })).status, 428);
  assert.equal((await call('workspace', 'PUT', { snapshot }, token, 0)).status, 200);
  assert.equal((await call('workspace', 'PUT', { snapshot }, token, 0)).status, 409);
  assert.equal((await call('workspace')).value.data.revision, 1);
});
test('invalid data rolls back without incrementing the workspace revision', async () => {
  const original = (await call('workspace')).value.data;
  const bad = structuredClone(original.snapshot); bad.records[0].projectID = randomUUID();
  assert.equal((await call('workspace', 'PUT', { snapshot: bad }, token, original.revision)).status, 422);
  assert.deepEqual((await call('workspace')).value.data, original);
});
test('device registration validates the app topic and push environment', async () => {
  const device = { deviceID: registeredDeviceID, token: 'ab'.repeat(32), platform: 'iOS', bundleID: 'com.guangyi.workspace.native.ios', environment: 'sandbox' };
  assert.equal((await call('devices', 'PUT', { ...device, bundleID: 'other.app' })).status, 422);
  assert.equal((await call('devices', 'PUT', device)).status, 200);
});
test('workspace writes send a collapsible background revision hint', async () => {
  workspacePushes = []; workspaceCollapseIDs = [];
  const remote = (await call('workspace')).value.data;
  remote.snapshot.profile.name = '另一台设备的更新';
  assert.equal((await call('workspace', 'PUT', { snapshot: remote.snapshot }, token, remote.revision, 'not-a-uuid')).status, 422);
  const updated = await call('workspace', 'PUT', { snapshot: remote.snapshot }, token, remote.revision, registeredDeviceID);
  assert.equal(updated.status, 200);
  await app.flushPushes(); assert.equal(workspacePushes.length, 0);
  updated.value.data.snapshot.profile.name = '紧接着的更新';
  const second = await call('workspace', 'PUT', { snapshot: updated.value.data.snapshot }, token, updated.value.data.revision);
  second.value.data.snapshot.profile.name = '最新更新';
  assert.equal((await call('workspace', 'PUT', { snapshot: second.value.data.snapshot }, token, second.value.data.revision)).status, 200);
  await app.flushPushes();
  assert.deepEqual(workspacePushes.map(value => value.revision).sort(), [remote.revision + 2, remote.revision + 3]);
  assert.equal(new Set(workspaceCollapseIDs).size, 1); assert.match(workspaceCollapseIDs[0], /^[a-f0-9]{64}$/);
  assert.deepEqual(workspacePushes[0].aps, { 'content-available': 1 });
  assert.deepEqual(apnsDelivery(workspacePushes[0]), { pushType: 'background', priority: '5', lifetime: 300 });
  assert.deepEqual(apnsDelivery({ aps: { alert: { title: '提醒' } } }), { pushType: 'alert', priority: '10', lifetime: 86400 });
});
test('server timer sends an accepted notification once and excludes completed reminders', async () => {
  reminderPushCount = 0; reminderPayloads = [];
  const remote = (await call('workspace')).value.data;
  const snapshot = remote.snapshot, now = Date.now() + 1000;
  snapshot.records[0].remindAt = new Date(now - 100).toISOString();
  assert.equal((await call('workspace', 'PUT', { snapshot }, token, remote.revision)).status, 200);
  await Promise.all([app.sweep(now), app.sweep(now)]);
  assert.equal(reminderPushCount, 1);
  assert.equal(reminderPayloads[0].scheduledAt, now - 100);
  assert.equal(reminderPayloads[0].id, snapshot.records[0].id);
  await app.sweep(now); assert.equal(reminderPushCount, 1);
  const next = (await call('workspace')).value.data;
  next.snapshot.records[0].status = 'DONE';
  next.snapshot.records[0].remindAt = new Date(now - 50).toISOString();
  await call('workspace', 'PUT', { snapshot: next.snapshot }, token, next.revision);
  await app.sweep(now); assert.equal(reminderPushCount, 1);
});
test('expired APNs device registrations are removed', async () => {
  const remote = (await call('workspace')).value.data;
  remote.snapshot.records[0].status = 'OPEN'; remote.snapshot.records[0].remindAt = new Date(Date.now() + 2000).toISOString();
  pushResult = { accepted: false, expired: true };
  await call('workspace', 'PUT', { snapshot: remote.snapshot }, token, remote.revision);
  await app.flushPushes();
  await app.sweep(Date.now() + 3000);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM devices').get().n, 0);
});
test('logout revokes the session server-side', async () => {
  assert.equal((await call('session', 'DELETE')).status, 200);
  assert.equal((await call('workspace')).status, 401);
});

async function withWebAuth(work) {
  let clock = Date.now();
  const expectedOrigin = 'https://native-login.test', account = 'native@test.invalid';
  const instance = createNativeServer({ databasePath: ':memory:', adminEmail: account, adminPassword: password,
    passkeyRPID: 'native-login.test', passkeyOrigin: expectedOrigin, webAuthNow: () => clock, totpNow: () => clock });
  await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + instance.server.address().port;
  const verifier = randomBytes(32).toString('base64url'), state = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
  async function api(path, body, auth = '', requestOrigin, method = 'POST') {
    const response = await fetch(base + '/api/native/v1/' + path, { method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}),
        ...(requestOrigin !== undefined ? { Origin: requestOrigin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }
  async function login() { const value = await api('session', { email: account, password }, '', expectedOrigin); assert.equal(value.status, 200); return value.value.data.accessToken; }
  async function authorize(auth) {
    const value = await api('web-auth/authorize', { codeChallenge, state }, auth ?? await login(), expectedOrigin);
    assert.equal(value.status, 200);
    return new URL(value.value.data.callbackURL);
  }
  try { await work({ instance, api, base, account, expectedOrigin, verifier, state, codeChallenge, login, authorize, now: () => clock, advance: milliseconds => { clock += milliseconds; } }); }
  finally { instance.close(); }
}

async function withRegistration(work) {
  await withWebAuth(async context => {
    async function request(path, { method = 'POST', body, rawBody, auth = '', headers = {} } = {}) {
      const response = await fetch(context.base + '/api/native/v1/' + path, { method,
        headers: { ...(body !== undefined || rawBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...headers },
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
      return { status: response.status, value: await response.json() };
    }
    const counts = () => ['users', 'workspaces', 'sessions'].map(table => context.instance.db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n);
    await work({ ...context, request, counts });
  });
}

test('registration normalizes email, returns a session and keeps new accounts isolated', async () => {
  await withRegistration(async ({ instance, request, account, expectedOrigin, verifier, state, codeChallenge, counts }) => {
    const signup = await request('accounts', { body: { email: '  First@TEST.invalid  ', password } });
    assert.equal(signup.status, 201); assert.equal(signup.value.data.account, 'first@test.invalid');
    assert.match(signup.value.data.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(counts(), [2, 2, 1]);
    const firstToken = signup.value.data.accessToken;
    const initial = await request('workspace', { method: 'GET', auth: firstToken });
    assert.equal(initial.status, 200); assert.equal(initial.value.data.revision, 0);
    for (const key of ['records', 'series', 'activities', 'revisions', 'assets', 'trash']) assert.deepEqual(initial.value.data.snapshot[key], []);
    assert.notEqual(initial.value.data.snapshot.profile.name, instance.db.prepare('SELECT name FROM users WHERE email=?').get(account).name);
    const second = await request('accounts', { body: { email: 'second@test.invalid', password: password + '-second' } });
    assert.equal(second.status, 201); const secondToken = second.value.data.accessToken;
    const secondBefore = (await request('workspace', { method: 'GET', auth: secondToken })).value.data;
    const record = { id: randomUUID(), kind: 'TASK', title: 'Only first account', version: 1, status: 'TODO', body: '', timezone: 'Asia/Shanghai',
      notificationsEnabled: false, dateOnly: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    initial.value.data.snapshot.records.push(record);
    const written = await request('workspace', { method: 'PUT', auth: firstToken, body: { snapshot: initial.value.data.snapshot }, headers: { 'If-Match': '"0"' } });
    assert.equal(written.status, 200);
    assert.deepEqual((await request('workspace', { method: 'GET', auth: secondToken })).value.data, secondBefore);
    secondBefore.snapshot.profile.name = 'Second account';
    assert.equal((await request('workspace', { method: 'PUT', auth: secondToken, body: { snapshot: secondBefore.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    const firstAfter = (await request('workspace', { method: 'GET', auth: firstToken })).value.data;
    assert.equal(firstAfter.revision, 1); assert.deepEqual(firstAfter.snapshot.records, [record]);
    assert.notEqual(firstAfter.snapshot.profile.name, 'Second account');
    const stored = instance.db.prepare('SELECT * FROM users WHERE email=?').get('first@test.invalid');
    const duplicate = await request('accounts', { body: { email: ' FIRST@Test.Invalid ', password: password + '-replacement' } });
    assert.equal(duplicate.status, 409); assert.equal(duplicate.value.error.code, 'ACCOUNT_EXISTS');
    assert.deepEqual(instance.db.prepare('SELECT * FROM users WHERE email=?').get('first@test.invalid'), stored);
    assert.deepEqual((await request('workspace', { method: 'GET', auth: firstToken })).value.data, firstAfter);
    const login = await request('session', { body: { email: 'first@test.invalid', password } });
    assert.equal(login.status, 200); assert.equal(login.value.data.account, 'first@test.invalid');
    assert.equal((await request('session', { body: { email: 'first@test.invalid', password: password + '-replacement' } })).status, 401);
    const authorized = await request('web-auth/authorize', { auth: firstToken, body: { codeChallenge, state }, headers: { Origin: expectedOrigin } });
    assert.equal(authorized.status, 200); const callback = new URL(authorized.value.data.callbackURL);
    assert.equal(callback.searchParams.get('state'), state);
    assert.equal((await request('workspace', { method: 'GET', auth: firstToken })).status, 401);
    const native = await request('web-auth/token', { body: { code: callback.searchParams.get('code'), codeVerifier: verifier } });
    assert.equal(native.status, 200); assert.equal(native.value.data.account, 'first@test.invalid');
    assert.deepEqual((await request('workspace', { method: 'GET', auth: native.value.data.accessToken })).value.data, firstAfter);
  });
});

test('registration rejects malformed shapes and unknown fields without creating accounts', async () => {
  await withRegistration(async ({ request, counts }) => {
    for (const body of [null, [], {}, { email: 'new@test.invalid' }, { email: 'new@test.invalid', password, role: 'admin' }]) {
      const response = await request('accounts', { body });
      assert.equal(response.status, 400); assert.equal(response.value.error.code, 'INVALID_REGISTRATION');
    }
    const malformed = await request('accounts', { rawBody: '{"email":' });
    assert.equal(malformed.status, 400); assert.equal(malformed.value.error.code, 'INVALID_JSON');
    assert.deepEqual(counts(), [1, 1, 0]);
  });
});

test('registration validates email and password boundaries without persisting rejected values', async () => {
  for (const [field, values, code] of [
    ['email', ['', 'no-at-sign', 'a@', 'a b@test.invalid', 'a'.repeat(242) + '@test.invalid'], 'INVALID_EMAIL'],
    ['password', ['', 'x'.repeat(7), 'x'.repeat(1025), 123], 'INVALID_PASSWORD']
  ]) {
    await withRegistration(async ({ request, counts }) => {
      for (const value of values) {
        const result = await request('accounts', { body: { email: 'valid@test.invalid', password, [field]: value } });
        assert.equal(result.status, 422); assert.equal(result.value.error.code, code);
      }
      assert.deepEqual(counts(), [1, 1, 0]);
    });
  }
  await withRegistration(async ({ request }) => {
    for (const [email, candidate] of [['minimum@test.invalid', 'x'.repeat(8)], ['maximum@test.invalid', 'x'.repeat(1024)]]) {
      assert.equal((await request('accounts', { body: { email, password: candidate } })).status, 201);
      assert.equal((await request('session', { body: { email, password: candidate } })).status, 200);
    }
  });
});

test('registration enforces trusted origin, JSON content type and a 4 KiB body limit', async () => {
  await withRegistration(async ({ request, expectedOrigin, counts }) => {
    const body = { email: 'new@test.invalid', password };
    for (const headers of [{ Origin: 'https://evil.test' }, { Origin: 'null' }, { Origin: expectedOrigin, 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await request('accounts', { body, headers })).status, 403);
    }
    assert.equal((await request('accounts', { body, headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await request('accounts', { body: { ...body, password: 'x'.repeat(5000) } })).status, 413);
    assert.deepEqual(counts(), [1, 1, 0]);
    assert.equal((await request('accounts', { body, headers: { Origin: expectedOrigin } })).status, 201);
  });
});

test('registration rolls back account, workspace and session together after insertion failures', async () => {
  await withRegistration(async ({ instance, request, counts }) => {
    for (const table of ['workspaces', 'sessions']) {
      instance.db.exec(`CREATE TRIGGER reject_signup BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'test signup insert failure'); END;`);
      const body = { email: table + '@test.invalid', password };
      assert.equal((await request('accounts', { body })).status, 500);
      assert.deepEqual(counts(), [1, 1, 0]);
      assert.equal((await request('session', { body })).status, 401);
      instance.db.exec('DROP TRIGGER reject_signup');
    }
    assert.equal((await request('accounts', { body: { email: 'workspaces@test.invalid', password } })).status, 201);
    assert.deepEqual(counts(), [2, 2, 1]);
  });
});

test('registration limits attempts per direct peer and ignores forged forwarding headers', async () => {
  await withRegistration(async ({ request, counts }) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await request('accounts', { body: { email: 'invalid', password }, headers: { 'X-Forwarded-For': '192.0.2.' + (attempt + 1) } });
      assert.equal(result.status, 422);
    }
    const limited = await request('accounts', { body: { email: 'new@test.invalid', password }, headers: { 'X-Forwarded-For': '198.51.100.1' } });
    assert.equal(limited.status, 429); assert.equal(limited.value.error.code, 'RATE_LIMITED');
    assert.deepEqual(counts(), [1, 1, 0]);
  });
});

test('registration uses separate validated client IP buckets behind the trusted local proxy', async () => {
  await withRegistration(async ({ request }) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const invalid = await request('accounts', { body: { email: 'invalid', password }, headers: { 'X-Real-IP': '192.0.2.10' } });
      assert.equal(invalid.status, 422);
    }
    const body = { email: 'proxied@test.invalid', password };
    assert.equal((await request('accounts', { body, headers: { 'X-Real-IP': '192.0.2.10' } })).status, 429);
    assert.equal((await request('accounts', { body, headers: { 'X-Real-IP': '192.0.2.11' } })).status, 201);
  });
});

test('web auth exchanges a hashed, fixed-callback code and revokes the browser session', async () => {
  await withWebAuth(async ({ instance, api, account, expectedOrigin, verifier, state, codeChallenge, login, authorize }) => {
    const browserToken = await login(), callback = await authorize(browserToken);
    assert.equal(callback.protocol, 'guangyi-workspace:'); assert.equal(callback.hostname, 'auth'); assert.equal(callback.pathname, '/callback');
    assert.equal(callback.searchParams.get('state'), state); assert.deepEqual([...callback.searchParams.keys()].sort(), ['code', 'state']);
    const code = callback.searchParams.get('code'); assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(callback.href.includes(browserToken), false);
    assert.equal((await api('workspace', undefined, browserToken, undefined, 'GET')).status, 401);
    const row = instance.db.prepare('SELECT * FROM web_auth_codes').get();
    assert.equal(row.hash, createHash('sha256').update(code).digest('hex')); assert.notEqual(row.hash, code);
    assert.equal(row.challenge, codeChallenge); assert.equal(row.state, state); assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    const exchanged = await api('web-auth/token', { code, codeVerifier: verifier });
    assert.equal(exchanged.status, 200); assert.equal(exchanged.value.data.account, account); assert.match(exchanged.value.data.accessToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM web_auth_codes').get().n, 0);
    const workspace = await api('workspace', undefined, exchanged.value.data.accessToken, undefined, 'GET');
    assert.equal(workspace.status, 200); assert.equal(workspace.value.data.revision, 0); assert.deepEqual(workspace.value.data.snapshot.records, []);
    assert.equal((await api('session', { email: account, password: 'wrong-password' }, '', expectedOrigin)).status, 401);
  });
});

test('web auth rejects wrong PKCE, malformed exchange bodies and code replay without issuing sessions', async () => {
  await withWebAuth(async ({ instance, api, verifier, authorize }) => {
    const code = (await authorize()).searchParams.get('code');
    const count = () => instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.equal((await api('web-auth/token', { code, codeVerifier: randomBytes(32).toString('base64url') })).status, 401);
    assert.equal(count(), 0); assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM web_auth_codes').get().n, 1);
    for (const body of [null, { code, codeVerifier: 'short' }, { code: '../' + code, codeVerifier: verifier }, { code, codeVerifier: verifier, redirect_uri: 'https://evil.test' }]) {
      assert.equal((await api('web-auth/token', body)).status, 400); assert.equal(count(), 0);
    }
    assert.equal((await api('web-auth/token', { code, codeVerifier: verifier })).status, 200); assert.equal(count(), 1);
    assert.equal((await api('web-auth/token', { code, codeVerifier: verifier })).status, 401); assert.equal(count(), 1);
  });
});

test('web auth authorization codes expire at 90 seconds and repeated invalid attempts are limited', async () => {
  await withWebAuth(async ({ instance, api, verifier, authorize, advance }) => {
    const code = (await authorize()).searchParams.get('code');
    advance(90000);
    const body = { code, codeVerifier: verifier };
    assert.equal((await api('web-auth/token', body)).status, 401);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    await instance.sweep(); assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM web_auth_codes').get().n, 0);
    let rateLimited = false;
    for (let attempt = 0; attempt < 61; attempt++) {
      const result = await api('web-auth/token', body);
      if (result.status === 429) { rateLimited = true; break; }
      assert.equal(result.status, 401);
    }
    assert.equal(rateLimited, true); assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
  });
});

test('web auth rejects untrusted origins, redirect overrides and malformed authorization without revoking valid sessions', async () => {
  await withWebAuth(async ({ instance, api, base, account, expectedOrigin, state, codeChallenge, login }) => {
    assert.equal((await api('session', { email: account, password }, '', 'https://evil.test')).status, 403);
    assert.equal((await api('passkeys/login/options', {}, '', 'https://evil.test')).status, 403);
    const browserToken = await login(), body = { codeChallenge, state };
    assert.equal((await api('web-auth/authorize', body, browserToken, 'https://evil.test')).status, 403);
    assert.equal((await api('web-auth/authorize', body, browserToken, 'null')).status, 403);
    for (const bad of [null, {}, { ...body, redirect_uri: 'https://evil.test' }, { ...body, codeChallenge: 'x'.repeat(43) }, { ...body, state: '<script>' }, { codeChallenge, state: 123 }]) {
      assert.equal((await api('web-auth/authorize', bad, browserToken, expectedOrigin)).status, 400);
    }
    const plain = await fetch(base + '/api/native/v1/web-auth/authorize', { method: 'POST', headers: { Authorization: 'Bearer ' + browserToken, 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    assert.equal(plain.status, 415);
    const large = await api('web-auth/authorize', { ...body, state: 'a'.repeat(3000) }, browserToken, expectedOrigin); assert.equal(large.status, 413);
    assert.equal((await api('web-auth/authorize', body, '', expectedOrigin)).status, 401);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM web_auth_codes').get().n, 0);
    assert.equal((await api('workspace', undefined, browserToken, undefined, 'GET')).status, 200);
  });
});

test('web auth issuance and redemption roll back atomically on database failure', async () => {
  await withWebAuth(async ({ instance, api, expectedOrigin, verifier, state, codeChallenge, login, authorize }) => {
    const browserToken = await login();
    instance.db.exec("CREATE TRIGGER reject_web_code BEFORE INSERT ON web_auth_codes BEGIN SELECT RAISE(ABORT, 'test code insert failure'); END;");
    assert.equal((await api('web-auth/authorize', { codeChallenge, state }, browserToken, expectedOrigin)).status, 500);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM web_auth_codes').get().n, 0);
    assert.equal((await api('workspace', undefined, browserToken, undefined, 'GET')).status, 200);
    instance.db.exec('DROP TRIGGER reject_web_code');
    const code = (await authorize(browserToken)).searchParams.get('code');
    instance.db.exec("CREATE TRIGGER reject_web_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test session insert failure'); END;");
    assert.equal((await api('web-auth/token', { code, codeVerifier: verifier })).status, 500);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM web_auth_codes').get().n, 1);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    instance.db.exec('DROP TRIGGER reject_web_session');
    assert.equal((await api('web-auth/token', { code, codeVerifier: verifier })).status, 200);
  });
});

test('web auth dedicated page rejects malicious parameters and keeps credentials out of storage and callback URLs', async () => {
  await withWebAuth(async ({ base, state, codeChallenge }) => {
    const query = new URLSearchParams({ code_challenge: codeChallenge, code_challenge_method: 'S256', state });
    const page = await fetch(base + '/native-login?' + query);
    assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store'); assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(page.headers.get('x-frame-options'), 'DENY');
    const html = await page.text();
    for (const id of ['native-password-form', 'native-email', 'native-password', 'native-password-login', 'native-passkey-login', 'native-return']) assert.ok(html.includes('id="' + id + '"'));
    assert.equal(html.includes(state), false); assert.equal(html.includes(codeChallenge), false);
    const head = await fetch(base + '/native-login?' + query, { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(await head.text(), '');
    for (const bad of ['', '?' + query + '&state=' + state, '?' + query + '&redirect_uri=https://evil.test', '?' + query.toString().replace('S256', 'plain'), '?code_challenge=bad&code_challenge_method=S256&state=' + state]) {
      assert.equal((await fetch(base + '/native-login' + bad)).status, 400);
    }
    const script = await fetch(base + '/native-login.js'); assert.equal(script.status, 200);
    const source = await script.text(); assert.doesNotThrow(() => new Function(source));
    assert.doesNotMatch(source, /sessionStorage|localStorage|document\.cookie/); assert.match(source, /navigator\.credentials\.get/);
    assert.match(source, /web-auth\/authorize/); assert.match(source, /callback\.searchParams\.get\('state'\) !== requestState/);
    assert.doesNotMatch(source, /searchParams\.set\([^\n]*(?:accessToken|token)/); assert.doesNotMatch(source, /innerHTML/);
  });
});

test('web auth accepts an existing browser passkey session and exchanges it for the same native account', async () => {
  await withWebAuth(async ({ instance, api, account, expectedOrigin, verifier, login, authorize }) => {
    const ownerToken = await login(), registration = (await api('passkeys/register/options', {}, ownerToken)).value.data;
    const device = authenticator('native-login.test', registration.options.user.id);
    assert.equal((await api('passkeys/register/verify', { challengeID: registration.challengeID, credential: device.register(registration.options.challenge, expectedOrigin) }, ownerToken)).status, 200);
    const challenge = (await api('passkeys/login/options', {}, '', expectedOrigin)).value.data;
    const browser = await api('passkeys/login/verify', { challengeID: challenge.challengeID, credential: device.login(challenge.options.challenge, expectedOrigin) }, '', expectedOrigin);
    assert.equal(browser.status, 200);
    const code = (await authorize(browser.value.data.accessToken)).searchParams.get('code');
    assert.equal((await api('workspace', undefined, browser.value.data.accessToken, undefined, 'GET')).status, 401);
    const native = await api('web-auth/token', { code, codeVerifier: verifier }); assert.equal(native.status, 200); assert.equal(native.value.data.account, account);
    assert.equal(instance.db.prepare('SELECT revision FROM workspaces').get().revision, 0);
  });
});

test('operator recovery helper stores only a short-lived token hash', () => {
  const directory=mkdtempSync(join(tmpdir(),'guangyi-passkey-recovery-')), databasePath=join(directory,'workspace.sqlite');
  try {
    const seeded=createNativeServer({databasePath,adminEmail:'recovery@test.invalid',adminPassword:password,
      passkeyRPID:'passkey.test',passkeyOrigin:'https://passkey.test'});
    seeded.close();
    const now=Date.now(), recovery=issuePasskeyRecovery({databasePath,origin:'https://passkey.test',now});
    assert.match(recovery.url,/^https:\/\/passkey\.test\/#passkey-recovery=[A-Za-z0-9_-]{43}$/);
    assert.equal(recovery.expires,now+10*60000);
    const reopened=createNativeServer({databasePath,adminEmail:'recovery@test.invalid',adminPassword:password,
      passkeyRPID:'passkey.test',passkeyOrigin:'https://passkey.test'});
    try {
      const row=reopened.db.prepare('SELECT hash,expires,created FROM passkey_recoveries').get();
      assert.notEqual(row.hash,recovery.token); assert.equal(row.expires-row.created,10*60000);
    } finally { reopened.close(); }
    const command=spawnSync(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url)),'issue-passkey-recovery',databasePath,'recovery@test.invalid'],
      {encoding:'utf8',env:{...process.env,PASSKEY_ORIGIN:'https://passkey.test'}});
    assert.equal(command.status,0,command.stderr);
    assert.match(command.stdout,/^https:\/\/passkey\.test\/#passkey-recovery=[A-Za-z0-9_-]{43}\n有效期至 .*Z\n$/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

// Test-only platform authenticator: real P-256 key, COSE key and signatures.
// Production parsing and validation are performed by SimpleWebAuthn.
import { generateKeyPairSync, createHash, randomBytes, sign as cryptoSign } from 'node:crypto';
function cbor(value) {
  const header = (major, size) => size < 24 ? Buffer.from([(major << 5) | size]) : size < 256 ? Buffer.from([(major << 5) | 24, size]) : Buffer.from([(major << 5) | 25, size >> 8, size & 255]);
  if (typeof value === 'number') return value >= 0 ? header(0, value) : header(1, -1-value);
  if (typeof value === 'string') { const bytes=Buffer.from(value); return Buffer.concat([header(3, bytes.length),bytes]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([header(2,value.length),value]);
  if (value instanceof Map) return Buffer.concat([header(5,value.size),...Array.from(value).flatMap(([key,value]) => [cbor(key),cbor(value)])]);
  throw new Error('unsupported test CBOR');
}
function authenticator(rpID, userHandle) {
  const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}), jwk=publicKey.export({format:'jwk'});
  const id=randomBytes(32).toString('base64url');
  const key=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const hash=value=>createHash('sha256').update(value).digest();
  function data(flags,counter,requestRP=rpID) { const count=Buffer.alloc(4); count.writeUInt32BE(counter); return Buffer.concat([hash(requestRP),Buffer.from([flags]),count]); }
  return {
    id,
    register(challenge,origin,flags=0x45) {
      const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge,origin,crossOrigin:false}));
      const rawID=Buffer.from(id,'base64url'), length=Buffer.alloc(2); length.writeUInt16BE(rawID.length);
      const authData=Buffer.concat([data(flags,0),Buffer.alloc(16),length,rawID,key]);
      return {id,rawId:id,type:'public-key',clientExtensionResults:{},authenticatorAttachment:'platform',response:{clientDataJSON:client.toString('base64url'),attestationObject:cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]])).toString('base64url'),transports:['internal']}};
    },
    login(challenge,origin,counter=1,flags=0x05,requestRP=rpID) {
      const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false})), authData=data(flags,counter,requestRP);
      return {id,rawId:id,type:'public-key',clientExtensionResults:{},authenticatorAttachment:'platform',response:{clientDataJSON:client.toString('base64url'),authenticatorData:authData.toString('base64url'),signature:cryptoSign('sha256',Buffer.concat([authData,hash(client)]),privateKey).toString('base64url'),userHandle}};
    }
  };
}
test('passkeys register, verify real signatures, reject replay/tampering and revoke', async () => {
  const rpID='passkey.test', expectedOrigin='https://passkey.test';
  let testClock=Date.now();
  const instance=createNativeServer({passkeyNow:()=>testClock,databasePath:':memory:',adminEmail:'passkey@test.invalid',adminPassword:password,passkeyRPID:rpID,passkeyOrigin:expectedOrigin});
  await new Promise((resolve,reject)=>{ instance.server.once('error',reject); instance.server.listen(0,'127.0.0.1',resolve); });
  const url='http://127.0.0.1:'+instance.server.address().port;
  async function api(path,body,auth='') {
    const result=await fetch(url+'/api/native/v1/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body??{})});
    return {status:result.status,value:await result.json()};
  }
  try {
    const preserved=instance.issuePasskeyRecovery();
    instance.db.exec("CREATE TRIGGER reject_recovery BEFORE INSERT ON passkey_recoveries BEGIN SELECT RAISE(ABORT, 'test recovery insert failure'); END;");
    assert.throws(()=>instance.issuePasskeyRecovery(),/test recovery insert failure/);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS total FROM passkey_recoveries WHERE hash=?').get(createHash('sha256').update(preserved.token).digest('hex')).total,1);
    instance.db.exec('DROP TRIGGER reject_recovery');
    const superseded=instance.issuePasskeyRecovery();
    const recovery=instance.issuePasskeyRecovery();
    assert.match(recovery.url,/^https:\/\/passkey\.test\/#passkey-recovery=[A-Za-z0-9_-]{43}$/);
    assert.notEqual(recovery.token,superseded.token);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS total FROM passkey_recoveries').get().total,1);
    const owner=instance.db.prepare('SELECT id FROM users WHERE email=?').get('passkey@test.invalid');
    assert.throws(()=>instance.db.prepare('INSERT INTO passkey_recoveries VALUES(?,?,?,?)').run('second-hash',owner.id,testClock+600000,testClock),/UNIQUE constraint failed/);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS total FROM passkey_recoveries WHERE hash=?').get(recovery.token).total,0);
    assert.equal((await api('passkeys/recovery/options',{token:superseded.token})).status,401);
    const recoveryOptions=(await api('passkeys/recovery/options',{token:recovery.token})).value.data;
    assert.equal(recoveryOptions.options.authenticatorSelection.userVerification,'required');
    const recoveredDevice=authenticator(rpID,recoveryOptions.options.user.id);
    const recoveryProof={challengeID:recoveryOptions.challengeID,credential:recoveredDevice.register(recoveryOptions.options.challenge,expectedOrigin)};
    assert.equal((await api('passkeys/recovery/verify',{...recoveryProof,token:randomBytes(32).toString('base64url')})).status,401);
    const recovered=await api('passkeys/recovery/verify',{...recoveryProof,token:recovery.token});
    assert.equal(recovered.status,200); assert.equal(recovered.value.data.account,'passkey@test.invalid');
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS total FROM passkey_recoveries').get().total,0);
    assert.equal((await api('passkeys/recovery/options',{token:recovery.token})).status,401);
    const recoveredChallenge=(await api('passkeys/login/options')).value.data;
    assert.equal((await api('passkeys/login/verify',{challengeID:recoveredChallenge.challengeID,
      credential:recoveredDevice.login(recoveredChallenge.options.challenge,expectedOrigin)})).status,200);
    const expiring=instance.issuePasskeyRecovery(); testClock += 600001;
    assert.equal((await api('passkeys/recovery/options',{token:expiring.token})).status,401);
    const session=(await api('session',{email:'passkey@test.invalid',password})).value.data.accessToken;
    assert.equal((await api('passkeys/register/options',{})).status,401);
    const registration=(await api('passkeys/register/options',{},session)).value.data;
    assert.equal(registration.options.authenticatorSelection.userVerification,'required');
    const device=authenticator(rpID,registration.options.user.id);
    const credential=device.register(registration.options.challenge,expectedOrigin);
    assert.equal((await api('passkeys/register/verify',{challengeID:registration.challengeID,credential},session)).status,200);
    assert.equal((await api('passkeys/register/verify',{challengeID:registration.challengeID,credential},session)).status,401);
    const challenge=(await api('passkeys/login/options')).value.data;
    const assertion=device.login(challenge.options.challenge,expectedOrigin);
    const loggedIn=await api('passkeys/login/verify',{challengeID:challenge.challengeID,credential:assertion});
    assert.equal(loggedIn.status,200); assert.equal(loggedIn.value.data.account,'passkey@test.invalid');
    assert.equal((await api('passkeys/login/verify',{challengeID:challenge.challengeID,credential:assertion})).status,401);
    for (const kind of ['origin','challenge','signature','verification','handle','counter','rpid']) {
      const next=(await api('passkeys/login/options')).value.data;
      const response=device.login(kind==='challenge'?'wrong-challenge':next.options.challenge,kind==='origin'?'https://evil.test':expectedOrigin,kind==='counter'?1:2,kind==='verification'?0x01:0x05,kind==='rpid'?'evil.test':rpID);
      if(kind==='signature') response.response.signature=randomBytes(64).toString('base64url');
      if(kind==='handle') response.response.userHandle=randomBytes(32).toString('base64url');
      assert.equal((await api('passkeys/login/verify',{challengeID:next.challengeID,credential:response})).status,401,kind);
    }
    const expired=(await api('passkeys/login/options')).value.data;
    testClock += 300001;
    assert.equal((await api('passkeys/login/verify',{challengeID:expired.challengeID,credential:device.login(expired.options.challenge,expectedOrigin,2)})).status,401);
    const bound=(await api('passkeys/register/options',{},session)).value.data;
    const secondSession=(await api('session',{email:'passkey@test.invalid',password})).value.data.accessToken;
    const extra=authenticator(rpID,bound.options.user.id);
    const extraProof={challengeID:bound.challengeID,credential:extra.register(bound.options.challenge,expectedOrigin)};
    assert.equal((await api('passkeys/register/verify',extraProof,secondSession)).status,401);
    assert.equal((await api('passkeys/register/verify',extraProof,session)).status,200);
    const invalid=(await api('passkeys/register/options',{},session)).value.data;
    assert.equal((await api('passkeys/register/verify',{challengeID:invalid.challengeID,credential:device.register(invalid.options.challenge,expectedOrigin,0x41)},session)).status,401);
    const revoked=await fetch(url+'/api/native/v1/passkeys',{method:'DELETE',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session},body:JSON.stringify({id:device.id})});
    assert.equal(revoked.status,200);
    const next=(await api('passkeys/login/options')).value.data;
    assert.equal((await api('passkeys/login/verify',{challengeID:next.challengeID,credential:device.login(next.options.challenge,expectedOrigin,2)})).status,401);
    const association=await fetch(url+'/.well-known/apple-app-site-association');
    assert.equal(association.status,200); assert.ok((await association.json()).webcredentials.apps.includes('67WBP6S5QL.com.guangyi.workspace.native.ios'));
  } finally { instance.close(); }
});


test('TOTP matches RFC 6238 SHA-1 vectors at six digits', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']])
    assert.equal(totpCode(secret, seconds * 1000), expected);
});

test('TOTP setup requires authenticated same-origin confirmation and expires safely', async () => {
  await withWebAuth(async ({ instance, api, base, login, expectedOrigin, advance, now }) => {
    const session = await login();
    assert.equal((await api('totp', undefined, '', undefined, 'GET')).status, 401);
    assert.equal((await api('totp/setup', {})).status, 401);
    assert.equal((await api('totp/setup', {}, session, 'https://evil.test')).status, 403);
    assert.equal((await api('totp/setup', { extra: true }, session)).value.error.code, 'INVALID_TOTP_REQUEST');
    assert.equal((await api('totp/setup', [], session)).status, 400);
    assert.equal((await fetch(base + '/api/native/v1/totp/setup', { method: 'POST', headers: { Authorization: 'Bearer ' + session }, body: '{}' })).status, 415);
    assert.deepEqual((await api('totp', undefined, session, undefined, 'GET')).value.data, { enabled: false });
    const first = (await api('totp/setup', {}, session)).value.data;
    assert.match(first.secret, /^[A-Z2-7]{32}$/);
    const uri = new URL(first.uri);
    assert.equal(uri.protocol, 'otpauth:'); assert.equal(uri.searchParams.get('secret'), first.secret);
    assert.equal(uri.searchParams.get('issuer'), 'native-login.test'); assert.equal(uri.searchParams.get('digits'), '6');
    assert.equal(first.appleURI, first.uri.replace('otpauth:', 'apple-otpauth:'));
    assert.equal((await api('totp/enable', { code: 'wrong' }, session)).status, 401);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM totp_credentials').get().n, 0);
    advance(600000);
    assert.equal((await api('totp/enable', { code: totpCode(first.secret, now()) }, session)).value.error.code, 'TOTP_SETUP_EXPIRED');
    const second = (await api('totp/setup', {}, session, expectedOrigin)).value.data;
    assert.notEqual(first.secret, second.secret);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM totp_pending').get().n, 1);
  });
});

test('TOTP gates password sessions, rejects replay, hashes recovery codes and isolates accounts', async () => {
  await withWebAuth(async ({ instance, api, login, account, advance, now }) => {
    const session = await login();
    const setup = (await api('totp/setup', {}, session)).value.data;
    const code = totpCode(setup.secret, now());
    const enabled = await api('totp/enable', { code }, session);
    assert.equal(enabled.status, 200);
    const recovery = enabled.value.data.recoveryCodes;
    assert.equal(recovery.length, 10); assert.equal(new Set(recovery).size, 10);
    for (const item of recovery) assert.match(item, /^[0-9A-F]{4}(?:-[0-9A-F]{4}){3}$/);
    const saved = instance.db.prepare('SELECT hash FROM totp_recovery_codes').all().map(row => row.hash);
    assert.deepEqual(new Set(saved), new Set(recovery.map(item => createHash('sha256').update(item).digest('hex'))));
    assert.deepEqual((await api('totp', undefined, session, undefined, 'GET')).value.data, { enabled: true });
    assert.equal((await api('totp/setup', {}, session)).value.error.code, 'TOTP_ALREADY_ENABLED');
    const count = () => instance.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    const before = count();
    assert.equal((await api('session', { email: account, password: 'incorrect', code })).value.error.code, 'INVALID_CREDENTIALS');
    assert.equal((await api('session', { email: account, password })).value.error.code, 'SECOND_FACTOR_REQUIRED');
    assert.equal((await api('session', { email: account, password, code })).value.error.code, 'INVALID_SECOND_FACTOR');
    assert.equal((await api('session', { email: account, password, code: {} })).value.error.code, 'INVALID_SECOND_FACTOR');
    assert.equal(count(), before);
    advance(30000);
    const next = totpCode(setup.secret, now());
    instance.db.exec("CREATE TRIGGER reject_totp_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'test session insertion'); END;");
    assert.equal((await api('session', { email: account, password, code: next })).status, 500);
    instance.db.exec('DROP TRIGGER reject_totp_session');
    const signedIn = await api('session', { email: account, password, code: next });
    assert.equal(signedIn.status, 200); assert.equal(signedIn.value.data.account, account);
    assert.equal((await api('session', { email: account, password, code: next })).value.error.code, 'INVALID_SECOND_FACTOR');
    const recovered = await api('session', { email: account, password, code: recovery[0].toLowerCase() });
    assert.equal(recovered.status, 200);
    assert.equal((await api('session', { email: account, password, code: recovery[0] })).value.error.code, 'INVALID_SECOND_FACTOR');
    const other = (await api('accounts', { email: 'other@test.invalid', password })).value.data.accessToken;
    assert.equal((await api('totp/disable', { code: recovery[1] }, other)).status, 401);
    assert.deepEqual((await api('totp', undefined, session, undefined, 'GET')).value.data, { enabled: true });
    assert.equal((await api('totp/disable', { code: recovery[1] }, session, 'https://evil.test')).status, 403);
    assert.equal((await api('totp/disable', { code: recovery[1] }, session)).status, 200);
    assert.deepEqual((await api('totp', undefined, session, undefined, 'GET')).value.data, { enabled: false });
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM totp_recovery_codes').get().n, 0);
    assert.equal((await api('session', { email: account, password })).status, 200);
  });
});

test('verified passkeys remain usable when TOTP is enabled, and TOTP guessing is limited', async () => {
  await withWebAuth(async ({ api, login, expectedOrigin, now }) => {
    const session = await login(), registration = (await api('passkeys/register/options', {}, session)).value.data;
    const device = authenticator('native-login.test', registration.options.user.id);
    assert.equal((await api('passkeys/register/verify', { challengeID: registration.challengeID,
      credential: device.register(registration.options.challenge, expectedOrigin) }, session)).status, 200);
    const setup = (await api('totp/setup', {}, session)).value.data;
    assert.equal((await api('totp/enable', { code: totpCode(setup.secret, now()) }, session)).status, 200);
    const challenge = (await api('passkeys/login/options')).value.data;
    assert.equal((await api('passkeys/login/verify', { challengeID: challenge.challengeID,
      credential: device.login(challenge.options.challenge, expectedOrigin) })).status, 200);
    for (let attempt = 0; attempt < 18; attempt++) assert.equal((await api('totp/disable', { code: 'wrong' }, session)).status, 401);
    assert.equal((await api('totp/disable', { code: 'wrong' }, session)).status, 429);
  });
});

test('native signup revokes a late session after pagehide instead of enrolling or authorizing it', async () => {
  const { runInNewContext } = await import('node:vm');
  const source = await (await fetch(origin + '/native-login.js')).text();
  const nodes = new Map(), windowEvents = new Map(), requests = [];
  function node(id) {
    if (id === 'security-panel') return null; // This test needs only the host lifecycle, not authenticator UI.
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: id === 'native-login-complete', disabled: false,
      textContent: '', classList: { toggle() {} }, listeners: new Map(), focus() {},
      addEventListener(name, listener) { this.listeners.set(name, listener); } });
    return nodes.get(id);
  }
  let releaseSignup;
  const signup = new Promise(resolve => { releaseSignup = resolve; });
  const response = data => ({ ok: true, json: async () => ({ data }) });
  runInNewContext(source, {
    URL, URLSearchParams, Date,
    document: { getElementById: node },
    window: { addEventListener(name, listener) { windowEvents.set(name, listener); } },
    navigator: {},
    location: { search: '?code_challenge=' + 'a'.repeat(43) + '&code_challenge_method=S256&state=' + 'b'.repeat(43),
      assign() { assert.fail('A closed login page must not navigate'); }, reload() {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/native/v1/accounts') return signup;
      if (url === '/api/native/v1/session' && options.method === 'DELETE') return response({ signedOut: true });
      assert.fail('Unexpected request from a closed login page: ' + url);
    }
  });
  node('native-registration-toggle').listeners.get('click')();
  node('native-email').value = 'late@test.invalid';
  node('native-password').value = 'test-only-registration-password';
  node('native-confirm-password').value = node('native-password').value;
  node('native-password-form').listeners.get('submit')({ preventDefault() {} });
  assert.equal(requests.length, 1);
  windowEvents.get('pagehide')();
  const lateToken = 'late-disposable-session-token';
  releaseSignup(response({ accessToken: lateToken, account: 'late@test.invalid' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests.map(item => item.url), ['/api/native/v1/accounts', '/api/native/v1/session']);
  assert.equal(requests[1].options.method, 'DELETE');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer ' + lateToken);
  assert.equal(requests[1].options.keepalive, true);
  assert.equal(node('native-login-complete').hidden, true);
  assert.equal(node('native-account').textContent, '');
  assert.equal(node('native-password').value, '');
  assert.equal(node('native-confirm-password').value, '');
});

// Exercise the generated three-file release over HTTP: integrations must not
// depend on an extra runtime module or on the native client's local database.
async function withTextIngress(work) {
  let clock = Date.now(); const pushes = [];
  const instance = createNativeServer({ databasePath: ':memory:', adminEmail: 'text-owner@test.invalid', adminPassword: password,
    passkeyRPID: 'text-import.test', passkeyOrigin: 'https://text-import.test', textNow: () => clock,
    sendPush: async (device, payload) => { pushes.push({ device, payload }); return { accepted: true }; } });
  await new Promise((resolve, reject) => { instance.server.once('error', reject); instance.server.listen(0, '127.0.0.1', resolve); });
  const base = 'http://127.0.0.1:' + instance.server.address().port;
  async function native(path, { method = 'GET', body, auth = '', headers = {} } = {}) {
    const response = await fetch(base + '/api/native/v1/' + path, { method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }
  const login = await native('session', { method: 'POST', body: { email: 'text-owner@test.invalid', password } });
  assert.equal(login.status, 200); const session = login.value.data.accessToken;
  async function createKey(auth = session, name = 'AI日程写入') {
    const response = await native('integrations/text-tokens', { method: 'POST', body: { name }, auth });
    assert.equal(response.status, 201); return response.value.data;
  }
  async function text(raw, { auth = '', key = randomUUID(), headers = {}, method = 'POST' } = {}) {
    const response = await fetch(base + '/api/integrations/v1/calendar-text', { method,
      headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'text/plain; charset=utf-8', 'Idempotency-Key': key, ...headers },
      body: raw });
    return { status: response.status, value: await response.json() };
  }
  async function slowText(auth, raw) {
    const { request } = await import('node:http');
    let handle;
    const response = new Promise((resolve, reject) => {
      handle = request(base + '/api/integrations/v1/calendar-text', { method: 'POST', headers: { Authorization: 'Bearer ' + auth,
        'Content-Type': 'text/plain; charset=utf-8', 'Idempotency-Key': randomUUID() } }, incoming => {
        const chunks = []; incoming.on('data', chunk => chunks.push(chunk)); incoming.once('error', reject);
        incoming.once('end', () => resolve({ status: incoming.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      handle.once('error', reject); handle.write(raw.slice(0, 4));
    });
    await new Promise(resolve => setImmediate(resolve));
    return { finish: () => handle.end(raw.slice(4)), response };
  }
  const state = async (auth = session) => (await native('workspace', { auth })).value.data;
  try { await work({ instance, base, native, text, slowText, state, createKey, session, pushes, now: () => clock, advance: value => { clock += value; } }); }
  finally { await instance.flushPushes(); instance.close(); }
}
const sampleText = 'WORKSHOP/1\n类型: 事项\n标题: API 测试事项\n计划: 2026-10-20T09:00+08:00';

async function projectDirectory(base, auth, query = {}, headers = {}) {
  const search = new URLSearchParams(query);
  const response = await fetch(base + '/api/integrations/v1/project-groups' + (search.size ? '?' + search : ''), {
    headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...headers }
  });
  return { status: response.status, value: await response.json(), headers: response.headers };
}
const directoryFixture = (title, values = {}) => ({ id: randomUUID(), kind: 'PROJECT', status: 'ACTIVE', version: 1,
  title, body: 'private-project-body-must-not-leak', timezone: 'Asia/Shanghai', projectKind: 'RESEARCH', ...values });

test('project directory exposes only the key owner visible group metadata and honors revocation, expiry and origin checks', async () => {
  await withTextIngress(async ({ base, native, state, createKey, session, advance }) => {
    const initial = await state(), area = directoryFixture('生活', { kind: 'AREA', status: 'OPEN', projectKind: 'LIFE' });
    const child = directoryFixture('生活中的子组', { areaID: area.id, projectKind: '自定义分类' });
    const archived = directoryFixture('archived-group-must-not-leak', { archivedAt: '2026-10-01T00:00:00.000Z' });
    const removed = directoryFixture('deleted-group-must-not-leak', { deletedAt: '2026-10-01T00:00:00.000Z' });
    const hiddenChild = directoryFixture('hidden-child-must-not-leak', { projectID: archived.id });
    const task = directoryFixture('private-task-must-not-leak', { kind: 'TASK', status: 'TODO', projectID: child.id });
    initial.snapshot.records = [area, child, archived, removed, hiddenChild, task];
    initial.snapshot.profile.name = 'private-profile-must-not-leak';
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: initial.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    const key = await createKey();
    const signup = await native('accounts', { method: 'POST', body: { email: 'directory-other@test.invalid', password } });
    assert.equal(signup.status, 201);
    const otherSession = signup.value.data.accessToken, otherKey = await createKey(otherSession);
    const own = await projectDirectory(base, key.accessToken);
    assert.equal(own.status, 200); assert.equal(own.value.data.revision, 1);
    assert.equal(own.value.data.timezone, 'Asia/Shanghai'); assert.equal(own.value.data.total, 2);
    assert.deepEqual(own.value.data.projects, [
      { id: area.id, title: area.title, kind: 'AREA', category: 'LIFE' },
      { id: child.id, title: child.title, kind: 'PROJECT', category: '自定义分类', parentID: area.id }
    ].sort((left, right) => left.id.localeCompare(right.id)));
    assert.doesNotMatch(JSON.stringify(own.value), /private-|must-not-leak|@test\.invalid|wsi_/);
    assert.equal(own.headers.get('cache-control'), 'no-store');
    const other = await projectDirectory(base, otherKey.accessToken);
    assert.equal(other.status, 200); assert.deepEqual(other.value.data.projects, []); assert.equal(other.value.data.total, 0);
    assert.equal((await projectDirectory(base, '')).status, 401);
    assert.equal((await projectDirectory(base, session)).status, 401);
    assert.equal((await projectDirectory(base, key.accessToken, {}, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await projectDirectory(base, key.accessToken, {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await native('integrations/text-tokens', { method: 'DELETE', auth: session, body: { id: key.credential.id } })).status, 200);
    assert.equal((await projectDirectory(base, key.accessToken)).status, 401);
    const expiring = await createKey(); advance(365 * 86400000);
    assert.equal((await projectDirectory(base, expiring.accessToken)).status, 401);
    assert.deepEqual((await state()).snapshot, initial.snapshot);
  });
});

test('project directory pagination stays ordered and bounded, with revision conflicts instead of inconsistent pages', async () => {
  await withTextIngress(async ({ base, native, state, text, createKey, session }) => {
    const initial = await state();
    initial.snapshot.records = Array.from({ length: 205 }, (_, index) => directoryFixture('目录项目 ' + index, {
      id: '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0')
    })).reverse();
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: initial.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    const key = await createKey(), first = await projectDirectory(base, key.accessToken);
    assert.equal(first.status, 200); assert.equal(first.value.data.projects.length, 100); assert.equal(first.value.data.total, 205);
    assert.equal(first.value.data.revision, 1); assert.ok(first.value.data.nextCursor);
    const unboundCursor = await projectDirectory(base, key.accessToken, { cursor: first.value.data.nextCursor });
    assert.ok([400, 422].includes(unboundCursor.status), 'A continuation cursor requires its snapshot revision');
    for (const limit of ['0', '201']) {
      const invalidLimit = await projectDirectory(base, key.accessToken, { limit });
      assert.ok([400, 422].includes(invalidLimit.status), 'A page limit must be between 1 and 200');
    }
    const largest = await projectDirectory(base, key.accessToken, { limit: '200' });
    assert.equal(largest.status, 200); assert.equal(largest.value.data.projects.length, 200);
    const second = await projectDirectory(base, key.accessToken, { cursor: first.value.data.nextCursor, revision: '1' });
    assert.equal(second.status, 200); assert.equal(second.value.data.projects.length, 100); assert.ok(second.value.data.nextCursor);
    const last = await projectDirectory(base, key.accessToken, { cursor: second.value.data.nextCursor, revision: '1' });
    assert.equal(last.status, 200); assert.equal(last.value.data.projects.length, 5); assert.equal(last.value.data.nextCursor, undefined);
    const ids = [first, second, last].flatMap(page => page.value.data.projects.map(project => project.id));
    assert.equal(new Set(ids).size, 205); assert.deepEqual(ids, initial.snapshot.records.map(record => record.id).sort());
    assert.equal((await text('WORKSHOP/1\n类型: 项目组\n标题: 新目录项目', { auth: key.accessToken })).status, 201);
    const stale = await projectDirectory(base, key.accessToken, { cursor: first.value.data.nextCursor, revision: '1' });
    assert.equal(stale.status, 409); assert.equal(stale.value.error.code, 'PROJECT_DIRECTORY_CHANGED');
    const refreshed = await projectDirectory(base, key.accessToken);
    assert.equal(refreshed.status, 200); assert.equal(refreshed.value.data.revision, 2); assert.equal(refreshed.value.data.total, 206);
  });
});

test('text batches create native nested project groups and assign new actions through all group aliases without duplicate retries', async () => {
  await withTextIngress(async ({ base, native, state, text, createKey, session }) => {
    const initial = await state(), area = directoryFixture('已有领域', { kind: 'AREA', status: 'OPEN' });
    initial.snapshot.records.push(area); initial.snapshot.custom = { preserved: 'server-only metadata' };
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: initial.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    const key = await createKey(), operation = randomUUID();
    const raw = 'WORKSHOP/1\n类型: 项目组\n标题: 编程学习\n分类: 自学\n备注: 主项目说明\n---\n类型: 项目组\n标题: 指针练习\n项目组: 编程学习\n---\n类型: 事项\n标题: 完成第一题\n日程组: 指针练习\n计划: 2026-10-20T09:00+08:00\n---\n类型: 项目组\n标题: 领域子组\n项目: ' + area.id + '\n---\n类型: 提醒\n标题: 领域提醒\n项目组: 已有领域\n提醒: 2026-10-20T08:45+08:00';
    const added = await text(raw, { auth: key.accessToken, key: operation });
    assert.equal(added.status, 201); assert.equal(added.value.data.created, 5); assert.deepEqual(added.value.data.seriesIDs, []);
    const final = await state(), [parent, child, task, areaChild, reminder] = final.snapshot.records.slice(1);
    assert.equal(final.revision, 2); assert.deepEqual(final.snapshot.records[0], area); assert.deepEqual(final.snapshot.custom, initial.snapshot.custom);
    assert.equal(parent.kind, 'PROJECT'); assert.equal(parent.status, 'ACTIVE'); assert.equal(parent.projectKind, '自学'); assert.equal(parent.body, '主项目说明');
    assert.equal(parent.notificationsEnabled, false); assert.equal(parent.projectID, undefined); assert.equal(parent.areaID, undefined);
    assert.equal(child.kind, 'PROJECT'); assert.equal(child.projectID, parent.id); assert.equal(child.projectKind, 'RESEARCH');
    assert.equal(task.kind, 'TASK'); assert.equal(task.projectID, child.id); assert.equal(task.areaID, undefined);
    assert.equal(areaChild.areaID, area.id); assert.equal(areaChild.projectID, undefined);
    assert.equal(reminder.areaID, area.id); assert.equal(reminder.projectID, undefined);
    for (const group of [parent, child, areaChild]) {
      for (const field of ['id', 'kind', 'title', 'version', 'createdAt', 'updatedAt', 'status', 'summary', 'body', 'category', 'tags', 'pinned', 'projectKind', 'dateOnly', 'timezone', 'notificationsEnabled', 'notificationLeadMinutes', 'isException'])
        assert.notEqual(group[field], undefined, field);
      for (const field of ['scheduledAt', 'dueDate', 'remindAt', 'recurrenceSeriesID']) assert.equal(group[field], undefined);
    }
    const replay = await text(raw, { auth: key.accessToken, key: operation });
    assert.equal(replay.status, 200); assert.deepEqual(replay.value.data, { ...added.value.data, replayed: true });
    assert.deepEqual(await state(), final);
    const directory = await projectDirectory(base, key.accessToken);
    assert.equal(directory.status, 200); assert.equal(directory.value.data.total, 4);
    assert.equal(directory.value.data.projects.find(group => group.id === child.id).parentID, parent.id);
    assert.equal(directory.value.data.projects.find(group => group.id === areaChild.id).parentID, area.id);
    const metadata = await native('integrations/text-tokens', { auth: session });
    assert.equal(metadata.status, 200); assert.match(metadata.value.data.prompt, /project-groups/);
    assert.match(metadata.value.data.prompt, /项目组/); assert.match(metadata.value.data.prompt, /分类/);
    assert.match(metadata.value.data.prompt, /\{\{API_KEY\}\}/); assert.doesNotMatch(metadata.value.data.prompt, new RegExp(key.accessToken));
  });
});

test('text group validation is atomic and rejects duplicate aliases, unsupported fields, future references and same-parent names', async () => {
  await withTextIngress(async ({ native, state, text, createKey, session, instance }) => {
    const initial = await state(), parent = directoryFixture('父组'), sibling = directoryFixture('已存在的子组');
    sibling.projectID = parent.id; initial.snapshot.records = [parent, sibling];
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: initial.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    const key = await createKey(), before = await state();
    const invalidBlocks = [
      ['类型: 项目组\n标题: 不支持计划\n计划: 2026-10-20T09:00+08:00', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 项目组\n标题: 不支持截止\n截止: 2026-10-20', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 项目组\n标题: 不支持提醒\n提醒: 2026-10-20T09:00+08:00', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 项目组\n标题: 不支持重复\n重复: 每天', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 项目组\n标题: 不支持星期\n星期: 1', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 项目组\n标题: 不支持周次\n第1周: 2026-10-19', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 项目组\n标题: 不支持重复结束\n重复结束: 2026-12-31', 'TEXT_PROJECT_FIELD_UNSUPPORTED'],
      ['类型: 事项\n标题: 错误分类\n分类: 不属于事项', 'INVALID_TEXT_CATEGORY'],
      ['类型: 项目组\n标题: 空分类\n分类: ', 'INVALID_TEXT_CATEGORY'],
      ['类型: 项目组\n标题: 过长分类\n分类: ' + 'x'.repeat(241), 'INVALID_TEXT_CATEGORY'],
      ['类型: 事项\n标题: 重复别名\n项目: 父组\n项目组: 父组', 'DUPLICATE_TEXT_FIELD'],
      ['类型: 事项\n标题: 重复别名二\n项目组: 父组\n日程组: 父组', 'DUPLICATE_TEXT_FIELD'],
      ['类型: 事项\n标题: 重复别名三\n项目: 父组\n日程组: 父组', 'DUPLICATE_TEXT_FIELD'],
      ['类型: 项目组\n标题: 已存在的子组\n项目: 父组', 'TEXT_PROJECT_EXISTS'],
      ['类型: 项目组\n标题: 父组', 'TEXT_PROJECT_EXISTS'],
      ['类型: 事项\n标题: 未来引用\n项目: 之后才创建\n---\n类型: 项目组\n标题: 之后才创建', 'TEXT_PROJECT_NOT_FOUND']
    ];
    for (const [blocks, expected] of invalidBlocks) {
      // The first valid block must also roll back when any later block fails.
      const response = await text('WORKSHOP/1\n类型: 项目组\n标题: 原子前置项目\n---\n' + blocks, { auth: key.accessToken });
      assert.equal(response.status, 422, blocks); assert.equal(response.value.error.code, expected, blocks);
      assert.deepEqual(await state(), before, blocks);
      assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM text_imports').get().n, 0);
    }
    const sameBatch = await text('WORKSHOP/1\n类型: 项目组\n标题: 批内重复\n---\n类型: 项目组\n标题: 批内重复', { auth: key.accessToken });
    assert.equal(sameBatch.status, 422); assert.equal(sameBatch.value.error.code, 'TEXT_PROJECT_EXISTS'); assert.deepEqual(await state(), before);
    const differentParents = await text('WORKSHOP/1\n类型: 项目组\n标题: 另一个父组\n---\n类型: 项目组\n标题: 已存在的子组\n项目: 另一个父组', { auth: key.accessToken });
    assert.equal(differentParents.status, 201);
    const after = await state(), duplicate = after.snapshot.records.at(-1);
    assert.equal(duplicate.projectID, after.snapshot.records.at(-2).id);
    const ambiguous = await text('WORKSHOP/1\n类型: 事项\n标题: 名称有歧义\n项目: 已存在的子组', { auth: key.accessToken });
    assert.equal(ambiguous.status, 422); assert.equal(ambiguous.value.error.code, 'AMBIGUOUS_TEXT_PROJECT'); assert.deepEqual(await state(), after);
    const explicit = await text('WORKSHOP/1\n类型: 事项\n标题: 用 UUID 消除歧义\n日程组: ' + duplicate.id, { auth: key.accessToken });
    assert.equal(explicit.status, 201); assert.equal((await state()).snapshot.records.at(-1).projectID, duplicate.id);
  });
});

test('text integration credentials are hash-only, owner-scoped, expiring and immediately revocable', async () => {
  await withTextIngress(async ({ instance, native, text, state, createKey, session, advance }) => {
    const key = await createKey();
    assert.match(key.accessToken, /^wsi_[A-Za-z0-9_-]{43}$/);
    assert.equal(key.endpoint, 'https://text-import.test/api/integrations/v1/calendar-text');
    assert.equal(key.protocol, 'WORKSHOP/1'); assert.equal(key.credential.expires - key.credential.created, 365 * 86400000);
    const stored = instance.db.prepare('SELECT * FROM text_tokens').get();
    assert.equal(stored.hash, createHash('sha256').update(key.accessToken).digest('hex'));
    assert.doesNotMatch(JSON.stringify(stored), /wsi_/);
    const list = await native('integrations/text-tokens', { auth: session, headers: { Host: 'untrusted.test' } });
    assert.equal(list.status, 200); assert.equal(list.value.data.credentials.length, 1);
    assert.equal(list.value.data.endpoint, key.endpoint);
    assert.match(list.value.data.prompt, /\{\{API_KEY\}\}/); assert.match(list.value.data.prompt, /WORKSHOP\/1/);
    assert.match(list.value.data.prompt, /Idempotency-Key/); assert.doesNotMatch(list.value.data.prompt, new RegExp(key.accessToken));
    assert.equal((await native('workspace', { auth: key.accessToken })).status, 401);
    assert.equal((await native('integrations/text-tokens', { auth: key.accessToken })).status, 401);
    assert.equal((await text(sampleText, { auth: session })).status, 401);
    const otherSignup = await native('accounts', { method: 'POST', body: { email: 'text-other@test.invalid', password } });
    assert.equal(otherSignup.status, 201); const other = otherSignup.value.data.accessToken;
    assert.equal((await native('integrations/text-tokens', { auth: other })).value.data.credentials.length, 0);
    assert.equal((await native('integrations/text-tokens', { method: 'DELETE', auth: other, body: { id: key.credential.id } })).status, 404);
    const otherBefore = await state(other);
    assert.equal((await text(sampleText, { auth: key.accessToken })).status, 201);
    assert.deepEqual(await state(other), otherBefore);
    assert.equal((await native('integrations/text-tokens', { auth: session })).value.data.credentials[0].lastUsed, stored.created);
    assert.equal((await native('integrations/text-tokens', { method: 'DELETE', auth: session, body: { id: key.credential.id } })).status, 200);
    assert.equal((await text(sampleText, { auth: key.accessToken })).status, 401);
    const expiring = await createKey(); advance(365 * 86400000);
    assert.equal((await text(sampleText, { auth: expiring.accessToken })).status, 401);
    assert.equal((await native('integrations/text-tokens', { auth: session })).value.data.credentials.length, 0);
  });
});

test('text batches append complete native records and bounded recurrence rules without changing existing metadata', async () => {
  await withTextIngress(async ({ native, state, createKey, text, session, instance, pushes }) => {
    const initial = await state();
    const project = { id: randomUUID(), kind: 'PROJECT', status: 'ACTIVE', version: 1, title: '课程', body: '', timezone: 'Asia/Shanghai' };
    initial.snapshot.records.push(project); initial.snapshot.profile.note = '保留未知资料字段'; initial.snapshot.custom = { untouched: true };
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: initial.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    await native('devices', { method: 'PUT', auth: session, body: { deviceID: randomUUID(), token: 'ab'.repeat(32), platform: 'iOS', bundleID: 'com.guangyi.workspace.native.ios', environment: 'sandbox' } });
    const key = await createKey();
    const raw = `WORKSHOP/1\n类型: 事项\n标题: 晨间整理\n计划: 2026-10-20T08:00:00+08:00\n提醒: 2026-10-20T07:50:00+08:00\n项目: 课程\n重复: 每天\n备注: 第一行\n  第二行\n---\n类型: 截止事项\n标题: 课程报告\n截止: 2026-10-23\n提醒: 2026-10-23T08:30:00+08:00\n---\n类型: 提醒\n标题: 打印资料\n提醒: 2026-10-22T12:00:00+08:00`;
    const added = await text(raw, { auth: key.accessToken });
    assert.equal(added.status, 201); assert.equal(added.value.data.created, 3); assert.equal(added.value.data.seriesIDs.length, 1);
    const final = await state(); assert.equal(final.revision, 2); assert.equal(final.snapshot.records.length, 4); assert.equal(final.snapshot.series.length, 1);
    assert.deepEqual(final.snapshot.records[0], project); assert.deepEqual(final.snapshot.profile, initial.snapshot.profile); assert.deepEqual(final.snapshot.custom, initial.snapshot.custom);
    for (const field of ['activities', 'revisions', 'assets', 'trash']) assert.deepEqual(final.snapshot[field], initial.snapshot[field]);
    const [task, deadline, reminder] = final.snapshot.records.slice(1);
    for (const record of [task, deadline, reminder, final.snapshot.series[0].template]) {
      for (const field of ['id', 'kind', 'title', 'version', 'createdAt', 'updatedAt', 'status', 'summary', 'body', 'category', 'tags', 'pinned', 'projectKind', 'dateOnly', 'timezone', 'notificationsEnabled', 'notificationLeadMinutes', 'isException'])
        assert.notEqual(record[field], undefined, field);
      assert.equal(record.timezone, 'Asia/Shanghai'); assert.ok(Number.isFinite(Date.parse(record.updatedAt)));
    }
    assert.equal(task.projectID, project.id); assert.equal(task.body, '第一行\n第二行'); assert.equal(task.scheduledAt, '2026-10-20T00:00:00.000Z');
    assert.equal(task.recurrenceSeriesID, final.snapshot.series[0].id); assert.equal(task.occurrenceDate, '2026-10-20');
    assert.deepEqual(final.snapshot.series[0].rule, { frequency: 'DAILY', interval: 1, weekdays: [] });
    assert.equal(deadline.dateOnly, true); assert.equal(deadline.dueDate, '2026-10-22T16:00:00.000Z'); assert.equal(deadline.notificationLeadMinutes, 30);
    assert.equal(reminder.remindAt, '2026-10-22T04:00:00.000Z');
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM history').get().n, 2);
    await instance.flushPushes(); assert.deepEqual(pushes.map(item => item.payload.revision), [2]);
  });
});

test('text input rejects invalid types, encoding, dates and entire malformed batches without leaking input', async () => {
  await withTextIngress(async ({ native, state, createKey, text, session }) => {
    const key = await createKey(), before = await state();
    const cases = [
      ['WORKSHOP/2\n类型: 事项\n标题: 错误', 422],
      [sampleText + '\n账户: never-return-this-private-value', 422],
      [sampleText + '\n标题: 重复字段', 422],
      [sampleText.replace('API 测试事项', 'a'.repeat(241)), 422],
      [sampleText.replace('2026-10-20', '2026-02-30'), 422],
      [sampleText.replace('09:00', '24:00'), 422],
      [sampleText.replace('+08:00', 'Z'), 422],
      [sampleText.replace('2026-10-20T09:00+08:00', '明天上午九点'), 422],
      [sampleText + '\n时区: Invalid/Zone', 422],
      [sampleText + '\n项目: 不存在的项目', 422],
      [sampleText + '\n重复: __proto__', 422],
      [sampleText + '\n星期: 1,2', 422],
      [sampleText + '\n重复: 单周', 422],
      [sampleText + '\n重复: 每周\n星期: 1,1', 422],
      [sampleText + '\n重复: 每天\n重复结束: 2026-10-19', 422],
      [sampleText.replace('2026-10-20', '2027-10-20') + '\n重复: 工作日（含调休）', 422],
      ['WORKSHOP/1\n类型: 截止事项\n标题: 迟到提醒\n截止: 2026-10-23\n提醒: 2026-10-23T10:00+08:00', 422],
      ['WORKSHOP/1\n类型: 截止事项\n标题: 秒级提前\n截止: 2026-10-23T10:00:00+08:00\n提醒: 2026-10-23T09:59:59+08:00', 422],
      [sampleText + '\n---\n类型: 事项\n未知的保密字段: private-marker', 422],
      ['WORKSHOP/1\n' + Array.from({ length: 51 }, (_, index) => `类型: 事项\n标题: ${index}`).join('\n---\n'), 422],
      [Buffer.from([0xff, 0xfe]), 422],
      ['x'.repeat(65537), 413]
    ];
    for (const [raw, expected] of cases) {
      const response = await text(raw, { auth: key.accessToken });
      assert.equal(response.status, expected, typeof raw === 'string' ? raw.slice(0, 120) : 'invalid UTF-8');
      assert.doesNotMatch(JSON.stringify(response.value), /never-return-this-private-value|private-marker|保密字段/);
      assert.deepEqual(await state(), before);
    }
    assert.equal((await text(sampleText, { auth: key.accessToken, headers: { 'Content-Type': 'application/json' } })).status, 415);
    assert.equal((await text(sampleText, { auth: key.accessToken, headers: { 'Content-Type': 'text/plain; charset=gbk' } })).status, 415);
    assert.equal((await text(sampleText, { auth: key.accessToken, key: 'bad' })).status, 400);
    assert.equal((await text(sampleText, { auth: key.accessToken, headers: { Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await text(sampleText, { auth: key.accessToken, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await native('integrations/text-tokens', { method: 'POST', auth: session, body: {}, headers: { Origin: 'https://evil.test' } })).status, 403);
    assert.deepEqual(await state(), before);
  });
});

test('text idempotence is durable per account, rejects changed bytes, and rolls back failed persistence', async () => {
  await withTextIngress(async ({ text, state, createKey, native, instance, session }) => {
    const key = await createKey(), operation = randomUUID();
    const first = await text(sampleText, { auth: key.accessToken, key: operation });
    assert.equal(first.status, 201); assert.equal(first.value.data.replayed, false);
    const replay = await text(sampleText, { auth: key.accessToken, key: operation.toUpperCase() });
    assert.equal(replay.status, 200); assert.deepEqual(replay.value.data, { ...first.value.data, replayed: true });
    assert.equal((await text(sampleText + '\n', { auth: key.accessToken, key: operation })).status, 409);
    assert.equal((await state()).snapshot.records.length, 1); assert.equal((await state()).revision, 1);
    await native('integrations/text-tokens', { method: 'DELETE', auth: session, body: { id: key.credential.id } });
    const replacement = await createKey();
    assert.equal((await text(sampleText, { auth: replacement.accessToken, key: operation })).status, 200);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM text_imports').get().n, 1);
    const before = await state();
    instance.db.exec("CREATE TRIGGER reject_text_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'test history rejection'); END;");
    const retryID = randomUUID();
    assert.equal((await text(sampleText, { auth: replacement.accessToken, key: retryID })).status, 500);
    assert.deepEqual(await state(), before); assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM text_imports').get().n, 1);
    instance.db.exec('DROP TRIGGER reject_text_history');
    assert.equal((await text(sampleText, { auth: replacement.accessToken, key: retryID })).status, 201);
    assert.equal((await state()).revision, 2);
  });
});

test('text append reads the latest snapshot after uploads and makes stale native PUTs conflict', async () => {
  await withTextIngress(async ({ native, text, slowText, state, createKey, session }) => {
    const key = await createKey(), before = await state();
    const pending = await slowText(key.accessToken, sampleText);
    const concurrent = structuredClone(before.snapshot); concurrent.profile.name = '上传时的最新资料';
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: concurrent }, headers: { 'If-Match': '"0"' } })).status, 200);
    pending.finish(); assert.equal((await pending.response).status, 201);
    const after = await state(); assert.equal(after.revision, 2); assert.equal(after.snapshot.profile.name, '上传时的最新资料'); assert.equal(after.snapshot.records.length, 1);
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: concurrent }, headers: { 'If-Match': '"1"' } })).status, 409);
    const id = randomUUID();
    const pair = await Promise.all([text(sampleText, { auth: key.accessToken, key: id }), text(sampleText, { auth: key.accessToken, key: id })]);
    assert.deepEqual(pair.map(item => item.status).sort(), [200, 201]);
    assert.deepEqual(pair[0].value.data.recordIDs, pair[1].value.data.recordIDs); assert.equal((await state()).snapshot.records.length, 2);
  });
});

test('text tokens are checked again after a slow body, and names and active key counts are bounded', async () => {
  await withTextIngress(async ({ native, text, slowText, state, createKey, session, advance }) => {
    const key = await createKey(), pending = await slowText(key.accessToken, sampleText);
    await native('integrations/text-tokens', { method: 'DELETE', auth: session, body: { id: key.credential.id } });
    pending.finish(); assert.equal((await pending.response).status, 401); assert.equal((await state()).revision, 0);
    const expiring = await createKey(), slowExpiry = await slowText(expiring.accessToken, sampleText);
    advance(365 * 86400000); slowExpiry.finish(); assert.equal((await slowExpiry.response).status, 401);
    assert.equal((await native('integrations/text-tokens', { method: 'POST', auth: session, body: { name: '' } })).status, 422);
    assert.equal((await native('integrations/text-tokens', { method: 'POST', auth: session, body: { name: 'a'.repeat(61) } })).status, 422);
    assert.equal((await native('integrations/text-tokens', { method: 'POST', auth: session, body: { userID: 2 } })).status, 422);
    for (let index = 0; index < 10; index++) await createKey();
    assert.equal((await native('integrations/text-tokens', { method: 'POST', auth: session, body: {} })).value.error.code, 'TEXT_TOKEN_LIMIT');
    assert.equal((await text(sampleText, { auth: expiring.accessToken })).status, 401);
  });
});

test('text recurrence supports weekly parity, date-only deadlines, DST and known workday years with one initial record', async () => {
  await withTextIngress(async ({ text, state, createKey }) => {
    const key = await createKey();
    const raw = `WORKSHOP/1\n类型: 事项\n标题: 单周课程\n计划: 2026-10-20T09:00+08:00\n重复: 单周\n星期: 2,4\n第1周: 2026-10-19\n---\n类型: 事项\n标题: 隔周整理\n计划: 2026-10-20T09:00+08:00\n重复: 每2周\n---\n类型: 事项\n标题: 工作日打卡\n计划: 2026-10-10T09:00+08:00\n重复: 工作日（含调休）\n---\n类型: 截止事项\n标题: 夏令时日\n截止: 2026-03-08\n时区: America/New_York`;
    assert.equal((await text(raw, { auth: key.accessToken })).status, 201);
    const final = await state(); assert.equal(final.snapshot.records.length, 4); assert.equal(final.snapshot.series.length, 3);
    assert.deepEqual(final.snapshot.series.map(item => [item.rule.frequency, item.rule.interval]), [['ODD_WEEKS', 1], ['WEEKLY', 2], ['CHINA_WORKDAYS', 1]]);
    assert.equal(final.snapshot.records[2].isException, false); assert.equal(final.snapshot.records[3].dueDate, '2026-03-08T05:00:00.000Z');
    assert.equal((await text('WORKSHOP/1\n类型: 事项\n标题: 夏令时不存在\n计划: 2026-03-08T02:30:00-05:00\n时区: America/New_York', { auth: key.accessToken })).status, 422);
  });
});

test('text imports enforce bounded IP and account rate limits, including idempotent retries', async () => {
  await withTextIngress(async ({ text, createKey, advance, instance }) => {
    const key = await createKey(), id = randomUUID();
    for (let index = 0; index < 60; index++) assert.ok([200, 201].includes((await text(sampleText, { auth: key.accessToken, key: id })).status));
    assert.equal((await text(sampleText, { auth: key.accessToken, key: id })).status, 429);
    advance(60000);
    for (let index = 0; index < 60; index++) assert.equal((await text(sampleText, { auth: key.accessToken, key: id })).status, 200);
    advance(60000);
    assert.equal((await text(sampleText, { auth: key.accessToken, key: id })).status, 429);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM text_imports').get().n, 1);
    advance(3600000); assert.equal((await text(sampleText, { auth: key.accessToken, key: id })).status, 200);
  });
});

test('text project lookup excludes archived ancestors and rejects ambiguous exact names', async () => {
  await withTextIngress(async ({ native, text, state, createKey, session }) => {
    const initial = await state();
    const area = { id: randomUUID(), kind: 'AREA', status: 'OPEN', version: 1, title: '旧领域', body: '', timezone: 'Asia/Shanghai', archivedAt: new Date().toISOString() };
    const group = title => ({ id: randomUUID(), kind: 'PROJECT', status: 'ACTIVE', version: 1, title, body: '', timezone: 'Asia/Shanghai' });
    const hidden = { ...group('不可见课程'), areaID: area.id }, first = group('同名课程'), second = group('同名课程');
    initial.snapshot.records.push(area, hidden, first, second);
    assert.equal((await native('workspace', { method: 'PUT', auth: session, body: { snapshot: initial.snapshot }, headers: { 'If-Match': '"0"' } })).status, 200);
    const key = await createKey();
    assert.equal((await text(sampleText + '\n项目: ' + hidden.id, { auth: key.accessToken })).value.error.code, 'TEXT_PROJECT_NOT_FOUND');
    assert.equal((await text(sampleText + '\n项目: 同名课程', { auth: key.accessToken })).value.error.code, 'AMBIGUOUS_TEXT_PROJECT');
    assert.equal((await state()).revision, 1);
    assert.equal((await text(sampleText + '\n项目: ' + first.id.toUpperCase(), { auth: key.accessToken })).status, 201);
    assert.equal((await state()).snapshot.records.at(-1).projectID, first.id);
  });
});

test('text task custom reminders dispatch at remindAt rather than at the plan time', async () => {
  await withTextIngress(async ({ native, text, createKey, instance, session, pushes, now }) => {
    await native('devices', { method: 'PUT', auth: session, body: { deviceID: randomUUID(), token: 'ab'.repeat(32), platform: 'iOS', bundleID: 'com.guangyi.workspace.native.ios', environment: 'sandbox' } });
    const at = Math.ceil((now() + 120000) / 60000) * 60000, later = at + 3600000;
    const iso = value => new Date(value).toISOString().replace('.000Z', 'Z');
    const key = await createKey();
    const raw = `WORKSHOP/1\n类型: 事项\n标题: 准时自定义提醒\n计划: ${iso(later)}\n提醒: ${iso(at)}\n时区: UTC`;
    assert.equal((await text(raw, { auth: key.accessToken })).status, 201);
    await instance.flushPushes();
    assert.equal((await instance.sweep(at + 100)).accepted, 1);
    const delivered = pushes.find(item => item.payload.aps.alert);
    assert.equal(delivered.payload.scheduledAt, at); assert.equal(delivered.payload.aps.alert.body, '准时自定义提醒');
  });
});

test('linked accounts merge atomically, share exact snapshots, enforce roles and immediately revoke access', async () => {
  await withTextIngress(async ({ native, session, state, instance, pushes }) => {
    const register = async email => (await native('accounts', { method: 'POST', body: { email, password } })).value.data.accessToken;
    const member = await register('linked-member@test.invalid'), stranger = await register('linked-stranger@test.invalid');
    const ownerState = await state(), memberState = await state(member);
    const record = title => ({ id: randomUUID(), kind: 'TASK', status: 'TODO', title, body: '', version: 1, timezone: 'Asia/Shanghai' });
    ownerState.snapshot.records.push(record('Owner task')); memberState.snapshot.records.push(record('Member task'));
    for (const [auth, snapshot] of [[session, ownerState.snapshot], [member, memberState.snapshot]]) {
      assert.equal((await native('workspace', { auth, method: 'PUT', headers: { 'If-Match': '"0"' }, body: { snapshot } })).status, 200);
      assert.equal((await native('devices', { auth, method: 'PUT', body: { deviceID: randomUUID(), token: 'ab'.repeat(32), platform: 'iOS', bundleID: 'com.guangyi.workspace.native.ios', environment: 'sandbox' } })).status, 200);
    }
    const ownerID = ownerState.workspaceID, headers = { 'X-Workspace-ID': ownerID };
    assert.equal((await native('workspace', { auth: member, headers })).status, 403);
    const invited = await native('sharing/invitations', { auth: session, method: 'POST', body: { email: 'linked-member@test.invalid', role: 'viewer' } });
    assert.equal(invited.status, 200); const id = invited.value.data.outgoing[0].id;
    assert.equal((await native('sharing/accept', { auth: stranger, method: 'POST', body: { id } })).status, 404);
    const accepted = await native('sharing/accept', { auth: member, method: 'POST', body: { id } });
    assert.equal(accepted.status, 200); assert.equal(accepted.value.data.workspaceID, ownerID); assert.equal(accepted.value.data.accessRole, 'viewer');
    assert.equal(accepted.value.data.workspaces[1].membershipID, id);
    const shared = await native('workspace', { auth: member, headers });
    assert.equal(shared.value.data.snapshot.records.length, 2); assert.equal(shared.value.data.revision, 2);
    assert.deepEqual(shared.value.data.snapshot, (await state()).snapshot);
    assert.deepEqual((await state(member)).snapshot, memberState.snapshot, 'personal pre-share snapshot stays untouched');
    assert.equal((await native('workspace', { auth: member, method: 'PUT', headers: { ...headers, 'If-Match': '"2"' }, body: { snapshot: shared.value.data.snapshot } })).status, 403);
    assert.equal((await native('sharing/permission', { auth: member, method: 'POST', body: { id, role: 'editor' } })).status, 404);
    assert.equal((await native('sharing/permission', { auth: session, method: 'POST', body: { id, role: 'editor' } })).status, 200);
    shared.value.data.snapshot.records.push(record('Together'));
    assert.equal((await native('workspace', { auth: member, method: 'PUT', headers: { ...headers, 'If-Match': '"2"' }, body: { snapshot: shared.value.data.snapshot } })).status, 200);
    assert.equal((await native('workspace', { auth: session, method: 'PUT', headers: { 'If-Match': '"2"' }, body: { snapshot: shared.value.data.snapshot } })).status, 409);
    assert.equal((await state()).snapshot.records.length, 3);
    await instance.flushPushes(); assert.ok(pushes.some(p => p.device.user_id === Number(ownerID) && p.payload.workspaceID === ownerID));
    assert.ok(pushes.some(p => p.device.user_id !== Number(ownerID) && p.payload.workspaceID === ownerID));
    assert.equal((await native('sharing/member', { auth: stranger, method: 'DELETE', body: { id } })).status, 404);
    assert.equal((await native('sharing/member', { auth: session, method: 'DELETE', body: { id } })).status, 200);
    assert.equal((await native('workspace', { auth: member, headers })).status, 403);
    assert.equal((await native('workspace', { auth: member, method: 'PUT', headers: { ...headers, 'If-Match': '"3"' }, body: { snapshot: shared.value.data.snapshot } })).status, 403);
    assert.equal((await state(stranger)).snapshot.records.length, 0);
  });
});

test('linked invitations enforce expiry, owner control and conflict-safe merge', async () => {
  await withTextIngress(async ({ native, session, state, instance }) => {
    const member = (await native('accounts', { method: 'POST', body: { email: 'conflict-member@test.invalid', password } })).value.data.accessToken;
    const owner = await state(), personal = await state(member);
    const item = { id: randomUUID(), kind: 'TASK', status: 'TODO', title: 'Owner', body: '', version: 1, timezone: 'Asia/Shanghai' };
    owner.snapshot.records.push(item); personal.snapshot.records.push({ ...item, title: 'Different' });
    for (const [auth, snapshot] of [[session, owner.snapshot], [member, personal.snapshot]]) await native('workspace', { auth, method: 'PUT', body: { snapshot }, headers: { 'If-Match': '"0"' } });
    const invite = async () => (await native('sharing/invitations', { auth: session, method: 'POST', body: { email: 'conflict-member@test.invalid', role: 'editor' } })).value.data.outgoing[0].id;
    const id = await invite();
    assert.equal((await native('sharing/invitation', { auth: member, method: 'DELETE', body: { id } })).status, 404);
    const conflict = await native('sharing/accept', { auth: member, method: 'POST', body: { id } });
    assert.equal(conflict.status, 409); assert.equal(conflict.value.error.code, 'SHARING_MERGE_CONFLICT');
    assert.equal((await state()).revision, 1); assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM sharing_members').get().n, 0);
    assert.equal((await native('sharing', { auth: member })).value.data.incoming.length, 1);
    instance.db.prepare('UPDATE sharing_invitations SET expires=0 WHERE id=?').run(id);
    assert.equal((await native('sharing', { auth: member })).value.data.incoming.length, 0);
    assert.equal((await native('sharing/accept', { auth: member, method: 'POST', body: { id } })).status, 404);
    const freshID = await invite();
    assert.equal((await native('sharing/decline', { auth: member, method: 'POST', body: { id: freshID } })).status, 200);
    assert.equal((await native('sharing', { auth: session })).value.data.outgoing.length, 0);
  });
});

function sampleCourse() {
  return { protocol: 'WORKSHOP-COURSE/1', id: randomUUID(), title: '安排一天', summary: '文字、图形和练习', lessons: [{ id: randomUUID(), title: '安排时间', blocks: [
    { id: randomUUID(), type: 'text', text: '先安排重要事项。' },
    { id: randomUUID(), type: 'callout', text: '预留休息时间。' },
    { id: randomUUID(), type: 'image', url: 'https://example.com/lesson.png', caption: '示意图' },
    { id: randomUUID(), type: 'chart', chartType: 'bar', points: [{ label: '学习', value: 4 }, { label: '休息', value: 1 }] },
    { id: randomUUID(), type: 'question', text: '先做什么？', questionType: 'singleChoice', options: [{ id: 'a', text: '重要事项' }, { id: 'b', text: '随意安排' }], correctOptionIDs: ['a'] },
    { id: randomUUID(), type: 'question', text: '写一句计划。', questionType: 'shortAnswer' }
  ] }] };
}
async function publishCourse(base, accessToken, course, { key = randomUUID(), revision, headers = {}, raw } = {}) {
  const response = await fetch(base + '/api/integrations/v1/courses', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken,
    'Content-Type': 'application/json', 'Idempotency-Key': key, ...(revision === undefined ? {} : { 'If-Match': '"' + revision + '"' }), ...headers }, body: raw ?? JSON.stringify(course) });
  return { status: response.status, value: await response.json() };
}
test('course generation prompts prioritize a compact native trace and self-checked code', async () => {
  await withTextIngress(async ({ native, session, instance }) => {
    const metadata = (await native('integrations/course-tokens', { auth: session })).value.data;
    let example;
    for (const prompt of [metadata.prompt, metadata.manualPrompt]) {
      assert.match(prompt, /编程课优先使用原生 trace/);
      assert.match(prompt, /每屏一个问题、一个变化/);
      assert.match(prompt, /默认每帧最多展示 2 个对象/);
      assert.match(prompt, /默认不超过 60 字/);
      assert.match(prompt, /由 App 决定布局/);
      assert.match(prompt, /不要求每节课包含 HTML/);
      assert.match(prompt, /开放代码题省略 acceptedAnswers/);
      assert.match(prompt, /不能把代码文本匹配当作通用代码判分/);
      assert.match(prompt, /始终保留一块可见的代码区/);
      assert.match(prompt, /referenceCode/); assert.match(prompt, /focusLines/);
      assert.match(prompt, /focusSpans/); assert.match(prompt, /highlightSpans/);
      assert.match(prompt, /互不重叠的出现次数/); assert.match(prompt, /不必把整行涂亮/);
      assert.doesNotMatch(prompt, /完整代码按需展开|前两个实质课时内安排至少一个|每个实验必须落到.*kind:"html"/);
      const fences = [...prompt.matchAll(/```json\n([\s\S]+?)\n```/g)];
      assert.equal(fences.length, 1, 'each workflow includes one complete JSON example');
      const parsed = JSON.parse(fences[0][1]);
      if (example) assert.deepEqual(parsed, example);
      else example = parsed;
    }
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_tokens').get().n, 0);
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: example })).status, 201);
    const downloaded = (await native('courses/' + example.id, { auth: session })).value.data.course;
    assert.deepEqual(downloaded, example, 'native trace survives production validation and publication');
    const blocks = downloaded.lessons[0].blocks;
    assert.deepEqual(blocks.slice(0, 2).map(block => block.presentation?.kind ?? block.type), ['trace', 'question']);
    const runnable = blocks.filter(block => block.execution);
    assert.deepEqual(runnable.map(block => [block.input.kind, block.execution.language, block.execution.template !== undefined]),
      [['integer', 'python', true], ['code', 'cpp', true], ['code', 'python', false], ['code', 'cpp', false]]);
    assert.ok(runnable.every(block => typeof block.execution.stdin === 'string' && typeof block.execution.expectedOutput === 'string'));
    assert.ok(runnable.filter(block => block.execution.template).every(block => block.execution.template.split('{{ANSWER}}').length === 2));
    assert.ok(runnable.filter(block => block.input.kind === 'code').every(block => block.input.language === block.execution.language && block.acceptedAnswers === undefined));
    const variant = blocks[0].presentation.trace.variants[0];
    assert.deepEqual(downloaded.lessons[0].referenceCode, variant.code);
    assert.equal(blocks[1].focusLines, undefined, 'precise focus does not require whole-line highlighting');
    assert.deepEqual(blocks[1].focusSpans, [{ line: 4, text: 'count', occurrence: 2 }, { line: 4, text: '+' }]);
    assert.deepEqual(variant.frames[1].focusSpans, blocks[1].focusSpans);
    assert.equal(variant.frames[2].focusSpans, undefined, 'frames retain a line-only fallback');
    assert.ok(runnable.every(block => block.focusLines.length > 0));
    assert.ok(runnable.filter(block => !block.execution.template).every(block => block.code.source === block.input.starterCode));
    assert.match(variant.code.source, /#include <iostream>/);
    assert.deepEqual(variant.frames.map(frame => frame.line), [3, 4, 5]);
    assert.deepEqual(variant.frames.map(frame => frame.objects[0].value), ['2', '3', '3']);
    assert.deepEqual(variant.frames.map(frame => frame.objects[0].id), ['count', 'count', 'count']);
    assert.equal(variant.frames.at(-1).output, '3');
    assert.ok(variant.frames.every(frame => frame.objects.length <= 2 && frame.note.length <= 60));
  });
});

test('course protocol enforces scoped tokens, CAS, strict content validation and revocation', async () => {
  await withTextIngress(async ({ native, base, session, instance, createKey, advance }) => {
    const beforeCredentials = await native('integrations/course-tokens', { auth: session });
    const manualPrompt = beforeCredentials.value.data.manualPrompt;
    assert.match(manualPrompt, /下一条学习主题/); assert.match(manualPrompt, /解释概念→具体例子或图形→练习→反馈/);
    assert.match(manualPrompt, /不要声称已上传/); assert.match(manualPrompt, /完整 JSON 文档/);
    assert.doesNotMatch(manualPrompt, /\{\{API_KEY\}\}|wsc_|Authorization/);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_tokens').get().n, 0, 'manual generation never mints a credential');
    const example = JSON.parse(manualPrompt.match(/```json\n([\s\S]+?)\n```/)[1]);
    const manualHeaders = { 'Idempotency-Key': randomUUID() };
    const nativeCreated = await native('courses', { auth: session, method: 'POST', headers: manualHeaders, body: example });
    assert.equal(nativeCreated.status, 201); assert.equal(nativeCreated.value.data.revision, 1);
    const nativeReplay = await native('courses', { auth: session, method: 'POST', headers: manualHeaders, body: example });
    assert.equal(nativeReplay.status, 200); assert.equal(nativeReplay.value.data.replayed, true);
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: manualHeaders, body: { ...example, title: 'changed' } })).status, 409);
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: example })).status, 409);
    const updateHeaders = { 'Idempotency-Key': randomUUID(), 'If-Match': '\"1\"' };
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: updateHeaders, body: { ...example, title: '更新课程' } })).value.data.revision, 2);
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: { ...updateHeaders, 'Idempotency-Key': randomUUID() }, body: example })).status, 409);
    assert.equal((await native('courses/' + example.id, { auth: session, method: 'DELETE', headers: { 'If-Match': '\"2\"' } })).status, 200);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_tokens').get().n, 0, 'native publishing requires no integration credential');
    const created = await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} });
    assert.equal(created.status, 201); const key = created.value.data;
    assert.match(key.accessToken, /^wsc_[A-Za-z0-9_-]{43}$/); assert.equal(key.protocol, 'WORKSHOP-COURSE/1');
    assert.equal(key.endpoint, 'https://text-import.test/api/integrations/v1/courses');
    assert.equal(instance.db.prepare('SELECT hash FROM course_tokens').get().hash, createHash('sha256').update(key.accessToken).digest('hex'));
    const listing = await native('integrations/course-tokens', { auth: session });
    assert.match(listing.value.data.prompt, /\{\{API_KEY\}\}/); assert.match(listing.value.data.prompt, /没有网络工具/); assert.match(listing.value.data.prompt, /不要假装上传/); assert.equal(listing.value.data.credentials.length, 1);
    const doc = sampleCourse(), mutation = randomUUID();
    assert.equal((await publishCourse(base, session, doc)).status, 401);
    assert.equal((await publishCourse(base, (await createKey()).accessToken, doc)).status, 401);
    assert.equal((await native('workspace', { auth: key.accessToken })).status, 401);
    assert.equal((await publishCourse(base, key.accessToken, doc, { headers: { 'X-Workspace-ID': '1' } })).status, 422);
    const published = await publishCourse(base, key.accessToken, doc, { key: mutation, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    assert.equal(published.status, 201); assert.equal(published.value.data.revision, 1); assert.equal(published.value.data.title, doc.title);
    const replay = await publishCourse(base, key.accessToken, doc, { key: mutation });
    assert.equal(replay.status, 200); assert.equal(replay.value.data.replayed, true); assert.equal(replay.value.data.title, doc.title);
    const legacyPublication = JSON.parse(instance.db.prepare('SELECT result FROM course_publications WHERE mutation_id=?').get(mutation).result);
    delete legacyPublication.title;
    instance.db.prepare('UPDATE course_publications SET result=? WHERE mutation_id=?').run(JSON.stringify(legacyPublication), mutation);
    const legacyReplay = await publishCourse(base, key.accessToken, doc, { key: mutation });
    assert.equal(legacyReplay.status, 200); assert.equal(legacyReplay.value.data.replayed, true); assert.equal(legacyReplay.value.data.title, doc.title);
    assert.equal(legacyReplay.value.data.revision, 1, 'legacy result enrichment does not increment the revision');
    assert.equal((await publishCourse(base, key.accessToken, { ...doc, title: 'different' }, { key: mutation })).status, 409);
    assert.equal((await publishCourse(base, key.accessToken, doc)).status, 409);
    assert.equal((await publishCourse(base, key.accessToken, doc, { revision: 2 })).status, 409);
    doc.title = '更新后的课程';
    const updateMutation = randomUUID(), updated = await publishCourse(base, key.accessToken, doc, { key: updateMutation, revision: 1 });
    assert.equal(updated.value.data.revision, 2); assert.equal(updated.value.data.title, doc.title);
    const updatedReplay = await publishCourse(base, key.accessToken, doc, { key: updateMutation, revision: 1 });
    assert.equal(updatedReplay.status, 200); assert.equal(updatedReplay.value.data.replayed, true); assert.equal(updatedReplay.value.data.title, doc.title);
    assert.equal((await native('courses', { auth: session })).value.data.courses[0].lessonCount, 1);
    const downloaded = await native('courses/' + doc.id, { auth: session }); assert.equal(downloaded.value.data.revision, 2); assert.deepEqual(downloaded.value.data.course, doc);
    const stranger = (await native('accounts', { method: 'POST', body: { email: 'course-stranger@test.invalid', password } })).value.data.accessToken;
    assert.equal((await native('courses', { auth: stranger })).value.data.courses.length, 0);
    assert.equal((await native('courses/' + doc.id, { auth: stranger })).status, 404);
    for (const modify of [
      d => { d.html = '<script>alert(1)</script>'; }, d => { d.lessons[0].blocks[0].type = 'html'; }, d => { d.lessons[0].blocks[0].type = 'script'; },
      d => { d.lessons[0].blocks[0].type = 'video'; }, d => { d.lessons[0].blocks[0].type = 'constructor'; }, d => { d.lessons[0].blocks[2].url = 'http://example.com/image.png'; },
      d => { d.lessons[0].blocks[2].url = 'https://example.com/image.svg'; }, d => { d.lessons[0].blocks[1].id = d.lessons[0].id; },
      d => { d.lessons[0].blocks[3].points[0].value = Infinity; }, d => { d.lessons[0].blocks[4].correctOptionIDs = ['unknown']; },
      d => { d.lessons[0].blocks[5].options = []; }, d => { d.lessons = Array.from({ length: 41 }, () => d.lessons[0]); }
    ]) { const bad = structuredClone(doc); modify(bad); assert.equal((await publishCourse(base, key.accessToken, bad, { revision: 2 })).status, 422); }
    assert.equal((await publishCourse(base, key.accessToken, doc, { raw: Buffer.from([0xff]) })).status, 400);
    assert.equal((await publishCourse(base, key.accessToken, doc, { raw: ' '.repeat(1024 * 1024 + 1) })).status, 413);
    assert.equal((await native('courses/' + doc.id, { auth: session })).value.data.revision, 2);
    assert.equal((await native('integrations/course-tokens', { auth: stranger, method: 'DELETE', body: { id: key.credential.id } })).status, 404);
    assert.equal((await native('integrations/course-tokens', { auth: session, method: 'DELETE', body: { id: key.credential.id } })).status, 200);
    assert.equal((await publishCourse(base, key.accessToken, doc, { revision: 2 })).status, 401);
    const expiring = (await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} })).value.data;
    const boundary = sampleCourse(); boundary.lessons[0].blocks[3].points = Array.from({ length: 60 }, (_, index) => ({ label: '图'.repeat(120), value: index }));
    boundary.lessons[0].blocks[4].text = '问'.repeat(4000); boundary.lessons[0].blocks[4].explanation = '答'.repeat(4000);
    boundary.lessons[0].blocks[4].options = Array.from({ length: 12 }, (_, index) => ({ id: 'a' + index, text: '选'.repeat(1000) }));
    boundary.lessons[0].blocks[4].correctOptionIDs = ['a0']; boundary.lessons[0].blocks[5].acceptedAnswers = ['答'.repeat(500)];
    assert.equal((await publishCourse(base, expiring.accessToken, boundary)).status, 201, 'native-compatible maximum limits are accepted');
    for (const modify of [
      d => d.lessons[0].blocks[3].points.push({ label: '61st', value: 1 }),
      d => { d.lessons[0].blocks[3].points[0].label += 'x'; },
      d => { d.lessons[0].blocks[4].text += 'x'; },
      d => { d.lessons[0].blocks[4].explanation += 'x'; },
      d => d.lessons[0].blocks[4].options.push({ id: 'a12', text: '13th' }),
      d => { d.lessons[0].blocks[4].options[0].text += 'x'; },
      d => { d.lessons[0].blocks[5].acceptedAnswers[0] += 'x'; }
    ]) { const bad = structuredClone(boundary); modify(bad); assert.equal((await publishCourse(base, expiring.accessToken, bad, { revision: 1 })).status, 422); }

    advance(366 * 86400000); assert.equal((await publishCourse(base, expiring.accessToken, sampleCourse())).status, 401);
  });
});
test('course progress is personal, revision-aware, idempotent and shared-viewer writable', async () => {
  await withTextIngress(async ({ native, base, session, state }) => {
    const key = (await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} })).value.data;
    const doc = sampleCourse(); assert.equal((await publishCourse(base, key.accessToken, doc)).status, 201);
    const member = (await native('accounts', { method: 'POST', body: { email: 'course-member@test.invalid', password } })).value.data.accessToken;
    const ownerID = (await state()).workspaceID, headers = { 'X-Workspace-ID': ownerID };
    const invitation = await native('sharing/invitations', { auth: session, method: 'POST', body: { email: 'course-member@test.invalid', role: 'viewer' } });
    const membership = invitation.value.data.outgoing[0].id;
    assert.equal((await native('sharing/accept', { auth: member, method: 'POST', body: { id: membership } })).status, 200);
    const path = 'courses/' + doc.id, progressPath = path + '/progress', lesson = doc.lessons[0];
    assert.equal((await native('courses', { auth: member, headers })).value.data.courses.length, 1);
    const memberDocument = sampleCourse();
    assert.equal((await native('courses', { auth: member, headers: { ...headers, 'Idempotency-Key': randomUUID() }, method: 'POST', body: memberDocument })).status, 403);

    const mutate = body => native(progressPath, { auth: member, headers, method: 'POST', body: { mutationID: randomUUID(), courseRevision: 1, lessonID: lesson.id, ...body } });
    assert.equal((await mutate({ completed: true })).status, 409);
    for (const body of [{ selectedOptionIDs: ['unknown'] }, { selectedOptionIDs: ['a'], text: 'invalid' }, { selectedOptionIDs: ['a', 'b'] }]) assert.equal((await mutate({ blockID: lesson.blocks[4].id, ...body })).status, 422);
    const choice = { mutationID: randomUUID(), blockID: lesson.blocks[4].id, selectedOptionIDs: ['b'] };
    const saved = await mutate(choice); assert.equal(saved.status, 200); assert.equal(saved.value.data.answers.length, 1);
    assert.deepEqual((await mutate(choice)).value.data, saved.value.data);
    assert.equal((await mutate({ ...choice, selectedOptionIDs: ['a'] })).status, 409);
    assert.equal((await mutate({ blockID: lesson.blocks[5].id, text: '我会留出休息时间', completed: true })).status, 200);
    const progress = await native(progressPath, { auth: member, headers }); assert.deepEqual(progress.value.data.completedLessonIDs, [lesson.id]); assert.equal(progress.value.data.courseRevision, 1);
    assert.equal((await native(progressPath, { auth: session })).value.data.answers.length, 0);
    assert.equal((await native(path, { auth: member, headers: { ...headers, 'If-Match': '"1"' }, method: 'DELETE' })).status, 403);
    doc.summary = '重新修订'; assert.equal((await publishCourse(base, key.accessToken, doc, { revision: 1 })).status, 200);
    const reset = await native(progressPath, { auth: member, headers }); assert.equal(reset.value.data.courseRevision, 2); assert.deepEqual(reset.value.data.answers, []); assert.deepEqual(reset.value.data.completedLessonIDs, []);
    assert.equal((await mutate(choice)).status, 409);
    assert.equal((await native('sharing/permission', { auth: session, method: 'POST', body: { id: membership, role: 'editor' } })).status, 200);
    const sharedPublish = await native('courses', { auth: member, headers: { ...headers, 'Idempotency-Key': randomUUID() }, method: 'POST', body: memberDocument });
    assert.equal(sharedPublish.status, 201); assert.equal(sharedPublish.value.data.revision, 1);
    assert.deepEqual((await native('courses/' + memberDocument.id, { auth: session })).value.data.course, memberDocument);
    assert.equal((await native('courses/' + memberDocument.id, { auth: member })).status, 404, 'shared publish never writes member personal space');
    assert.equal((await native('courses', { auth: member, headers: { ...headers, 'Idempotency-Key': randomUUID(), 'If-Match': '\"1\"' }, method: 'POST', body: { ...memberDocument, title: '共同编辑' } })).value.data.revision, 2);

    assert.equal((await native(path, { auth: member, headers, method: 'DELETE' })).status, 428);
    assert.equal((await native(path, { auth: member, headers: { ...headers, 'If-Match': '"1"' }, method: 'DELETE' })).status, 409);
    assert.equal((await native(path, { auth: member, headers: { ...headers, 'If-Match': '"2"' }, method: 'DELETE' })).status, 200);
    assert.equal((await native(path, { auth: session })).status, 404);
    assert.equal((await publishCourse(base, key.accessToken, doc, { revision: 3 })).status, 409);
    assert.equal((await native('sharing/member', { auth: session, method: 'DELETE', body: { id: membership } })).status, 200);
    assert.equal((await native('courses', { auth: member, headers })).status, 403);
    assert.equal((await mutate({ blockID: lesson.blocks[5].id, text: 'later', courseRevision: 2 })).status, 403);
  });
});


test('course stars are personal, workspace-scoped, viewer-writable and independent of course CAS and progress', async () => {
  await withTextIngress(async ({ native, session, state, instance }) => {
    const doc = sampleCourse();
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: doc })).status, 201);
    const member = (await native('accounts', { method: 'POST', body: { email: 'course-star-member@test.invalid', password } })).value.data.accessToken;
    const outsider = (await native('accounts', { method: 'POST', body: { email: 'course-star-outsider@test.invalid', password } })).value.data.accessToken;
    const ownerID = (await state()).workspaceID, headers = { 'X-Workspace-ID': ownerID };
    const invitation = await native('sharing/invitations', { auth: session, method: 'POST', body: { email: 'course-star-member@test.invalid', role: 'viewer' } });
    const membership = invitation.value.data.outgoing[0].id;
    assert.equal((await native('sharing/accept', { auth: member, method: 'POST', body: { id: membership } })).status, 200);
    // Identical UUIDs in different spaces must not share stars.
    assert.equal((await native('courses', { auth: member, method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: doc })).status, 201);
    const path = 'courses/' + doc.id, star = path + '/star';
    const mark = (body, auth = member, scope = headers) => native(star, { auth, headers: scope, method: 'PUT', body });
    const catalog = (auth, scope = {}) => native('courses', { auth, headers: scope });
    assert.deepEqual((await catalog(member, headers)).value.data.starredCourseIDs, []);
    const original = (await native(path, { auth: session })).value.data;
    const progress = (await native(path + '/progress', { auth: member, headers })).value.data;
    for (const body of [{}, { starred: null }, { starred: 1 }, { starred: 'true' }, { starred: true, userID: 1 }, [], null]) assert.equal((await mark(body)).status, 422);
    assert.deepEqual((await mark({ starred: true })).value.data, { starred: true });
    assert.equal((await mark({ starred: true })).status, 200);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_stars').get().n, 1);
    assert.deepEqual((await catalog(member, headers)).value.data.starredCourseIDs, [doc.id]);
    assert.deepEqual((await catalog(session)).value.data.starredCourseIDs, []);
    assert.deepEqual((await catalog(member)).value.data.starredCourseIDs, []);
    assert.deepEqual((await native(path, { auth: session })).value.data, original);
    assert.deepEqual((await native(path + '/progress', { auth: member, headers })).value.data, progress);
    assert.equal((await mark({ starred: true }, outsider)).status, 403);
    assert.equal((await native('courses/' + randomUUID() + '/star', { auth: member, headers, method: 'PUT', body: { starred: true } })).status, 404);
    for (const method of ['GET', 'DELETE', 'POST']) assert.equal((await native(star, { auth: session, method, ...(method === 'POST' ? { body: { starred: true } } : {}), headers: { 'If-Match': '"1"' } })).status, 404);
    assert.equal((await mark({ starred: false })).status, 200);
    assert.deepEqual((await catalog(member, headers)).value.data.starredCourseIDs, []);
    assert.equal((await mark({ starred: false })).status, 200);
    assert.equal((await mark({ starred: true })).status, 200);
    assert.equal((await mark({ starred: true }, session, {})).status, 200);
    assert.equal((await mark({ starred: true }, member, {})).status, 200);
    assert.equal((await native(path, { auth: member, headers: { ...headers, 'If-Match': '"1"' }, method: 'DELETE' })).status, 403);
    assert.equal((await native(path, { auth: session, headers: { 'If-Match': '"2"' }, method: 'DELETE' })).status, 409);
    assert.deepEqual((await catalog(member, headers)).value.data.starredCourseIDs, [doc.id]);
    assert.equal((await native(path, { auth: session, headers: { 'If-Match': '"1"' }, method: 'DELETE' })).status, 200);
    assert.deepEqual((await catalog(member, headers)).value.data.starredCourseIDs, []);
    assert.deepEqual((await catalog(session)).value.data.starredCourseIDs, []);
    assert.deepEqual((await catalog(member)).value.data.starredCourseIDs, [doc.id]);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_stars WHERE owner_id=?').get(Number(ownerID)).n, 0);
    assert.equal((await mark({ starred: true })).status, 404);
    assert.equal((await mark({ starred: false })).status, 404);
  });
});

test('course star writes recheck session and shared access after streamed bodies finish', async () => {
  await withTextIngress(async ({ native, base, session, state, instance }) => {
    const doc = sampleCourse();
    assert.equal((await native('courses', { auth: session, method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: doc })).status, 201);
    const member = (await native('accounts', { method: 'POST', body: { email: 'course-star-revoked@test.invalid', password } })).value.data.accessToken;
    const headers = { 'X-Workspace-ID': (await state()).workspaceID };
    const invitation = await native('sharing/invitations', { auth: session, method: 'POST', body: { email: 'course-star-revoked@test.invalid', role: 'viewer' } });
    const membership = invitation.value.data.outgoing[0].id;
    assert.equal((await native('sharing/accept', { auth: member, method: 'POST', body: { id: membership } })).status, 200);
    async function start(auth, scope = {}) {
      const { request } = await import('node:http');
      let handle;
      const arrived = new Promise(resolve => instance.server.once('request', () => setImmediate(resolve)));
      const response = new Promise((resolve, reject) => {
        handle = request(base + '/api/native/v1/courses/' + doc.id + '/star', { method: 'PUT', headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json', ...scope } }, incoming => {
          const chunks = []; incoming.on('data', chunk => chunks.push(chunk)); incoming.once('error', reject);
          incoming.once('end', () => resolve({ status: incoming.statusCode, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        });
        handle.once('error', reject); handle.write('{"sta');
      });
      await arrived;
      return { response, finish: () => handle.end('rred":true}') };
    }
    const sharedWrite = await start(member, headers);
    assert.equal((await native('sharing/member', { auth: session, method: 'DELETE', body: { id: membership } })).status, 200);
    sharedWrite.finish(); assert.equal((await sharedWrite.response).status, 403);
    const ownerWrite = await start(session);
    assert.equal((await native('session', { auth: session, method: 'DELETE' })).status, 200);
    ownerWrite.finish(); assert.equal((await ownerWrite.response).status, 401);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_stars').get().n, 0);
  });
});

// Keep fixtures inline: production verification receives only the bundled server and tests.
function programmingCourse() {
  return {
  "protocol": "WORKSHOP-COURSE/1",
  "id": "c0000000-0000-4000-8000-000000000001",
  "title": "C++ 函数指针：从地址到调用",
  "summary": "结合源码、分步拆解、对照、翻卡和练习理解函数指针。代码仅作课程数据，不执行。",
  "lessons": [
    {
      "id": "c0000000-0000-4000-8000-000000000002",
      "title": "用一个例子理解函数指针",
      "objectives": [
        "区分保存函数地址与发起函数调用",
        "读懂返回 int、参数为 int 的函数指针声明"
      ],
      "estimatedMinutes": 12,
      "blocks": [
        {
          "id": "c0000000-0000-4000-8000-000000000003",
          "type": "text",
          "title": "观察一段完整代码",
          "text": "完整示例（仅供阅读，不会由 App 编译或执行）：\n#include <iostream>\n\nint twice(int x) { return x * 2; }\n\nint main() {\n    int (*operation)(int) = twice;\n    std::cout << operation(3) << \"\\n\";\n}\n预期输出：6",
          "presentation": {
            "kind": "code",
            "code": {
              "language": "cpp",
              "filename": "dispatch.cpp",
              "source": "#include <iostream>\n\nint twice(int x) { return x * 2; }\n\nint main() {\n    int (*operation)(int) = twice;\n    std::cout << operation(3) << \"\\n\";\n}",
              "highlightLines": [
                6,
                7
              ],
              "annotations": [
                {
                  "line": 6,
                  "text": "operation 是函数指针；它保存函数地址，不会在赋值时调用函数。"
                }
              ],
              "stdin": "",
              "expectedOutput": "6\n"
            }
          }
        },
        {
          "id": "c0000000-0000-4000-8000-000000000004",
          "type": "text",
          "title": "把声明拆开看",
          "text": "int (*operation)(int)：operation 是名字；(*operation) 说明它是指针；参数是 int；返回值是 int。",
          "presentation": {
            "kind": "table",
            "table": {
              "columns": [
                "片段",
                "含义"
              ],
              "rows": [
                [
                  "int",
                  "返回值类型"
                ],
                [
                  "(*operation)",
                  "指针名"
                ],
                [
                  "(int)",
                  "参数类型"
                ]
              ]
            }
          }
        },
        {
          "id": "c0000000-0000-4000-8000-000000000005",
          "type": "text",
          "title": "从地址到调用",
          "text": "1. 定义 twice。2. 把 twice 的地址赋给 operation。3. 调用 operation(3)，得到 6。",
          "presentation": {
            "kind": "steps",
            "steps": [
              {
                "title": "定义目标函数",
                "text": "目标函数接收 int 并返回 int。",
                "code": {
                  "language": "cpp",
                  "source": "int twice(int x) { return x * 2; }"
                }
              },
              {
                "title": "保存函数地址",
                "text": "函数名在这里可转换为函数指针。",
                "code": {
                  "language": "cpp",
                  "source": "int (*operation)(int) = twice;"
                }
              },
              {
                "title": "通过指针调用",
                "text": "operation(3) 与 twice(3) 的结果相同。"
              }
            ]
          }
        },
        {
          "id": "c0000000-0000-4000-8000-000000000006",
          "type": "callout",
          "title": "定义与调用不要混淆",
          "text": "int (*operation)(int) = twice; 是定义指针；int result = operation(3); 才会调用函数。",
          "presentation": {
            "kind": "comparison",
            "items": [
              {
                "title": "保存地址",
                "text": "这里不会执行 twice。",
                "code": {
                  "language": "cpp",
                  "source": "int (*operation)(int) = twice;"
                }
              },
              {
                "title": "发起调用",
                "text": "这里把参数 3 传入函数。",
                "code": {
                  "language": "cpp",
                  "source": "int result = operation(3);"
                }
              }
            ]
          }
        },
        {
          "id": "c0000000-0000-4000-8000-000000000007",
          "type": "text",
          "title": "用两张卡片检查理解",
          "text": "卡片1：函数指针保存什么？答案：可调用函数的地址。卡片2：operation(3) 会输出什么？答案：twice(3) 的结果是 6。",
          "presentation": {
            "kind": "flashcards",
            "cards": [
              {
                "front": "函数指针保存什么？",
                "back": "可调用函数的地址，且指针类型需要与函数签名兼容。"
              },
              {
                "front": "operation(3) 的返回值是多少？",
                "back": "6，因为 operation 指向 twice。"
              }
            ]
          }
        },
        {
          "id": "c0000000-0000-4000-8000-000000000008",
          "type": "question",
          "title": "先预测，再核对",
          "text": "哪个表达式会调用函数？",
          "questionType": "singleChoice",
          "code": {
            "language": "cpp",
            "source": "int (*operation)(int) = twice;\nint result = operation(3);",
            "highlightLines": [
              2
            ]
          },
          "options": [
            {
              "id": "address",
              "text": "twice"
            },
            {
              "id": "call",
              "text": "operation(3)"
            }
          ],
          "correctOptionIDs": [
            "call"
          ],
          "hints": [
            "找一找带实际参数的括号。"
          ],
          "explanation": "operation(3) 传入实参并发起调用；赋值时的 twice 仅提供函数地址。"
        },
        {
          "id": "c0000000-0000-4000-8000-000000000009",
          "type": "question",
          "title": "补全声明",
          "text": "写出一行代码：定义名为 operation 的函数指针，参数和返回值都是 int，并指向 twice。",
          "questionType": "shortAnswer",
          "answerFormat": "code",
          "code": {
            "language": "cpp",
            "source": "int twice(int x) { return x * 2; }"
          },
          "hints": [
            "指针名需要放在 (*...) 内。",
            "末尾使用 = twice;"
          ],
          "acceptedAnswers": [
            "int (*operation)(int) = twice;"
          ],
          "explanation": "这是参考写法。代码答案会保留内部空格和大小写进行文本比较，并不代表已经编译测试；等价写法可自行对照。"
        },
        {
          "id": "c0000000-0000-4000-8000-000000000010",
          "type": "question",
          "title": "核对输出",
          "text": "上面的完整程序输出什么？只填写输出内容。",
          "questionType": "shortAnswer",
          "answerFormat": "output",
          "code": {
            "language": "cpp",
            "filename": "dispatch.cpp",
            "source": "#include <iostream>\n\nint twice(int x) { return x * 2; }\n\nint main() {\n    int (*operation)(int) = twice;\n    std::cout << operation(3) << \"\\n\";\n}",
            "highlightLines": [
              6,
              7
            ],
            "annotations": [
              {
                "line": 6,
                "text": "operation 是函数指针；它保存函数地址，不会在赋值时调用函数。"
              }
            ],
            "stdin": "",
            "expectedOutput": "6\n"
          },
          "acceptedAnswers": [
            "6"
          ],
          "explanation": "twice 把 3 乘以 2，输出 6。预期输出由课程提供，App 不运行程序。"
        }
      ]
    }
  ]
};
}
function richCourse() {
  return {
  "protocol": "WORKSHOP-COURSE/1",
  "id": "d0000000-0000-4000-8000-000000000001",
  "title": "变量与状态：可操作的小演示",
  "summary": "用代码框、Markdown、SVG 和离线 HTML 演示理解变量更新，不依赖图片或视频。",
  "lessons": [
    {
      "id": "d0000000-0000-4000-8000-000000000002",
      "title": "观察数值如何变化",
      "objectives": [
        "理解变量当前值与一次更新操作的关系"
      ],
      "estimatedMinutes": 6,
      "blocks": [
        {
          "id": "d0000000-0000-4000-8000-000000000003",
          "type": "text",
          "title": "先读代码",
          "text": "int value = 1;\nvalue = value + 1;\n更新后 value 为 2。",
          "presentation": {
            "kind": "markdown",
            "markdown": {
              "source": "## 一次更新\n\n```cpp\nint value = 1;\nvalue = value + 1;\n```\n\n> 先读取旧值，再把结果写回变量。"
            }
          }
        },
        {
          "id": "d0000000-0000-4000-8000-000000000004",
          "type": "text",
          "title": "看见变量",
          "text": "一个方框表示变量 value，里面存放当前值 1。执行加 1 操作后，方框里的值变为 2。",
          "presentation": {
            "kind": "svg",
            "svg": {
              "height": 160,
              "source": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 320 140\"><rect x=\"20\" y=\"20\" width=\"280\" height=\"100\" rx=\"16\" fill=\"#f0edff\"/><text x=\"160\" y=\"55\" text-anchor=\"middle\" font-size=\"18\" fill=\"#333\">value</text><text x=\"160\" y=\"98\" text-anchor=\"middle\" font-size=\"32\" fill=\"#6553c7\">1 → 2</text></svg>"
            }
          }
        },
        {
          "id": "d0000000-0000-4000-8000-000000000005",
          "type": "callout",
          "title": "亲手更新状态",
          "text": "点击“加 1”会把当前值增加 1，点击“重置”恢复到 1。这个 HTML 演示只模拟变量更新，不运行 C++ 程序。",
          "presentation": {
            "kind": "html",
            "html": {
              "height": 240,
              "source": "<style>:root{color-scheme:light dark}body{margin:0;padding:16px;font:16px system-ui;text-align:center}output{display:block;font-size:48px;margin:16px}button{font:inherit;padding:10px 20px;border:0;border-radius:24px;background:#6553c7;color:white;margin:4px}</style><p>value 当前值</p><output id=\"value\">1</output><button id=\"add\">加 1</button><button id=\"reset\">重置</button><script>let n=1;const out=document.getElementById(\"value\");document.getElementById(\"add\").onclick=()=>{out.textContent=String(++n)};document.getElementById(\"reset\").onclick=()=>{n=1;out.textContent=\"1\"};</script>"
            }
          }
        },
        {
          "id": "d0000000-0000-4000-8000-000000000006",
          "type": "question",
          "text": "从 1 开始，连续加 1 两次后，变量的值是多少？",
          "questionType": "shortAnswer",
          "answerFormat": "output",
          "acceptedAnswers": [
            "3"
          ],
          "explanation": "第一次更新为 2，第二次读取 2 再加 1，得到 3。"
        }
      ]
    }
  ]
};
}
test('course structured extensions round-trip C++ data and expose a static strict schema', async () => {
  await withTextIngress(async ({ native, base, session, instance }) => {
    const schemaResponse = await fetch(base + '/api/integrations/v1/courses/schema');
    assert.equal(schemaResponse.status, 200, 'schema discovery needs no session or publishing credential');
    assert.match(schemaResponse.headers.get('content-type'), /^application\/json/);
    assert.equal(schemaResponse.headers.get('x-content-type-options'), 'nosniff');
    const schema = await schemaResponse.json();
    assert.equal(schema.properties.protocol.const, 'WORKSHOP-COURSE/1');
    assert.equal(schema['x-workshop-extensionVersion'], 'structured-2');
    assert.deepEqual(schema.$defs.presentation.oneOf.map(value => value.properties.kind.const), ['code', 'table', 'steps', 'comparison', 'flashcards', 'markdown', 'html', 'svg', 'trace']);
    assert.deepEqual(Object.keys(schema.$defs.lesson.properties).sort(), ['blocks', 'estimatedMinutes', 'id', 'objectives', 'referenceCode', 'title']);
    assert.equal(schema.properties.referenceCode.$ref, '#/$defs/code');
    assert.equal(schema.$defs.focusLines.maxItems, 200); assert.equal(schema.$defs.focusLines.uniqueItems, true);
    assert.equal(schema.$defs.textBlock.properties.focusLines.$ref, '#/$defs/focusLines');
    assert.equal(schema.$defs.code.properties.highlightSpans.$ref, '#/$defs/codeSpans');
    assert.equal(schema.$defs.textBlock.properties.focusSpans.$ref, '#/$defs/codeSpans');
    assert.equal(schema.$defs.traceFrame.properties.focusSpans.$ref, '#/$defs/codeSpans');
    assert.equal(schema.$defs.codeSpans.maxItems, 200); assert.equal(schema.$defs.codeSpan.properties.occurrence.default, 1);
    assert.equal(schema.$defs.code.properties.source.maxLength, 20000);
    const languagePattern = new RegExp(schema.$defs.code.properties.language.pattern);
    assert.match('c++', languagePattern); assert.doesNotMatch('cpp\n', languagePattern); assert.doesNotMatch('cpp\r', languagePattern);
    assert.equal(schema.$defs.codeAnswerBlock.properties.acceptedAnswers.items.maxLength, 20000);
    // Code input may override a legacy answerFormat. Non-code branches keep
    // the original output/text limits; the common property permits code input.
    assert.equal(schema.$defs.outputAnswerBlock.properties.acceptedAnswers.items.maxLength, 20000);
    assert.equal(schema.$defs.textAnswerBlock.properties.acceptedAnswers.items.maxLength, 20000);
    assert.equal(schema.$defs.outputAnswerBlock.allOf[0].else.properties.acceptedAnswers.items.maxLength, 8000);
    assert.equal(schema.$defs.textAnswerBlock.allOf[0].else.properties.acceptedAnswers.items.maxLength, 500);
    function checkObjects(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'object') assert.equal(node.additionalProperties, false, 'all schema objects reject unknown keys');
      for (const child of Object.values(node)) if (child && typeof child === 'object') checkObjects(child);
    }
    checkObjects(schema);
    assert.equal(instance.db.prepare('SELECT COUNT(*) AS n FROM course_tokens').get().n, 0);
    const metadata = (await native('integrations/course-tokens', { auth: session })).value.data;
    assert.equal(metadata.schemaURL, 'https://text-import.test/api/integrations/v1/courses/schema');
    assert.equal(metadata.extensionVersion, 'structured-2');
    assert.match(metadata.prompt, /GET https:\/\/text-import\.test\/api\/integrations\/v1\/courses\/schema/);
    assert.match(metadata.manualPrompt, /#include <iostream>/);
    assert.match(metadata.manualPrompt, /comparison/); assert.match(metadata.manualPrompt, /flashcards/); assert.match(metadata.manualPrompt, /不编译、不执行/);
    const issued = (await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} })).value.data;
    assert.equal(issued.schemaURL, metadata.schemaURL); assert.equal(issued.extensionVersion, metadata.extensionVersion);
    const doc = programmingCourse();
    const code = doc.lessons[0].blocks[0].presentation.code;
    code.source = '#include <iostream>\r\ntemplate<typename T>\rT identity(T value) { return value; }\n// <script> is a quoted teaching example, not executable markup';
    code.highlightLines = [1, 2, 4]; code.annotations = [{ line: 2, text: 'C++ template<typename T> is plain source data.' }];
    doc.lessons[0].blocks[0].text = code.source;
    doc.lessons[0].blocks[1].presentation.table.rows[0][1] = '<vector<int>>';
    const created = await publishCourse(base, issued.accessToken, doc); assert.equal(created.status, 201); assert.equal(created.value.data.title, doc.title);
    const downloaded = await native('courses/' + doc.id, { auth: session });
    assert.deepEqual(downloaded.value.data.course, doc, 'all structured fields and CRLF/CR/LF source bytes survive publication');
    assert.deepEqual(doc.lessons[0].blocks.slice(0, 5).map(block => block.presentation.kind), ['code', 'table', 'steps', 'comparison', 'flashcards']);
    assert.equal(downloaded.value.data.course.lessons[0].blocks[0].presentation.code.source, code.source);
  });
});

test('course rich presentations preserve offline HTML SVG and Markdown with bounded strict payloads', async () => {
  await withTextIngress(async ({ native, base, session }) => {
    const key = (await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} })).value.data;
    const doc = richCourse();
    assert.equal((await publishCourse(base, key.accessToken, doc)).status, 201);
    assert.deepEqual((await native('courses/' + doc.id, { auth: session })).value.data.course, doc);
    const metadata = (await native('integrations/course-tokens', { auth: session })).value.data;
    for (const prompt of [metadata.prompt, metadata.manualPrompt]) {
      for (const pattern of [/kind:"markdown"/, /kind:"html"/, /kind:"svg"/, /暂停\/重置/, /prefers-reduced-motion/, /1 MiB/, /默认不要使用图片/, /Markdown 围栏/, /CDN/]) assert.match(prompt, pattern);
      assert.doesNotMatch(prompt, /禁止 html\/script\/svg|协议不提供可执行脚本/);
    }
    const schema = await (await fetch(base + '/api/integrations/v1/courses/schema')).json();
    for (const [kind, max] of [['markdown', 20000], ['html', 60000], ['svg', 60000]]) {
      assert.equal(schema.$defs[kind].properties.source.maxLength, max);
      assert.equal(schema.$defs[kind].properties.source['x-workshop-maxUTF16Length'], max);
      assert.equal(schema.$defs[kind].additionalProperties, false);
      if (kind === 'markdown') assert.equal(schema.$defs[kind].properties.height, undefined);
      else assert.deepEqual(schema.$defs[kind].properties.height, { type: 'integer', minimum: 120, maximum: 640 });
    }
    const invalid = [
      p => { p.kind = 'canvas'; },
      p => { p.html.extra = 'unknown'; },
      p => { p.svg = { source: '<svg/>' }; },
      p => { delete p.html.source; },
      p => { p.html = null; },
      p => { p.html = []; },
      p => { p.html.source = ''; },
      p => { p.html.source = ' \n\t'; },
      p => { p.html.source = 'x\u0000'; },
      p => { p.html.source = 'x'.repeat(60001); },
      p => { p.html.source = '🙂'.repeat(30001); },
      p => { p.html.height = 119; },
      p => { p.html.height = 641; },
      p => { p.html.height = 240.5; },
      p => { p.html.height = '240'; },
      p => { p.html.height = null; },
      p => { p.kind = 'markdown'; delete p.html; p.markdown = { source: 'x'.repeat(20001) }; },
      p => { p.kind = 'markdown'; delete p.html; p.markdown = { source: 'ok', height: 240 }; },
      p => { p.kind = 'svg'; delete p.html; p.svg = { source: 'x'.repeat(60001) }; },
      p => { p.kind = 'svg'; delete p.html; p.svg = { source: '<svg/>', height: 119 }; }
    ];
    for (const [index, change] of invalid.entries()) {
      const bad = structuredClone(doc); change(bad.lessons[0].blocks[2].presentation);
      assert.equal((await publishCourse(base, key.accessToken, bad, { revision: 1 })).status, 422, 'invalid rich payload ' + index);
    }
    const noFallback = structuredClone(doc); delete noFallback.lessons[0].blocks[2].text;
    assert.equal((await publishCourse(base, key.accessToken, noFallback, { revision: 1 })).status, 422);
    const boundary = structuredClone(doc);
    boundary.lessons[0].blocks[0].presentation.markdown.source = 'm'.repeat(20000);
    boundary.lessons[0].blocks[1].presentation.svg = { source: '🙂'.repeat(30000), height: 120 };
    boundary.lessons[0].blocks[2].presentation.html = { source: 'h'.repeat(60000), height: 640 };
    assert.equal((await publishCourse(base, key.accessToken, boundary, { revision: 1 })).status, 200);
    assert.deepEqual((await native('courses/' + doc.id, { auth: session })).value.data.course, boundary);
    const oversized = structuredClone(doc);
    oversized.lessons[0].blocks = Array.from({ length: 18 }, () => ({ id: randomUUID(), type: 'text', text: '完整可读退路', presentation: { kind: 'html', html: { source: 'x'.repeat(60000) } } }));
    assert.equal((await publishCourse(base, key.accessToken, oversized, { revision: 2 })).status, 413, '1 MiB transport limit still applies');
  });
});

test('course structured extensions reject invalid bounds, references and misplaced fields', async () => {
  await withTextIngress(async ({ native, base, session }) => {
    const key = (await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} })).value.data;
    const original = programmingCourse();
    assert.equal((await publishCourse(base, key.accessToken, original)).status, 201);
    const invalid = [
      d => { d.lessons[0].objectives = ['']; },
      d => { d.lessons[0].objectives = Array(7).fill('目标'); },
      d => { d.lessons[0].objectives = ['x'.repeat(501)]; },
      d => { d.lessons[0].estimatedMinutes = 0; },
      d => { d.lessons[0].estimatedMinutes = 181; },
      d => { d.lessons[0].estimatedMinutes = 1.5; },
      d => { d.lessons[0].blocks[0].title = 'x'.repeat(241); },
      d => { delete d.lessons[0].blocks[0].text; },
      d => { d.lessons[0].blocks[0].presentation.kind = 'html'; },
      d => { d.lessons[0].blocks[0].presentation.extra = true; },
      d => { d.lessons[0].blocks[0].presentation.table = { columns: ['a'], rows: [['b']] }; },
      d => { d.lessons[0].blocks[0].presentation.code.language = 'c++/html'; },
      d => { d.lessons[0].blocks[0].presentation.code.language = 'cpp\n'; },
      d => { d.lessons[0].blocks[0].presentation.code.language = 'cpp\r'; },
      d => { d.lessons[0].blocks[0].presentation.code.source = ''; },
      d => { d.lessons[0].blocks[0].presentation.code.source = 'x'.repeat(20001); },
      d => { d.lessons[0].blocks[0].presentation.code.source = 'x\u0000'; },
      d => { d.lessons[0].blocks[0].presentation.code.execute = true; },
      d => { d.lessons[0].blocks[0].presentation.code.highlightLines = [0]; },
      d => { d.lessons[0].blocks[0].presentation.code.highlightLines = [2, 2]; },
      d => { d.lessons[0].blocks[0].presentation.code.highlightLines = [9]; },
      d => { d.lessons[0].blocks[0].presentation.code.annotations = [{ line: 6, text: 'a' }, { line: 6, text: 'b' }]; },
      d => { d.lessons[0].blocks[0].presentation.code.annotations = [{ line: 9, text: 'missing' }]; },
      d => { d.lessons[0].blocks[0].presentation.code.stdin = 'x'.repeat(4001); },
      d => { d.lessons[0].blocks[0].presentation.code.expectedOutput = 'x'.repeat(8001); },
      d => { d.lessons[0].blocks[1].presentation.table.rows[0].pop(); },
      d => { d.lessons[0].blocks[1].presentation.table.columns = []; },
      d => { d.lessons[0].blocks[1].presentation.table.rows[0][0] = 'x'.repeat(2001); },
      d => { d.lessons[0].blocks[2].presentation.steps = []; },
      d => { d.lessons[0].blocks[2].presentation.steps[0].extra = true; },
      d => { d.lessons[0].blocks[3].presentation.items = [{ title: 'one', text: 'one' }]; },
      d => { d.lessons[0].blocks[4].presentation.cards = []; },
      d => { d.lessons[0].blocks[4].presentation.cards[0].back = 'x'.repeat(4001); },
      d => { d.lessons[0].blocks[5].presentation = { kind: 'code', code: { language: 'cpp', source: 'int x;' } }; },
      d => { d.lessons[0].blocks[0].code = { language: 'cpp', source: 'int x;' }; },
      d => { d.lessons[0].blocks[0].hints = ['hint']; },
      d => { d.lessons[0].blocks[5].answerFormat = 'code'; },
      d => { d.lessons[0].blocks[5].hints = Array(6).fill('hint'); },
      d => { d.lessons[0].blocks[6].answerFormat = 'binary'; },
      d => { d.lessons[0].blocks[6].acceptedAnswers = ['x'.repeat(20001)]; },
      d => { d.lessons[0].blocks[7].acceptedAnswers = ['x'.repeat(8001)]; },
      d => { d.lessons[0].blocks[0].presentation.code = { language: 'cpp', source: 'a\r\nb\rc\nd', highlightLines: [5] }; }
    ];
    for (const [index, modify] of invalid.entries()) {
      const doc = structuredClone(original); modify(doc);
      const result = await publishCourse(base, key.accessToken, doc, { revision: 1 });
      assert.equal(result.status, 422, 'invalid structured case ' + index);
    }
    assert.equal((await native('courses/' + original.id, { auth: session })).value.data.revision, 1);
    const boundary = structuredClone(original);
    boundary.lessons[0].objectives = Array(6).fill('目标'.repeat(250)); boundary.lessons[0].estimatedMinutes = 180;
    boundary.lessons[0].blocks[0].presentation.code = { language: 'c++', source: 'x'.repeat(20000), highlightLines: [1], annotations: [], stdin: '', expectedOutput: '' };
    boundary.lessons[0].blocks[6].acceptedAnswers = ['x'.repeat(20000)]; boundary.lessons[0].blocks[7].acceptedAnswers = ['x'.repeat(8000)];
    assert.equal((await publishCourse(base, key.accessToken, boundary, { revision: 1 })).status, 200);
  });
});

test('course programming answers keep exact data, format limits, idempotency and valid-response completion', async () => {
  await withTextIngress(async ({ native, base, session }) => {
    const key = (await native('integrations/course-tokens', { auth: session, method: 'POST', body: {} })).value.data;
    const doc = programmingCourse(), lesson = doc.lessons[0];
    lesson.blocks = lesson.blocks.filter(block => block.type === 'question');
    lesson.blocks.push({ id: randomUUID(), type: 'question', text: '保持旧版短答限制', questionType: 'shortAnswer', acceptedAnswers: ['reference'] });
    assert.equal((await publishCourse(base, key.accessToken, doc)).status, 201);
    const path = 'courses/' + doc.id + '/progress';
    const mutate = body => native(path, { auth: session, method: 'POST', body: { mutationID: randomUUID(), courseRevision: 1, lessonID: lesson.id, ...body } });
    assert.equal((await mutate({ completed: true })).status, 409);
    const choice = lesson.blocks[0], code = lesson.blocks[1], output = lesson.blocks[2], legacy = lesson.blocks[3];
    assert.equal((await mutate({ blockID: choice.id, selectedOptionIDs: ['address'] })).status, 200, 'wrong but valid choice remains a valid response');
    const source = '#include <iostream>\r\nstd::cout << "Case  And  Spaces";\n' + '中'.repeat(20000 - 64);
    const codeMutation = { mutationID: randomUUID(), blockID: code.id, text: source };
    const saved = await mutate(codeMutation);
    assert.equal(saved.status, 200); assert.equal(saved.value.data.answers.find(answer => answer.blockID === code.id).text, source);
    assert.deepEqual((await mutate(codeMutation)).value.data, saved.value.data, 'long code answers retain existing idempotent retry semantics');
    assert.equal((await mutate({ ...codeMutation, text: source + 'x' })).status, 409);
    assert.equal((await mutate({ blockID: code.id, text: 'x'.repeat(20001) })).status, 422);
    assert.equal((await mutate({ blockID: output.id, text: 'x'.repeat(8001) })).status, 422);
    assert.equal((await mutate({ blockID: legacy.id, text: 'x'.repeat(4001) })).status, 422, 'new formats do not loosen legacy text limits');
    assert.equal((await mutate({ blockID: code.id, text: '   ' })).status, 422);
    const maximumCode = 'x'.repeat(20000);
    // Escaped JSON needs up to six bytes for each UTF-16 unit; body cap must still admit a valid 20k code answer.
    const escapedBody = JSON.stringify({ mutationID: randomUUID(), courseRevision: 1, lessonID: lesson.id, blockID: code.id, text: maximumCode }).replaceAll('x', '\\u0078');
    const escapedResponse = await fetch(base + '/api/native/v1/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + session, 'Content-Type': 'application/json' }, body: escapedBody });
    assert.equal(escapedResponse.status, 200); assert.equal((await escapedResponse.json()).data.answers.find(answer => answer.blockID === code.id).text, maximumCode);
    assert.equal((await mutate({ blockID: output.id, text: 'o'.repeat(8000) })).status, 200);
    const completed = await mutate({ blockID: legacy.id, text: 't'.repeat(4000), completed: true });
    assert.equal(completed.status, 200); assert.deepEqual(completed.value.data.completedLessonIDs, [lesson.id], 'reference answer mismatch does not block completion');
    const stranger = (await native('accounts', { method: 'POST', body: { email: 'programming-stranger@test.invalid', password } })).value.data.accessToken;
    assert.equal((await native(path, { auth: stranger })).status, 404, 'programming progress remains account isolated');
  });
});
