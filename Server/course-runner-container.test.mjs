import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { decodeCourseOutput, killCourseProcessGroup, executeCourseProcess } from './CourseRunner/container-exec.mjs';

// No compiler, interpreter, shell, process signal or /workspace write is used by
// this suite. Child lifecycle and pipes are simulated; real Linux containment is
// exercised separately inside the deployed disposable runner containers.
function processHarness(pid = 12345) {
  const child = new EventEmitter(), signals = [], calls = [], cancelled = [], input = [];
  child.pid = pid;
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin.on('data', chunk => input.push(chunk));
  child.unref = () => { child.unreferenced = true; };
  let expire;
  const timer = {};
  const options = {
    spawnProcess: (...args) => { calls.push(args); return child; },
    killProcess: (...args) => { signals.push(args); },
    schedule: (callback, timeout) => { expire = callback; calls.push(['timer', timeout]); return timer; },
    cancel: value => { cancelled.push(value); }
  };
  return { child, signals, calls, cancelled, input, options, timer, expire: () => expire() };
}

test('UTF-8 output truncation preserves complete scalars across byte and chunk boundaries', () => {
  for (const scalar of ['é', '界', '🙂']) {
    for (let prefix = 0; prefix < 4; prefix++) {
      const text = 'a'.repeat(prefix) + scalar.repeat(20000), bytes = Buffer.from(text);
      const value = decodeCourseOutput([bytes.subarray(0, 7), bytes.subarray(7, 16385), bytes.subarray(16385)]);
      assert.ok(Buffer.byteLength(value) <= 16384);
      assert.equal(value.includes('\uFFFD'), false, `${scalar}, prefix ${prefix}`);
      assert.ok(text.startsWith(value));
      assert.equal(value.isWellFormed(), true);
    }
  }
  assert.equal(decodeCourseOutput([Buffer.from('hello')]), 'hello');
  assert.equal(decodeCourseOutput([Buffer.from('界')], 2), '');
});

test('invalid child bytes cannot expand the normalized UTF-8 output beyond its byte limit', () => {
  const value = decodeCourseOutput([Buffer.alloc(16384, 0xff)]);
  assert.ok(Buffer.byteLength(value) <= 16384);
  assert.equal(value.isWellFormed(), true);
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value)), value);
});

test('process-group termination targets only the invocation PGID and tolerates an exited group', () => {
  const signals = [];
  assert.equal(killCourseProcessGroup({ pid: 4321 }, (...args) => signals.push(args)), true);
  assert.deepEqual(signals, [[-4321, 'SIGKILL']]);
  for (const pid of [undefined, null, 0, 1, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(killCourseProcessGroup({ pid }, () => { throw new Error('must not signal'); }), false);
  }
  assert.equal(killCourseProcessGroup({ pid: 4321 }, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); }), false);
});

test('normal execution creates a detached process group, passes stdin and cancels its deadline', async () => {
  const h = processHarness();
  const running = executeCourseProcess('/test/interpreter', ['answer'], 'input\n', 2000, h.options);
  assert.deepEqual(h.calls[0], ['/test/interpreter', ['answer'], { shell: false, detached: true, cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }]);
  assert.equal(Buffer.concat(h.input).toString(), 'input\n');
  h.child.stdout.write('5\n'); h.child.emit('close', 0);
  assert.deepEqual(await running, { code: 0, timedOut: false, overflow: false, stdout: '5\n', stderr: '' });
  assert.deepEqual(h.cancelled, [h.timer]);
  assert.deepEqual(h.signals, []);
  h.expire(); assert.deepEqual(h.signals, [], 'late timer cannot kill another process group');
});

test('deadline kills fork descendants even after parent exit and resolves without waiting for inherited pipes', async () => {
  const h = processHarness();
  const running = executeCourseProcess('/test/interpreter', [], '', 2000, h.options);
  h.child.stdout.write('before timeout');
  h.child.emit('exit', 0); // A descendant still holds stdout, so close never fires.
  h.expire();
  const result = await running;
  assert.equal(result.timedOut, true); assert.equal(result.code, null);
  assert.equal(result.stdout, 'before timeout');
  assert.deepEqual(h.signals, [[-12345, 'SIGKILL']]);
  assert.equal(h.child.stdout.destroyed, true); assert.equal(h.child.stderr.destroyed, true);
  assert.equal(h.child.unreferenced, true);
});

test('stdout or stderr flood terminates the entire process group and retains bounded Unicode output', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const h = processHarness();
    const running = executeCourseProcess('/test/interpreter', [], '', 2000, h.options);
    h.child[stream].write(Buffer.from('界'.repeat(6000)));
    const result = await running;
    assert.equal(result.overflow, true); assert.equal(result.timedOut, false);
    assert.ok(Buffer.byteLength(result[stream]) <= 16384);
    assert.equal(result[stream].includes('\uFFFD'), false);
    assert.deepEqual(h.signals, [[-12345, 'SIGKILL']]);
    h.expire(); assert.equal(h.signals.length, 1);
  }
});

test('synchronous spawn failure is safe before timer initialization and does not signal unrelated processes', async () => {
  const result = await executeCourseProcess('/test/interpreter', [], '', 2000, {
    spawnProcess: () => { throw new Error('spawn failed'); },
    killProcess: () => { throw new Error('must not signal'); },
    schedule: () => { throw new Error('must not schedule'); },
    cancel: () => { throw new Error('timer was not initialized'); }
  });
  assert.equal(result.code, 127); assert.equal(result.stderr, '无法启动语言运行环境。');
});

test('asynchronous spawn failure cancels its timer and produces a stable diagnostic', async () => {
  const h = processHarness(undefined); delete h.child.pid;
  const running = executeCourseProcess('/test/interpreter', [], '', 2000, h.options);
  h.child.emit('error', Object.assign(new Error('spawn failed'), { code: 'ENOENT' }));
  const result = await running;
  assert.equal(result.code, 127); assert.equal(result.stderr, '无法启动语言运行环境。');
  assert.deepEqual(h.cancelled, [h.timer]); assert.deepEqual(h.signals, []);
});

test('a vanished process group still releases a timed-out invocation with open pipe handles', async () => {
  const h = processHarness();
  h.options.killProcess = () => { throw Object.assign(new Error(), { code: 'ESRCH' }); };
  const running = executeCourseProcess('/test/interpreter', [], '', 2000, h.options);
  h.expire();
  assert.equal((await running).timedOut, true);
  assert.equal(h.child.stdout.destroyed, true); assert.equal(h.child.unreferenced, true);
});
