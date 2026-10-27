import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { renderCoursePlayer, rendererVersion } from './course-player.mjs';
import { createCourseAPI, courseAuthoringGuide } from './courses.mjs';
const fixture = () => JSON.parse(readFileSync(new URL('./Fixtures/course-rich.json', import.meta.url)));

test('player packages one lesson, static offline shell, safely serialized source and executable runtime', () => {
  const course=fixture();course.title='</script><script>globalThis.pwned=true</script>';course.lessons[0].blocks[0].text=course.title;
  course.lessons.push({id:randomUUID(),title:'Other private lesson',blocks:[]});
  const value=renderCoursePlayer(course,course.lessons[0].id.toUpperCase(),2);
  assert.equal((value.html.match(/<\/script\s*>/gi) ?? []).length,1,'only the trusted outer script closes in raw HTML');
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
test('both public AI guides preserve structured authoring and explain server renderer boundary',()=>{
  for(const mode of ['manual','automatic']){
    const prompt=courseAuthoringGuide('https://example.invalid/api/integrations/v1/courses',mode);
    assert.match(prompt,/WORKSHOP-PLAYER\/1/);assert.match(prompt,/不能上传整个可信页面/);assert.match(prompt,/持久化的答案必须使用 question/);assert.match(prompt,/setPrimaryAction/);assert.match(prompt,/最后一帧后才翻页/);
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
test('native-feel renderer keeps full-width content and preference-driven controls and haptics',()=>{
  const course=fixture(),html=renderCoursePlayer(course,course.lessons[0].id,1).html;
  assert.equal(rendererVersion,'2026.10.27.1');
  assert.match(html,/font:17px\/1\.53 -apple-system/);
  assert.match(html,/--bottom-space:16px/);
  assert.match(html,/needs-control-space/);
  assert.match(html,/function fitControls/);
  assert.match(html,/env\(safe-area-inset-bottom,0px\)/);
  assert.match(html,/article\.card\{background:transparent;padding:0/);
  assert.match(html,/resize:none/);
  assert.match(html,/controlSide==='left'/);
  assert.match(html,/hapticsEnabled = message.hapticsEnabled !== false/);
  assert.match(html,/post\(\{type:'haptic',style\}\)/);
  assert.match(html,/haptic\('success',true\)/);
  assert.match(html,/haptic\('error',true\)/);
  assert.ok(!html.includes('`${lesson.title} · ${index+1}'));
});
test('ready/init renders once and iframe proxy rejects forged sources, tokens, capabilities and stale pages',()=>{
  const messages=[],listeners=new Map(),created=[],commands=[];
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes={};this.isConnected=true;this.contentWindow={postMessage:message=>commands.push(message)};this.classList={toggle(){}};created.push(this);}
    append(...values){this.children.push(...values);}
    replaceChildren(...values){this.children=values;}
    setAttribute(key,value){this.attributes[key]=value;}
    getBoundingClientRect(){return {top:20,left:20,right:320,bottom:220,width:300,height:200};}
    querySelector(){return null;}
  }
  const app=new Element('main'),body=new Element('body');
  const document={visibilityState:'visible',body,getElementById:()=>app,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),addEventListener(){}};
  const window={innerWidth:400,innerHeight:800,webkit:{messageHandlers:{workshopPlayer:{postMessage:message=>messages.push(message)}}},addEventListener:(name,handler)=>listeners.set(name,handler),scrollTo(){}};
  let time=0;
  const context=vm.createContext({window,document,Element,performance:{now:()=>time+=100},getComputedStyle:()=>({visibility:'visible',display:'block'}),requestAnimationFrame(){},structuredClone,setTimeout,clearTimeout});
  const course={id:randomUUID(),lessons:[{id:randomUUID(),title:'Sandbox',blocks:[{id:randomUUID(),type:'text',text:'Touch',presentation:{kind:'html',html:{source:'<button>Touch</button>'}}},{id:randomUUID(),type:'text',text:'Next page'}]}]};
  const html=renderCoursePlayer(course,course.lessons[0].id,1).html;
  vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(html)[1],context);
  assert.equal(messages.at(-1).type,'ready','existing native ready/init handshake stays intact');
  assert.equal(app.children.length,0,'course DOM is not constructed before saved progress arrives');
  assert.equal(created.filter(e=>e.tagName==='IFRAME').length,0,'pre-init does not start a throwaway sandbox');
  window.WorkshopPlayer.receive({type:'next'});
  assert.equal(app.children.length,0,'navigation cannot render before initialization');
  window.WorkshopPlayer.receive({type:'init',progress:{answers:[]},theme:'light'});
  assert.equal(created.filter(e=>e.tagName==='IFRAME').length,1,'first init builds the course sandbox once');
  const firstChildren=app.children;
  window.WorkshopPlayer.receive({type:'init',theme:'dark',controlSide:'left'});
  assert.equal(app.children,firstChildren,'environment refresh preserves the live course DOM');
  assert.equal(created.filter(e=>e.tagName==='IFRAME').length,1,'later init does not recreate the sandbox');
  const frame=created.filter(e=>e.tagName==='IFRAME').at(-1),token=/\)\("([0-9a-f-]+)"\);<\/script>/.exec(frame.srcdoc)[1];
  const send=(source,data)=>listeners.get('message')({source,data});
  const feedback=()=>messages.filter(m=>m.type==='haptic');
  send({}, {type:'workshop-feedback',token,style:'impact'});assert.equal(feedback().length,0);
  send(frame.contentWindow,{type:'workshop-feedback',token:'wrong',style:'impact'});assert.equal(feedback().length,0);
  send(frame.contentWindow,{type:'submit',token,style:'impact',blockID:course.lessons[0].blocks[0].id});assert.equal(feedback().length,0);
  send(frame.contentWindow,{type:'workshop-feedback',token,style:'success'});assert.equal(feedback().length,0);
  send(frame.contentWindow,{type:'workshop-feedback',token,style:'impact'});assert.equal(feedback().length,1);
  assert.deepEqual(Object.keys(feedback()[0]).sort(),['style','type']);
  send({}, {type:'workshop-primary',token,canNext:true,canPrevious:false});
  send(frame.contentWindow,{type:'workshop-primary',token:'wrong',canNext:true,canPrevious:false});
  send(frame.contentWindow,{type:'workshop-primary',token,canNext:'yes',canPrevious:false});
  assert.equal(commands.length,0);
  send(frame.contentWindow,{type:'workshop-primary',token,canNext:true,canPrevious:false});
  window.WorkshopPlayer.receive({type:'next'});
  assert.equal(commands.length,1);assert.equal(commands[0].direction,'next');
  assert.equal(messages.filter(m=>m.type==='state').at(-1).canNext,false);
  window.WorkshopPlayer.receive({type:'next'});assert.equal(commands.length,1,'pending local action cannot run twice');
  send(frame.contentWindow,{type:'workshop-primary-result',token,requestID:'wrong',ok:true});
  assert.equal(messages.filter(m=>m.type==='state').at(-1).canNext,false);
  send(frame.contentWindow,{type:'workshop-primary',token,canNext:false,canPrevious:true});
  send(frame.contentWindow,{type:'workshop-primary-result',token,requestID:commands[0].requestID,ok:true});
  assert.equal(messages.filter(m=>m.type==='state').at(-1).canPrevious,true);
  assert.equal(messages.filter(m=>m.type==='submit'||m.type==='run'||m.type==='complete').length,0);
  window.WorkshopPlayer.receive({type:'next'});
  assert.equal(messages.filter(m=>m.type==='state').at(-1).index,1,'finished local demo advances the block');
  send(frame.contentWindow,{type:'workshop-feedback',token,style:'selection'});assert.equal(feedback().length,1);
  send(frame.contentWindow,{type:'workshop-primary',token,canNext:true,canPrevious:true});
  assert.equal(messages.filter(m=>m.type==='state').at(-1).canPrevious,true);
  window.WorkshopPlayer.receive({type:'next'});assert.equal(commands.length,1,'stale iframe cannot capture later navigation');
});

test('course feedback distinguishes answer and execution outcomes without swallowing prompt results',()=>{
  function mount(block){
    const messages=[],created=[];let time=1000;
    class Element {
      constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes={};this.classList={toggle(){}};created.push(this);}
      append(...values){this.children.push(...values);}
      replaceChildren(...values){this.children=values;}
      setAttribute(key,value){this.attributes[key]=value;}
      querySelector(){return null;}
    }
    const app=new Element('main'),body=new Element('body');
    const document={visibilityState:'visible',body,getElementById:()=>app,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),addEventListener(){}};
    const window={innerWidth:400,innerHeight:800,webkit:{messageHandlers:{workshopPlayer:{postMessage:message=>messages.push(message)}}},addEventListener(){},scrollTo(){}};
    const context=vm.createContext({window,document,Element,performance:{now:()=>time},requestAnimationFrame(){},structuredClone,setTimeout,clearTimeout});
    const course={id:randomUUID(),lessons:[{id:randomUUID(),title:'Feedback',blocks:[block]}]};
    vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(renderCoursePlayer(course,course.lessons[0].id,1).html)[1],context);
    window.WorkshopPlayer.receive({type:'init',progress:{answers:[]},theme:'light'});
    return {messages,receive:message=>window.WorkshopPlayer.receive(message),at:value=>{time=value;},styles:()=>messages.filter(m=>m.type==='haptic').map(m=>m.style),input:()=>created.findLast(e=>typeof e.oninput==='function'),find:(tag,text)=>created.findLast(e=>e.tagName===tag.toUpperCase()&&(text===undefined||e.textContent===text))};
  }
  const choice=(graded=true)=>({id:randomUUID(),type:'question',questionType:'singleChoice',options:[{id:'right',text:'Right'},{id:'wrong',text:'Wrong'}],...(graded?{correctOptionIDs:['right']}:{})});
  const submit=(h)=>{h.receive({type:'next'});const message=h.messages.findLast(m=>m.type==='submit');assert.ok(message);return message;};
  for(const [selected,graded,expected] of [['Right',true,'success'],['Wrong',true,'warning'],['Right',false,'impact']]){
    const h=mount(choice(graded));h.find('button',selected).onclick({});assert.deepEqual(h.styles(),['selection']);
    h.at(1001);h.find('button',selected).onclick({});assert.deepEqual(h.styles(),['selection'],'same single-choice option has no second feedback');
    const message=submit(h);h.receive({type:'saved',requestID:message.requestID,ok:true});
    assert.deepEqual(h.styles(),['selection',expected],'ACK feedback reflects grading even immediately after a tap');
    h.receive({type:'saved',requestID:message.requestID,ok:true});assert.equal(h.styles().length,2,'duplicate ACK is ignored');
  }
  const rapid=mount(choice());rapid.find('button','Right').onclick({});rapid.at(1020);rapid.find('button','Wrong').onclick({});
  assert.deepEqual(rapid.styles(),['selection'],'ordinary rapid feedback is throttled');
  const rapidSubmit=submit(rapid);rapid.receive({type:'saved',requestID:rapidSubmit.requestID,ok:true});assert.deepEqual(rapid.styles(),['selection','warning'],'result feedback has an independent throttle');
  for(const [result,error,expected] of [
    [{status:'completed',passed:true},undefined,'success'],
    [{status:'completed',passed:false},undefined,'warning'],
    [{status:'completed'},undefined,'impact'],
    [{status:'runtimeError',passed:false},undefined,'error'],
    [{status:'timeout'},undefined,'error'],
    [{status:'cancelled'},undefined,undefined],
    [undefined,'Runner unavailable','error']
  ]){
    const h=mount({id:randomUUID(),type:'question',questionType:'shortAnswer',input:{kind:'code'},execution:{language:'python'}});
    const run=h.find('button','▶ 运行代码');run.onclick({});assert.deepEqual(h.styles(),[],'empty code cannot create feedback or run');
    const input=h.input();input.value='print(1)';input.oninput();run.onclick({});assert.deepEqual(h.styles(),['impact']);
    const request=h.messages.findLast(m=>m.type==='run');assert.ok(request);h.at(1001);h.receive({type:'runResult',requestID:request.requestID,result,error});
    assert.deepEqual(h.styles(),expected?['impact',expected]:['impact'],'execution completion is graded separately from running successfully');
  }
  const muted=mount(choice());muted.receive({type:'init',hapticsEnabled:false});muted.find('button','Wrong').onclick({});const request=submit(muted);muted.receive({type:'saved',requestID:request.requestID,ok:true});assert.deepEqual(muted.styles(),[],'preference disables interaction and result feedback together');
});
