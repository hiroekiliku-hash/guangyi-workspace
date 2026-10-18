import http from 'node:http';

export const courseExecutionLanguages = Object.freeze(['javascript', 'python', 'cpp']);
export const courseExecutionStatuses = Object.freeze(['completed', 'timeout', 'compileError', 'runtimeError', 'unavailable', 'outputLimit']);
export const courseExecutionOutputBytes = 16 * 1024;
export const unavailableCourseExecution = () => ({ status: 'unavailable', stdout: '', stderr: '代码运行服务暂未启用，请稍后重试。', durationMs: 0 });

// This module is safe to include in the API bundle: it never starts an interpreter,
// compiler, shell or container. Only the separately installed runner can do that.
export function createCourseExecutionClient({ socketPath, timeoutMs = 15000 } = {}) {
  return payload => {
    if (typeof socketPath !== 'string' || !socketPath.startsWith('/') || socketPath.includes('\0')) return Promise.resolve(unavailableCourseExecution());
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      const body = Buffer.from(JSON.stringify(payload));
      const request = http.request({ socketPath, method: 'POST', path: '/run', headers: { 'Content-Type': 'application/json', 'Content-Length': body.length } }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 256 * 1024) { response.destroy(); request.destroy(); finish(unavailableCourseExecution()); }
          else chunks.push(chunk);
        });
        response.on('error', () => finish(unavailableCourseExecution()));
        response.on('end', () => {
          let value;
          try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(unavailableCourseExecution()); }
          if (response.statusCode !== 200 || !value || !courseExecutionStatuses.includes(value.status) ||
            typeof value.stdout !== 'string' || typeof value.stderr !== 'string' ||
            Buffer.byteLength(value.stdout) > courseExecutionOutputBytes || Buffer.byteLength(value.stderr) > courseExecutionOutputBytes ||
            !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > 60000 ||
            (value.exitCode !== undefined && (!Number.isSafeInteger(value.exitCode) || Math.abs(value.exitCode) > 255))) return finish(unavailableCourseExecution());
          // No runner-supplied grade or extra field reaches the client.
          finish({ status: value.status, stdout: value.stdout, stderr: value.stderr, durationMs: value.durationMs,
            ...(value.exitCode === undefined ? {} : { exitCode: value.exitCode }) });
        });
      });
      const timeout = setTimeout(() => { request.destroy(); finish(unavailableCourseExecution()); }, timeoutMs);
      timeout.unref?.();
      request.on('close', () => clearTimeout(timeout));
      request.on('error', () => finish(unavailableCourseExecution()));
      request.end(body);
    });
  };
}
