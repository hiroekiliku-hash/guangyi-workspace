import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {DatabaseSync} from 'node:sqlite';import {Readable} from 'node:stream';import {randomUUID} from 'node:crypto';import vm from 'node:vm';
import {createCourseAPI,courseAuthoringGuide} from './courses.mjs';import {checkCPPBasicSource} from './CourseRunner/cpp-basic-policy.mjs';import {tokenizeCPP} from './cpp-highlight.mjs';import {gradeCPPProblem,cppSubmission} from './cpp-exam.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('./Fixtures/course-cpp-exam.json',import.meta.url)));
function harness(runCode=async()=>({status:'unavailable',stdout:'',stderr:'',durationMs:0})){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY);INSERT INTO users VALUES(1);INSERT INTO users VALUES(2)');class APIError extends Error{constructor(status,code){super(code);this.status=status;}}
 let actor=1,owner=1,authorized=true;const handle=createCourseAPI({db,userFor:()=>{if(!authorized)throw new APIError(401,'UNAUTHORIZED');return actor;},workspaceAccess:()=>({ownerID:owner}),sameWebOrigin(){},respond:(r,status,body)=>Object.assign(r,{status,body}),APIError,origin:'https://example.invalid',rateLimit(){},peer:()=> 'test',runCode});
 return{db,setOwner:x=>owner=x,revoke:()=>authorized=false,async req(method,path,body,headers={}){const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{method,url:path,headers:{'content-type':'application/json','idempotency-key':randomUUID(),...headers}});const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.bytes=bytes;}};try{const found=await handle(req,res,path.split('?')[0]);if(!found)res.status=404;return res;}catch(e){if(e instanceof APIError)return{status:e.status,error:e.message};throw e;}}};
}
test('C++ exam publishes public projections, hides tests and updates atomically with CAS/idempotency',async()=>{
 const h=harness(),doc=fixture(),id=doc.course.id,lesson=doc.course.lessons[0],key=randomUUID();try{
  const created=await h.req('POST','/api/native/v1/courses',doc,{'idempotency-key':key});assert.equal(created.status,201);assert.equal((await h.req('POST','/api/native/v1/courses',doc,{'idempotency-key':key})).body.data.replayed,true);
  const read=await h.req('GET','/api/native/v1/courses/'+id);assert.equal(read.status,200);for(const block of read.body.data.course.lessons[0].blocks){assert.equal(block.acceptedAnswers,undefined);assert.equal(block.execution.expectedOutput,undefined);assert.equal(block.input.kind,'code');}
  assert.equal(h.db.prepare('SELECT count(*) n FROM course_cpp_problems').get().n,3);
  const player=await h.req('GET',`/api/native/v1/courses/${id}/player?lessonID=${lesson.id}`);const html=JSON.parse(player.bytes).data.html;assert.match(html,/cpp-editor/);assert.doesNotMatch(html,/"expectedOutput"/);assert.ok(!html.includes('"1\\n3\\n6"'));assert.doesNotThrow(()=>new vm.Script(/<script>([\s\S]*)<\/script>/.exec(html)[1]));
  assert.equal((await h.req('POST','/api/native/v1/courses',read.body.data.course,{'if-match':'"1"'})).status,409,'ordinary update cannot silently remove private grading');
  const updated=structuredClone(doc);updated.course.title='Updated';assert.equal((await h.req('POST','/api/native/v1/courses',updated,{'if-match':'"99"'})).status,409);assert.equal((await h.req('POST','/api/native/v1/courses',updated,{'if-match':'"1"'})).status,200);assert.equal(h.db.prepare('SELECT min(revision) r FROM course_cpp_problems').get().r,2);
  h.setOwner(2);assert.equal((await h.req('GET','/api/native/v1/courses/'+id)).status,404);
 }finally{h.db.close();}
});
test('server grades full suites and only returns aggregate counts, never hidden streams',async()=>{
 const doc=fixture();doc.problems[2].grading.tests=[{stdin:'87654321 0\n',expectedOutput:'PRIVATE_EXPECTED_ABC'}];let captured;const h=harness(async p=>{captured=p;return{status:'completed',stdout:'',stderr:'',durationMs:1,cases:[{status:'completed',stdout:'PRIVATE_EXPECTED_ABC',stderr:'PRIVATE_STDERR'}]};});
 try{assert.equal((await h.req('POST','/api/native/v1/courses',doc)).status,201);const block=doc.course.lessons[0].blocks[2],path='/api/native/v1/courses/'+doc.course.id+'/run';
 const req={courseRevision:1,lessonID:doc.course.lessons[0].id,blockID:block.id,text:'#include <iostream>\nint main(){std::cout<<1;}'};const response=await h.req('POST',path,req);assert.equal(response.status,200);assert.equal(response.body.data.passed,true);assert.match(response.body.data.stdout,/1 \/ 1/);assert.ok(!JSON.stringify(response.body).includes('PRIVATE_'));assert.ok(!JSON.stringify(response.body).includes('87654321'));assert.deepEqual(captured.tests,['87654321 0\n']);assert.ok(!JSON.stringify(captured).includes('PRIVATE_EXPECTED'));
 assert.equal((await h.req('POST',path,{...req,debug:true})).status,422);const page=await h.req('GET',`/api/native/v1/courses/${doc.course.id}/player?lessonID=${doc.course.lessons[0].id}`);assert.ok(!Buffer.from(page.bytes).toString().includes('PRIVATE_EXPECTED'));assert.ok(!Buffer.from(page.bytes).toString().includes('87654321'));
 }finally{h.db.close();}
});
test('understanding compares outputs; fill binds only named blanks; failure diagnostics do not expose tests',async()=>{
 const doc=fixture(),base=doc.problems[0];let called=false;const run=async()=>{called=true;return{status:'completed',stdout:'',stderr:'',durationMs:0};};
 assert.equal((await gradeCPPProblem(base,'1\n3\n6',run)).passed,true);assert.equal(called,false);assert.equal((await gradeCPPProblem(base,'1\n3\n5',run)).passed,false);
 const fill=doc.problems[1];assert.match(cppSubmission(fill,JSON.stringify({condition:'i <= n',update:'sum += i'})),/i <= n/);assert.throws(()=>cppSubmission(fill,'{}'));assert.throws(()=>cppSubmission(fill,'{"condition":"x","update":"y","extra":"z"}'));
 assert.match((await gradeCPPProblem(doc.problems[2],'int main(){',async()=>({status:'compileError',stdout:'',stderr:'answer.cpp:1: error: expected }',durationMs:2}))).stderr,/expected/);
 const fail=await gradeCPPProblem(doc.problems[2],'int main(){}',async()=>({status:'timeout',stdout:'HIDDEN',stderr:'SECRET_INPUT',durationMs:2}));assert.equal(fail.status,'timeout');assert.doesNotMatch(JSON.stringify(fail),/HIDDEN|SECRET/);
});
test('basic C++ profile rejects non-basic headers, preprocessor evasions and debug/system features',()=>{
 for(const source of ['#include <iostream>\nint main(){}','#include /* comment */ <vector>\nint main(){}','int n=1\'000;\n#include <cmath>\nint main(){}','// #include <fstream>\nint main(){const char* x="/* #include <fstream>";}','const char* s=R"xx(\n#include <fstream>\n)xx";\nint main(){}'])assert.equal(checkCPPBasicSource(source),null,source);
 for(const source of ['#include <fstream>\nint main(){}','#include <bits/stdc++.h>\nint main(){}','#include "/etc/passwd"\nint main(){}','#define H <fstream>\n#include H\nint main(){}','%:include <fstream>\nint main(){}','#pragma GCC optimize("O3")\nint main(){}','int n=1\'000;\n#include <fstream>\nint main(){}','int main(){system("ls");}'])assert.ok(checkCPPBasicSource(source),source);
});
test('serialized C++ tokenizer preserves strings, raw literals, comments, numbers and hostile text without HTML',()=>{
 const tokenize=vm.runInNewContext('('+tokenizeCPP.toString()+')');const samples=['#include <iostream>\nint main(){std::cout<<"中文😀";}','/* if while */ int n=0xFF;','R"xx(\n int /*x*/ )xx"','char c=\'\\\'\'; // abc','</script><img src=x onerror=x>','int n=1\'000; double x=1.2e-3;','/* unfinished','"unfinished','R"tag(unfinished'];
 for(const s of samples){const t=tokenize(s);assert.equal(t.map(t=>t.text).join(''),s);assert.ok(t.every(x=>['plain','string','comment','number','keyword','preprocessor'].includes(x.kind)));}
 assert.throws(()=>tokenize('x'.repeat(20001)));assert.throws(()=>tokenize(null));assert.equal(tokenize('"if for"')[0].kind,'string');
});
test('cpp exam config is strict and browser import does not expose or create credentials',async()=>{
 const h=harness();try{for(const change of [d=>d.problems[0].debug=true,d=>d.problems[1].template+='{{unknown}}',d=>d.problems[2].grading.tests=[],d=>d.problems[0].kind='unknown']){const d=fixture();change(d);assert.equal((await h.req('POST','/api/native/v1/courses',d)).status,422);}
 const schema=await h.req('GET','/api/integrations/v1/courses/cpp-schema');assert.equal(schema.status,200);assert.equal(schema.body.title,'WORKSHOP-CPP-EXAM/1');
 const page=await h.req('GET','/course-cpp-import');assert.equal(page.status,200);assert.match(page.headers['Content-Security-Policy'],/connect-src 'self'/);assert.equal(page.headers['Cache-Control'],'no-store');assert.doesNotMatch(Buffer.from(page.bytes).toString(),/localStorage|console\.log/);assert.equal((await h.req('GET','/course-cpp-import?token=secret')).status,422);assert.equal(h.db.prepare('SELECT count(*) n FROM course_tokens').get().n,0);
 assert.match(courseAuthoringGuide('https://example.invalid/api/integrations/v1/courses'),/WORKSHOP-CPP-EXAM\/1/);
 }finally{h.db.close();}
});
