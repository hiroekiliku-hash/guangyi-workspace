import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCourseAPI, courseManualPrompt } from './courses.mjs';
import { createCourseExecutionClient } from './course-execution.mjs';
import { createDockerCourseRunner, dockerCourseArguments, cleanupDockerCourseContainers, createCourseRunnerServer } from './CourseRunner/runner.mjs';

const completed = (stdout = '5') => ({ status: 'completed', stdout, stderr: '', exitCode: 0, durationMs: 3 });
const question = () => ({ id: randomUUID(), type: 'question', text: '输出 5。', questionType: 'shortAnswer', answerFormat: 'code', input: { kind: 'code', language: 'javascript', minLines: 2, maxLines: 24 }, execution: { language: 'javascript', expectedOutput: '5' } });
const document = block => ({ protocol: 'WORKSHOP-COURSE/1', id: randomUUID(), title: '输入与代码运行', summary: '', lessons: [{ id: randomUUID(), title: '程序', blocks: [block ?? question()] }] });
function harness(runCode) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1),(2),(3)');
  class APIError extends Error { constructor(status, code) { super(code); this.status = status; } }
  const users = new Map([['1', 1], ['2', 2], ['3', 3]]);
  const userFor = request => { const actor = users.get(request.headers.authorization); if (!actor) throw new APIError(401, 'UNAUTHORIZED'); return actor; };
  const handle = createCourseAPI({ db, userFor, workspaceAccess: (request, write) => {
    const actor = userFor(request); if (write && actor !== 1) throw new APIError(403, 'READ_ONLY'); return { ownerID: actor === 3 ? 3 : 1 };
  }, sameWebOrigin: () => {}, respond: (response, status, body) => Object.assign(response, { status, body }), APIError, origin: 'https://example.invalid', rateLimit: () => {}, peer: () => 'test', ...(runCode ? { runCode } : {}) });
  async function request(path, body, { user = '1', method = 'POST', revoke = false } = {}) {
    const bytes = Buffer.from(JSON.stringify(body ?? {}));
    const stream = Readable.from((async function* () { yield bytes; if (revoke) users.delete(user); })());
    stream.method = method; stream.headers = { 'content-type': 'application/json', 'idempotency-key': randomUUID(), authorization: user };
    const response = {};
    try { await handle(stream, response, '/api/native/v1/courses' + path); return response; }
    catch (error) { if (error instanceof APIError) return { status: error.status, code: error.message }; throw error; }
  }
  return { db, request, async publish(doc) { return request('', doc); }, runBody(doc, text = 'console.log(5);', extra = {}) { return { courseRevision: 1, lessonID: doc.lessons[0].id, blockID: doc.lessons[0].blocks[0].id, text, ...extra }; } };
}
test('input controls and explicit execution publish without changing legacy questions', async () => {
  const h = harness();
  try {
    for (const input of [undefined, { kind: 'text', placeholder: '' }, { kind: 'integer', minLines: 2 }, { kind: 'decimal' }, { kind: 'code', language: 'cpp', starterCode: '', minLines: 3, maxLines: 8 }]) {
      const block = question(); delete block.execution; if (input) block.input = input; else delete block.input;
      const doc = document(block); assert.equal((await h.publish(doc)).status, 201);
    }
    const legacyRun = question(); delete legacyRun.input;
    assert.equal((await h.publish(document(legacyRun))).status, 201, 'execution without input infers a complete program');
    const prompt = courseManualPrompt();
    for (const fragment of ['两行数字键盘', 'starterCode', '{{ANSWER}}', 'execution', '服务器独立沙盒', '不能宣称已编译通过']) assert.ok(prompt.includes(fragment));
  } finally { h.db.close(); }
});
test('invalid input fields, language mismatches, templates and numeric accepted answers are rejected', async () => {
  const h = harness();
  try {
    const invalid = [
      b => { b.input.extra = true; }, b => { b.input.kind = 'number'; }, b => { b.input.minLines = 1; }, b => { b.input.maxLines = 25; },
      b => { b.input.minLines = 8; b.input.maxLines = 4; }, b => { b.input.language = 'python'; },
      b => { b.input = { kind: 'text', language: 'javascript' }; }, b => { b.input = { kind: 'integer', starterCode: '4' }; },
      b => { b.input = { kind: 'decimal' }; }, b => { b.execution.template = 'no marker'; }, b => { b.execution.template = '{{ANSWER}} + {{ANSWER}}'; },
      b => { b.execution.stdin = 'x'.repeat(4001); }, b => { b.execution.extra = true; },
      b => { b.input = { kind: 'integer' }; b.execution.template = 'console.log({{ANSWER}})'; b.acceptedAnswers = ['1e3']; },
      b => { b.questionType = 'singleChoice'; b.options = [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }]; b.correctOptionIDs = ['a']; delete b.answerFormat; }
    ];
    for (const mutate of invalid) { const block = question(); mutate(block); assert.equal((await h.publish(document(block))).status, 422); }
  } finally { h.db.close(); }
});
test('numeric progress accepts signed decimal syntax and rejects text or exponent input', async () => {
  const h = harness();
  try {
    for (const [kind, good, bad] of [['integer', '-42', '4.2'], ['decimal', '+.5', '1e3']]) {
      const block = question(); block.input = { kind }; delete block.execution; delete block.answerFormat;
      const doc = document(block); assert.equal((await h.publish(doc)).status, 201);
      const progress = text => h.request('/' + doc.id + '/progress', { mutationID: randomUUID(), ...h.runBody(doc, text) });
      assert.equal((await progress(good)).status, 200); assert.equal((await progress(bad)).code, 'INVALID_COURSE_ANSWER');
    }
  } finally { h.db.close(); }
});
test('run derives language, source and expected result from the saved course, with literal template replacement', async () => {
  let received; const h = harness(async payload => { received = payload; return completed('$&'); });
  try {
    const block = question(); block.execution = { language: 'javascript', template: 'console.log("{{ANSWER}}")', expectedOutput: '$&', stdin: 'preset' };
    const doc = document(block); await h.publish(doc);
    const result = await h.request('/' + doc.id + '/run', h.runBody(doc, '$&'), { user: '2' });
    assert.equal(result.status, 200); assert.deepEqual(received, { language: 'javascript', source: 'console.log("$&")', stdin: 'preset' });
    assert.equal(result.body.data.passed, true);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM course_progress').get().n, 0, 'run never overwrites saved answers');
    assert.equal((await h.request('/' + doc.id + '/run', { ...h.runBody(doc), language: 'python' })).status, 422);
    assert.equal((await h.request('/' + doc.id + '/run', h.runBody(doc, '$&', { stdin: '' }))).body.data.passed, undefined);
  } finally { h.db.close(); }
});
test('run checks auth, sharing, course revision, block configuration and post-upload revocation', async () => {
  let calls = 0; const h = harness(async () => { calls++; return completed(); });
  try {
    const doc = document(); await h.publish(doc); const path = '/' + doc.id + '/run';
    assert.equal((await h.request(path, h.runBody(doc), { user: 'no-session' })).status, 401);
    assert.equal((await h.request(path, h.runBody(doc), { user: '3' })).status, 404);
    assert.equal((await h.request(path, h.runBody(doc, 'x', { courseRevision: 2 }))).status, 409);
    assert.equal((await h.request(path, h.runBody(doc, 'x', { blockID: randomUUID() }))).code, 'COURSE_EXECUTION_NOT_ALLOWED');
    assert.equal((await h.request(path, h.runBody(doc), { user: '2', revoke: true })).status, 401);
    const block = question(); delete block.execution; const plain = document(block); await h.publish(plain);
    assert.equal((await h.request('/' + plain.id + '/run', h.runBody(plain))).code, 'COURSE_EXECUTION_NOT_ALLOWED');
    assert.equal(calls, 0);
  } finally { h.db.close(); }
});
test('unconfigured or failed runner returns unavailable, while concurrent user requests are bounded', async () => {
  const h = harness();
  try { const doc = document(); await h.publish(doc); assert.equal((await h.request('/' + doc.id + '/run', h.runBody(doc))).body.data.status, 'unavailable'); } finally { h.db.close(); }
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const h2 = harness(async () => { entered(); await gate; throw new Error('private runner details'); });
  try {
    const doc = document(); await h2.publish(doc); const path = '/' + doc.id + '/run';
    const first = h2.request(path, h2.runBody(doc)); await started;
    assert.equal((await h2.request(path, h2.runBody(doc))).code, 'COURSE_RUN_BUSY');
    release(); assert.equal((await first).body.data.status, 'unavailable');
  } finally { release(); h2.db.close(); }
});
test('Docker runner uses fixed commands, pinned image and all required containment flags', async () => {
  const image = 'sha256:' + 'a'.repeat(64), name = 'workshop-run-' + randomUUID();
  const args = dockerCourseArguments(image, name);
  for (const flag of ['--pull=never', '--network=none', '--read-only', '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges=true', '--memory=256m', '--memory-swap=256m', '--cpus=0.5', '--pids-limit=48', '--log-driver=none', 'fsize=8388608:8388608', 'workshop.course-runner.instance=guangyi-workspace']) assert.ok(args.includes(flag));
  assert.equal(args.includes('--privileged'), false); assert.equal(args.includes('--volume'), false); assert.equal(args.includes('--mount'), false);
  assert.throws(() => dockerCourseArguments('node:latest', name));
  assert.throws(() => dockerCourseArguments(image, name, 'other/instance'));
  assert.ok(dockerCourseArguments(image, name, 'separate-runner').includes('workshop.course-runner.instance=separate-runner'));
  const calls = []; const run = createDockerCourseRunner({ image, execute: async (...call) => { calls.push(call); return { code: 0, stdout: Buffer.from(JSON.stringify(completed())), stderr: Buffer.alloc(0) }; } });
  assert.equal((await run({ language: 'cpp', source: 'int main(){}', stdin: '' })).status, 'completed');
  assert.deepEqual(calls[1][1].slice(0, 2), ['rm', '--force']);
  assert.equal((await run({ language: 'bash', source: 'echo hello', stdin: '' })).status, 'unavailable');
});
test('Docker runner cleans up on timeout, output flood and malformed container responses', async () => {
  const image = 'sha256:' + 'b'.repeat(64);
  for (const [raw, expected] of [[{ timedOut: true, code: null }, 'timeout'], [{ overflow: true, code: null }, 'outputLimit'], [{ code: 0, stdout: Buffer.from('not JSON') }, 'unavailable']]) {
    let removals = 0;
    const run = createDockerCourseRunner({ image, execute: async (_binary, args) => { if (args[0] === 'rm') { removals++; return {}; } return raw; } });
    assert.equal((await run({ language: 'python', source: 'print(1)', stdin: '' })).status, expected); assert.equal(removals, 1);
  }
});
test('runner cleanup uses the configured binary and both instance labels, then verifies no containers remain', async () => {
  const docker = '/opt/workshop-course-runner/docker-cli', instance = 'test-instance', id = 'c'.repeat(64), calls = [];
  let removed = false;
  const execute = async (binary, args) => {
    assert.equal(binary, docker); calls.push(args);
    if (args[0] === 'rm') { assert.deepEqual(args, ['rm', '--force', id]); removed = true; return { code: 0 }; }
    assert.deepEqual(args, ['ps', '--all', '--no-trunc', '--filter', 'label=workshop.course-runner=1', '--filter', 'label=workshop.course-runner.instance=test-instance', '--format', '{{.ID}}']);
    return { code: 0, stdout: Buffer.from(removed ? '' : id + '\n') };
  };
  assert.equal(await cleanupDockerCourseContainers({ docker, instance, execute }), 1);
  assert.equal(calls.length, 3);
});
test('runner cleanup rejects invalid selectors, engine errors, malformed IDs and incomplete removal', async () => {
  const id = 'd'.repeat(64);
  for (const settings of [{ docker: 'docker' }, { docker: '/bad\0binary' }, { instance: '' }, { instance: 'bad=selector' }]) {
    await assert.rejects(cleanupDockerCourseContainers({ ...settings, execute: async () => { throw new Error('must not execute'); } }), /INVALID_RUNNER_CONFIGURATION/);
  }
  for (const failure of ['list', 'listTimeout', 'listOverflow', 'invalidID', 'remove', 'remaining']) {
    let lists = 0;
    await assert.rejects(cleanupDockerCourseContainers({ execute: async (_binary, args) => {
      if (args[0] === 'rm') return { code: failure === 'remove' ? 1 : 0 };
      lists++;
      if (failure === 'list') return { code: 1 };
      if (failure === 'listTimeout') return { code: 0, timedOut: true };
      if (failure === 'listOverflow') return { code: 0, overflow: true };
      return { code: 0, stdout: Buffer.from(failure === 'invalidID' ? 'unexpected ID' : (lists === 1 || failure === 'remaining' ? id : '')) };
    } }), /RUNNER_CLEANUP_FAILED/, failure);
  }
});
test('runner stop blocks new submissions, drains active work and performs one instance sweep', async () => {
  const image = 'sha256:' + 'e'.repeat(64), calls = [];
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const run = createDockerCourseRunner({ image, instance: 'stop-test', execute: async (_binary, args) => {
    calls.push(args);
    if (args[0] === 'run') { entered(); await gate; return { code: 0, stdout: Buffer.from(JSON.stringify(completed())) }; }
    return { code: 0, stdout: Buffer.alloc(0) };
  } });
  const payload = { language: 'python', source: 'print(5)', stdin: '' };
  const first = run(payload); await started;
  const stopped = run.stop(); assert.equal(run.stop(), stopped);
  assert.equal((await run(payload)).status, 'unavailable');
  assert.equal(calls.filter(args => args[0] === 'ps').length, 0, 'do not sweep before a pending container creation finishes');
  release(); assert.equal((await first).status, 'completed'); await stopped;
  assert.equal(calls.filter(args => args[0] === 'run').length, 1);
  assert.equal(calls.filter(args => args[0] === 'ps').length, 2);
  assert.ok(calls.filter(args => args[0] === 'ps').every(args => args.includes('label=workshop.course-runner.instance=stop-test')));
  assert.equal((await run(payload)).status, 'unavailable');
});
test('failed request cleanup or stop cleanup permanently closes runner admission', async () => {
  const image = 'sha256:' + 'f'.repeat(64), payload = { language: 'python', source: 'print(5)', stdin: '' };
  let started = 0;
  const run = createDockerCourseRunner({ image, execute: async (_binary, args) => {
    if (args[0] === 'run') { started++; return { code: 0, stdout: Buffer.from(JSON.stringify(completed())) }; }
    if (args[0] === 'rm') return { code: 1 };
    return { code: 0, stdout: Buffer.from('f'.repeat(64)) };
  } });
  await run(payload); assert.equal((await run(payload)).status, 'unavailable'); assert.equal(started, 1);
  await assert.rejects(run.stop(), /RUNNER_CLEANUP_FAILED/);
  assert.equal((await run(payload)).status, 'unavailable');
});
test('Unix socket client bounds output, omits untrusted grades and reports an unavailable runner honestly', async () => {
  assert.equal((await createCourseExecutionClient()({})).status, 'unavailable');
  const directory = await mkdtemp(join(tmpdir(), 'workshop-course-runner-')), socketPath = join(directory, 'run.sock');
  let output = { ...completed('5'), passed: true };
  const server = createCourseRunnerServer(async () => output);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  try {
    const client = createCourseExecutionClient({ socketPath });
    assert.deepEqual(await client({ language: 'javascript', source: 'console.log(5)', stdin: '' }), completed('5'));
    output = { ...completed(), stdout: 'x'.repeat(16 * 1024 + 1) };
    assert.equal((await client({})).status, 'unavailable');
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
