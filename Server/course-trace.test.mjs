import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createCourseAPI } from './courses.mjs';

const trace = () => ({ variants: [{ id: 'reference', title: '引用传递', code: { language: 'cpp', source: 'int value = 7;\r\nint& alias = value;\ralias = 8;' }, frames: [
  { title: '建立对象', line: 1, note: 'value 是独立对象。', objects: [{ id: 'value', names: ['value'], value: '7' }], output: '' },
  { title: '共享对象', line: 3, note: 'alias 和 value 指向同一个对象。', objects: [{ id: 'value', names: ['value', 'alias'], value: '8', scope: 'main', changed: true }], output: '8' }
] }] });
function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1)');
  class APIError extends Error { constructor(status, code) { super(code); this.status = status; } }
  const handle = createCourseAPI({ db, userFor: () => 1, workspaceAccess: () => ({ ownerID: 1 }), sameWebOrigin: () => {}, respond: (response, status, body) => Object.assign(response, { status, body }), APIError, origin: 'https://example.invalid', rateLimit: () => {}, peer: () => 'test' });
  return { db, async publish(presentation) {
    const document = { protocol: 'WORKSHOP-COURSE/1', id: randomUUID(), title: '传参实验', summary: '', lessons: [{ id: randomUUID(), title: '引用', blocks: [{ id: randomUUID(), type: 'text', text: '逐帧观察对象变化。', presentation }] }] };
    const request = Readable.from([Buffer.from(JSON.stringify(document))]);
    request.method = 'POST'; request.headers = { 'content-type': 'application/json', 'idempotency-key': randomUUID() };
    const response = {};
    try { await handle(request, response, '/api/native/v1/courses'); return response; }
    catch (error) { if (error instanceof APIError) return { status: error.status }; throw error; }
  } };
}
test('trace publication retains author-written aliases, source lines and optional output', async () => {
  const h = harness();
  try {
    const value = trace();
    assert.equal((await h.publish({ kind: 'trace', trace: value })).status, 201);
    const saved = JSON.parse(h.db.prepare('SELECT document FROM courses').get().document);
    assert.deepEqual(saved.lessons[0].blocks[0].presentation.trace, value);
  } finally { h.db.close(); }
});
test('trace rejects invalid frame bounds, IDs, UTF-16 lengths and primitive types', async () => {
  const h = harness();
  const changes = [
    x => { x.variants = []; }, x => { x.variants.push(structuredClone(x.variants[0])); },
    x => { x.variants[0].id = '中文'; }, x => { x.variants[0].id = 'value\n'; }, x => { x.variants[0].frames.length = 1; },
    x => { x.variants[0].frames[0].line = 0; }, x => { x.variants[0].frames[0].line = 4; },
    x => { x.variants[0].frames[0].line = true; }, x => { x.variants[0].frames[0].note = '😀'.repeat(201); },
    x => { x.variants[0].frames[0].objects = []; },
    x => { const objects = x.variants[0].frames[0].objects; objects.push(structuredClone(objects[0])); },
    x => { x.variants[0].frames[0].objects[0].names = []; },
    x => { x.variants[0].frames[0].objects[0].value = ''; },
    x => { x.variants[0].frames[0].objects[0].changed = 1; },
    x => { x.variants[0].frames[0].output = 'x'.repeat(2001); },
  ];
  try { for (const change of changes) { const value = trace(); change(value); assert.equal((await h.publish({ kind: 'trace', trace: value })).status, 422); } }
  finally { h.db.close(); }
});
test('trace rejects mixed payloads, unknown nested fields, missing and null values', async () => {
  const h = harness();
  try {
    const mixed = { kind: 'trace', trace: trace(), code: { language: 'cpp', source: 'int x;' } };
    assert.equal((await h.publish(mixed)).status, 422);
    for (const mutate of [
      x => { x.unknown = true; }, x => { x.variants[0].unknown = true; },
      x => { x.variants[0].frames[0].unknown = true; },
      x => { x.variants[0].frames[0].objects[0].unknown = true; },
      x => { delete x.variants[0].frames[0].note; },
      x => { x.variants[0].frames[0].objects[0].changed = null; }
    ]) { const value = trace(); mutate(value); assert.equal((await h.publish({ kind: 'trace', trace: value })).status, 422); }
  } finally { h.db.close(); }
});
