// Runs only inside the disposable container; no account data or credentials enter it.
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const LIMIT = 16 * 1024, start = performance.now();
const result = (status, stdout = '', stderr = '', exitCode) => ({ status, stdout, stderr,
  durationMs: Math.round(performance.now() - start), ...(exitCode === undefined ? {} : { exitCode }) });
function utf8(chunks) {
  let value = Buffer.concat(chunks).subarray(0, LIMIT).toString('utf8');
  while (Buffer.byteLength(value) > LIMIT) value = value.slice(0, -1);
  return value;
}
function execute(binary, args, stdin, timeout) {
  return new Promise(resolve => {
    let settled = false, child, timedOut = false, overflow = false;
    let outBytes = 0, errBytes = 0; const stdout = [], stderr = [];
    const finish = code => {
      if (settled) return; settled = true; clearTimeout(timer);
      resolve({ code, timedOut, overflow, stdout: utf8(stdout), stderr: utf8(stderr) });
    };
    try { child = spawn(binary, args, { shell: false, cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { return resolve({ code: 127, stdout: '', stderr: '无法启动语言运行环境。' }); }
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', chunk => { const remain = LIMIT - outBytes; if (remain > 0) stdout.push(chunk.subarray(0, remain)); outBytes += chunk.length; if (outBytes > LIMIT) { overflow = true; child.kill('SIGKILL'); } });
    child.stderr.on('data', chunk => { const remain = LIMIT - errBytes; if (remain > 0) stderr.push(chunk.subarray(0, remain)); errBytes += chunk.length; if (errBytes > LIMIT) { overflow = true; child.kill('SIGKILL'); } });
    child.stdin.on('error', () => {}); child.on('error', () => finish(127)); child.on('close', finish);
    child.stdin.end(stdin);
  });
}
async function main() {
  let length = 0; const chunks = [];
  for await (const chunk of process.stdin) { length += chunk.length; if (length > 256 * 1024) return result('runtimeError', '', '提交内容过大。'); chunks.push(chunk); }
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  if (!['javascript', 'python', 'cpp'].includes(payload.language) || typeof payload.source !== 'string' || payload.source.length > 40000 ||
    typeof payload.stdin !== 'string' || payload.stdin.length > 4000) return result('runtimeError', '', '无效代码提交。');
  const file = { javascript: 'answer.cjs', python: 'answer.py', cpp: 'answer.cpp' }[payload.language];
  await writeFile('/workspace/' + file, payload.source, { mode: 0o600 });
  if (payload.language === 'cpp') {
    const compile = await execute('/usr/bin/g++', ['-std=c++20', '-O0', '-pipe', '/workspace/answer.cpp', '-o', '/workspace/answer'], '', 5000);
    if (compile.timedOut) return result('timeout', compile.stdout, compile.stderr || '编译超时。');
    if (compile.overflow) return result('outputLimit', compile.stdout, compile.stderr);
    if (compile.code !== 0) return result('compileError', compile.stdout, compile.stderr, compile.code ?? undefined);
  }
  const binary = { javascript: '/usr/local/bin/node', python: '/usr/bin/python3', cpp: '/workspace/answer' }[payload.language];
  const args = { javascript: ['--max-old-space-size=96', '/workspace/answer.cjs'], python: ['-I', '-B', '/workspace/answer.py'], cpp: [] }[payload.language];
  const run = await execute(binary, args, payload.stdin, 2000);
  if (run.timedOut) return result('timeout', run.stdout, run.stderr || '运行超时。');
  if (run.overflow) return result('outputLimit', run.stdout, run.stderr);
  return result(run.code === 0 ? 'completed' : 'runtimeError', run.stdout, run.stderr, run.code ?? undefined);
}
try { process.stdout.write(JSON.stringify(await main())); }
catch { process.stdout.write(JSON.stringify(result('runtimeError', '', '无法运行这段代码。'))); }
