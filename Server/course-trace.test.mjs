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
  return { db, async publish(presentation, configure = () => {}) {
    const document = { protocol: 'WORKSHOP-COURSE/1', id: randomUUID(), title: '传参实验', summary: '', lessons: [{ id: randomUUID(), title: '引用', blocks: [{ id: randomUUID(), type: 'text', text: '逐帧观察对象变化。', presentation }] }] };
    configure(document);
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
test('persistent reference programs and block focus survive publication with source precedence', async () => {
  const h = harness();
  const code = lines => ({ language: 'cpp', source: Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') });
  const text = (focusLines, presentation) => ({ id: randomUUID(), type: 'text', text: '观察当前程序。', focusLines, ...(presentation ? { presentation } : {}) });
  try {
    const cases = [
      d => { d.referenceCode = { language: 'cpp', source: 'a\r\nb\rc\nd', highlightLines: [2] }; d.lessons[0].blocks = [text([4])]; },
      d => { d.referenceCode = code(8); d.lessons[0].referenceCode = code(6); d.lessons[0].blocks = [text([6])]; },
      d => { d.lessons[0].referenceCode = code(6); d.lessons[0].blocks = [text([2], { kind: 'code', code: code(2) })]; },
      d => { d.lessons[0].referenceCode = code(6); d.lessons[0].blocks[0].focusLines = [3]; d.lessons[0].blocks[0].presentation = { kind: 'trace', trace: trace() }; },
      d => { d.lessons[0].referenceCode = code(6); d.lessons[0].blocks = [{ id: randomUUID(), type: 'question', text: '填写整数。', questionType: 'shortAnswer', input: { kind: 'integer' }, execution: { language: 'python', template: 'n = {{ANSWER}}\nprint(n)' }, focusLines: [2] }]; },
      d => { d.lessons[0].blocks = [text([1]), text([], { kind: 'code', code: code(1) })]; },
      d => { d.lessons[0].blocks = [text([], { kind: 'code', code: code(2) }), text([2]), text([], { kind: 'code', code: code(4) })]; },
      d => { d.lessons[0].blocks = [text([])]; },
      d => { d.lessons[0].referenceCode = code(201); d.lessons[0].blocks = [text(Array.from({ length: 200 }, (_, i) => i + 1))]; }
    ];
    for (const [index, configure] of cases.entries()) {
      assert.equal((await h.publish(undefined, configure)).status, 201, 'valid reference context ' + index);
      const saved = JSON.parse(h.db.prepare('SELECT document FROM courses ORDER BY rowid DESC LIMIT 1').get().document);
      assert.ok(saved.lessons[0].blocks.every(block => Array.isArray(block.focusLines)));
      if (index === 0) assert.equal(saved.referenceCode.source, 'a\r\nb\rc\nd', 'original code newlines are preserved');
      if (index === 4) assert.match(saved.lessons[0].blocks[0].execution.template, /\{\{ANSWER\}\}/, 'reference rendering never fills the answer');
    }
  } finally { h.db.close(); }
});
test('focus lines reject invalid values and out-of-bounds effective sources without crossing lessons', async () => {
  const h = harness();
  const code = n => ({ language: 'cpp', source: Array(n).fill('x').join('\n') });
  const question = (focusLines, extra = {}) => ({ id: randomUUID(), type: 'question', text: '填写答案。', questionType: 'shortAnswer', focusLines, ...extra });
  const cases = [
    ...[null, '1', [0], [true], [1.5], [1, 1], [2], Array(201).fill(1)].map(lines => d => { d.referenceCode = code(1); d.lessons[0].blocks[0].focusLines = lines; }),
    d => { d.lessons[0].blocks[0].focusLines = [1]; },
    d => { d.referenceCode = null; }, d => { d.lessons[0].referenceCode = { ...code(1), secret: true }; },
    d => { d.referenceCode = code(8); d.lessons[0].referenceCode = code(2); d.lessons[0].blocks[0].focusLines = [3]; },
    d => { d.lessons[0].referenceCode = code(8); d.lessons[0].blocks = [question([3], { code: code(2), execution: { language: 'cpp', template: 'x;\nx;\n{{ANSWER}}' } })]; },
    d => { d.lessons[0].referenceCode = code(8); d.lessons[0].blocks[0].presentation = { kind: 'code', code: code(2) }; d.lessons[0].blocks[0].focusLines = [3]; },
    d => { d.lessons[0].referenceCode = code(8); d.lessons[0].blocks[0].presentation = { kind: 'trace', trace: trace() }; d.lessons[0].blocks[0].focusLines = [4]; },
    d => { d.lessons[0].referenceCode = code(8); d.lessons[0].blocks = [question([2], { input: { kind: 'integer' }, execution: { language: 'python', template: 'print({{ANSWER}})' } })]; },
    d => { d.lessons[0].blocks = [question([], { code: code(2) }), question([3]), question([], { code: code(4) })]; },
    d => { d.lessons[0].blocks[0].focusLines = [1]; d.lessons.push({ id: randomUUID(), title: '另一课时', blocks: [question([], { code: code(8) })] }); },
    d => { d.lessons[0].blocks = [question([1]), { id: randomUUID(), type: 'text', text: '缺少代码。', presentation: { kind: 'code' } }]; }
  ];
  try {
    for (const [index, configure] of cases.entries()) assert.equal((await h.publish(undefined, configure)).status, 422, 'invalid focus context ' + index);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM courses').get().n, 0, 'invalid focus never publishes partial documents');
  } finally { h.db.close(); }
});
test('literal code spans retain Unicode, repeated occurrences and overlaps in shared source and trace frames', async () => {
  const h = harness();
  const source = 'count = count + 1;\r\n变量 = "😀";\rtext = "a+b";\nprint("aaaa");';
  const spans = [{ line: 1, text: 'count', occurrence: 2 }, { line: 1, text: '+' }, { line: 1, text: 'count + 1' },
    { line: 2, text: '变量' }, { line: 2, text: '😀' }, { line: 3, text: 'a+b' }, { line: 4, text: 'aa', occurrence: 2 }];
  try {
    const created = await h.publish(undefined, d => {
      d.referenceCode = { language: 'python', source, highlightSpans: spans };
      d.lessons[0].blocks[0].focusSpans = spans;
    });
    assert.equal(created.status, 201);
    let saved = JSON.parse(h.db.prepare('SELECT document FROM courses ORDER BY rowid DESC LIMIT 1').get().document);
    assert.equal(saved.referenceCode.source, source);
    assert.deepEqual(saved.referenceCode.highlightSpans, spans);
    assert.deepEqual(saved.lessons[0].blocks[0].focusSpans, spans);
    const value = trace(); value.variants[0].frames[0].focusSpans = [{ line: 1, text: '=' }]; value.variants[0].frames[1].focusSpans = [];
    assert.equal((await h.publish({ kind: 'trace', trace: value })).status, 201);
    saved = JSON.parse(h.db.prepare('SELECT document FROM courses ORDER BY rowid DESC LIMIT 1').get().document);
    assert.deepEqual(saved.lessons[0].blocks[0].presentation.trace, value);
    assert.equal((await h.publish(undefined, d => { d.lessons[0].blocks[0].focusSpans = []; })).status, 201, 'empty block spans clear focus without a code context');
    const boundary = Array.from({ length: 200 }, (_, i) => ({ line: 1, text: 'x', occurrence: i + 1 }));
    assert.equal((await h.publish(undefined, d => { d.referenceCode = { language: 'text', source: 'x'.repeat(200), highlightSpans: boundary }; })).status, 201);
    assert.equal((await h.publish(undefined, d => { d.referenceCode = { language: 'text', source: '😀'.repeat(1000), highlightSpans: [{ line: 1, text: '😀'.repeat(1000) }] }; })).status, 201);
  } finally { h.db.close(); }
});
test('literal code spans reject unmatched text, ambiguous duplicates, invalid bounds and wrong source contexts', async () => {
  const h = harness();
  const code = { language: 'cpp', source: 'count = count + 1;\naaa\né' };
  const bad = [null, {}, Array(201).fill({ line: 1, text: 'count' }),
    [null], [{ line: 1, text: 'count', extra: true }], [{ text: 'count' }], [{ line: 1 }],
    ...[0, true, 1.5, '1', 4].map(line => [{ line, text: 'count' }]),
    ...['', ' ', '\t', '\n', '\r', '\u0000', '\u007f', '\u0085', '\u2028', '\u2029', '😀'.repeat(1001), 'COUNT', 'not there', 'count.*', 'count + 1;\naaa'].map(text => [{ line: 1, text }]),
    ...[0, null, true, 1.5, '1', 20001, 3].map(occurrence => [{ line: 1, text: 'count', occurrence }]),
    [{ line: 1, text: 'count' }, { line: 1, text: 'count', occurrence: 1 }],
    [{ line: 2, text: 'aa', occurrence: 2 }], [{ line: 3, text: 'e\u0301' }]
  ];
  try {
    for (const [index, spans] of bad.entries()) {
      assert.equal((await h.publish(undefined, d => { d.referenceCode = { ...code, highlightSpans: spans }; })).status, 422, 'invalid source span ' + index);
      assert.equal((await h.publish(undefined, d => { d.referenceCode = code; d.lessons[0].blocks[0].focusSpans = spans; })).status, 422, 'invalid block span ' + index);
    }
    for (const configure of [
      d => { d.lessons[0].blocks[0].focusSpans = [{ line: 1, text: 'count' }]; },
      d => { d.referenceCode = code; d.lessons[0].referenceCode = { language: 'python', source: 'other = 1' }; d.lessons[0].blocks[0].focusSpans = [{ line: 1, text: 'count' }]; },
      d => { d.referenceCode = code; d.lessons[0].blocks = [{ id: randomUUID(), type: 'question', text: '填写整数。', questionType: 'shortAnswer', input: { kind: 'integer' }, execution: { language: 'python', template: 'print({{ANSWER}})' }, focusSpans: [{ line: 1, text: 'count' }] }]; },
      d => { d.referenceCode = code; const t = trace(); t.variants[0].frames[0].focusSpans = [{ line: 1, text: 'count' }]; d.lessons[0].blocks[0].presentation = { kind: 'trace', trace: t }; }
    ]) assert.equal((await h.publish(undefined, configure)).status, 422, 'span resolves against actual current program');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM courses').get().n, 0, 'invalid spans cannot publish partial courses');
  } finally { h.db.close(); }
});
