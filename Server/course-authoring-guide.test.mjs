import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { createCourseAPI, courseAuthoringGuide, courseManualPrompt, coursePrompt } from './courses.mjs';

const endpoint = 'https://example.invalid/api/integrations/v1/courses';
function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY)');
  class APIError extends Error { constructor(status, code) { super(code); this.status = status; } }
  let accountReads = 0;
  const requireAccount = () => { accountReads++; throw new APIError(401, 'UNAUTHORIZED'); };
  const handle = createCourseAPI({ db, userFor: requireAccount, workspaceAccess: requireAccount,
    sameWebOrigin: () => {}, respond: (response, status, body) => Object.assign(response, { status, body }),
    APIError, origin: new URL(endpoint).origin, rateLimit: () => {}, peer: () => 'test' });
  return { db, get accountReads() { return accountReads; }, async request(path, { method = 'GET', headers = {} } = {}) {
    const request = Readable.from([]); request.method = method; request.url = path; request.headers = headers;
    const response = { writeHead(status, values) { this.status = status; this.headers = values; }, end(bytes) { this.bytes = bytes; } };
    try { if (!await handle(request, response, path.split('?')[0])) response.status = 404; return response; }
    catch (error) { if (error instanceof APIError) return { status: error.status, code: error.message }; throw error; }
  } };
}
const header = (response, name) => Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
const text = response => Buffer.from(response.bytes ?? '').toString('utf8');

test('copied prompts only direct the AI to a public current guide, with a separate upload credential', () => {
  for (const [mode, prompt] of [['manual', courseManualPrompt(endpoint)], ['automatic', coursePrompt(endpoint)]]) {
    assert.ok(prompt.length < 800, 'copied text stays short enough to hand to an AI');
    assert.ok(prompt.includes(`https://example.invalid/course-authoring?mode=${mode}`));
    assert.doesNotMatch(prompt, /```|"lessons"|"blocks"|"protocol"|referenceCode|focusSpans/);
    const urls = prompt.match(/https:\/\/[^\s<>"\)]+/g) ?? [];
    assert.ok(urls.length > 0);
    for (const raw of urls) {
      const url = new URL(raw.replace(/[。；，]+$/, ''));
      assert.equal(url.origin, 'https://example.invalid');
      assert.equal(url.username, ''); assert.equal(url.password, '');
      if (url.pathname === '/course-authoring') assert.deepEqual([...url.searchParams.keys()], ['mode']);
      else { assert.equal(url.href, endpoint); assert.equal(url.search, ''); }
      assert.doesNotMatch(url.href, /API_KEY|wsc_|token|key=/i);
    }
    if (mode === 'automatic') assert.match(prompt, /\{\{API_KEY\}\}/);
    else assert.doesNotMatch(prompt, /API_KEY|wsc_|Authorization/);
  }
  assert.match(courseManualPrompt(), /https:\/\/workspace\.kdfz\.com\.cn\/course-authoring\?mode=manual/);
});

test('public HTML and plain-text guides preserve complete authoring rules without account access', async () => {
  const h = harness();
  try {
    for (const mode of ['manual', 'automatic']) {
      const plain = await h.request('/api/integrations/v1/courses/guide?mode=' + mode);
      assert.equal(plain.status, 200); assert.match(header(plain, 'Content-Type'), /^text\/plain;.*charset=utf-8/i);
      assert.equal(header(plain, 'X-Content-Type-Options'), 'nosniff');
      const guide = text(plain);
      assert.equal(guide, courseAuthoringGuide(endpoint, mode));
      assert.match(guide, /WORKSHOP-COURSE\/1/); assert.match(guide, /referenceCode/); assert.match(guide, /setPrimaryAction/);
      const examples = [...guide.matchAll(/```json\n([\s\S]+?)\n```/g)];
      assert.equal(examples.length, 1); assert.ok(JSON.parse(examples[0][1]).lessons.length > 0);
      if (mode === 'automatic') { assert.match(guide, /Authorization: Bearer/); assert.doesNotMatch(guide, /API_KEY|wsc_/); assert.match(guide, /POST https:\/\/example\.invalid\/api\/integrations\/v1\/courses/); }
      else { assert.doesNotMatch(guide, /API_KEY|wsc_|Authorization/); assert.match(guide, /不要声称已上传/); }
      const html = await h.request('/course-authoring?mode=' + mode);
      assert.equal(html.status, 200); assert.match(header(html, 'Content-Type'), /^text\/html;.*charset=utf-8/i);
      assert.match(text(html), /<!doctype html>/i); assert.match(text(html), /referenceCode/);
      assert.match(text(html), /&lt;iostream&gt;/); assert.doesNotMatch(text(html), /#include <iostream>/);
      assert.ok(header(html, 'ETag')); assert.notEqual(header(html, 'ETag'), header(plain, 'ETag'));
    }
    assert.equal(text(await h.request('/api/integrations/v1/courses/guide')), courseAuthoringGuide(endpoint, 'manual'));
    assert.equal(h.accountReads, 0, 'public guide lookup never reads a session or account');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM course_tokens').get().n, 0, 'reading a guide never creates a token');
  } finally { h.db.close(); }
});

test('public guide queries and methods are strict; HEAD, ETag and gzip preserve the same representation', async () => {
  const h = harness();
  try {
    for (const path of ['/course-authoring', '/api/integrations/v1/courses/guide']) {
      for (const query of ['?mode=', '?mode=wrong', '?mode=manual&mode=automatic', '?mode=manual&key=private', '?user=1']) {
        assert.equal((await h.request(path + query)).status, 422, path + query);
      }
      for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await h.request(path, { method })).status, 404);
      const plain = await h.request(path + '?mode=manual');
      const automatic = await h.request(path + '?mode=automatic');
      assert.notEqual(header(plain, 'ETag'), header(automatic, 'ETag'));
      const head = await h.request(path + '?mode=manual', { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(text(head), '');
      assert.equal(header(head, 'ETag'), header(plain, 'ETag'));
      assert.equal(Number(header(head, 'Content-Length')), Buffer.byteLength(text(plain)));
      const cached = await h.request(path + '?mode=manual', { headers: { 'if-none-match': header(plain, 'ETag') } });
      assert.equal(cached.status, 304); assert.equal(text(cached), '');
      const compressed = await h.request(path + '?mode=manual', { headers: { 'accept-encoding': 'gzip, deflate' } });
      assert.equal(compressed.status, 200); assert.equal(header(compressed, 'Content-Encoding'), 'gzip');
      assert.equal(gunzipSync(compressed.bytes).toString('utf8'), text(plain));
      assert.match(header(compressed, 'Vary'), /Accept-Encoding/i);
      const uncompressed = await h.request(path, { headers: { 'accept-encoding': 'gzip;q=0' } });
      assert.equal(header(uncompressed, 'Content-Encoding'), undefined); assert.equal(text(uncompressed), text(plain));
      const compressedHead = await h.request(path, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
      assert.equal(compressedHead.status, 200); assert.equal(text(compressedHead), '');
      assert.equal(header(compressedHead, 'Content-Encoding'), 'gzip');
      assert.equal(Number(header(compressedHead, 'Content-Length')), compressed.bytes.length);
    }
    assert.equal(h.accountReads, 0);
  } finally { h.db.close(); }
});
