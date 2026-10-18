import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import http2 from 'node:http2';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, createHmac, scryptSync, timingSafeEqual, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { effectiveDeadline, formatCountdown, visibleRecord, compareActionRecords, compareDeadlineRecords, webAsset } from './web.mjs';
import { createCourseAPI } from './courses.mjs';
import { createCourseExecutionClient } from './course-execution.mjs';
import { parseCalendarText, calendarTextPrompt, TextImportError, textImportPath, textImportProtocol, textImportLimit } from './text-ingress.mjs';

export { effectiveDeadline, formatCountdown, visibleRecord, compareActionRecords, compareDeadlineRecords };

let deploymentRevision = 'unversioned';
try { deploymentRevision = readFileSync(join(dirname(new URL(import.meta.url).pathname), 'REVISION'), 'utf8').trim(); } catch {}
if (!/^[a-f0-9]{40}$/.test(deploymentRevision)) deploymentRevision = 'unversioned';

const sha = value => createHash('sha256').update(value).digest('hex');
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes) {
  let bits = 0, value = 0, encoded = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { encoded += base32Alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) encoded += base32Alphabet[(value << (5 - bits)) & 31];
  return encoded;
}
export function totpCode(secret, now = Date.now()) {
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret) {
    const digit = base32Alphabet.indexOf(char);
    if (digit < 0) throw new Error('INVALID_TOTP_SECRET');
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
const nativeCallbackURL = 'guangyi-workspace://auth/callback';
const webAuthValue = /^[A-Za-z0-9_-]{43}$/;
const pkceVerifier = /^[A-Za-z0-9._~-]{43,128}$/;
function validWebAuthRequest(value) {
  return value && !Array.isArray(value) && typeof value === 'object' &&
    Object.keys(value).length === 2 && typeof value.codeChallenge === 'string' && webAuthValue.test(value.codeChallenge) &&
    Buffer.from(value.codeChallenge, 'base64url').toString('base64url') === value.codeChallenge &&
    typeof value.state === 'string' && webAuthValue.test(value.state);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emptyWorkspace = name => ({ format: 'guangyi-native', schemaVersion: 1, records: [], series: [], activities: [], revisions: [], assets: [], trash: [], profile: { name, timezone: 'Asia/Shanghai' } });
class APIError extends Error { constructor(status, code) { super(code); this.status = status; } }
function passkeyRecoveryTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS passkey_recoveries(
    hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS passkey_recoveries_user_id ON passkey_recoveries(user_id);`);
}
function createPasskeyRecovery(db, { email, origin, now = Date.now() }) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || parsed.username || parsed.password || parsed.protocol !== 'https:') throw new Error('INVALID_PASSKEY_ORIGIN');
  passkeyRecoveryTable(db);
  const users = email
    ? db.prepare('SELECT id,email FROM users WHERE email=?').all(email.trim().toLowerCase())
    : db.prepare('SELECT id,email FROM users ORDER BY id').all();
  if (users.length !== 1) throw new Error(email ? 'ACCOUNT_NOT_FOUND' : 'ACCOUNT_MUST_BE_SPECIFIED');
  const user = users[0], token = randomBytes(32).toString('base64url'), expires = now + 10 * 60000;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM passkey_recoveries WHERE expires<=? OR user_id=?').run(now, user.id);
    db.prepare('INSERT INTO passkey_recoveries(hash,user_id,expires,created) VALUES(?,?,?,?)').run(sha(token), user.id, expires, now);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return { token, url: `${origin}/#passkey-recovery=${token}`, expires, account: user.email };
}
export function issuePasskeyRecovery({ databasePath, email, origin = 'https://workspace.kdfz.com.cn', now = Date.now() }) {
  if (typeof databasePath !== 'string' || databasePath === ':memory:' || !existsSync(databasePath)) throw new Error('DATABASE_NOT_FOUND');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    return createPasskeyRecovery(db, { email, origin, now });
  }
  finally { db.close(); }
}
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
  if (['TASK', 'MILESTONE', 'REMINDER'].includes(record.kind) && record.remindAt) return Date.parse(record.remindAt);
  let at = record.dueDate ?? record.scheduledAt;
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
    CREATE TABLE IF NOT EXISTS sharing_invitations(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),invitee_id INTEGER NOT NULL REFERENCES users(id),role TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,UNIQUE(owner_id,invitee_id));
    CREATE TABLE IF NOT EXISTS sharing_members(id TEXT PRIMARY KEY,owner_id INTEGER NOT NULL REFERENCES users(id),member_id INTEGER NOT NULL REFERENCES users(id),role TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(owner_id,member_id));
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),expires INTEGER);
    CREATE TABLE IF NOT EXISTS workspaces(user_id INTEGER PRIMARY KEY REFERENCES users(id),revision INTEGER,snapshot TEXT);
    CREATE TABLE IF NOT EXISTS history(user_id INTEGER,revision INTEGER,snapshot TEXT,created INTEGER,PRIMARY KEY(user_id,revision));
    CREATE TABLE IF NOT EXISTS devices(user_id INTEGER,device_id TEXT,token TEXT,platform TEXT,bundle_id TEXT,environment TEXT,created INTEGER,PRIMARY KEY(user_id,device_id));
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,user_id INTEGER,accepted INTEGER,lease_until INTEGER);
    CREATE TABLE IF NOT EXISTS text_tokens(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,last_used INTEGER);
    CREATE INDEX IF NOT EXISTS text_tokens_user ON text_tokens(user_id);
    CREATE TABLE IF NOT EXISTS text_imports(user_id INTEGER NOT NULL REFERENCES users(id),idempotency_key TEXT NOT NULL,body_hash TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(user_id,idempotency_key));`);
  const email = adminEmail.trim().toLowerCase();
  if (!db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
    const salt = randomBytes(16).toString('hex'), hash = scryptSync(adminPassword, salt, 64);
    const user = db.prepare('INSERT INTO users(email,salt,hash,name) VALUES(?,?,?,?)').run(email, salt, hash, displayName);
    db.prepare('INSERT INTO workspaces(user_id,revision,snapshot) VALUES(?,0,?)').run(user.lastInsertRowid, JSON.stringify(emptyWorkspace(displayName)));
  }
  const rpID = configuration.passkeyRPID ?? 'workspace.kdfz.com.cn';
  const passkeyOrigin = configuration.passkeyOrigin ?? `https://${rpID}`;
  const passkeyApps = (configuration.passkeyApps ?? '67WBP6S5QL.com.guangyi.workspace.native.ios,67WBP6S5QL.com.guangyi.workspace.native.mac').split(',').filter(Boolean);
  const parsedOrigin = new URL(passkeyOrigin);
  if (parsedOrigin.hostname !== rpID || parsedOrigin.origin !== passkeyOrigin || (parsedOrigin.protocol !== 'https:' && !(rpID === 'localhost' && parsedOrigin.protocol === 'http:'))) throw new Error('INVALID_PASSKEY_ORIGIN');
  const textEndpoint = passkeyOrigin + textImportPath;
  const textNow = configuration.textNow ?? Date.now;
  const textAttempts = new Map();
  function textRateLimit(key, window, limit) {
    const now = textNow();
    for (const [entryKey, entry] of textAttempts) if (now >= entry.until) textAttempts.delete(entryKey);
    const prior = textAttempts.get(key);
    if (!prior && textAttempts.size >= 10000) throw new APIError(429, 'RATE_LIMITED');
    const entry = prior ?? { until: now + window, count: 0 };
    textAttempts.set(key, entry);
    if (++entry.count > limit) throw new APIError(429, 'RATE_LIMITED');
  }
  function textPeer(request) {
    const peer = request.socket.remoteAddress ?? 'unknown', forwarded = request.headers['x-real-ip'];
    const local = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    return local && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
  }
  function textCredential(request) {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !/^Bearer wsi_[A-Za-z0-9_-]{43}$/.test(header)) throw new APIError(401, 'INVALID_TEXT_TOKEN');
    const credential = db.prepare('SELECT * FROM text_tokens WHERE hash=? AND expires>?').get(sha(header.slice(7)), textNow());
    if (!credential) throw new APIError(401, 'INVALID_TEXT_TOKEN');
    return credential;
  }
  const textCredentialInfo = row => ({ id: row.id, name: row.name, created: row.created, expires: row.expires, ...(row.last_used != null ? { lastUsed: row.last_used } : {}) });
  db.exec(`CREATE TABLE IF NOT EXISTS passkey_users(user_id INTEGER PRIMARY KEY REFERENCES users(id),handle TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),public_key BLOB NOT NULL,counter INTEGER NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS passkey_challenges(id TEXT PRIMARY KEY,kind TEXT NOT NULL,challenge TEXT NOT NULL,user_id INTEGER,session_hash TEXT,expires INTEGER NOT NULL);`);
  passkeyRecoveryTable(db);
  const passkeyNow = configuration.passkeyNow ?? Date.now;
  const webAuthNow = configuration.webAuthNow ?? Date.now;
  const totpNow = configuration.totpNow ?? Date.now;
  db.exec(`CREATE TABLE IF NOT EXISTS totp_credentials(user_id INTEGER PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,last_step INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS totp_pending(user_id INTEGER PRIMARY KEY REFERENCES users(id),secret TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS totp_recovery_codes(user_id INTEGER NOT NULL REFERENCES users(id),hash TEXT NOT NULL,PRIMARY KEY(user_id,hash));`);
  function totpStep(secret, code) {
    if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) return null;
    const now = totpNow(), current = Math.floor(now / 30000);
    for (const step of [current, current - 1, current + 1]) {
      if (step >= 0 && timingSafeEqual(Buffer.from(totpCode(secret, step * 30000)), Buffer.from(code))) return step;
    }
    return null;
  }
  function consumeSecondFactor(userID, code) {
    const credential = db.prepare('SELECT secret,last_step FROM totp_credentials WHERE user_id=?').get(userID);
    if (!credential) return false;
    const step = totpStep(credential.secret, code);
    if (step !== null && step > credential.last_step) {
      return db.prepare('UPDATE totp_credentials SET last_step=? WHERE user_id=? AND last_step<?').run(step, userID, step).changes === 1;
    }
    if (typeof code !== 'string' || !/^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/i.test(code)) return false;
    return db.prepare('DELETE FROM totp_recovery_codes WHERE user_id=? AND hash=?').run(userID, sha(code.toUpperCase())).changes === 1;
  }
  function totpRateLimit(userID) {
    const key = 'totp:' + userID, now = Date.now(), prior = attempts.get(key);
    const counter = prior && now - prior.start < 600000 ? prior : { start: now, count: 0 };
    attempts.set(key, counter);
    if (++counter.count > 20) throw new APIError(429, 'RATE_LIMITED');
  }
  async function totpBody(request, withCode = true) {
    sameWebOrigin(request); requireJSON(request);
    const value = await body(request, 512);
    if (!value || Array.isArray(value) || typeof value !== 'object' ||
      (withCode ? Object.keys(value).length !== 1 || typeof value.code !== 'string' || value.code.length > 32 : Object.keys(value).length !== 0))
      throw new APIError(400, 'INVALID_TOTP_REQUEST');
    return value;
  }

  db.exec(`CREATE TABLE IF NOT EXISTS web_auth_codes(
    hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),challenge TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL);`);
  const attempts = new Map();
  function registrationRateLimit(request) {
    const peer = request.socket.remoteAddress ?? 'unknown';
    // The local Nginx proxy overwrites X-Real-IP; never trust it from a remote peer.
    const forwarded = request.headers['x-real-ip'];
    const localProxy = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    const address = localProxy && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
    const now = Date.now();
    for (const [key, value] of attempts) if (now - value.start >= 600000) attempts.delete(key);
    for (const [key, limit] of [['registration:' + address, 6], ['registration:global', 60]]) {
      const prior = attempts.get(key);
      if (!prior && attempts.size >= 10000) throw new APIError(429, 'RATE_LIMITED');
      const counter = prior ?? { start: now, count: 0 };
      attempts.set(key, counter);
      if (++counter.count > limit) throw new APIError(429, 'RATE_LIMITED');
    }
  }
  function webAuthRateLimit(request) {
    const key = 'web-auth:' + (request.socket.remoteAddress ?? 'unknown'), now = Date.now(), old = attempts.get(key);
    const entry = old && now - old.start < 600000 ? old : { start: now, count: 0 };
    attempts.set(key, entry);
    if (++entry.count > 60) throw new APIError(429, 'RATE_LIMITED');
  }
  function sameWebOrigin(request) {
    if (request.headers.origin != null && request.headers.origin !== passkeyOrigin) throw new APIError(403, 'INVALID_ORIGIN');
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new APIError(403, 'INVALID_ORIGIN');
  }
  function requireJSON(request) {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new APIError(415, 'JSON_REQUIRED');
  }
  function passkeyRateLimit(request) {
    const key = 'passkey:' + (request.socket.remoteAddress ?? 'unknown'), now = Date.now(), old = attempts.get(key);
    const entry = old && now - old.start < 600000 ? old : { start: now, count: 0 };
    attempts.set(key, entry);
    if (++entry.count > 60) throw new APIError(429, 'RATE_LIMITED');
  }
  function issueChallenge(kind, challenge, userID = null, sessionHash = null) {
    db.prepare('DELETE FROM passkey_challenges WHERE expires<?').run(passkeyNow());
    if (db.prepare('SELECT COUNT(*) AS total FROM passkey_challenges').get().total >= 1000) throw new APIError(429, 'RATE_LIMITED');
    const id = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO passkey_challenges VALUES(?,?,?,?,?,?)').run(id, kind, challenge, userID, sessionHash, passkeyNow() + 300000);
    return id;
  }
  function consumeChallenge(id, kind, sessionHash = null) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new APIError(401, 'INVALID_CHALLENGE');
    const value = db.prepare('DELETE FROM passkey_challenges WHERE id=? AND kind=? AND session_hash IS ? RETURNING *').get(id, kind, sessionHash);
    if (!value || value.expires <= passkeyNow()) throw new APIError(401, 'INVALID_CHALLENGE');
    return value;
  }
  function recoveryFor(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new APIError(401, 'INVALID_RECOVERY_TOKEN');
    const hash = sha(token), value = db.prepare('SELECT hash,user_id,expires FROM passkey_recoveries WHERE hash=?').get(hash);
    if (!value || value.expires <= passkeyNow()) {
      db.prepare('DELETE FROM passkey_recoveries WHERE hash=?').run(hash);
      throw new APIError(401, 'INVALID_RECOVERY_TOKEN');
    }
    return value;
  }
  async function registrationOptions(userID) {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(userID);
    db.prepare('INSERT OR IGNORE INTO passkey_users(user_id,handle) VALUES(?,?)').run(userID, randomBytes(32).toString('base64url'));
    const handle = db.prepare('SELECT handle FROM passkey_users WHERE user_id=?').get(userID).handle;
    const credentials = db.prepare('SELECT id FROM passkeys WHERE user_id=?').all(userID);
    if (credentials.length >= 10) throw new APIError(422, 'PASSKEY_LIMIT');
    const options = await generateRegistrationOptions({ rpName: '广益 WorkSpace', rpID, userID: new Uint8Array(Buffer.from(handle, 'base64url')),
      userName: user.email, userDisplayName: user.name, attestationType: 'none', supportedAlgorithmIDs: [-7],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
      excludeCredentials: credentials.map(value => ({ id: value.id })) });
    return { user, options };
  }
  async function verifiedRegistration(value, challenge, userID) {
    let result;
    try { result = await verifyRegistrationResponse({ response: value.credential, expectedChallenge: challenge.challenge,
      expectedOrigin: passkeyOrigin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7] }); }
    catch { throw new APIError(401, 'INVALID_PASSKEY'); }
    if (!result.verified || !result.registrationInfo) throw new APIError(401, 'INVALID_PASSKEY');
    const credential = result.registrationInfo.credential;
    if (db.prepare('SELECT COUNT(*) AS total FROM passkeys WHERE user_id=?').get(userID).total >= 10) throw new APIError(422, 'PASSKEY_LIMIT');
    if (db.prepare('SELECT id FROM passkeys WHERE id=?').get(credential.id)) throw new APIError(409, 'PASSKEY_EXISTS');
    return credential;
  }
  function createSession(user) {
    const accessToken = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)').run(sha(accessToken), user.id, Date.now() + 30 * 86400000);
    return { accessToken, displayName: user.name, account: user.email };
  }
  const allowedBundles = new Set((configuration.allowedBundles ?? 'com.guangyi.workspace.native.ios,com.guangyi.workspace.native.mac').split(','));
  const pendingPushes = new Set();
  function queuePush(work) {
    const pending = Promise.resolve().then(work).catch(() => {}).finally(() => pendingPushes.delete(pending));
    pendingPushes.add(pending);
  }
  async function notifyWorkspaceChanged(userID, revision, sourceDeviceID) {
    if (!sendPush) return;
    const payload = { aps: { 'content-available': 1 }, kind: 'WORKSPACE_SYNC', revision, workspaceID: String(userID) };
    // A stable collapse key lets APNs retain only the latest pending revision.
    const collapseID = sha(JSON.stringify(['workspace', userID]));
    for (const device of db.prepare('SELECT * FROM devices WHERE user_id=? OR user_id IN (SELECT member_id FROM sharing_members WHERE owner_id=?)').all(userID, userID)) {
      if (device.device_id === sourceDeviceID) continue;
      try {
        const result = await sendPush(device, payload, collapseID);
        if (result.expired) db.prepare('DELETE FROM devices WHERE user_id=? AND device_id=?').run(device.user_id, device.device_id);
      } catch {}
    }
  }
  function userFor(request) {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 300) throw new APIError(401, 'UNAUTHENTICATED');
    const session = db.prepare('SELECT user_id FROM sessions WHERE hash=? AND expires>?').get(sha(header.slice(7)), Date.now());
    if (!session) throw new APIError(401, 'UNAUTHENTICATED');
    return session.user_id;
  }
  function workspaceAccess(request, writing = false) {
    const userID = userFor(request), header = request.headers['x-workspace-id'];
    if (header != null && (typeof header !== 'string' || !/^[1-9]\d{0,14}$/.test(header))) throw new APIError(422, 'INVALID_WORKSPACE_ID');
    const ownerID = header == null ? userID : Number(header);
    const role = ownerID === userID ? 'owner' : db.prepare('SELECT role FROM sharing_members WHERE owner_id=? AND member_id=?').get(ownerID, userID)?.role;
    if (!role) throw new APIError(403, 'WORKSPACE_ACCESS_REVOKED');
    if (writing && role === 'viewer') throw new APIError(403, 'WORKSPACE_READ_ONLY');
    return { ownerID, role };
  }
  function sharingState(userID) {
    const now = Date.now();
    return {
      ownedWorkspaceID: String(userID),
      incoming: db.prepare('SELECT i.id,CAST(i.owner_id AS TEXT) AS workspaceID,u.email AS ownerEmail,i.role FROM sharing_invitations i JOIN users u ON u.id=i.owner_id WHERE i.invitee_id=? AND i.expires>? ORDER BY i.created').all(userID, now),
      outgoing: db.prepare("SELECT i.id,u.email,i.role,'pending' AS status FROM sharing_invitations i JOIN users u ON u.id=i.invitee_id WHERE i.owner_id=? AND i.expires>? ORDER BY i.created").all(userID, now),
      members: db.prepare('SELECT m.id,u.email,m.role FROM sharing_members m JOIN users u ON u.id=m.member_id WHERE m.owner_id=? ORDER BY m.created').all(userID),
      workspaces: [{ id: String(userID), ownerEmail: db.prepare('SELECT email FROM users WHERE id=?').get(userID).email, role: 'owner' },
        ...db.prepare('SELECT CAST(m.owner_id AS TEXT) AS id,m.id AS membershipID,u.email AS ownerEmail,m.role FROM sharing_members m JOIN users u ON u.id=m.owner_id WHERE m.member_id=? ORDER BY m.created').all(userID)]
    };
  }
  function mergeSharedSnapshots(owner, incoming) {
    const merged = { ...owner };
    for (const key of ['records', 'series', 'assets', 'activities', 'revisions', 'trash']) {
      const entries = new Map();
      for (const item of [...owner[key], ...incoming[key]]) {
        if (!item || typeof item.id !== 'string' || !uuid.test(item.id)) throw new APIError(409, 'SHARING_MERGE_CONFLICT');
        const id = item.id.toLowerCase(), prior = entries.get(id);
        if (prior && !isDeepStrictEqual(prior, item)) throw new APIError(409, 'SHARING_MERGE_CONFLICT');
        entries.set(id, item);
      }
      merged[key] = [...entries.values()];
    }
    validateSnapshot(merged);
    return merged;
  }
  async function body(request, limit = 128 * 1024 * 1024) {
    let size = 0; const chunks = [];
    for await (const chunk of request) { size += chunk.length; if (size > limit) throw new APIError(413, 'TOO_LARGE'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new APIError(400, 'INVALID_JSON'); }
  }
  async function textBody(request) {
    if (request.headers['content-encoding'] != null && request.headers['content-encoding'] !== 'identity') throw new APIError(415, 'TEXT_ENCODING_UNSUPPORTED');
    if (!/^text\/plain(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(request.headers['content-type'] ?? '')) throw new APIError(415, 'UTF8_TEXT_REQUIRED');
    if (Number(request.headers['content-length']) > textImportLimit) { request.resume(); throw new APIError(413, 'TOO_LARGE'); }
    const bytes = await new Promise((resolve, reject) => {
      let size = 0, chunks = [], done = false;
      const fail = error => { if (!done) { done = true; chunks = []; reject(error); } };
      request.on('data', chunk => {
        if (done) return;
        size += chunk.length;
        if (size > textImportLimit) return fail(new APIError(413, 'TOO_LARGE'));
        chunks.push(chunk);
      });
      request.once('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
      request.once('aborted', () => fail(new APIError(400, 'INVALID_TEXT_BODY')));
      request.once('error', () => fail(new APIError(400, 'INVALID_TEXT_BODY')));
    });
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new APIError(422, 'INVALID_TEXT_UTF8'); }
    return { bytes, text };
  }
  function respond(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(data));
  }
  function respondWeb(response, asset, headOnly) {
    response.writeHead(200, asset.headers);
    response.end(headOnly ? undefined : asset.body);
  }
  const courseAPI = createCourseAPI({ db, userFor, workspaceAccess, sameWebOrigin, respond, APIError, origin: passkeyOrigin, rateLimit: textRateLimit, peer: textPeer, now: textNow,
    runCode: configuration.runCourseCode ?? createCourseExecutionClient({ socketPath: configuration.courseRunnerSocket }) });
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost'), path = url.pathname;
      if (path === '/native-login' && (request.method === 'GET' || request.method === 'HEAD')) {
        sameWebOrigin(request);
        const parameters = url.searchParams, expected = ['code_challenge', 'code_challenge_method', 'state'];
        if ([...parameters.keys()].length !== 3 || expected.some(key => parameters.getAll(key).length !== 1) ||
          parameters.get('code_challenge_method') !== 'S256' || !validWebAuthRequest({ codeChallenge: parameters.get('code_challenge'), state: parameters.get('state') }))
          throw new APIError(400, 'INVALID_WEB_AUTH_REQUEST');
        return respondWeb(response, webAsset(path), request.method === 'HEAD');
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        const asset = path === '/native-login' ? undefined : webAsset(path);
        if (asset) return respondWeb(response, asset, request.method === 'HEAD');
      }
      if (path === '/.well-known/apple-app-site-association' && request.method === 'GET') return respond(response, 200, { webcredentials: { apps: passkeyApps } });
      if (path === '/api/native/v1/passkeys/login/options' && request.method === 'POST') {
        sameWebOrigin(request);
        passkeyRateLimit(request);
        const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
        return respond(response, 200, { data: { challengeID: issueChallenge('login', options.challenge), options } });
      }
      if (path === '/api/native/v1/passkeys/login/verify' && request.method === 'POST') {
        sameWebOrigin(request);
        passkeyRateLimit(request);
        const value = await body(request, 65536), challenge = consumeChallenge(value.challengeID, 'login');
        const credential = db.prepare('SELECT * FROM passkeys WHERE id=?').get(typeof value.credential?.id === 'string' ? value.credential.id : '');
        if (!credential) throw new APIError(401, 'INVALID_PASSKEY');
        const owner = db.prepare('SELECT * FROM users WHERE id=?').get(credential.user_id);
        const handle = db.prepare('SELECT handle FROM passkey_users WHERE user_id=?').get(credential.user_id)?.handle;
        if (value.credential?.response?.userHandle !== handle) throw new APIError(401, 'INVALID_PASSKEY');
        let result;
        try { result = await verifyAuthenticationResponse({ response: value.credential, expectedChallenge: challenge.challenge, expectedOrigin: passkeyOrigin, expectedRPID: rpID,
          credential: { id: credential.id, publicKey: new Uint8Array(credential.public_key), counter: credential.counter }, requireUserVerification: true }); }
        catch { throw new APIError(401, 'INVALID_PASSKEY'); }
        if (!result.verified) throw new APIError(401, 'INVALID_PASSKEY');
        const changed = db.prepare('UPDATE passkeys SET counter=? WHERE id=? AND counter=?').run(result.authenticationInfo.newCounter, credential.id, credential.counter);
        if (changed.changes !== 1) throw new APIError(409, 'PASSKEY_COUNTER_CONFLICT');
        return respond(response, 200, { data: createSession(owner) });
      }
      if (path === '/api/native/v1/passkeys/recovery/options' && request.method === 'POST') {
        passkeyRateLimit(request);
        const value = await body(request, 8192), recovery = recoveryFor(value.token);
        const { options } = await registrationOptions(recovery.user_id);
        return respond(response, 200, { data: { challengeID: issueChallenge('recovery', options.challenge, recovery.user_id, recovery.hash), options } });
      }
      if (path === '/api/native/v1/passkeys/recovery/verify' && request.method === 'POST') {
        passkeyRateLimit(request);
        const value = await body(request, 65536), recovery = recoveryFor(value.token);
        const challenge = consumeChallenge(value.challengeID, 'recovery', recovery.hash);
        if (challenge.user_id !== recovery.user_id) throw new APIError(401, 'INVALID_CHALLENGE');
        const credential = await verifiedRegistration(value, challenge, recovery.user_id);
        db.exec('BEGIN IMMEDIATE');
        try {
          const consumed = db.prepare('DELETE FROM passkey_recoveries WHERE hash=? AND user_id=? AND expires>?').run(recovery.hash, recovery.user_id, passkeyNow());
          if (consumed.changes !== 1) throw new APIError(401, 'INVALID_RECOVERY_TOKEN');
          db.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?)').run(credential.id, recovery.user_id, Buffer.from(credential.publicKey), credential.counter, Date.now());
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(recovery.user_id);
        return respond(response, 200, { data: createSession(user) });
      }
      if (path === '/deploy-revision.json' && request.method === 'GET') return respond(response, 200, { revision: deploymentRevision });
      if (path === '/health' && request.method === 'GET') return respond(response, 200, { status: 'ok' });
      if (path === '/api/native/v1/accounts' && request.method === 'POST') {
        sameWebOrigin(request); requireJSON(request); registrationRateLimit(request);
        const value = await body(request, 4096);
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).length !== 2 ||
          !Object.hasOwn(value, 'email') || !Object.hasOwn(value, 'password')) throw new APIError(400, 'INVALID_REGISTRATION');
        if (typeof value.email !== 'string') throw new APIError(422, 'INVALID_EMAIL');
        const account = value.email.trim().toLowerCase();
        const local = account.slice(0, account.indexOf('@'));
        if (account.length > 254 || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
          !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(account))
          throw new APIError(422, 'INVALID_EMAIL');
        if (typeof value.password !== 'string' || value.password.length < 8 || value.password.length > 1024)
          throw new APIError(422, 'INVALID_PASSWORD');
        const name = local;
        db.exec('BEGIN IMMEDIATE');
        try {
          if (db.prepare('SELECT id FROM users WHERE email=?').get(account)) throw new APIError(409, 'ACCOUNT_EXISTS');
          const salt = randomBytes(16).toString('hex'), hash = scryptSync(value.password, salt, 64);
          const inserted = db.prepare('INSERT INTO users(email,salt,hash,name) VALUES(?,?,?,?)').run(account, salt, hash, name);
          const id = Number(inserted.lastInsertRowid);
          db.prepare('INSERT INTO workspaces(user_id,revision,snapshot) VALUES(?,0,?)').run(id, JSON.stringify(emptyWorkspace(name)));
          const session = createSession({ id, email: account, name });
          db.exec('COMMIT');
          return respond(response, 201, { data: session });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === '/api/native/v1/session' && request.method === 'POST') {
        sameWebOrigin(request);
        const ip = request.socket.remoteAddress ?? 'unknown', now = Date.now(), prior = attempts.get(ip);
        const counter = prior && now - prior.start < 600000 ? prior : { start: now, count: 0 };
        if (++counter.count > 20) throw new APIError(429, 'RATE_LIMITED');
        attempts.set(ip, counter);
        const value = await body(request, 8192);
        if (!value || Array.isArray(value) || typeof value.email !== 'string' || typeof value.password !== 'string' || value.password.length > 1024) throw new APIError(401, 'INVALID_CREDENTIALS');
        const user = db.prepare('SELECT * FROM users WHERE email=?').get(value.email.trim().toLowerCase());
        const salt = user?.salt ?? 'invalid-user-constant-salt';
        const candidate = scryptSync(value.password, salt, 64);
        if (!user || !timingSafeEqual(candidate, user.hash)) throw new APIError(401, 'INVALID_CREDENTIALS');
        if (db.prepare('SELECT user_id FROM totp_credentials WHERE user_id=?').get(user.id)) {
          if (value.code === undefined || value.code === '') throw new APIError(401, 'SECOND_FACTOR_REQUIRED');
          totpRateLimit(user.id);
          db.exec('BEGIN IMMEDIATE');
          try {
            if (!consumeSecondFactor(user.id, value.code)) throw new APIError(401, 'INVALID_SECOND_FACTOR');
            const session = createSession(user); db.exec('COMMIT');
            return respond(response, 200, { data: session });
          } catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        return respond(response, 200, { data: createSession(user) });
      }
      if (path === '/api/native/v1/web-auth/token' && request.method === 'POST') {
        sameWebOrigin(request); webAuthRateLimit(request); requireJSON(request);
        const value = await body(request, 2048);
        if (!value || Array.isArray(value) || Object.keys(value).length !== 2 ||
          typeof value.code !== 'string' || !webAuthValue.test(value.code) ||
          typeof value.codeVerifier !== 'string' || !pkceVerifier.test(value.codeVerifier)) throw new APIError(400, 'INVALID_WEB_AUTH_REQUEST');
        const hash = sha(value.code), now = webAuthNow();
        db.exec('BEGIN IMMEDIATE');
        try {
          const code = db.prepare('SELECT * FROM web_auth_codes WHERE hash=? AND expires>?').get(hash, now);
          const challenge = createHash('sha256').update(value.codeVerifier).digest('base64url');
          if (!code || !timingSafeEqual(Buffer.from(code.challenge), Buffer.from(challenge))) throw new APIError(401, 'INVALID_AUTHORIZATION_CODE');
          const user = db.prepare('SELECT * FROM users WHERE id=?').get(code.user_id);
          if (!user) throw new APIError(401, 'INVALID_AUTHORIZATION_CODE');
          db.prepare('DELETE FROM web_auth_codes WHERE hash=?').run(hash);
          const session = createSession(user);
          db.exec('COMMIT');
          return respond(response, 200, { data: session });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === textImportPath && request.method === 'POST') {
        sameWebOrigin(request);
        textRateLimit('ip:' + textPeer(request), 60000, 60);
        textCredential(request);
        const requestID = request.headers['idempotency-key'];
        if (typeof requestID !== 'string' || !uuid.test(requestID)) throw new APIError(400, 'IDEMPOTENCY_KEY_REQUIRED');
        const { bytes, text } = await textBody(request);
        const digest = sha(bytes), key = requestID.toLowerCase();
        let result, owner, repeated = false;
        // No await may appear between this refreshed authorization, snapshot
        // read and append. An old native PUT then fails its If-Match normally.
        db.exec('BEGIN IMMEDIATE');
        try {
          const credential = textCredential(request); owner = credential.user_id;
          textRateLimit('account:' + owner, 3600000, 120);
          const prior = db.prepare('SELECT body_hash,result FROM text_imports WHERE user_id=? AND idempotency_key=?').get(owner, key);
          if (prior) {
            if (prior.body_hash !== digest) throw new APIError(409, 'IDEMPOTENCY_CONFLICT');
            result = JSON.parse(prior.result); repeated = true;
          } else {
            const old = db.prepare('SELECT revision,snapshot FROM workspaces WHERE user_id=?').get(owner);
            const snapshot = JSON.parse(old.snapshot), additions = parseCalendarText(text, snapshot, textNow());
            snapshot.records.push(...additions.records); snapshot.series.push(...additions.series);
            validateSnapshot(snapshot);
            db.prepare('INSERT INTO history(user_id,revision,snapshot,created) VALUES(?,?,?,?)').run(owner, old.revision, old.snapshot, textNow());
            db.prepare('UPDATE workspaces SET revision=revision+1,snapshot=? WHERE user_id=?').run(JSON.stringify(snapshot), owner);
            db.prepare('DELETE FROM history WHERE user_id=? AND revision<?').run(owner, Math.max(0, old.revision - 4));
            result = { revision: old.revision + 1, created: additions.records.length, recordIDs: additions.records.map(item => item.id), seriesIDs: additions.series.map(item => item.id) };
            db.prepare('INSERT INTO text_imports(user_id,idempotency_key,body_hash,result,created) VALUES(?,?,?,?,?)').run(owner, key, digest, JSON.stringify(result), textNow());
          }
          db.prepare('UPDATE text_tokens SET last_used=? WHERE id=?').run(textNow(), credential.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        respond(response, repeated ? 200 : 201, { data: { ...result, replayed: repeated } });
        if (!repeated) queuePush(() => notifyWorkspaceChanged(owner, result.revision));
        return;
      }
      if (await courseAPI(request, response, path)) return;
      const userID = userFor(request);
      if (path === '/api/native/v1/sharing' && request.method === 'GET') {
        sameWebOrigin(request);
        return respond(response, 200, { data: sharingState(userID) });
      }
      if (path.startsWith('/api/native/v1/sharing/') && ['POST', 'DELETE'].includes(request.method)) {
        sameWebOrigin(request); requireJSON(request);
        const value = await body(request, 2048);
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new APIError(422, 'INVALID_SHARING_REQUEST');
        const inviting = path === '/api/native/v1/sharing/invitations' && request.method === 'POST';
        const permission = path === '/api/native/v1/sharing/permission' && request.method === 'POST';
        const action = path.slice('/api/native/v1/sharing/'.length);
        if (!(inviting || permission || ['accept', 'decline'].includes(action) && request.method === 'POST' || ['member', 'invitation'].includes(action) && request.method === 'DELETE')) throw new APIError(404, 'NOT_FOUND');
        const allowed = inviting ? ['email', 'role'] : permission ? ['id', 'role'] : ['id'];
        if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key)) ||
            ((inviting || permission) && !['viewer', 'editor'].includes(value.role)) ||
            (!inviting && (typeof value.id !== 'string' || !uuid.test(value.id))) ||
            (inviting && (typeof value.email !== 'string' || value.email.length > 254))) throw new APIError(422, 'INVALID_SHARING_REQUEST');
        let changedWorkspace, changedRevision;
        db.exec('BEGIN IMMEDIATE');
        try {
          const actor = userFor(request), now = Date.now();
          db.prepare('DELETE FROM sharing_invitations WHERE expires<=?').run(now);
          if (inviting) {
            const other = db.prepare('SELECT id FROM users WHERE email=?').get(value.email.trim().toLowerCase());
            if (!other) throw new APIError(404, 'SHARING_ACCOUNT_NOT_FOUND');
            if (other.id === actor) throw new APIError(422, 'SHARING_SELF_INVITE');
            if (db.prepare('SELECT id FROM sharing_members WHERE owner_id=? AND member_id=?').get(actor, other.id)) throw new APIError(409, 'SHARING_ALREADY_LINKED');
            if (db.prepare('SELECT id FROM sharing_invitations WHERE owner_id=? AND invitee_id=?').get(actor, other.id)) throw new APIError(409, 'SHARING_INVITATION_EXISTS');
            if (db.prepare('SELECT COUNT(*) AS n FROM sharing_invitations WHERE owner_id=?').get(actor).n >= 20 || db.prepare('SELECT COUNT(*) AS n FROM sharing_members WHERE owner_id=?').get(actor).n >= 20) throw new APIError(422, 'SHARING_LIMIT');
            db.prepare('INSERT INTO sharing_invitations VALUES(?,?,?,?,?,?)').run(randomUUID(), actor, other.id, value.role, now, now + 7 * 86400000);
          } else if (action === 'accept' || action === 'decline') {
            const invitation = db.prepare('SELECT * FROM sharing_invitations WHERE id=? AND invitee_id=?').get(value.id.toLowerCase(), actor);
            if (!invitation) throw new APIError(404, 'SHARING_INVITATION_NOT_FOUND');
            if (action === 'accept') {
              if (db.prepare('SELECT id FROM sharing_members WHERE owner_id=?').get(actor)) throw new APIError(409, 'SHARING_HAS_MEMBERS');
              if (db.prepare('SELECT COUNT(*) AS n FROM sharing_members WHERE owner_id=?').get(invitation.owner_id).n >= 20 || db.prepare('SELECT COUNT(*) AS n FROM sharing_members WHERE member_id=?').get(actor).n >= 20) throw new APIError(422, 'SHARING_LIMIT');
              const old = db.prepare('SELECT revision,snapshot FROM workspaces WHERE user_id=?').get(invitation.owner_id);
              const personal = db.prepare('SELECT snapshot FROM workspaces WHERE user_id=?').get(actor);
              const merged = mergeSharedSnapshots(JSON.parse(old.snapshot), JSON.parse(personal.snapshot));
              db.prepare('INSERT INTO history VALUES(?,?,?,?)').run(invitation.owner_id, old.revision, old.snapshot, now);
              db.prepare('UPDATE workspaces SET revision=revision+1,snapshot=? WHERE user_id=?').run(JSON.stringify(merged), invitation.owner_id);
              db.prepare('DELETE FROM history WHERE user_id=? AND revision<?').run(invitation.owner_id, Math.max(0, old.revision - 4));
              db.prepare('INSERT INTO sharing_members VALUES(?,?,?,?,?)').run(invitation.id, invitation.owner_id, actor, invitation.role, now);
              changedWorkspace = invitation.owner_id; changedRevision = old.revision + 1;
            }
            db.prepare('DELETE FROM sharing_invitations WHERE id=?').run(invitation.id);
          } else if (permission) {
            const result = db.prepare('UPDATE sharing_members SET role=? WHERE id=? AND owner_id=?').run(value.role, value.id.toLowerCase(), actor);
            if (!result.changes) throw new APIError(404, 'SHARING_MEMBER_NOT_FOUND');
          } else if (action === 'member') {
            const result = db.prepare('DELETE FROM sharing_members WHERE id=? AND (owner_id=? OR member_id=?)').run(value.id.toLowerCase(), actor, actor);
            if (!result.changes) throw new APIError(404, 'SHARING_MEMBER_NOT_FOUND');
          } else {
            const result = db.prepare('DELETE FROM sharing_invitations WHERE id=? AND owner_id=?').run(value.id.toLowerCase(), actor);
            if (!result.changes) throw new APIError(404, 'SHARING_INVITATION_NOT_FOUND');
          }
          db.exec('COMMIT');
          const data = sharingState(actor);
          if (changedWorkspace != null) { data.workspaceID = String(changedWorkspace); data.accessRole = value.role ?? db.prepare('SELECT role FROM sharing_members WHERE owner_id=? AND member_id=?').get(changedWorkspace, actor).role; }
          respond(response, 200, { data });
          if (changedWorkspace != null) queuePush(() => notifyWorkspaceChanged(changedWorkspace, changedRevision));
          return;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === '/api/native/v1/integrations/text-tokens' && request.method === 'GET') {
        sameWebOrigin(request);
        const credentials = db.prepare('SELECT * FROM text_tokens WHERE user_id=? AND expires>? ORDER BY created,id').all(userID, textNow()).map(textCredentialInfo);
        return respond(response, 200, { data: { credentials, endpoint: textEndpoint, protocol: textImportProtocol, prompt: calendarTextPrompt(textEndpoint) } });
      }
      if (path === '/api/native/v1/integrations/text-tokens' && ['POST', 'DELETE'].includes(request.method)) {
        sameWebOrigin(request); requireJSON(request);
        const value = await body(request, 1024);
        if (!value || Array.isArray(value) || typeof value !== 'object') throw new APIError(422, 'INVALID_TEXT_TOKEN_REQUEST');
        const creating = request.method === 'POST';
        if (creating ? Object.keys(value).some(key => key !== 'name') : Object.keys(value).length !== 1 || !uuid.test(value.id)) throw new APIError(422, 'INVALID_TEXT_TOKEN_REQUEST');
        const name = value.name === undefined ? 'AI日程写入' : typeof value.name === 'string' ? value.name.trim() : '';
        if (creating && (!name || name.length > 60)) throw new APIError(422, 'INVALID_TEXT_TOKEN_NAME');
        db.exec('BEGIN IMMEDIATE');
        try {
          const owner = userFor(request);
          if (creating) {
            const now = textNow();
            db.prepare('DELETE FROM text_tokens WHERE user_id=? AND expires<=?').run(owner, now);
            if (db.prepare('SELECT COUNT(*) AS total FROM text_tokens WHERE user_id=?').get(owner).total >= 10) throw new APIError(422, 'TEXT_TOKEN_LIMIT');
            const accessToken = 'wsi_' + randomBytes(32).toString('base64url');
            const credential = { id: randomUUID(), name, created: now, expires: now + 365 * 86400000 };
            db.prepare('INSERT INTO text_tokens(id,hash,user_id,name,created,expires) VALUES(?,?,?,?,?,?)').run(credential.id, sha(accessToken), owner, name, credential.created, credential.expires);
            db.exec('COMMIT');
            return respond(response, 201, { data: { credential, accessToken, endpoint: textEndpoint, protocol: textImportProtocol } });
          }
          const removed = db.prepare('DELETE FROM text_tokens WHERE id=? AND user_id=?').run(value.id.toLowerCase(), owner);
          if (removed.changes !== 1) throw new APIError(404, 'TEXT_TOKEN_NOT_FOUND');
          db.exec('COMMIT');
          return respond(response, 200, { data: { revoked: true } });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === '/api/native/v1/web-auth/authorize' && request.method === 'POST') {
        sameWebOrigin(request); webAuthRateLimit(request); requireJSON(request);
        const value = await body(request, 2048);
        if (!validWebAuthRequest(value)) throw new APIError(400, 'INVALID_WEB_AUTH_REQUEST');
        const now = webAuthNow(), code = randomBytes(32).toString('base64url');
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM web_auth_codes WHERE expires<=?').run(now);
          if (db.prepare('SELECT COUNT(*) AS total FROM web_auth_codes').get().total >= 1000) throw new APIError(429, 'RATE_LIMITED');
          const revoked = db.prepare('DELETE FROM sessions WHERE hash=? AND user_id=? AND expires>?').run(sha(request.headers.authorization.slice(7)), userID, Date.now());
          if (revoked.changes !== 1) throw new APIError(401, 'UNAUTHENTICATED');
          db.prepare('INSERT INTO web_auth_codes VALUES(?,?,?,?,?)').run(sha(code), userID, value.codeChallenge, value.state, now + 90000);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const callback = new URL(nativeCallbackURL);
        callback.searchParams.set('code', code); callback.searchParams.set('state', value.state);
        return respond(response, 200, { data: { callbackURL: callback.href } });
      }
      if (path === '/api/native/v1/totp' && request.method === 'GET') {
        return respond(response, 200, { data: { enabled: !!db.prepare('SELECT user_id FROM totp_credentials WHERE user_id=?').get(userID) } });
      }
      if (path === '/api/native/v1/totp/setup' && request.method === 'POST') {
        await totpBody(request, false); totpRateLimit(userID);
        if (db.prepare('SELECT user_id FROM totp_credentials WHERE user_id=?').get(userID)) throw new APIError(409, 'TOTP_ALREADY_ENABLED');
        const secret = base32Encode(randomBytes(20)), now = totpNow();
        db.prepare('DELETE FROM totp_pending WHERE expires<=?').run(now);
        db.prepare('INSERT OR REPLACE INTO totp_pending VALUES(?,?,?)').run(userID, secret, now + 600000);
        const owner = db.prepare('SELECT email FROM users WHERE id=?').get(userID);
        const query = new URLSearchParams({ secret, issuer: rpID, algorithm: 'SHA1', digits: '6', period: '30' });
        const uri = 'otpauth://totp/' + encodeURIComponent('工作坊:' + owner.email) + '?' + query;
        return respond(response, 200, { data: { secret, uri, appleURI: uri.replace('otpauth:', 'apple-otpauth:') } });
      }
      if (path === '/api/native/v1/totp/enable' && request.method === 'POST') {
        const value = await totpBody(request); totpRateLimit(userID);
        db.exec('BEGIN IMMEDIATE');
        try {
          if (db.prepare('SELECT user_id FROM totp_credentials WHERE user_id=?').get(userID)) throw new APIError(409, 'TOTP_ALREADY_ENABLED');
          const pending = db.prepare('SELECT * FROM totp_pending WHERE user_id=?').get(userID);
          if (!pending || pending.expires <= totpNow()) throw new APIError(410, 'TOTP_SETUP_EXPIRED');
          const step = totpStep(pending.secret, value.code);
          if (step === null) throw new APIError(401, 'INVALID_SECOND_FACTOR');
          const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-'));
          db.prepare('INSERT INTO totp_credentials VALUES(?,?,?)').run(userID, pending.secret, step);
          db.prepare('DELETE FROM totp_recovery_codes WHERE user_id=?').run(userID);
          for (const code of recoveryCodes) db.prepare('INSERT INTO totp_recovery_codes VALUES(?,?)').run(userID, sha(code));
          db.prepare('DELETE FROM totp_pending WHERE user_id=?').run(userID);
          db.exec('COMMIT');
          return respond(response, 200, { data: { recoveryCodes } });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === '/api/native/v1/totp/disable' && request.method === 'POST') {
        const value = await totpBody(request); totpRateLimit(userID);
        db.exec('BEGIN IMMEDIATE');
        try {
          if (!consumeSecondFactor(userID, value.code)) throw new APIError(401, 'INVALID_SECOND_FACTOR');
          db.prepare('DELETE FROM totp_credentials WHERE user_id=?').run(userID);
          db.prepare('DELETE FROM totp_pending WHERE user_id=?').run(userID);
          db.prepare('DELETE FROM totp_recovery_codes WHERE user_id=?').run(userID);
          db.exec('COMMIT');
          return respond(response, 200, { data: { enabled: false } });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
      if (path === '/api/native/v1/passkeys/register/options' && request.method === 'POST') {
        passkeyRateLimit(request);
        const { options } = await registrationOptions(userID);
        return respond(response, 200, { data: { challengeID: issueChallenge('register', options.challenge, userID, sha(request.headers.authorization.slice(7))), options } });
      }
      if (path === '/api/native/v1/passkeys/register/verify' && request.method === 'POST') {
        passkeyRateLimit(request);
        const value = await body(request, 65536), challenge = consumeChallenge(value.challengeID, 'register', sha(request.headers.authorization.slice(7)));
        if (challenge.user_id !== userID) throw new APIError(401, 'INVALID_CHALLENGE');
        const credential = await verifiedRegistration(value, challenge, userID);
        db.prepare('INSERT INTO passkeys VALUES(?,?,?,?,?)').run(credential.id, userID, Buffer.from(credential.publicKey), credential.counter, Date.now());
        return respond(response, 200, { data: { registered: true } });
      }
      if (path === '/api/native/v1/passkeys' && request.method === 'GET') {
        return respond(response, 200, { data: { credentials: db.prepare('SELECT id,created FROM passkeys WHERE user_id=? ORDER BY created').all(userID) } });
      }
      if (path === '/api/native/v1/passkeys' && request.method === 'DELETE') {
        const value = await body(request, 8192);
        if (typeof value.id !== 'string') throw new APIError(422, 'INVALID_PASSKEY');
        db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(value.id, userID);
        return respond(response, 200, { data: { revoked: true } });
      }
      if (path === '/api/native/v1/session' && request.method === 'DELETE') {
        db.prepare('DELETE FROM sessions WHERE hash=?').run(sha(request.headers.authorization.slice(7)));
        return respond(response, 200, { data: { signedOut: true } });
      }
      if (path === '/api/native/v1/workspace' && request.method === 'GET') {
        const { ownerID, role } = workspaceAccess(request);
        const row = db.prepare('SELECT revision,snapshot FROM workspaces WHERE user_id=?').get(ownerID);
        return respond(response, 200, { data: { revision: row.revision, snapshot: JSON.parse(row.snapshot), workspaceID: String(ownerID), accessRole: role } });
      }
      if (path === '/api/native/v1/workspace' && request.method === 'PUT') {
        const sourceDeviceID = request.headers['x-workspace-device-id'];
        if (sourceDeviceID != null && (typeof sourceDeviceID !== 'string' || !uuid.test(sourceDeviceID))) throw new APIError(422, 'INVALID_DEVICE');
        const match = request.headers['if-match'];
        if (typeof match !== 'string' || !/^"\d+"$/.test(match)) throw new APIError(428, 'VERSION_REQUIRED');
        const revision = Number(match.slice(1, -1));
        if (!Number.isSafeInteger(revision)) throw new APIError(400, 'INVALID_VERSION');
        workspaceAccess(request, true);
        const value = await body(request); validateSnapshot(value.snapshot);
        const snapshot = JSON.stringify(value.snapshot);
        let ownerID, role;
        db.exec('BEGIN IMMEDIATE');
        try {
          ({ ownerID, role } = workspaceAccess(request, true));
          const old = db.prepare('SELECT revision,snapshot FROM workspaces WHERE user_id=?').get(ownerID);
          if (old.revision !== revision) throw new APIError(409, 'WRITE_CONFLICT');
          db.prepare('INSERT INTO history(user_id,revision,snapshot,created) VALUES(?,?,?,?)').run(ownerID, old.revision, old.snapshot, Date.now());
          db.prepare('UPDATE workspaces SET revision=revision+1,snapshot=? WHERE user_id=?').run(snapshot, ownerID);
          db.prepare('DELETE FROM history WHERE user_id=? AND revision<?').run(ownerID, Math.max(0, revision - 4));
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const nextRevision = revision + 1;
        respond(response, 200, { data: { revision: nextRevision, snapshot: value.snapshot, workspaceID: String(ownerID), accessRole: role } });
        queuePush(() => notifyWorkspaceChanged(ownerID, nextRevision, sourceDeviceID));
        return;
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
    } catch (error) {
      if (error instanceof TextImportError) return respond(response, error.status, { error: { code: error.message, ...(error.line ? { line: error.line } : {}), ...(error.field ? { field: error.field } : {}) } });
      respond(response, error instanceof APIError ? error.status : 500, { error: { code: error instanceof APIError ? error.message : 'INTERNAL_ERROR' } });
    }
  });
  server.requestTimeout = 60000;
  let sweeping = false;
  async function sweep(now = Date.now()) {
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    db.prepare('DELETE FROM passkey_recoveries WHERE expires<=?').run(now);
    db.prepare('DELETE FROM web_auth_codes WHERE expires<=?').run(webAuthNow());
    db.prepare('DELETE FROM totp_pending WHERE expires<=?').run(totpNow());
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
            try { result = await sendPush(activeDevice, { aps: { alert: { title: '广益 WorkSpace · 提醒', body: current.title }, sound: 'default', category: 'WORKSPACE_REMINDER' }, id: current.id, scheduledAt: at }, id); }
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
  return { server, db, sweep, issuePasskeyRecovery: email => createPasskeyRecovery(db, { email, origin: passkeyOrigin, now: passkeyNow() }),
    flushPushes: () => Promise.all([...pendingPushes]), close: () => { server.close(); db.close(); } };
}
export function apnsDelivery(payload) {
  const background = payload?.aps?.['content-available'] === 1 && payload?.aps?.alert == null;
  return background ? { pushType: 'background', priority: '5', lifetime: 300 } : { pushType: 'alert', priority: '10', lifetime: 86400 };
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
      const delivery = apnsDelivery(payload);
      const request = session.request({ ':method': 'POST', ':path': '/3/device/' + device.token, authorization: 'bearer ' + jwt,
        'apns-topic': device.bundle_id, 'apns-push-type': delivery.pushType, 'apns-priority': delivery.priority, 'apns-collapse-id': collapseID.slice(0, 64),
        'apns-expiration': String(Math.floor(Date.now() / 1000) + delivery.lifetime) });
      let status = 0; request.on('response', headers => { status = Number(headers[':status']); });
      request.on('data', () => {}); request.on('error', error => { finish(); reject(error); });
      request.on('end', () => { finish(); resolve({ accepted: status === 200, expired: status === 410 }); });
      request.end(JSON.stringify(payload));
    });
  };
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.umask(0o077);
  if (process.argv[2] === 'issue-passkey-recovery') {
    try {
      const recovery = issuePasskeyRecovery({ databasePath: process.argv[3] ?? process.env.DATABASE_PATH,
        email: process.argv[4] ?? process.env.ADMIN_EMAIL, origin: process.env.PASSKEY_ORIGIN ?? 'https://workspace.kdfz.com.cn' });
      process.stdout.write(`${recovery.url}\n有效期至 ${new Date(recovery.expires).toISOString()}\n`);
    } catch (error) {
      process.stderr.write(`无法生成通行密钥恢复链接：${error.message}\n`); process.exitCode = 1;
    }
  } else {
    const app = createNativeServer({ databasePath: process.env.DATABASE_PATH ?? '/data/workspace.sqlite', adminEmail: process.env.ADMIN_EMAIL,
      adminPassword: process.env.ADMIN_PASSWORD, passkeyRPID: process.env.PASSKEY_RP_ID, passkeyOrigin: process.env.PASSKEY_ORIGIN, passkeyApps: process.env.PASSKEY_APP_IDS, displayName: process.env.DISPLAY_NAME, allowedBundles: process.env.APNS_ALLOWED_BUNDLE_IDS,
      courseRunnerSocket: process.env.COURSE_RUNNER_SOCKET,
      sendPush: applePushSender({ teamID: process.env.APNS_TEAM_ID, keyID: process.env.APNS_KEY_ID, keyPath: process.env.APNS_PRIVATE_KEY_FILE }) });
    app.server.listen(Number(process.env.PORT ?? 8080), process.env.HOST ?? '127.0.0.1', () => console.log('Native workspace API is listening'));
    setInterval(() => app.sweep().catch(() => console.error('notification_dispatch_failed')), 30000).unref();
  }
}
