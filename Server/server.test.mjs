import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNativeServer } from './server.mjs';
let app, origin, token;
const password = 'test-only-password-not-a-production-credential';
let pushCount = 0, pushResult = { accepted: true, expired: false };
before(async () => {
  app = createNativeServer({ databasePath: ':memory:', adminEmail: 'owner@test.invalid', adminPassword: password,
    sendPush: async (_device, payload) => { assert.equal(payload.aps.category, 'WORKSPACE_REMINDER'); pushCount++; return pushResult; } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + app.server.address().port;
});
after(() => app.close());
async function call(path, method = 'GET', body, auth = token, revision) {
  const response = await fetch(origin + '/api/native/v1/' + path, { method, headers: {
    ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(revision !== undefined ? { 'If-Match': '"' + revision + '"' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, value: await response.json() };
}
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
  const device = { deviceID: randomUUID(), token: 'ab'.repeat(32), platform: 'iOS', bundleID: 'com.guangyi.workspace.native.ios', environment: 'sandbox' };
  assert.equal((await call('devices', 'PUT', { ...device, bundleID: 'other.app' })).status, 422);
  assert.equal((await call('devices', 'PUT', device)).status, 200);
});
test('server timer sends an accepted notification once and excludes completed reminders', async () => {
  const remote = (await call('workspace')).value.data;
  const snapshot = remote.snapshot, now = Date.now() + 1000;
  snapshot.records[0].remindAt = new Date(now - 100).toISOString();
  assert.equal((await call('workspace', 'PUT', { snapshot }, token, remote.revision)).status, 200);
  await Promise.all([app.sweep(now), app.sweep(now)]);
  assert.equal(pushCount, 1);
  await app.sweep(now); assert.equal(pushCount, 1);
  const next = (await call('workspace')).value.data;
  next.snapshot.records[0].status = 'DONE';
  next.snapshot.records[0].remindAt = new Date(now - 50).toISOString();
  await call('workspace', 'PUT', { snapshot: next.snapshot }, token, next.revision);
  await app.sweep(now); assert.equal(pushCount, 1);
});
test('expired APNs device registrations are removed', async () => {
  const remote = (await call('workspace')).value.data;
  remote.snapshot.records[0].status = 'OPEN'; remote.snapshot.records[0].remindAt = new Date(Date.now() + 2000).toISOString();
  await call('workspace', 'PUT', { snapshot: remote.snapshot }, token, remote.revision);
  pushResult = { accepted: false, expired: true };
  await app.sweep(Date.now() + 3000);
  assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM devices').get().n, 0);
});
test('logout revokes the session server-side', async () => {
  assert.equal((await call('session', 'DELETE')).status, 200);
  assert.equal((await call('workspace')).status, 401);
});
