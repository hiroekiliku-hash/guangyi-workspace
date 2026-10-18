// Disposable memory database + shipping bundle + real private runner. No accounts,
// environment files or other configuration are loaded from the production API.
import { createNativeServer } from '../../Server/server.mjs';

const password = process.env.GUANGYI_ACCEPTANCE_PASSWORD;
const socketPath = process.env.RUNNER_SOCKET;
const port = Number(process.env.GUANGYI_ACCEPTANCE_PORT ?? 0);
if (!password || password.length < 32 || !socketPath?.startsWith('/') || socketPath.includes('\0') ||
    !Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('INVALID_DISPOSABLE_ACCEPTANCE_CONFIGURATION');
const app = createNativeServer({ databasePath: ':memory:', adminEmail: 'native-course-execution@test.invalid',
  adminPassword: password, displayName: 'Execution acceptance', courseRunnerSocket: socketPath });
app.server.prependListener('request', (_request, response) => {
  response.setHeader('X-Workshop-Acceptance-Isolated', 'memory-course-execution-v1');
});
await new Promise((resolve, reject) => {
  app.server.once('error', reject);
  app.server.listen(port, '127.0.0.1', resolve);
});
console.log(JSON.stringify({ origin: `http://127.0.0.1:${app.server.address().port}`, fixture: 'memory-course-execution-v1' }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  app.close();
  process.stdin.pause();
}
if (process.env.GUANGYI_ACCEPTANCE_KEEP_ALIVE !== '1') {
  process.stdin.once('data', stop);
  process.stdin.once('end', stop);
  process.stdin.resume();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
