import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNativeServer, apnsDelivery, effectiveDeadline, formatCountdown, visibleRecord, compareActionRecords, compareDeadlineRecords } from './server.mjs';
let app, origin, token;
const password = 'test-only-password-not-a-production-credential';
const registeredDeviceID = randomUUID();
let reminderPushCount = 0, workspacePushes = [], workspaceCollapseIDs = [], pushResult = { accepted: true, expired: false };
before(async () => {
  app = createNativeServer({ databasePath: ':memory:', adminEmail: 'owner@test.invalid', adminPassword: password,
    sendPush: async (_device, payload, collapseID) => {
      if (payload.kind === 'WORKSPACE_SYNC') { workspacePushes.push(payload); workspaceCollapseIDs.push(collapseID); }
      else { assert.equal(payload.aps.category, 'WORKSPACE_REMINDER'); reminderPushCount++; }
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
  const remote = (await call('workspace')).value.data;
  const snapshot = remote.snapshot, now = Date.now() + 1000;
  snapshot.records[0].remindAt = new Date(now - 100).toISOString();
  assert.equal((await call('workspace', 'PUT', { snapshot }, token, remote.revision)).status, 200);
  await Promise.all([app.sweep(now), app.sweep(now)]);
  assert.equal(reminderPushCount, 1);
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
