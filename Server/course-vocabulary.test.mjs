import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { createCourseAPI, courseAuthoringGuide, courseManualPrompt } from './courses.mjs';
import { renderCoursePlayer } from './course-player.mjs';
const sample = () => JSON.parse(readFileSync(new URL('./Fixtures/course-vocabulary.json', import.meta.url)));
function api() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY); INSERT INTO users VALUES(1)');
  class APIError extends Error { constructor(status, code) { super(code); this.status = status; } }
  const handler = createCourseAPI({db, userFor:()=>1, workspaceAccess:()=>({ownerID:1}), sameWebOrigin(){}, respond:(r,status,body)=>Object.assign(r,{status,body}), APIError, origin:'https://example.invalid', rateLimit(){}, peer:()=> 'test'});
  return {db, async request(method,path,body) {
    const req=Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
    Object.assign(req,{method,url:path,headers:{'content-type':'application/json','idempotency-key':randomUUID()}});
    const response={};
    try { await handler(req,response,path); return response; }
    catch(error) { if(error instanceof APIError)return {status:error.status,error:error.message}; throw error; }
  }};
}
test('vocabulary document uploads using unchanged native contract and persists real answers', async()=>{
  const h=api(), course=sample(),lesson=course.lessons[0];
  try {
    assert.equal((await h.request('POST','/api/native/v1/courses',course)).status,201);
    const invalid=structuredClone(course);invalid.id=randomUUID();invalid.lessons[0].blocks[0].presentation.kind='vocabulary';
    assert.equal((await h.request('POST','/api/native/v1/courses',invalid)).status,422,'no new native enum required');
    const result=await h.request('GET',`/api/native/v1/courses/${course.id}`);
    assert.equal(result.status,200);
    const progressPath=`/api/native/v1/courses/${course.id}/progress`;
    const answer={mutationID:randomUUID(),courseRevision:1,lessonID:lesson.id,blockID:lesson.blocks[2].id,selectedOptionIDs:[],text:'retrieve'};
    assert.equal((await h.request('POST',progressPath,answer)).status,200);
    const progress=await h.request('GET',progressPath);
    assert.equal(progress.body.data.answers[0].text,'retrieve');
    assert.equal((await h.request('POST',progressPath,{...answer,mutationID:randomUUID(),blockID:lesson.blocks[0].id})).status,422,'flipping a card cannot manufacture an answer');

    const demo=JSON.parse(readFileSync(new URL('./AppContent/demo-course.json',import.meta.url)));
    assert.deepEqual(demo.payload.lessons.at(-1),lesson);
    assert.equal((await h.request('POST','/api/native/v1/courses',demo.payload)).status,201,'updated demo still passes strict validation');
  } finally {h.db.close();}
});
test('both authoring guides describe vocabulary protocol and honest progress boundaries',()=>{
  for(const mode of ['manual','automatic']){
    const guide=courseAuthoringGuide('https://example.invalid/api/integrations/v1/courses',mode);
    for(const text of ['【词汇学习课程】','flashcards','acceptedAnswers','造句','间隔复习记录','原生继续'])assert.ok(guide.includes(text),text);
  }
  assert.ok(courseManualPrompt().length<800,'copy prompt stays short');
});

