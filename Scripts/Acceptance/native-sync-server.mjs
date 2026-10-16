import { createNativeServer } from '../../Server/server.mjs';

const password = process.env.GUANGYI_ACCEPTANCE_PASSWORD;
if (!password || password.length < 32) throw new Error('Missing isolated acceptance password');
const app = createNativeServer({ databasePath: ':memory:', adminEmail: 'native-acceptance@test.invalid', adminPassword: password });
await new Promise((resolve, reject) => {
  app.server.once('error', reject);
  app.server.listen(0, '127.0.0.1', resolve);
});
console.log(JSON.stringify({ origin: `http://127.0.0.1:${app.server.address().port}` }));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  app.close();
  process.stdin.pause();
}
process.stdin.once('data', stop);
process.stdin.once('end', stop);
process.stdin.resume();
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
