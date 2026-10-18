#!/usr/bin/env node
// Real-container acceptance only. This client never executes submitted code on
// the host, starts a server, reads account data, or connects through the public API.
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const GROUPS = ['functional', 'isolation', 'stress'];
const OUTPUT_LIMIT = 16 * 1024;
const started = performance.now();
const deadline = started + 78_000;
const selected = new Set();
let socket = process.env.RUNNER_SOCKET;
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--help') {
    console.log('RUNNER_SOCKET=/absolute/runner.sock node verify-course-runner.mjs [--functional] [--isolation] [--stress]\nOptional: --socket /absolute/runner.sock. With no group flags, run every group. JSON report goes to stdout; failures exit nonzero.');
    process.exit(0);
  }
  if (argument === '--socket') socket = process.argv[++index];
  else if (GROUPS.includes(argument.slice(2)) && argument.startsWith('--')) selected.add(argument.slice(2));
  else {
    console.log(JSON.stringify({ ok: false, error: 'UNKNOWN_ARGUMENT' }));
    process.exit(2);
  }
}
if (!socket?.startsWith('/') || socket.includes('\0')) {
  console.log(JSON.stringify({ ok: false, error: 'ABSOLUTE_RUNNER_SOCKET_REQUIRED' }));
  process.exit(2);
}
if (selected.size === 0) for (const group of GROUPS) selected.add(group);

const checks = [];
class CheckFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireCheck(condition, code) {
  if (!condition) throw new CheckFailure(code);
}
function requestRun(language, source, stdin = '') {
  // Keep the wire contract deliberately narrow, even for isolation probes.
  const body = JSON.stringify({ language, source, stdin });
  return new Promise((resolve, reject) => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return reject(new CheckFailure('SUITE_TIME_BUDGET_EXHAUSTED'));
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const request = http.request({ socketPath: socket, path: '/run', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 256 * 1024) {
          finish(new CheckFailure('RESPONSE_BODY_LIMIT_EXCEEDED'));
          response.destroy();
          request.destroy();
        } else chunks.push(chunk);
      });
      response.once('error', () => finish(new CheckFailure('RESPONSE_CONNECTION_ERROR')));
      response.once('end', () => {
        if (response.statusCode !== 200) return finish(new CheckFailure('RUNNER_HTTP_' + response.statusCode));
        let value;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { return finish(new CheckFailure('INVALID_RUNNER_JSON')); }
        if (!value || typeof value.status !== 'string' || typeof value.stdout !== 'string' || typeof value.stderr !== 'string')
          return finish(new CheckFailure('INVALID_RUNNER_RESULT'));
        finish(null, value);
      });
    });
    const timer = setTimeout(() => {
      finish(new CheckFailure(performance.now() >= deadline ? 'SUITE_TIME_BUDGET_EXHAUSTED' : 'RUNNER_REQUEST_TIMEOUT'));
      request.destroy();
    }, Math.min(14_500, remaining));
    request.once('error', () => finish(new CheckFailure('RUNNER_CONNECTION_ERROR')));
    request.end(body);
  });
}
async function test(group, name, operation) {
  if (!selected.has(group)) return;
  const beginning = performance.now();
  try {
    requireCheck(beginning < deadline, 'SUITE_TIME_BUDGET_EXHAUSTED');
    const details = await operation();
    checks.push({ group, name, ok: true, elapsedMs: Math.round(performance.now() - beginning), ...details });
  } catch (error) {
    // Do not emit exception messages, submitted source, server stderr, paths,
    // environment values, socket names, or credentials into the report.
    checks.push({ group, name, ok: false, elapsedMs: Math.round(performance.now() - beginning),
      error: error instanceof CheckFailure ? error.code : 'UNEXPECTED_ACCEPTANCE_ERROR' });
  }
}
function resultSummary(result) {
  return { status: result.status, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr) };
}
function completed(result, expected) {
  requireCheck(result.status === 'completed', 'EXPECTED_COMPLETED_GOT_' + safeStatus(result.status));
  requireCheck(result.stdout === expected, 'UNEXPECTED_STDOUT');
  requireCheck(result.stderr === '', 'UNEXPECTED_STDERR');
  requireCheck(result.exitCode === 0, 'EXPECTED_ZERO_EXIT_CODE');
  return resultSummary(result);
}
function safeStatus(value) {
  return ['completed', 'timeout', 'compileError', 'runtimeError', 'outputLimit', 'unavailable'].includes(value) ? value.toUpperCase() : 'INVALID_STATUS';
}
function outputLimited(result) {
  requireCheck(result.status === 'outputLimit', 'EXPECTED_OUTPUT_LIMIT_GOT_' + safeStatus(result.status));
  requireCheck(Buffer.byteLength(result.stdout) <= OUTPUT_LIMIT && Buffer.byteLength(result.stderr) <= OUTPUT_LIMIT, 'OUTPUT_CAP_EXCEEDED');
  requireCheck(!result.stdout.includes('\uFFFD') && !result.stderr.includes('\uFFFD'), 'BROKEN_UTF8_OUTPUT_BOUNDARY');
  requireCheck(result.stdout.length + result.stderr.length > 0, 'OUTPUT_DISCARDED');
  return resultSummary(result);
}
async function recovery(group, name) {
  await test(group, name, async () => completed(await requestRun('python', 'print("recovered")\n'), 'recovered\n'));
}

