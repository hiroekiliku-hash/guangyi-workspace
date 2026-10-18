// Install independently from the workspace API. Never give the API Docker access.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MAX_OUTPUT = 16 * 1024, MAX_BODY = 256 * 1024;
const unavailable = (durationMs = 0) => ({ status: 'unavailable', stdout: '', stderr: '代码运行服务暂不可用。', durationMs });
const imageID = /^sha256:[a-f0-9]{64}$/;
export function dockerCourseArguments(image, name) {
  if (!imageID.test(image) || !/^workshop-run-[0-9a-f-]{36}$/.test(name)) throw new Error('INVALID_RUNNER_CONFIGURATION');
  return ['run', '--rm', '--interactive', '--init', '--name', name,
    '--label', 'workshop.course-runner=1', '--pull=never', '--network=none', '--read-only',
    '--user=10001:10001', '--cap-drop=ALL', '--security-opt=no-new-privileges=true',
    '--memory=256m', '--memory-swap=256m', '--cpus=0.5', '--pids-limit=48',
    '--ulimit', 'nofile=64:64', '--ulimit', 'fsize=1024:1024', '--ulimit', 'core=0:0',
    '--tmpfs', '/workspace:rw,exec,nosuid,nodev,size=32m,uid=10001,gid=10001,mode=0700',
    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001,mode=0700',
    '--workdir=/workspace', '--env=HOME=/workspace', '--env=TMPDIR=/tmp', '--log-driver=none',
    '--entrypoint=/usr/local/bin/node', image, '/opt/course-runner/container-exec.mjs'];
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
  if (!imageID.test(image ?? '') || !docker.startsWith('/')) throw new Error('RUNNER_REQUIRES_PINNED_IMAGE_AND_ABSOLUTE_DOCKER');
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
export function createDockerCourseRunner({ docker = '/usr/bin/docker', image, concurrency = 1, execute = command } = {}) {
  if (!imageID.test(image ?? '') || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 2 || !docker.startsWith('/')) throw new Error('INVALID_RUNNER_CONFIGURATION');
  let running = 0, healthy = true;
  return async function run(payload) {
    if (!healthy || running >= concurrency) return unavailable();
    const keys = ['language', 'source', 'stdin'];
    if (!payload || Array.isArray(payload) || Object.keys(payload).some(key => !keys.includes(key)) ||
      !['javascript', 'python', 'cpp'].includes(payload.language) || typeof payload.source !== 'string' || !payload.source.trim() || payload.source.length > 40000 ||
      typeof payload.stdin !== 'string' || payload.stdin.length > 4000 || /\0/.test(payload.source + payload.stdin)) return unavailable();
    running++;
    const name = 'workshop-run-' + randomUUID(), start = performance.now();
    try {
      const raw = await execute(docker, dockerCourseArguments(image, name), { input: JSON.stringify(payload), timeout: 10000, maxBytes: 256 * 1024 });
      const durationMs = Math.round(performance.now() - start);
      if (raw.timedOut || raw.overflow) return { status: raw.timedOut ? 'timeout' : 'outputLimit', stdout: '', stderr: raw.timedOut ? '运行超时。' : '输出超过限制。', durationMs };
      if (raw.code !== 0) return unavailable(durationMs);
      let result; try { result = JSON.parse(raw.stdout); } catch { return unavailable(durationMs); }
      if (!['completed', 'timeout', 'compileError', 'runtimeError', 'outputLimit'].includes(result.status) ||
        typeof result.stdout !== 'string' || typeof result.stderr !== 'string' ||
        Buffer.byteLength(result.stdout) > MAX_OUTPUT || Buffer.byteLength(result.stderr) > MAX_OUTPUT ||
        (result.exitCode !== undefined && (!Number.isSafeInteger(result.exitCode) || Math.abs(result.exitCode) > 255))) return unavailable(durationMs);
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, durationMs,
        ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }) };
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
    }
  };
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
  const socket = process.env.COURSE_RUNNER_SOCKET;
  if (!socket?.startsWith('/') || socket.includes('\0')) throw new Error('ABSOLUTE_RUNNER_SOCKET_REQUIRED');
  const configuration = { docker: process.env.COURSE_RUNNER_DOCKER ?? '/usr/bin/docker', image: process.env.COURSE_RUNNER_IMAGE,
    concurrency: Number(process.env.COURSE_RUNNER_CONCURRENCY ?? 1) };
  await validateDockerRunner(configuration);
  process.umask(0o007);
  const server = createCourseRunnerServer(createDockerCourseRunner(configuration));
  server.listen(socket, () => { chmodSync(socket, 0o660); console.log('Course runner listening on private Unix socket'); });
}