// Exercise trusted HTML as the native shell does: messages in, observable DOM and bridge out.
function mount(course=sample()) {
  const messages=[]; let time=1000;
  class Element {
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.style={};this.attributes={};this.classList={toggle(){}};}
    append(...values){this.children.push(...values);}
    replaceChildren(...values){this.children=values;}
    setAttribute(key,value){this.attributes[key]=value;}
    getAttribute(key){return this.attributes[key];}
    querySelector(){return null;}
    remove(){}
  }
  const app=new Element('main');
  const document={body:new Element('body'),getElementById:()=>app,createElement:t=>new Element(t),createTextNode:text=>({textContent:text}),addEventListener(){}};
  const window={innerWidth:400,innerHeight:800,webkit:{messageHandlers:{workshopPlayer:{postMessage:m=>messages.push(m)}}},addEventListener(){},scrollTo(){}};
  const context=vm.createContext({window,document,Element,performance:{now:()=>time+=200},requestAnimationFrame(){},structuredClone,setTimeout,clearTimeout});
  vm.runInContext(/<script>([\s\S]*)<\/script>/.exec(renderCoursePlayer(course,course.lessons[0].id,1).html)[1],context);
  const receive=m=>window.WorkshopPlayer.receive(m);
  const elements=()=>{const all=[];const visit=e=>{all.push(e);(e.children??[]).forEach(visit);};visit(app);return all;};
  return {messages,receive,init:()=>receive({type:'init',theme:'dark',progress:{answers:[]}}),next:()=>receive({type:'next'}),previous:()=>receive({type:'previous'}),state:()=>messages.filter(m=>m.type==='state').at(-1),elements,text:()=>elements().map(e=>e.textContent??'').join('\n')};
}
test('native next reveals then moves a single card, previous and revisits preserve position',()=>{
  const h=mount();h.next();assert.equal(h.state(),undefined,'waits for init');h.init();
  assert.match(h.text(),/adapt/);assert.doesNotMatch(h.text(),/天气变化时/);assert.equal(h.state().canPrevious,false);
  h.next();assert.match(h.text(),/天气变化时/);assert.match(h.text(),/adapt/);assert.equal(h.state().index,0);assert.equal(h.state().canPrevious,true);
  h.previous();assert.doesNotMatch(h.text(),/天气变化时/);assert.equal(h.state().canPrevious,false);
  h.next();h.next();assert.match(h.text(),/consistent/);assert.doesNotMatch(h.text(),/持续的小步/);
  h.previous();assert.match(h.text(),/天气变化时/,'previous card returns revealed');
  h.next();h.next();h.next();assert.match(h.text(),/retrieve/);assert.doesNotMatch(h.text(),/看答案前/);
  h.next();assert.match(h.text(),/看答案前/);h.next();assert.equal(h.state().index,1,'last revealed card advances block');
  h.previous();assert.match(h.text(),/看答案前/,'returning retains last revealed card');
  assert.equal(h.elements().filter(e=>e.tagName==='BUTTON').length,1,'only one card, no duplicate navigation buttons');
  assert.equal(h.messages.filter(m=>m.type==='submit'||m.type==='complete').length,0,'flipping never persists fake mastery');
});
test('tapping reveals once; ordinary and hostile flashcard strings stay text',()=>{
  const course=sample();course.lessons[0].blocks[0].presentation.cards=[{front:'<img src=x onerror=alert(1)>',back:'</script><script>globalThis.pwned=true</script>'}];
  const h=mount(course);h.init();
  const card=()=>h.elements().find(e=>e.tagName==='BUTTON');
  card().onclick({});assert.match(h.text(),/globalThis.pwned/);assert.equal(h.state().index,0);
  card().onclick({});assert.match(h.text(),/globalThis.pwned/,'tap does not unexpectedly hide answer');
  assert.equal(h.elements().filter(e=>['IMG','SCRIPT'].includes(e.tagName)).length,0);
  h.next();assert.equal(h.state().index,1,'single card terminates after reveal');
});
test('vocabulary question uses native next for submission and prevents double submits',()=>{
  const course=sample();course.lessons[0].blocks=[course.lessons[0].blocks[2]];
  const h=mount(course);h.init();const input=h.elements().find(e=>e.oninput);input.value='  Retrieve  ';input.oninput();
  h.next();const submit=h.messages.findLast(m=>m.type==='submit');assert.ok(submit);h.next();assert.equal(h.messages.filter(m=>m.type==='submit').length,1);
  h.receive({type:'saved',requestID:submit.requestID,ok:true});assert.match(h.text(),/回答正确/,'text spelling follows documented case/whitespace normalization');
  h.next();assert.ok(h.messages.find(m=>m.type==='complete'));
});