await test('functional', 'python-hello', async () => completed(await requestRun('python', 'print("Hello, Workshop!")\n'), 'Hello, Workshop!\n'));
await test('functional', 'python-stdin', async () => completed(await requestRun('python', 'import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n', '17 25\n'), '42\n'));
await test('functional', 'python-unicode', async () => completed(await requestRun('python', 'import sys\nprint("工作坊 🧪 " + sys.stdin.read().strip())\n', '你好\n'), '工作坊 🧪 你好\n'));
await test('functional', 'python-runtime-error', async () => {
  const result = await requestRun('python', 'raise ValueError("acceptance-error")\n');
  requireCheck(result.status === 'runtimeError' && result.stderr.includes('ValueError'), 'PYTHON_ERROR_NOT_REPORTED');
  return resultSummary(result);
});
await test('functional', 'cpp-iostream', async () => completed(await requestRun('cpp', '#include <iostream>\nint main(){std::cout << "Hello, C++!\\n";}\n'), 'Hello, C++!\n'));
await test('functional', 'cpp-bits-stdin', async () => completed(await requestRun('cpp', '#include <bits/stdc++.h>\nint main(){long long a,b; std::cin>>a>>b; std::cout<<std::gcd(a,b)<<" "<<std::lcm(a,b)<<"\\n";}\n', '24 36\n'), '12 72\n'));
await test('functional', 'cpp-compile-error', async () => {
  const result = await requestRun('cpp', '#include <iostream>\nint main(){std::cout << ;}\n');
  requireCheck(result.status === 'compileError' && result.stderr.length > 0, 'CPP_COMPILE_ERROR_NOT_REPORTED');
  return resultSummary(result);
});
await test('functional', 'cpp-runtime-error', async () => {
  const result = await requestRun('cpp', '#include <cstdlib>\nint main(){std::abort();}\n');
  requireCheck(result.status === 'runtimeError', 'CPP_RUNTIME_ERROR_NOT_REPORTED');
  return resultSummary(result);
});
await recovery('functional', 'functional-recovery');

