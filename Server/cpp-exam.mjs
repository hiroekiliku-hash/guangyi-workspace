import { checkCPPBasicSource, cppBasicHeaders } from './CourseRunner/cpp-basic-policy.mjs';
export const cppExamProtocol='WORKSHOP-CPP-EXAM/1';
export const normalizeCPPOutput=(s,mode='exact')=>mode==='tokens'?JSON.stringify(s.trim().split(/\s+/u).filter(Boolean)):s.replace(/\r\n|\r/g,'\n').trimEnd();
export function validateCPPExam(value, validateCourse, fail) {
  const object=(v,keys)=>{if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!keys.includes(k)))fail('INVALID_CPP_EXAM');};
  const text=(s,max,empty=false)=>{if(typeof s!=='string'||s.length>max||(!empty&&!s.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))fail('INVALID_CPP_EXAM');};
  object(value,['protocol','course','problems']);if(value.protocol!==cppExamProtocol||!Array.isArray(value.problems)||value.problems.length<1||value.problems.length>80)fail('INVALID_CPP_EXAM');
  const course=validateCourse(structuredClone(value.course)),problems=[],ids=new Set();
  for(const input of value.problems){
    object(input,['lessonID','blockID','kind','grading','template','blanks','sampleInput']);
    if(typeof input.lessonID!=='string'||typeof input.blockID!=='string'||!['understanding','fill','program'].includes(input.kind))fail('INVALID_CPP_EXAM');
    const lesson=course?.lessons?.find(l=>String(l.id).toLowerCase()===input.lessonID.toLowerCase()),block=lesson?.blocks?.find(b=>String(b.id).toLowerCase()===input.blockID.toLowerCase());
    if(!block||block.type!=='question'||block.questionType!=='shortAnswer'||ids.has(input.blockID.toLowerCase()))fail('INVALID_CPP_EXAM');ids.add(input.blockID.toLowerCase());
    const spec=structuredClone(input);spec.lessonID=input.lessonID.toLowerCase();spec.blockID=input.blockID.toLowerCase();
    object(spec.grading,['kind','comparison','acceptedAnswers','tests']);if(!['exact','tokens'].includes(spec.grading.comparison??'exact'))fail('INVALID_CPP_EXAM');spec.grading.comparison??='exact';
    if(spec.grading.kind==='compare'){
      if(spec.grading.tests!==undefined||!Array.isArray(spec.grading.acceptedAnswers)||spec.grading.acceptedAnswers.length<1||spec.grading.acceptedAnswers.length>20)fail('INVALID_CPP_EXAM');
      spec.grading.acceptedAnswers.forEach(s=>text(s,20000));
    }else if(spec.grading.kind==='tests'){
      if(spec.kind==='understanding'||spec.grading.acceptedAnswers!==undefined||!Array.isArray(spec.grading.tests)||spec.grading.tests.length<1||spec.grading.tests.length>8)fail('INVALID_CPP_EXAM');
      for(const test of spec.grading.tests){object(test,['stdin','expectedOutput']);text(test.stdin,4000,true);text(test.expectedOutput,8000,true);}
    }else fail('INVALID_CPP_EXAM');
    if(spec.kind==='understanding'){
      if(!block.code||!['cpp','c++'].includes(block.code.language)||checkCPPBasicSource(block.code.source))fail('INVALID_CPP_EXAM_CODE');
      if(spec.template!==undefined||spec.blanks!==undefined)fail('INVALID_CPP_EXAM');
    }else if(spec.kind==='fill'){
      text(spec.template,20000);if(!Array.isArray(spec.blanks)||spec.blanks.length<1||spec.blanks.length>8)fail('INVALID_CPP_EXAM');const used=new Set();
      for(const blank of spec.blanks){object(blank,['id','label']);if(!/^[a-z][a-z0-9_]{0,23}$/.test(blank.id)||used.has(blank.id))fail('INVALID_CPP_EXAM');used.add(blank.id);text(blank.label,120);if(spec.template.split('{{'+blank.id+'}}').length!==2)fail('INVALID_CPP_EXAM');}
      const markers=[...spec.template.matchAll(/\{\{([^{}]+)\}\}/g)];if(markers.length!==used.size||markers.some(m=>!used.has(m[1])))fail('INVALID_CPP_EXAM');
      if(checkCPPBasicSource(spec.template.replace(/\{\{[^{}]+\}\}/g,'0')))fail('INVALID_CPP_EXAM_CODE');
      block.code={language:'cpp',source:spec.template,filename:'question.cpp'};
    }else if(spec.template!==undefined||spec.blanks!==undefined)fail('INVALID_CPP_EXAM');
    if(spec.sampleInput!==undefined)text(spec.sampleInput,4000,true);
    // Public projection stays readable by existing native decoders. Answers and
    // tests live only in a server-owned sidecar, never in the course document.
    delete block.acceptedAnswers;delete block.options;delete block.correctOptionIDs;
    block.answerFormat=spec.kind==='understanding'?'output':'code';
    block.input={kind:'code',language:'cpp',placeholder:spec.kind==='understanding'?'逐行填写输出结果':spec.kind==='fill'?'填写各处代码':'从 #include 开始编写完整程序',minLines:2,maxLines:24};
    block.execution={language:'cpp',stdin:spec.sampleInput??''};
    problems.push(spec);
  }
  return {course:validateCourse(course),problems};
}
export function publicCPPProblem(spec){return {kind:spec.kind,grading:spec.grading.kind,comparison:spec.grading.comparison,headers:cppBasicHeaders,...(spec.kind==='fill'?{template:spec.template,blanks:spec.blanks}:{}),...(spec.grading.kind==='tests'?{testCount:spec.grading.tests.length}:{})};}
export function cppSubmission(spec,answer){
  if(spec.kind!=='fill')return answer;
  let blanks;try{blanks=JSON.parse(answer);}catch{throw new Error('请填写所有代码空格。');}
  if(!blanks||Array.isArray(blanks)||Object.keys(blanks).length!==spec.blanks.length||Object.keys(blanks).some(k=>!spec.blanks.some(b=>b.id===k)))throw new Error('填空内容格式无效。');
  for(const b of spec.blanks)if(typeof blanks[b.id]!=='string'||!blanks[b.id].trim()||blanks[b.id].length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(blanks[b.id]))throw new Error('请填写所有代码空格。');
  return spec.template.replace(/\{\{([^{}]+)\}\}/g,(_,id)=>blanks[id]);
}
export async function gradeCPPProblem(spec,answer,runCode,{stdin}={}){
  const start=performance.now();let source;
  const result=(status,stdout,stderr,passed)=>({status,stdout,stderr,durationMs:Math.round(performance.now()-start),...(passed===undefined?{}:{passed})});
  try{source=cppSubmission(spec,answer);}catch(e){return result('compileError','',e.message,false);}
  if(spec.kind!=='understanding'){const policy=checkCPPBasicSource(source);if(policy)return result('compileError','',policy,false);}
  if(spec.grading.kind==='compare'&&stdin===undefined){const actual=spec.kind==='fill'?source:answer;const pass=spec.grading.acceptedAnswers.some(s=>normalizeCPPOutput(s,spec.grading.comparison)===normalizeCPPOutput(actual,spec.grading.comparison));return result('completed',pass?'答案匹配。':'答案未匹配，请重新检查。','',pass);}
  if(spec.kind==='understanding')return result('unavailable','','程序理解题使用输出比对，不执行输入的答案。');
  if(stdin!==undefined)return runCode({language:'cpp',source,stdin,profile:'cpp-exam-basic'});
  const run=await runCode({language:'cpp',source,stdin:'',profile:'cpp-exam-basic',tests:spec.grading.tests.map(t=>t.stdin)});
  if(run.status!=='completed')return result(run.status,'',run.status==='compileError'?run.stderr:run.status==='unavailable'?'判题服务暂不可用。':'程序未完成全部测试；隐藏测试的输入和输出不公开。',false);
  if(!Array.isArray(run.cases)||run.cases.length!==spec.grading.tests.length)return result('unavailable','','当前运行服务尚不支持测试集判题。');
  const passed=run.cases.filter((c,i)=>c.status==='completed'&&normalizeCPPOutput(c.stdout,spec.grading.comparison)===normalizeCPPOutput(spec.grading.tests[i].expectedOutput,spec.grading.comparison)).length;
  const runtimeError=run.cases.some(c=>c.status==='runtimeError');
  return result(runtimeError?'runtimeError':'completed',`通过 ${passed} / ${spec.grading.tests.length} 个隐藏测试。`,runtimeError?'程序在隐藏测试中发生运行错误；输入与错误流不公开。':passed===spec.grading.tests.length?'':'请检查边界、输入读取与输出格式。隐藏测试数据不公开。',passed===spec.grading.tests.length);
}
