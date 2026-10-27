// Install independently from the workspace API. Never give the API Docker access.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAX_OUTPUT = 16 * 1024, MAX_BODY = 256 * 1024;
const unavailable = (durationMs = 0) => ({ status: 'unavailable', stdout: '', stderr: '代码运行服务暂不可用。', durationMs });
const imageID = /^sha256:[a-f0-9]{64}$/;
const defaultInstance = 'guangyi-workspace';
const instanceID = /^[a-z][a-z0-9-]{0,63}$/;
const absoluteBinary = value => typeof value === 'string' && value.startsWith('/') && !value.includes('\0');
const instanceFilters = instance => ['--filter', 'label=workshop.course-runner=1', '--filter', 'label=workshop.course-runner.instance=' + instance];
export function dockerCourseArguments(image, name, instance = defaultInstance) {
  if (!imageID.test(image) || !/^workshop-run-[0-9a-f-]{36}$/.test(name) || !instanceID.test(instance)) throw new Error('INVALID_RUNNER_CONFIGURATION');
  return ['run', '--rm', '--interactive', '--init', '--name', name,
    '--label', 'workshop.course-runner=1', '--label', 'workshop.course-runner.instance=' + instance,
    '--pull=never', '--network=none', '--read-only',
    '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges=true',
    '--memory=256m', '--memory-swap=256m', '--cpus=0.5', '--pids-limit=48',
    '--ulimit', 'nofile=64:64', '--ulimit', 'fsize=8388608:8388608', '--ulimit', 'core=0:0',
    '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=32m,uid=10001,gid=10001,mode=0700',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001,mode=0700',
    '--workdir=/workspace', '--env=HOME=/workspace', '--env=TMPDIR=/tmp', '--log-driver=none',
    '--entrypoint=/usr/local/bin/node', image, '/opt/course-runner/container-exec.mjs'];
}
export async function cleanupDockerCourseContainers({ docker = '/usr/bin/docker', instance = defaultInstance, execute = command } = {}) {
  if (!absoluteBinary(docker) || !instanceID.test(instance)) throw new Error('INVALID_RUNNER_CONFIGURATION');
  const list = async () => {
    const result = await execute(docker, ['ps', '--all', '--no-trunc', ...instanceFilters(instance), '--format', '{{.ID}}'], { timeout: 5000, maxBytes: 64 * 1024 });
    if (result.code !== 0 || result.timedOut || result.overflow) throw new Error('RUNNER_CLEANUP_FAILED');
    const text = result.stdout.toString().trim(), ids = text ? text.split(/\r?\n/) : [];
    if (ids.length > 256 || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error('RUNNER_CLEANUP_FAILED');
    return ids;
  };
  const ids = await list();
  for (let offset = 0; offset < ids.length; offset += 32) {
    const result = await execute(docker, ['rm', '--force', ...ids.slice(offset, offset + 32)], { timeout: 5000, maxBytes: 64 * 1024 });
    if (result.code !== 0 || result.timedOut || result.overflow) throw new Error('RUNNER_CLEANUP_FAILED');
  }
  if ((await list()).length) throw new Error('RUNNER_CLEANUP_FAILED');
  return ids.length;
}
function command(binary, args, { input, timeout = 10000, maxBytes = 256 * 1024 } = {}) {
  return new Promise(resolve => {
    let child, settled = false, bytes = 0, stdout = [], stderr = [], timedOut = false, overflow = false;
    const finish = code => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code, timedOut, overflow, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }); } };
    try { child = spawn(binary, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { return resolve({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }); }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    const capture = chunks => chunk => { bytes += chunk.length; if (bytes > maxBytes) { overflow = true; child.kill('SIGKILL'); } else chunks.push(chunk); };
    child.stdout.on('data', capture(stdout)); child.stderr.on('data', capture(stderr));
    child.stdin.on('error', () => {}); child.on('error', () => finish(null)); child.on('close', finish);
    child.stdin.end(input);
  });
}
export async function validateDockerRunner({ docker = '/usr/bin/docker', image }) {
  if (!imageID.test(image ?? '') || !absoluteBinary(docker)) throw new Error('RUNNER_REQUIRES_PINNED_IMAGE_AND_ABSOLUTE_DOCKER');
  const info = await command(docker, ['info', '--format', '{{json .}}'], { timeout: 5000, maxBytes: 256 * 1024 });
  let parsed; try { parsed = JSON.parse(info.stdout); } catch { throw new Error('DOCKER_UNAVAILABLE'); }
  // Fail closed if the engine cannot enforce the limits. Rootless Docker needs
  // cgroup v2 + systemd delegation; accepting ignored limits would be unsafe.
  if (info.code !== 0 || parsed.OSType !== 'linux' || parsed.CgroupVersion !== '2' || parsed.CgroupDriver !== 'systemd' ||
    !parsed.SecurityOptions?.some(value => value.includes('seccomp')) ||
    parsed.MemoryLimit !== true || parsed.SwapLimit !== true || parsed.PidsLimit !== true || parsed.CpuCfsQuota !== true)
    throw new Error('DOCKER_RESOURCE_ISOLATION_REQUIRED');
  const inspect = await command(docker, ['image', 'inspect', '--format', '{{.Id}}', image], { timeout: 5000, maxBytes: 256 });
  if (inspect.code !== 0 || inspect.stdout.toString().trim() !== image) throw new Error('PINNED_IMAGE_NOT_AVAILABLE');
}
export function createDockerCourseRunner({ docker = '/usr/bin/docker', image, instance = defaultInstance, concurrency = 1, execute = command } = {}) {
  if (!imageID.test(image ?? '') || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 2 || !absoluteBinary(docker) || !instanceID.test(instance)) throw new Error('INVALID_RUNNER_CONFIGURATION');
  let running = 0, healthy = true, drain, stopPromise;
  async function run(payload) {
    if (!healthy || running >= concurrency) return unavailable();
    const keys = ['language', 'source', 'stdin', 'profile', 'tests'];
    if (!payload || Array.isArray(payload) || Object.keys(payload).some(key => !keys.includes(key)) ||
      !['javascript', 'python', 'cpp'].includes(payload.language) || typeof payload.source !== 'string' || !payload.source.trim() || payload.source.length > 40000 ||
      typeof payload.stdin !== 'string' || payload.stdin.length > 4000 || /\0/.test(payload.source + payload.stdin)) return unavailable();
    if(payload.profile!==undefined&&(payload.profile!=='cpp-exam-basic'||payload.language!=='cpp'))return unavailable();
    if(payload.tests!==undefined&&(payload.profile!=='cpp-exam-basic'||payload.language!=='cpp'||!Array.isArray(payload.tests)||payload.tests.length<1||payload.tests.length>8||payload.tests.some(t=>typeof t!=='string'||t.length>4000||t.includes('\0'))))return unavailable();
    running++;
    const name = 'workshop-run-' + randomUUID(), start = performance.now();
    try {
      const raw = await execute(docker, dockerCourseArguments(image, name, instance), { input: JSON.stringify(payload), timeout: payload.tests?12500:10000, maxBytes: 256 * 1024 });
      const durationMs = Math.round(performance.now() - start);
      if (raw.timedOut || raw.overflow) return { status: raw.timedOut ? 'timeout' : 'outputLimit', stdout: '', stderr: raw.timedOut ? '运行超时。' : '输出超过限制。', durationMs };
      if (raw.code !== 0) return unavailable(durationMs);
      let result; try { result = JSON.parse(raw.stdout); } catch { return unavailable(durationMs); }
      if (!['completed', 'timeout', 'compileError', 'runtimeError', 'outputLimit'].includes(result.status) ||
        typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
        Buffer.byteLength(result.stdout) > MAX_OUTPUT || Buffer.byteLength(result.stderr) > MAX_OUTPUT ||
        (result.exitCode !== undefined && (!Number.isSafeInteger(result.exitCode) || Math.abs(result.exitCode) > 255))) return unavailable(durationMs);
      let cases;
      if(payload.tests&&result.status==='completed'){
        if(!Array.isArray(result.cases)||result.cases.length!==payload.tests.length||result.cases.some(c=>!c||!['completed','runtimeError'].includes(c.status)||typeof c.stdout!=='string'||Buffer.byteLength(c.stdout)>MAX_OUTPUT))return unavailable(durationMs);
        cases=result.cases.map(c=>({status:c.status,stdout:c.stdout,stderr:'',durationMs:0}));
        if(cases.reduce((n,c)=>n+Buffer.byteLength(c.stdout),0)>64*1024)return unavailable(durationMs);
      }
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, durationMs,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),...(cases?{cases}:{}) };
    } catch { return unavailable(Math.round(performance.now() - start)); }
    finally {
      // Killing the Docker CLI does not necessarily stop the container. Keep the
      // slot occupied until removal is attempted, even on malformed responses.
      try {
        const removed = await execute(docker, ['rm', '--force', name], { timeout: 2000, maxBytes: 1024 });
        if (removed.code !== 0) {
          const remaining = await execute(docker, ['ps', '--all', '--filter', 'name=^' + name + '$', '--format', '{{.ID}}'], { timeout: 2000, maxBytes: 1024 });
          if (remaining.code !== 0 || remaining.stdout.toString().trim()) healthy = false;
        }
      } catch { healthy = false; }
      running--;
      if (running === 0) drain?.();
    }
  }
  // Drain already issued Docker commands before the label sweep: a daemon can
  // finish creating a container after its client disconnects. ExecStopPost runs
  // the same sweep after a crash or forced service termination.
  run.stop = () => stopPromise ??= (async () => {
    healthy = false;
    if (running > 0) await new Promise(resolve => { drain = resolve; });
    await cleanupDockerCourseContainers({ docker, instance, execute });
  })();
  return run;
}
export function createCourseRunnerServer(run) {
  return http.createServer(async (request, response) => {
    const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)); };
    if (request.method !== 'POST' || request.url !== '/run') { request.resume(); return reply(404, unavailable()); }
    if (request.headers['content-type'] !== 'application/json' || Number(request.headers['content-length']) > MAX_BODY) { request.resume(); return reply(413, unavailable()); }
    let length = 0; const chunks = [];
    try {
      for await (const chunk of request) { length += chunk.length; if (length <= MAX_BODY) chunks.push(chunk); }
      if (length > MAX_BODY) return reply(413, unavailable());
      const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      reply(200, await run(payload));
    } catch { if (!response.writableEnded) reply(400, unavailable()); }
  }).setTimeout(15000);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--cleanup')) throw new Error('INVALID_RUNNER_MODE');
  const configuration = { docker: process.env.COURSE_RUNNER_DOCKER ?? '/usr/bin/docker', image: process.env.COURSE_RUNNER_IMAGE,
    instance: process.env.COURSE_RUNNER_INSTANCE ?? defaultInstance,
    concurrency: Number(process.env.COURSE_RUNNER_CONCURRENCY ?? 1) };
  await cleanupDockerCourseContainers(configuration);
  if (args[0] !== '--cleanup') {
    const socket = process.env.COURSE_RUNNER_SOCKET;
    if (!socket?.startsWith('/') || socket.includes('\0')) throw new Error('ABSOLUTE_RUNNER_SOCKET_REQUIRED');
    await validateDockerRunner(configuration);
    process.umask(0o007);
    const run = createDockerCourseRunner(configuration), server = createCourseRunnerServer(run);
    let shutdown;
    const stop = () => {
      if (shutdown) return;
      server.close();
      server.closeIdleConnections();
      shutdown = run.stop().then(() => { server.closeAllConnections(); process.exit(0); }, () => { server.closeAllConnections(); process.exit(1); });
    };
    process.on('SIGTERM', stop); process.on('SIGINT', stop);
    server.listen(socket, () => { chmodSync(socket, 0o660); console.log('Course runner listening on private Unix socket'); });
  }
}
