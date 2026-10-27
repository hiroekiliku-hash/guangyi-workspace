// Runs only inside the disposable container; no account data or credentials enter it.
import { checkCPPBasicSource } from './cpp-basic-policy.mjs';
import { writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LIMIT = 16 * 1024, start = performance.now();
const result = (status, stdout = '', stderr = '', exitCode) => ({ status, stdout, stderr,
  durationMs: Math.round(performance.now() - start), ...(exitCode === undefined ? {} : { exitCode }) });
export function decodeCourseOutput(chunks, limit = LIMIT) {
  // Streaming decode retains an incomplete trailing sequence instead of adding
  // U+FFFD when the byte limit splits a valid UTF-8 scalar. Invalid source bytes
  // may still become U+FFFD; bound their expanded representation a second time.
  const value = new TextDecoder('utf-8').decode(Buffer.concat(chunks).subarray(0, limit), { stream: true });
  if (Buffer.byteLength(value) <= limit) return value;
  return new TextDecoder('utf-8').decode(Buffer.from(value).subarray(0, limit), { stream: true });
}
export function killCourseProcessGroup(child, killProcess = process.kill) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 1) return false;
  try { killProcess(-child.pid, 'SIGKILL'); return true; }
  catch { return false; } // A process group may already have exited.
}
export function executeCourseProcess(binary, args, stdin, timeout, { spawnProcess = spawn, killProcess = process.kill, schedule = setTimeout, cancel = clearTimeout } = {}) {
  return new Promise(resolve => {
    let settled = false, child, timer, timedOut = false, overflow = false;
    let outBytes = 0, errBytes = 0; const stdout = [], stderr = [];
    const finish = code => {
      if (settled) return; settled = true; if (timer !== undefined) cancel(timer);
      resolve({ code, timedOut, overflow, stdout: decodeCourseOutput(stdout), stderr: decodeCourseOutput(stderr) });
    };
    const terminate = () => {
      // Each invocation owns a separate POSIX process group. Killing only the
      // original PID misses forked children after their parent exits, leaving
      // inherited stdout/stderr open and defeating the execution deadline.
      killCourseProcessGroup(child, killProcess);
      child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy();
      child?.unref?.();
    };
    const failStart = () => {
      if (settled) return;
      if (errBytes === 0) stderr.push(Buffer.from('无法启动语言运行环境。'));
      terminate(); finish(127);
    };
    try {
      child = spawnProcess(binary, args, { shell: false, detached: true, cwd: '/workspace', stdio: ['pipe', 'pipe', 'pipe'] });
      const capture = (chunks, errorStream) => chunk => {
        if (settled) return;
        const bytes = errorStream ? errBytes : outBytes, remain = LIMIT - bytes;
        if (remain > 0) chunks.push(chunk.subarray(0, remain));
        if (errorStream) errBytes += chunk.length; else outBytes += chunk.length;
        if (bytes + chunk.length > LIMIT) { overflow = true; terminate(); finish(null); }
      };
      child.stdout.on('data', capture(stdout, false)); child.stderr.on('data', capture(stderr, true));
      child.stdin.on('error', () => {}); child.stdout.on('error', () => {}); child.stderr.on('error', () => {});
      child.on('error', failStart); child.on('close', finish);
      timer = schedule(() => { if (!settled) { timedOut = true; terminate(); finish(null); } }, timeout);
      child.stdin.end(stdin);
    } catch { failStart(); }
  });
}
async function main() {
  let length = 0; const chunks = [];
  for await (const chunk of process.stdin) { length += chunk.length; if (length > 256 * 1024) return result('runtimeError', '', '提交内容过大。'); chunks.push(chunk); }
  const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  if (!['javascript', 'python', 'cpp'].includes(payload.language) || typeof payload.source !== 'string' || payload.source.length > 40000 ||
    typeof payload.stdin !== 'string' || payload.stdin.length > 4000) return result('runtimeError', '', '无效代码提交。');
  const batch=payload.tests!==undefined;
  if((payload.profile!==undefined&&(payload.profile!=='cpp-exam-basic'||payload.language!=='cpp'))||(batch&&(payload.language!=='cpp'||payload.profile!=='cpp-exam-basic'||!Array.isArray(payload.tests)||payload.tests.length<1||payload.tests.length>8||payload.tests.some(t=>typeof t!=='string'||t.length>4000||t.includes('\0')))))return result('runtimeError','','无效测试请求。');
  if(payload.profile==='cpp-exam-basic'){const error=checkCPPBasicSource(payload.source);if(error)return result('compileError','',error);}
  const file = { javascript: 'answer.cjs', python: 'answer.py', cpp: 'answer.cpp' }[payload.language];
  await writeFile('/workspace/' + file, payload.source, { mode: 0o600 });
  if (payload.language === 'cpp') {
    const compile = await executeCourseProcess('/usr/bin/g++', [payload.profile==='cpp-exam-basic'?'-std=c++17':'-std=c++20', '-O0', '-pipe', ...(payload.profile==='cpp-exam-basic'?['-pedantic-errors']:[]), '/workspace/answer.cpp', '-o', '/workspace/answer'], '', 5000);
    if (compile.timedOut) return result('timeout', compile.stdout, compile.stderr || '编译超时。');
    if (compile.overflow) return result('outputLimit', compile.stdout, compile.stderr);
    if (compile.code !== 0) return result('compileError', compile.stdout, compile.stderr, compile.code ?? undefined);
  }
  const binary = { javascript: '/usr/local/bin/node', python: '/usr/bin/python3', cpp: '/workspace/answer' }[payload.language];
  const args = { javascript: ['--max-old-space-size=96', '/workspace/answer.cjs'], python: ['-I', '-B', '/workspace/answer.py'], cpp: [] }[payload.language];
  if(batch){
    const cases=[], started=performance.now();
    for(const input of payload.tests){
      const budget=Math.min(1500,4500-(performance.now()-started));
      if(budget<=0)return result('timeout','','测试集运行超时。');
      const run=await executeCourseProcess(binary,args,input,budget);
      if(run.timedOut)return result('timeout','','测试集运行超时。');
      if(run.overflow)return result('outputLimit','','输出超过限制。');
      // Never expose runtime stderr produced under hidden input. Expected answers
      // are never transmitted to this container, only bounded input strings.
      cases.push({status:run.code===0?'completed':'runtimeError',stdout:run.stdout,stderr:'',durationMs:0});
      if(cases.reduce((n,c)=>n+Buffer.byteLength(c.stdout),0)>64*1024)return result('outputLimit','','测试集输出超过限制。');
    }
    return {...result('completed'),cases};
  }
  const run = await executeCourseProcess(binary, args, payload.stdin, 2000);
  if (run.timedOut) return result('timeout', run.stdout, run.stderr || '运行超时。');
  if (run.overflow) return result('outputLimit', run.stdout, run.stderr);
  return result(run.code === 0 ? 'completed' : 'runtimeError', run.stdout, run.stderr, run.code ?? undefined);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(JSON.stringify(await main())); }
  catch { process.stdout.write(JSON.stringify(result('runtimeError', '', '无法运行这段代码。'))); }
}