const isolationSource = String.raw`import errno,json,os,socket
def read(path):
    with open(path,encoding='utf-8') as stream: return stream.read().strip()
status=dict(line.split(':',1) for line in read('/proc/self/status').splitlines() if ':' in line)
def limit(name):
    try: return read('/sys/fs/cgroup/'+name)
    except OSError: return 'unavailable'
root_read_only=False
for line in read('/proc/self/mountinfo').splitlines():
    fields=line.split(' - ',1)[0].split()
    if len(fields)>5 and fields[4]=='/': root_read_only='ro' in fields[5].split(',')
root_write_denied=False
try:
    fd=os.open('/.workshop-runner-readonly-probe',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    os.close(fd)
    os.unlink('/.workshop-runner-readonly-probe')
except OSError as error: root_write_denied=error.errno in (errno.EROFS,errno.EACCES,errno.EPERM)
paths=['/etc/guangyi-workspace.env','/var/lib/guangyi-workspace/workspace.sqlite','/run/docker.sock','/var/run/docker.sock','/run/user/10001/docker.sock']
protected_paths_unreadable=all(not os.access(path,os.R_OK) for path in paths)
forbidden_env={'DATABASE_PATH','ADMIN_EMAIL','ADMIN_PASSWORD','COURSE_RUNNER_IMAGE','COURSE_RUNNER_SOCKET','GUANGYI_DEPLOY_KEY','APNS_PRIVATE_KEY_FILE'}
environment_clean=all(key not in forbidden_env and not any(word in key.upper() for word in ('PASSWORD','SECRET','TOKEN','PRIVATE_KEY')) for key in os.environ)
def blocked(address,port):
    with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as connection:
        connection.settimeout(0.2)
        try: connection.connect((address,port)); return False
        except OSError: return True
print(json.dumps({'uid':[int(value) for value in status['Uid'].split()],'gid':[int(value) for value in status['Gid'].split()],
    'capEff':status['CapEff'].strip(),'noNewPrivs':int(status['NoNewPrivs']),'seccomp':int(status['Seccomp']),
    'memoryMax':limit('memory.max'),'swapMax':limit('memory.swap.max'),'pidsMax':limit('pids.max'),'cpuMax':limit('cpu.max'),
    'rootReadOnly':root_read_only,'rootWriteDenied':root_write_denied,'protectedPathsUnreadable':protected_paths_unreadable,
    'environmentClean':environment_clean,'externalBlocked':blocked('1.1.1.1',443),
    'hostLoopbackBlocked':blocked('127.0.0.1',8087) and blocked('127.0.0.1',2375)}))
`;
await test('isolation', 'container-isolation', async () => {
  const result = await requestRun('python', isolationSource);
  requireCheck(result.status === 'completed', 'ISOLATION_PROBE_DID_NOT_COMPLETE');
  let value;
  try { value = JSON.parse(result.stdout); } catch { throw new CheckFailure('INVALID_ISOLATION_PROBE_JSON'); }
  requireCheck(Array.isArray(value.uid) && value.uid.length === 4 && value.uid.every(id => id === 10001), 'RUNNER_UID_NOT_ISOLATED');
  requireCheck(Array.isArray(value.gid) && value.gid.length === 4 && value.gid.every(id => id === 10001), 'RUNNER_GID_NOT_ISOLATED');
  requireCheck(/^0+$/.test(value.capEff), 'LINUX_CAPABILITIES_NOT_DROPPED');
  requireCheck(value.noNewPrivs === 1 && value.seccomp === 2, 'LINUX_SYSCALL_ISOLATION_NOT_ENFORCED');
  requireCheck(value.memoryMax === '268435456', 'MEMORY_CGROUP_LIMIT_NOT_ENFORCED');
  requireCheck(value.swapMax === '0', 'SWAP_CGROUP_LIMIT_NOT_ENFORCED');
  requireCheck(value.pidsMax === '48', 'PID_CGROUP_LIMIT_NOT_ENFORCED');
  const cpu = String(value.cpuMax).split(/\s+/).map(Number);
  requireCheck(cpu.length === 2 && Number.isFinite(cpu[0]) && cpu[1] > 0 && Math.abs(cpu[0] / cpu[1] - 0.5) < 0.00001, 'CPU_CGROUP_LIMIT_NOT_ENFORCED');
  requireCheck(value.rootReadOnly === true && value.rootWriteDenied === true, 'ROOT_FILESYSTEM_NOT_READ_ONLY');
  requireCheck(value.protectedPathsUnreadable === true, 'HOST_SENSITIVE_PATH_EXPOSED');
  requireCheck(value.environmentClean === true, 'HOST_CREDENTIAL_ENVIRONMENT_EXPOSED');
  requireCheck(value.externalBlocked === true && value.hostLoopbackBlocked === true, 'CONTAINER_NETWORK_NOT_ISOLATED');
  return { uid: 10001, capEff: '0', noNewPrivs: 1, seccomp: 2,
    memoryMax: 268435456, swapMax: 0, pidsMax: 48, cpuQuota: 0.5,
    rootReadOnly: true, protectedPathsUnreadable: true, environmentClean: true, networkBlocked: true };
});

