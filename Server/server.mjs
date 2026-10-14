import http from 'node:http';
import http2 from 'node:http2';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, scryptSync, timingSafeEqual, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

let deploymentRevision = 'unversioned';
try { deploymentRevision = readFileSync(join(dirname(new URL(import.meta.url).pathname), 'REVISION'), 'utf8').trim(); } catch {}
if (!/^[a-f0-9]{40}$/.test(deploymentRevision)) deploymentRevision = 'unversioned';

const sha = value => createHash('sha256').update(value).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emptyWorkspace = name => ({ format: 'guangyi-native', schemaVersion: 1, records: [], series: [], activities: [], revisions: [], assets: [], trash: [], profile: { name, timezone: 'Asia/Shanghai' } });
class APIError extends Error { constructor(status, code) { super(code); this.status = status; } }
export function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.format !== 'guangyi-native' || snapshot.schemaVersion !== 1) throw new APIError(422, 'INVALID_SNAPSHOT');
  for (const key of ['records', 'series', 'activities', 'revisions', 'assets', 'trash']) {
    if (!Array.isArray(snapshot[key]) || snapshot[key].length > 100000) throw new APIError(422, 'INVALID_SNAPSHOT');
  }
  const ids = new Set();
  const states = { AREA: ['OPEN'], KNOWLEDGE: ['OPEN'], PROJECT: ['PLANNED', 'ACTIVE', 'WAITING', 'PAUSED', 'COMPLETED'],
    MILESTONE: ['PLANNED', 'ACTIVE', 'DONE', 'CANCELLED'], TASK: ['TODO', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELLED'], DEADLINE: ['OPEN', 'DONE', 'CANCELLED'], REMINDER: ['OPEN', 'DONE'] };
  for (const record of snapshot.records) {
    if (!uuid.test(record.id) || ids.has(record.id) || !states[record.kind]?.includes(record.status) ||
      typeof record.title !== 'string' || !record.title.trim() || record.title.length > 480 ||
      !Number.isSafeInteger(record.version) || record.version < 1 || typeof record.body !== 'string' || record.body.length > 500000)
      throw new APIError(422, 'INVALID_RECORD');
    ids.add(record.id);
    for (const field of ['createdAt', 'updatedAt', 'dueDate', 'remindAt', 'scheduledAt', 'snoozedUntil']) {
      if (record[field] != null && (typeof record[field] !== 'string' || !Number.isFinite(Date.parse(record[field])))) throw new APIError(422, 'INVALID_DATE');
    }
    try { new Intl.DateTimeFormat('en-US', { timeZone: record.timezone }).format(); } catch { throw new APIError(422, 'INVALID_TIMEZONE'); }
  }
  for (const record of snapshot.records) {
    for (const field of ['projectID', 'milestoneID', 'areaID']) if (record[field] != null && !ids.has(record[field])) throw new APIError(422, 'MISSING_PARENT');
  }
  const assetIDs = new Set(), noteIDs = new Set(snapshot.records.filter(r => r.kind === 'KNOWLEDGE').map(r => r.id));
  for (const asset of snapshot.assets) {
    if (!uuid.test(asset.id) || assetIDs.has(asset.id) || !noteIDs.has(asset.ownerID) || typeof asset.data !== 'string' ||
      asset.data.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data)) throw new APIError(422, 'INVALID_ASSET');
    const data = Buffer.from(asset.data, 'base64');
    if (data.length > 10 * 1024 * 1024 || data.subarray(0, 5).toString() !== '%PDF-') throw new APIError(422, 'INVALID_ASSET');
    assetIDs.add(asset.id);
  }
}
function moment(record) {
  if (record.snoozedUntil) return Date.parse(record.snoozedUntil);
  let at = record.kind === 'REMINDER' ? record.remindAt : record.dueDate ?? record.scheduledAt;
  if (!at) return NaN;
  if (record.kind !== 'REMINDER' && record.dueDate && record.dateOnly) {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: record.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = value => Object.fromEntries(formatter.formatToParts(new Date(value)).map(p => [p.type, p.value]));
    const day = parts(Date.parse(at));
    const target = Date.UTC(Number(day.year), Number(day.month) - 1, Number(day.day), 9);
    let estimate = target;
    for (let i = 0; i < 3; i++) {
      const p = parts(estimate);
      const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
      estimate = target - (wall - estimate);
    }
    at = estimate;
  } else at = Date.parse(at);
  return at - Number(record.notificationLeadMinutes ?? 0) * 60000;
}
export function createNativeServer(configuration) {
  const { databasePath, adminEmail, adminPassword, displayName = '广益', sendPush } = configuration;
  if (!adminEmail || !adminPassword || adminPassword.length < 16 || /^replace[-_]/i.test(adminPassword)) throw new Error('ADMIN_EMAIL and a unique 16+ character ADMIN_PASSWORD are required');
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE,salt TEXT,hash BLOB,name TEXT);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS workspaces(user_id INTEGER PRIMARY KEY REFERENCES users(id),revision INTEGER,snapshot TEXT);
    CREATE TABLE IF NOT EXISTS history(user_id INTEGER,revision INTEGER,snapshot TEXT,created INTEGER,PRIMARY KEY(user_id,revision));
    CREATE TABLE IF NOT EXISTS devices(user_id INTEGER,device_id TEXT,token TEXT,platform TEXT,bundle_id TEXT,environment TEXT,created INTEGER,PRIMARY KEY(user_id,device_id));
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,user_id INTEGER,accepted INTEGER,lease_until INTEGER);`);
  const email = adminEmail.trim().toLowerCase();
  if (!db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
    const salt = randomBytes(16).toString('hex'), hash = scryptSync(adminPassword, salt, 64);
    const user = db.prepare('INSERT INTO users(email,salt,hash,name) VALUES(?,?,?,?)').run(email, salt, hash, displayName);
    db.prepare('INSERT INTO workspaces(user_id,revision,snapshot) VALUES(?,0,?)').run(user.lastInsertRowid, JSON.stringify(emptyWorkspace(displayName)));
  }
  const attempts = new Map();
  const allowedBundles = new Set((configuration.allowedBundles ?? 'com.guangyi.workspace.native.ios,com.guangyi.workspace.native.mac').split(','));
  function userFor(request) {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 300) throw new APIError(401, 'UNAUTHENTICATED');
    const session = db.prepare('SELECT user_id FROM sessions WHERE hash=? AND expires>?').get(sha(header.slice(7)), Date.now());
    if (!session) throw new APIError(401, 'UNAUTHENTICATED');
    return session.user_id;
  }
  async function body(request, limit = 128 * 1024 * 1024) {
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > limit) throw new APIError(413, 'TOO_LARGE'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new APIError(400, 'INVALID_JSON'); }
  }
  function respond(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  }
  const server = http.createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/deploy-revision.json' && request.method === 'GET') return respond(response, 200, { revision: deploymentRevision });
      if (path === '/health' && request.method === 'GET') return respond(response, 200, { status: 'ok' });
      if (path === '/api/native/v1/session' && request.method === 'POST') {
        const ip = request.socket.remoteAddress ?? 'unknown', now = Date.now(), prior = attempts.get(ip);
        const counter = prior && now - prior.start < 600000 ? prior : { start: now, count: 0 };
        if (++counter.count > 20) throw new APIError(429, 'RATE_LIMITED');
        attempts.set(ip, counter);
        const value = await body(request, 8192);
        if (typeof value.email !== 'string' || typeof value.password !== 'string' || value.password.length > 1024) throw new APIError(401, 'INVALID_CREDENTIALS');
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(value.email.trim().toLowerCase());
        const salt = user?.salt ?? 'invalid-user-constant-salt';
        const candidate = scryptSync(value.password, salt, 64);
        if (!user || !timingSafeEqual(candidate, user.hash)) throw new APIError(401, 'INVALID_CREDENTIALS');
        const accessToken = randomBytes(32).toString('base64url');
        db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(sha(accessToken), user.id, now + 30 * 86400000);
        return respond(response, 200, { data: { accessToken, displayName: user.name } });
      }
      const userID = userFor(request);
      if (path === '/api/native/v1/session' && request.method === 'DELETE') {
        db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(request.headers.authorization.slice(7)));
        return respond(response, 200, { data: { signedOut: true } });
      }
      if (path === '/api/native/v1/workspace' && request.method === 'GET') {
        const row = db.prepare('SELECT revision,snapshot FROM workspaces WHERE user_id=?').get(userID);
        return respond(response, 200, { data: { revision: row.revision, snapshot: JSON.parse(row.snapshot) } });
      }
      if (path === '/api/native/v1/workspace' && request.method === 'PUT') {
        const match = request.headers['if-match'];
        if (typeof match !== 'string' || !/^"\d+"$/.test(match)) throw new APIError(428, 'VERSION_REQUIRED');
        const revision = Number(match.slice(1, -1));
        if (!Number.isSafeInteger(revision)) throw new APIError(400, 'INVALID_VERSION');
        const value = await body(request); validateSnapshot(value.snapshot);
        const snapshot = JSON.stringify(value.snapshot);
        db.exec('BEGIN IMMEDIATE');
        try {
          const old = db.prepare('SELECT revision,snapshot FROM workspaces WHERE user_id=?').get(userID);
          if (old.revision !== revision) throw new APIError(409, 'WRITE_CONFLICT');
          db.prepare('INSERT INTO history(user_id,revision,snapshot,created) VALUES(?,?,?,?)').run(userID, old.revision, old.snapshot, Date.now());
          db.prepare('UPDATE workspaces SET revision=revision+1,snapshot=? WHERE user_id=?').run(snapshot, userID);
          db.prepare('DELETE FROM history WHERE user_id=? AND revision<?').run(userID, Math.max(0, revision - 4));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return respond(response, 200, { data: { revision: revision + 1, snapshot: value.snapshot } });
      }
      if (path === '/api/native/v1/devices' && request.method === 'PUT') {
        const device = await body(request, 8192);
        if (!uuid.test(device.deviceID) || !['iOS', 'macOS'].includes(device.platform) ||
          !['sandbox', 'production'].includes(device.environment) || !allowedBundles.has(device.bundleID) ||
          typeof device.token !== 'string' || !/^[a-f0-9]{32,512}$/i.test(device.token)) throw new APIError(422, 'INVALID_DEVICE');
        const old = db.prepare('SELECT created FROM devices WHERE user_id=? AND device_id=?').get(userID, device.deviceID);
        db.prepare(`INSERT INTO devices(user_id,device_id,token,platform,bundle_id,environment,created) VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(user_id,device_id) DO UPDATE SET token=excluded.token,platform=excluded.platform,bundle_id=excluded.bundle_id,environment=excluded.environment`)
          .run(userID, device.deviceID, device.token, device.platform, device.bundleID, device.environment, old?.created ?? Date.now());
        return respond(response, 200, { data: { registered: true, deliveryEnabled: !!sendPush } });
      }
      if (path === '/api/native/v1/devices' && request.method === 'DELETE') {
        const device = await body(request, 8192);
        db.prepare('DELETE FROM devices WHERE user_id=? AND device_id=?').run(userID, device.deviceID);
        return respond(response, 200, { data: { removed: true } });
      }
      throw new APIError(404, 'NOT_FOUND');
    } catch (error) { respond(response, error instanceof APIError ? error.status : 500, { error: { code: error instanceof APIError ? error.message : 'INTERNAL_ERROR' } }); }
  });
  server.requestTimeout = 60000;
  let sweeping = false;
  async function sweep(now = Date.now()) {
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    for (const [ip, value] of attempts) if (now - value.start > 600000) attempts.delete(ip);
    if (!sendPush || sweeping) return { accepted: 0 };
    sweeping = true; let accepted = 0;
    try {
      for (const row of db.prepare('SELECT user_id,snapshot FROM workspaces').all()) {
        const snapshot = JSON.parse(row.snapshot);
        const devices = db.prepare('SELECT * FROM devices WHERE user_id=?').all(row.user_id);
        const parentLive = id => !id || snapshot.records.some(r => r.id === id && !r.deletedAt && !r.archivedAt);
        for (const record of snapshot.records) {
          if (record.deletedAt || record.archivedAt || ['DONE', 'COMPLETED', 'CANCELLED'].includes(record.status) ||
            !record.notificationsEnabled || !parentLive(record.projectID)) continue;
          const at = moment(record);
          if (!Number.isFinite(at) || at > now || at < now - 86400000) continue;
          for (const device of devices) {
            if (device.created > at) continue;
            const id = sha(JSON.stringify([row.user_id, device.device_id, record.id, at]));
            const claim = db.prepare(`INSERT INTO deliveries(id,user_id,accepted,lease_until) VALUES(?,?,0,?)
              ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE deliveries.accepted=0 AND deliveries.lease_until<?`)
              .run(id, row.user_id, now + 120000, now);
            if (!claim.changes) continue;
            const fresh = JSON.parse(db.prepare('SELECT snapshot FROM workspaces WHERE user_id=?').get(row.user_id).snapshot);
            const current = fresh.records.find(r => r.id === record.id);
            const activeDevice = db.prepare('SELECT * FROM devices WHERE user_id=? AND device_id=?').get(row.user_id, device.device_id);
            const freshParent = !current?.projectID || fresh.records.some(r => r.id === current.projectID && !r.deletedAt && !r.archivedAt);
            if (!activeDevice || !current || !freshParent || current.deletedAt || current.archivedAt || ['DONE', 'COMPLETED', 'CANCELLED'].includes(current.status) || !current.notificationsEnabled || moment(current) !== at) continue;
            let result;
            try { result = await sendPush(activeDevice, { aps: { alert: { title: '广益 WorkSpace · 提醒', body: current.title }, sound: 'default', category: 'WORKSPACE_REMINDER' }, id: current.id }, id); }
            catch { continue; }
            if (result.accepted) { db.prepare('UPDATE deliveries SET accepted=1 WHERE id=?').run(id); accepted++; }
            else if (result.expired) db.prepare('DELETE FROM devices WHERE user_id=? AND device_id=?').run(row.user_id, device.device_id);
          }
        }
      }
      db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
      for (const [ip, value] of attempts) if (now - value.start > 600000) attempts.delete(ip);
    } finally { sweeping = false; }
    return { accepted };
  }
  return { server, db, sweep, close: () => { server.close(); db.close(); } };
}
export function applePushSender({ teamID, keyID, keyPath }) {
  if (!teamID || !keyID || !keyPath) return undefined;
  const key = createPrivateKey(readFileSync(keyPath));
  let jwt = '', minted = 0;
  return async (device, payload, collapseID) => {
    if (Date.now() - minted > 45 * 60000) {
      const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyID })).toString('base64url');
      const claims = Buffer.from(JSON.stringify({ iss: teamID, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
      const data = header + '.' + claims;
      jwt = data + '.' + sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url'); minted = Date.now();
    }
    return new Promise((resolve, reject) => {
      const session = http2.connect(device.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com');
      const timer = setTimeout(() => { session.destroy(); reject(new Error('APNS_TIMEOUT')); }, 15000);
      const finish = () => { clearTimeout(timer); session.close(); };
      session.on('error', error => { finish(); reject(error); });
      const request = session.request({ ':method': 'POST', ':path': '/3/device/' + device.token, authorization: 'bearer ' + jwt,
        'apns-topic': device.bundle_id, 'apns-push-type': 'alert', 'apns-priority': '10', 'apns-collapse-id': collapseID.slice(0, 64),
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 86400) });
      let status = 0; request.on('response', headers => { status = Number(headers[':status']); });
      request.on('data', () => {}); request.on('error', error => { finish(); reject(error); });
      request.on('end', () => { finish(); resolve({ accepted: status === 200, expired: status === 410 }); });
      request.end(JSON.stringify(payload));
    });
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.umask(0o077);
  const app = createNativeServer({ databasePath: process.env.DATABASE_PATH ?? '/data/workspace.sqlite', adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD, displayName: process.env.DISPLAY_NAME, allowedBundles: process.env.APNS_ALLOWED_BUNDLE_IDS,
    sendPush: applePushSender({ teamID: process.env.APNS_TEAM_ID, keyID: process.env.APNS_KEY_ID, keyPath: process.env.APNS_PRIVATE_KEY_FILE }) });
  app.server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '127.0.0.1', () => console.log('Native workspace API is listening'));
  setInterval(() => app.sweep().catch(() => console.error('notification_dispatch_failed')), 30000).unref();
}
