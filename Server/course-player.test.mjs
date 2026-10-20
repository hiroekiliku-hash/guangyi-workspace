import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { renderCoursePlayer, rendererVersion } from './course-player.mjs';
import { createCourseAPI, courseManualPrompt, coursePrompt } from './courses.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('./Fixtures/course-rich.json', import.meta.url)));

test('player packages one lesson, static offline shell, safely serialized source and executable runtime', () => {
  const course=fixture();course.title='</script><script>globalThis.pwned=true</script>';course.lessons[0].blocks[0].text=course.title;
  course.lessons.push({id:randomUUID(),title:'Other private lesson',blocks:[]});
  const value=renderCoursePlayer(course,course.lessons[0].id.toUpperCase(),2);
  assert.equal(value.protocol,'WORKSHOP-PLAYER/1');assert.equal(value.rendererVersion,rendererVersion);assert.equal(value.courseRevision,2);
  assert.ok(!value.html.includes('Other private lesson'));assert.ok(!value.html.includes('</script><script>globalThis.pwned'));
  assert.match(value.html,/connect-src 'none'/);assert.match(value.html,/frame.setAttribute\('sandbox', 'allow-scripts'\)/);assert.ok(!value.html.includes('allow-same-origin'));
  assert.match(value.html,/window.WorkshopPlayer=/);assert.match(value.html,/message.requestID===pending.id/);
  const script=/<script>([\s\S]*)<\/script>/.exec(value.html)[1];assert.doesNotThrow(()=>new vm.Script(script));
  assert.throws(()=>renderCoursePlayer(course,randomUUID(),1),/COURSE_LESSON_NOT_FOUND/);
});

function harness(){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);INSERT INTO users VALUES(2)');
  class APIError extends Error{constructor(status,code){super(code);this.status=status;this.code=code;}}
  let owner=1,authorized=true;
  const handle=createCourseAPI({db,userFor:()=>{if(!authorized)throw new APIError(401,'UNAUTHORIZED');return 1;},workspaceAccess:()=>({ownerID:owner}),sameWebOrigin:()=>{},respond:(r,status,body)=>Object.assign(r,{status,body}),APIError,origin:'https://example.invalid',rateLimit:()=>{},peer:()=> 'test'});
  return{db,setOwner:value=>owner=value,setAuthorized:value=>authorized=value,async request(method,path,body,headers={}){const q=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);q.method=method;q.url=path;q.headers={'content-type':'application/json','idempotency-key':randomUUID(),...headers};const r={writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.bytes=bytes;}};try{await handle(q,r,path.split('?')[0]);return r;}catch(e){if(e instanceof APIError)return {status:e.status,error:e.code};throw e;}}};
}
test('authenticated player route enforces workspace, lesson/query boundaries and gzip negotiation',async()=>{
  const h=harness(),course=fixture(),lessonID=course.lessons[0].id;
  try{
    assert.equal((await h.request('POST','/api/native/v1/courses',course)).status,201);
    const path=`/api/native/v1/courses/${course.id}/player?lessonID=${lessonID}`;
    const response=await h.request('GET',path,undefined,{'accept-encoding':'gzip, deflate'});
    assert.equal(response.status,200);assert.equal(response.headers['Content-Encoding'],'gzip');assert.equal(response.headers['Cache-Control'],'private, no-store');
    const payload=JSON.parse(gunzipSync(response.bytes));assert.equal(payload.data.lessonID,lessonID);assert.ok(response.bytes.length<Buffer.byteLength(payload.data.html)/2);
    const plain=await h.request('GET',path,undefined,{'accept-encoding':'gzip;q=0'});assert.equal(plain.headers['Content-Encoding'],undefined);assert.equal(JSON.parse(plain.bytes).data.rendererVersion,rendererVersion);
    assert.equal((await h.request('GET',path+'&lessonID='+lessonID)).status,422);
    assert.equal((await h.request('GET',path+'&evil=1')).status,422);
    assert.equal((await h.request('GET',path.replace(lessonID,randomUUID()))).status,404);
    assert.equal((await h.request('GET',path.split('?')[0])).status,422);
    h.setOwner(2);assert.equal((await h.request('GET',path)).status,404);
    h.setOwner(1);h.setAuthorized(false);assert.equal((await h.request('GET',path)).status,401);
  }finally{h.db.close();}
});
test('both AI prompts preserve structured authoring and explain server renderer boundary',()=>{
  for(const prompt of [courseManualPrompt(),coursePrompt('https://example.invalid/courses')]){
    assert.match(prompt,/WORKSHOP-PLAYER\/1/);assert.match(prompt,/不能上传整个可信页面/);assert.match(prompt,/持久化的答案必须使用 question/);
  }
});
test('public demo player accepts only deployment catalog courses and exact query',async()=>{
  const h=harness();h.setAuthorized(false);
  try{
    const entry=JSON.parse(readFileSync(new URL('./AppContent/demo-course.json',import.meta.url)));
    const path=`/api/native/v1/course-player/demo?courseID=${entry.payload.id}&lessonID=${entry.payload.lessons[0].id}`;
    const response=await h.request('GET',path,undefined,{'accept-encoding':'gzip'});
    assert.equal(response.status,200);const value=JSON.parse(gunzipSync(response.bytes)).data;assert.equal(value.courseRevision,entry.version);assert.equal(value.courseID,entry.payload.id);
    assert.equal((await h.request('GET',path+'&ownerID=1')).status,422);
    assert.equal((await h.request('GET',path.replace(entry.payload.id,randomUUID()))).status,404);
    assert.equal((await h.request('GET',path.replace(entry.payload.lessons[0].id,randomUUID()))).status,404);
  }finally{h.db.close();}
});