for (const [language, source] of [
  ['python', 'while True: pass\n'],
  ['cpp', 'int main(){volatile unsigned long long n=0; for(;;){n=n+1;}}\n'],
]) await test('stress', language + '-execution-timeout', async () => {
  const beginning = performance.now();
  const result = await requestRun(language, source);
  const wallMs = performance.now() - beginning;
  requireCheck(result.status === 'timeout', 'EXPECTED_TIMEOUT_GOT_' + safeStatus(result.status));
  requireCheck(wallMs >= 1800 && wallMs < 8500, 'TWO_SECOND_EXECUTION_TIMEOUT_NOT_ENFORCED');
  return resultSummary(result);
});

await test('stress', 'python-output-unicode-limit', async () => outputLimited(await requestRun('python', 'import sys\nsys.stdout.write("中🧪" * 10000)\n')));
await test('stress', 'cpp-output-unicode-limit', async () => outputLimited(await requestRun('cpp', '#include <iostream>\nint main(){for(int i=0;i<10000;++i)std::cout<<"中🧪";}\n')));
await test('stress', 'python-stderr-unicode-limit', async () => outputLimited(await requestRun('python', 'import sys\nsys.stderr.write("中🧪" * 10000)\n')));

for (const [language, source] of [
  ['python', 'blocks=[]\nwhile True: blocks.append(bytearray(8*1024*1024))\n'],
  ['cpp', '#include <cstring>\n#include <vector>\nint main(){std::vector<char*> blocks;for(;;){char* p=new char[8*1024*1024];std::memset(p,1,8*1024*1024);blocks.push_back(p);}}\n'],
]) {
  await test('stress', language + '-memory-exhaustion', async () => {
    const result = await requestRun(language, source);
    requireCheck(result.status === 'runtimeError' || result.status === 'timeout', 'MEMORY_EXHAUSTION_NOT_CONTAINED_' + safeStatus(result.status));
    return resultSummary(result);
  });
  await recovery('stress', language + '-memory-recovery');
}

await test('stress', 'python-descendant-output-pipe', async () => {
  const beginning = performance.now();
  const result = await requestRun('python', 'import subprocess,sys\nsubprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"],stdin=subprocess.DEVNULL)\nprint("parent-exited",flush=True)\n');
  requireCheck(result.status === 'timeout', 'DESCENDANT_PIPE_NOT_REAPED_' + safeStatus(result.status));
  requireCheck(performance.now() - beginning < 8500, 'DESCENDANT_PIPE_OUTLIVED_EXECUTION_DEADLINE');
  return resultSummary(result);
});
await recovery('stress', 'stress-recovery');

const ok = checks.length > 0 && checks.every(check => check.ok);
console.log(JSON.stringify({ ok, transport: 'private-unix-socket', realContainersRequired: true,
  groups: GROUPS.filter(group => selected.has(group)), checks,
  passed: checks.filter(check => check.ok).length, failed: checks.filter(check => !check.ok).length,
  elapsedMs: Math.round(performance.now() - started) }, null, 2));
process.exitCode = ok ? 0 : 1;
