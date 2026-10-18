import { randomBytes, randomUUID, createHash } from 'node:crypto';
import courseSchema from './course.schema.json' with { type: 'json' };
import { courseExecutionLanguages, unavailableCourseExecution } from './course-execution.mjs';

export const courseProtocol = 'WORKSHOP-COURSE/1';
export const coursePath = '/api/integrations/v1/courses';
export const courseExtensionVersion = 'structured-2';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_-]{1,40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const limit = 1024 * 1024;
// The author supplies semantic states; the native client owns layout and controls.
function courseInteractionExample() {
  const source = '#include <iostream>\nint main() {\n    int count = 2;\n    count = count + 1;\n    std::cout << count;\n}';
  return {
    protocol: courseProtocol, id: 'c0000000-0000-4000-8000-000000000001',
    title: '一次赋值，发生了什么', summary: '沿着程序的三个状态，观察同一个变量如何更新。',
    lessons: [{
      id: 'c0000000-0000-4000-8000-000000000002', title: '先计算，再写回',
      objectives: ['理解赋值先计算右侧，再写回变量。'], estimatedMinutes: 4,
      blocks: [
        { id: 'c0000000-0000-4000-8000-000000000003', type: 'text', title: '跟着一次赋值走',
          text: '这是固定程序的教学推演。count 从 2 开始，加 1 后变成 3，最后输出 3。',
          presentation: { kind: 'trace', trace: { variants: [{ id: 'assignment', title: '赋值',
            code: { language: 'cpp', source, filename: 'counter.cpp' }, frames: [
              { title: '创建变量', line: 3, note: 'count 的初值是 2。', objects: [{ id: 'count', names: ['count'], value: '2', scope: 'main', changed: true }] },
              { title: '更新变量', line: 4, note: '先计算 2 + 1，再把 3 写回 count。', objects: [{ id: 'count', names: ['count'], value: '3', scope: 'main', changed: true }] },
              { title: '输出结果', line: 5, note: '输出现在的 count：3。', objects: [{ id: 'count', names: ['count'], value: '3', scope: 'main' }], output: '3' }
            ] }] } } },
        { id: 'c0000000-0000-4000-8000-000000000004', type: 'question', title: '再更新一次',
          text: '如果输出前再执行一次 count = count + 1，会输出多少？', questionType: 'singleChoice',
          options: [{ id: 'a', text: '2' }, { id: 'b', text: '3' }, { id: 'c', text: '4' }], correctOptionIDs: ['c'],
          explanation: '第一次更新后是 3，再加 1 得到 4。' }
      ]
    }]
  };
}

function courseTeachingPrompt() {
  return `你是工作坊的课程设计与教学助手。下面是制作要求，不是学习材料，不要把提示词本身改写成课程。第一次收到时，只简短回复“准备好了，请发送下一条学习主题、资料或问题，我会为你制作可阅读、可互动的课程。”，等待下一条学习内容。
根据用户的主题、教材、笔记或问题推断基础、目标和课时；只有无法推断的关键条件才简短提问。遵从明确要求，不反复索要参数。按“解释概念→具体例子或图形→练习→反馈”的节奏，由浅入深，每课时一个目标。重要来源和不确定处明示，不虚构统计或参考答案。
【先清楚，再丰富】
每屏一个问题、一个变化。编程课优先使用原生 trace 表达逐步语义，作者只提供代码、状态和解释，由 App 决定布局、配色、字号、动画和交互；不要自造布局、坐标、颜色或按钮字段。每节围绕一个短程序连续展开：先预测→单步观察→迁移一道题→动手改写。通常 4–6 块即可，不为了形式丰富而叠加对照、闪卡、修复题、术语表。没有新的教学价值就删掉。
trace 默认每帧最多展示 2 个对象，note 用一句话，默认不超过 60 字；每一步只解释一个变化。App 默认聚焦当前代码行和一句解释，完整代码按需展开。禁止同时铺开代码全貌、参数面板、输出面板、对照、时间轴和重复标签。相同对象的多个名字必须放在同一个 objects 项的 names 数组；不要把引用画成新的副本。对象 id 在同一 variant 的连续帧保持稳定，离开作用域时移除名字或对象。frame 表示执行对应 line 后的状态，line 必须真实存在；返回帧可定位函数右花括号。output 仅在真正产生输出的帧提供，不能混用预期输出与已发生输出。
【互动边界】
trace 是作者编写、客户端逐步展示的教学推演，不是实际编译或运行 C++/Python。优先原生 trace、question、code。仅当原生形式无法表达核心交互（例如连续拖动物理参数）时，才使用显式 HTML；不要求每节课包含 HTML，不用多种控件堆出实验台。普通正文、Code、Markdown 围栏不执行。HTML 操作必须绑定实际状态更新并给明确观察任务；至少提供重置，动画附暂停/重置并尊重 prefers-reduced-motion。HTML 临时状态不保存为作答或进度，需保存的练习用 question。
默认不要使用图片；图解优先 SVG，图表只用真实数据。禁止视频、音频、图片数据、base64。旧 image 字段仍可接受有效 HTTPS 地址，不编造 URL。
【文档格式 structured-2】
输出一个完整 WORKSHOP-COURSE/1 JSON 文档，未知字段拒绝。课程 {protocol,id,title,summary,lessons:[{id,title,objectives?,estimatedMinutes?,blocks:[]}]}。objectives 0–6项，每项最多500；estimatedMinutes 1–180整数。课程、课时、块 id 为同一文档内唯一 UUID。新课程生成新 UUID，修改已有课程保留结构 ID。不要把用户 ID、修订号或执行指令放入正文。
块 type 为 text/callout/image/chart/question，每块可有 title。text/callout 必填非空 text，可加一种 presentation；结构化块的 text 是简短教学摘要，不必重复完整代码或逐帧内容，也不要求兼容旧展示端。image 必填 HTTPS url、可选 caption；chart 必填 chartType(bar/line)、points:[{label,value}]、可选 caption。
presentation 只允许 kind 与唯一对应载荷，不能混搭：
{kind:"trace",trace:{variants:[{id,title,code:Code,frames:[{title,line,note,objects:[{id,names:[字符串],value,scope?,changed?}],output?}]}]}}。
trace.variants 为1–4项、id各不相同；每项 frames 为2–24帧，每帧 objects 为1–4项且对象id不能重复。variant/object 的 id 为1–40个 ASCII 字母、数字、下划线或连字符。每个对象 names 为1–3个非空名字，作者应避免重复；value 是非空字符串最多120，scope 可选非空最多80，changed 可选布尔值。names 每项最多80；frame.title 和 variant.title 非空最多120；note 非空最多400（默认一句不超过60字）；line 为对应 code.source 的有效正整数行号；output 可空最多2000。一个对象的 names 表示同一对象的不同名字，不是多个对象。
现有形式按需使用：{kind:"code",code:Code}；{kind:"table",table:{columns:[字符串],rows:[[字符串]]}}，1–8列、1–60行，每行与列数一致；{kind:"steps",steps:[{title,text,code?}]}，1–20步；{kind:"comparison",items:[{title,text,code?}]}，2–4项；{kind:"flashcards",cards:[{front,back}]}，1–20张；{kind:"markdown",markdown:{source}}；{kind:"html",html:{source,height?}}；{kind:"svg",svg:{source,height?}}。steps/comparison 每项 title240、text4000；table列名120、单元格2000；flashcards.front2000、back4000。markdown.source 非空最多20000；html.source/svg.source 非空最多60000；height 可省略，提供时为120–640整数，Markdown不接受height。
Code={language,source,filename?,highlightLines?,annotations?,stdin?,expectedOutput?}。language 为1–40个 ASCII 字母、数字、下划线、+、.或-（C++用 cpp 或 c++）；source 非空最多20000，保留换行与缩进，不放 Markdown 围栏。filename240；highlightLines 为0–200个有效、不重复的正整数行号；annotations 为0–40个 {line,text}，行号有效且不重复、text2000；stdin 可空最多4000，expectedOutput 可空最多8000。行按 CRLF/CR/LF 划分。#include <iostream>、template<typename T>、a < b 都是数据，允许原样写入字符串。普通 Code 展示不编译、不执行，也不验证真实运行结果，不能声称已运行。只有下面显式 execution 的作答题可以实际运行。
question 必填 text、questionType(singleChoice/multipleChoice/shortAnswer)，可有 explanation、code:Code、hints（0–5项，每项最多2000）。选择题必填 options:[{id,text}]、correctOptionIDs，只引用已有选项；单选恰好一个正确项，多选至少一个；不接受 acceptedAnswers/answerFormat。选项id为1–40个 ASCII 字母、数字、下划线或连字符。shortAnswer 不接受 options/correctOptionIDs；可有 acceptedAnswers 和 answerFormat(text/code/output)，默认text。text比较忽略大小写、合并空白；code/output仅统一换行并去掉首尾空白，仍是文本比较。开放代码题默认自行核对：省略 acceptedAnswers，解析给参考实现与检查点；不能把代码文本匹配当作通用代码判分。只有答案确实唯一的补全题才给 code 参考文本，并说明比较局限。每课完成只要求每题有效作答，不要求全对。
【作答输入与真实运行】
shortAnswer 可指定 input:{kind:"text"|"integer"|"decimal"|"code",language?,placeholder?,starterCode?,minLines?,maxLines?}。数字答案必须用 integer 或 decimal，让 App 使用两行数字键盘；代码练习用 code，让 App 提供有语法颜色的多行编辑器。input.language 仅 code 可用，限定 javascript/python/cpp；starterCode 仅 code 可用、可空最多20000；placeholder 可空最多500。minLines/maxLines 为2–24整数且min≤max；数字输入仍会紧凑显示。integer 仅可带正负号的十进制整数；decimal 可带正负号与小数点、不接受科学记数、逗号、NaN/Infinity。不要把要求输入数字的题目保留成普通长文本框。旧文档省略input仍兼容；execution存在或answerFormat=code时推断为code，其他默认text。
仅 shortAnswer 可显式添加 execution:{language:"javascript"|"python"|"cpp",template?,stdin?,expectedOutput?}。input.language与execution.language都提供时必须相同。完整程序题可省略template，使用学生提交的完整源码；填空题必须提供template，且完整程序模板中恰好出现一次字面标记{{ANSWER}}，App/服务器只替换这一处。显式input.kind为text/integer/decimal时execution必须带template，不把任意文字或数字误当源码。template非空最多20000；stdin可空最多4000；expectedOutput可空最多8000。真实运行作答/代码输入上限20000。template只提供公开教学程序，不含秘密、密钥或隐藏答案；输入永远不通过shell拼接。比较运行输出会统一换行并去末尾空白；expectedOutput只用于课程默认stdin的一次输出核对，不等于通用判分或隐藏测试，不要把一个示例通过宣称为普遍正确。
明确区分三种形式：trace是人工推演；code/presentation.code是源码展示；execution才是可实际运行的作答题。JavaScript可在App本地隔离运行；Python/C++需服务器独立沙盒可用。运行服务未启用、超时或编译错误时要如实反馈，课程仍可编辑与作答；不能宣称已编译通过。默认非运行开放代码题仍自行核对；需要实验时有意添加execution，不能靠把程序塞进普通text或HTML冒充编译器。
例如补全输出的数字题：questionType:"shortAnswer",answerFormat:"output",input:{kind:"integer",placeholder:"输入整数"},execution:{language:"cpp",template:"#include <iostream>\\nint main(){ std::cout << {{ANSWER}}; }",expectedOutput:"42"}；完整JavaScript程序题：input:{kind:"code",language:"javascript",starterCode:"console.log(2 + 3);",minLines:4,maxLines:16},execution:{language:"javascript",expectedOutput:"5"}。这些是块字段片段说明；正式输出仍必须是唯一完整课程JSON。
HTML/SVG 通过显式 presentation 进入离线沙盒；不与普通字符串拼接。完全内联，不使用 CDN、外链脚本/样式/字体、请求、导航、iframe/object/embed、SVG image/foreignObject、媒体、data/base64 或下载。HTML可运行内联CSS/JavaScript、SVG/canvas；服务器只存储。不要仿制 App 导航、账号或上传控件；适配约320px宽屏幕，控件至少44px高，事件更新先改模型再绘制，避免每次输入替换整个innerHTML，避免无限循环和后台定时器。Markdown可含标题、列表、表格、引用和带语言名的代码围栏，不启用原始HTML或图片。
限制按 UTF-16 代码单元：JSON UTF-8最多1 MiB；1–40课时，每课1–80块；所有title240、summary2000、text/callout20000、题干和explanation4000、caption2000。图表1–60点，label120，value有限且绝对值≤10^15；选择题2–12项，选项text1000；acceptedAnswers最多20个不重复项，各项上限text500/code20000/output8000，用户答案上限4000/20000/8000；URL2048；禁止控制字符。不要新造 block.type 或把 code/hints/input/execution 放在非 question 块；input/execution仅shortAnswer可用。
输出前核对：每一步是否只突出一个变化？对象身份和引用别名是否一致？代码行号、数值、输出与练习答案是否对应？原生能表达时是否避免了 HTML？不要把检查清单写进课程，也不逐项索要确认。
下面是“原生单步推演→一道迁移题”的完整有效示例。按用户主题设计，不照搬标题、UUID或知识点；只有这一个完整 JSON 代码块是格式示例：
\`\`\`json
${JSON.stringify(courseInteractionExample(), null, 2)}
\`\`\``;
}
export function courseManualPrompt() {
  return courseTeachingPrompt() + `
你在本次流程只负责生成供用户导入的课程，不需要登录或调用网络。先按上述要求等待用户下一条学习内容。课程制作完成后只输出一个完整 JSON 文档，放在一个 json 代码块中；不要在代码块外附加无关说明，不要输出多个片段，不要声称已上传。用户会把文档复制到工作坊的“粘贴课程并上传”（课程页右上角 + 或课程 API 设置中）并由 App 使用其当前登录账户上传。修改已有课程时，用户需在 App 核对已知课程版本；没有已有文档时创建新 UUID，不猜测或覆盖旧课程。`;
}
export function coursePrompt(endpoint) {
  return courseTeachingPrompt() + `
用户后续提供学习内容后，如果你有网络请求工具，将制作完成的文档上传到当前课程发布凭据绑定的账户，不询问或提交用户 ID。
静态 JSON Schema（可选发现，不含账户信息）：GET ${endpoint}/schema
POST ${endpoint}
Authorization: Bearer {{API_KEY}}
Content-Type: application/json; charset=utf-8
Idempotency-Key: 每次新操作生成的 UUID。密钥只出现在 Authorization 请求头，不能进入正文、日志、课程或公开输出。
新建课程无需 If-Match；更新已有课程必须提供已知当前修订号 If-Match: "整数"。修订号放在请求头，不放入课程 JSON。重试保留同一 Idempotency-Key、完全相同的字节正文与 If-Match。409 表示冲突，应停止并获取最新课程或请用户核对，不能猜测版本强行覆盖。只有 HTTP 201/200 成功后才可以说已上传，并报告返回的课程标题和修订号。
如果没有网络工具或无法实际发起 HTTP 请求，不要假装上传：只输出一个完整 WORKSHOP-COURSE/1 JSON 文档，优先放在唯一的 json 代码块内，不附加无关说明，让用户复制到 App 的“粘贴课程并上传”（课程页右上角 + 或课程 API 设置中）。此退路不需要用户提供其他凭据。`;
}

export function createCourseAPI({ db, userFor, workspaceAccess, sameWebOrigin, respond, APIError, origin, rateLimit, peer, now = Date.now, runCode = async () => unavailableCourseExecution() }) {
  const fail = (code = 'INVALID_COURSE', status = 422) => { throw new APIError(status, code); };
  const object = (value, keys, code) => {
    if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !keys.includes(key))) fail(code);
  };
  const string = (value, max, nonempty = true) => {
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail();
  };
  const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase(); };
  const array = (value, min, max) => { if (!Array.isArray(value) || value.length < min || value.length > max) fail(); };
  const uniqueStrings = (value, max, check) => {
    array(value, 0, max); const seen = new Set();
    for (const item of value) { check(item); if (seen.has(item)) fail(); seen.add(item); }
  };
  // Native code strings are curriculum data. Rich presentation source is also stored
  // as data here and runs only inside the client sandbox; never execute it on the server.
  // Do not blacklist quoted HTML or C++ syntax in ordinary teaching text.
  function validateCode(code) {
    object(code, ['language', 'source', 'filename', 'highlightLines', 'annotations', 'stdin', 'expectedOutput']);
    if (typeof code.language !== 'string' || code.language.length < 1 || code.language.length > 40 || /[^A-Za-z0-9_+.-]/.test(code.language)) fail();
    string(code.source, 20000);
    const lineCount = code.source.split(/\r\n|\r|\n/).length;
    if (code.filename !== undefined) string(code.filename, 240);
    if (code.highlightLines !== undefined) uniqueStrings(code.highlightLines, 200, line => { if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) fail(); });
    if (code.annotations !== undefined) {
      array(code.annotations, 0, 40); const lines = new Set();
      for (const annotation of code.annotations) {
        object(annotation, ['line', 'text']);
        if (!Number.isSafeInteger(annotation.line) || annotation.line < 1 || annotation.line > lineCount || lines.has(annotation.line)) fail();
        lines.add(annotation.line); string(annotation.text, 2000);
      }
    }
    if (code.stdin !== undefined) string(code.stdin, 4000, false);
    if (code.expectedOutput !== undefined) string(code.expectedOutput, 8000, false);
  }
  function validateTrace(trace) {
    object(trace, ['variants']); array(trace.variants, 1, 4);
    const variants = new Set();
    const takeIdentifier = (id, seen) => {
      if (typeof id !== 'string' || id.length < 1 || id.length > 40 || /[^A-Za-z0-9_-]/.test(id) || seen.has(id)) fail();
      seen.add(id);
    };
    for (const variant of trace.variants) {
      object(variant, ['id', 'title', 'code', 'frames']); takeIdentifier(variant.id, variants);
      string(variant.title, 120); validateCode(variant.code); array(variant.frames, 2, 24);
      const lines = variant.code.source.split(/\r\n|\r|\n/).length;
      for (const frame of variant.frames) {
        object(frame, ['title', 'line', 'note', 'objects', 'output']);
        string(frame.title, 120); string(frame.note, 400);
        if (!Number.isSafeInteger(frame.line) || frame.line < 1 || frame.line > lines) fail();
        array(frame.objects, 1, 4); const objects = new Set();
        for (const item of frame.objects) {
          object(item, ['id', 'names', 'value', 'scope', 'changed']); takeIdentifier(item.id, objects);
          array(item.names, 1, 3); for (const name of item.names) string(name, 80);
          string(item.value, 120);
          if (item.scope !== undefined) string(item.scope, 80);
          if (item.changed !== undefined && typeof item.changed !== 'boolean') fail();
        }
        if (frame.output !== undefined) string(frame.output, 2000, false);
      }
    }
  }
  function validatePresentation(value) {
    const fields = { code: 'code', table: 'table', steps: 'steps', comparison: 'items', flashcards: 'cards', markdown: 'markdown', html: 'html', svg: 'svg', trace: 'trace' };
    if (!value || !Object.hasOwn(fields, value.kind)) fail('UNSUPPORTED_COURSE_PRESENTATION');
    object(value, ['kind', fields[value.kind]]);
    if (value.kind === 'code') validateCode(value.code);
    if (value.kind === 'trace') validateTrace(value.trace);
    if (['markdown', 'html', 'svg'].includes(value.kind)) {
      const source = value[value.kind];
      object(source, value.kind === 'markdown' ? ['source'] : ['source', 'height']);
      string(source.source, value.kind === 'markdown' ? 20000 : 60000);
      if (source.height !== undefined && (!Number.isSafeInteger(source.height) || source.height < 120 || source.height > 640)) fail();
    }
    if (value.kind === 'table') {
      object(value.table, ['columns', 'rows']); array(value.table.columns, 1, 8); array(value.table.rows, 1, 60);
      for (const column of value.table.columns) string(column, 120);
      for (const row of value.table.rows) { array(row, value.table.columns.length, value.table.columns.length); for (const cell of row) string(cell, 2000, false); }
    }
    if (value.kind === 'steps' || value.kind === 'comparison') {
      const items = value[value.kind === 'steps' ? 'steps' : 'items'];
      array(items, value.kind === 'steps' ? 1 : 2, value.kind === 'steps' ? 20 : 4);
      for (const item of items) { object(item, ['title', 'text', 'code']); string(item.title, 240); string(item.text, 4000); if (item.code !== undefined) validateCode(item.code); }
    }
    if (value.kind === 'flashcards') {
      array(value.cards, 1, 20);
      for (const card of value.cards) { object(card, ['front', 'back']); string(card.front, 2000); string(card.back, 4000); }
    }
  }
  const integerAnswer = /^[+-]?[0-9]+$/;
  const decimalAnswer = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;
  const numericAnswerValid = (block, text) => block?.input?.kind === 'integer' ? integerAnswer.test(text.trim()) : block?.input?.kind === 'decimal' ? decimalAnswer.test(text.trim()) : true;
  const answerTextLimit = block => block?.questionType === 'shortAnswer' ? (block.execution || block.input?.kind === 'code' ? 20000 : ({ text: 4000, code: 20000, output: 8000 }[block.answerFormat ?? 'text'] ?? 4000)) : 4000;
  function validateInput(input) {
    object(input, ['kind', 'language', 'placeholder', 'starterCode', 'minLines', 'maxLines']);
    if (!['text', 'integer', 'decimal', 'code'].includes(input.kind)) fail();
    if (input.placeholder !== undefined) string(input.placeholder, 500, false);
    if (input.language !== undefined && (input.kind !== 'code' || !courseExecutionLanguages.includes(input.language))) fail();
    if (input.starterCode !== undefined) { if (input.kind !== 'code') fail(); string(input.starterCode, 20000, false); }
    for (const key of ['minLines', 'maxLines']) if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < 2 || input[key] > 24)) fail();
    if (input.minLines !== undefined && input.maxLines !== undefined && input.maxLines < input.minLines) fail();
  }
  function validateExecution(execution, input) {
    object(execution, ['language', 'template', 'stdin', 'expectedOutput']);
    if (!courseExecutionLanguages.includes(execution.language)) fail();
    if (input?.language !== undefined && input.language !== execution.language) fail();
    if (execution.template !== undefined) {
      string(execution.template, 20000);
      if (execution.template.split('{{ANSWER}}').length !== 2) fail();
    } else if (input !== undefined && input.kind !== 'code') fail();
    if (execution.stdin !== undefined) string(execution.stdin, 4000, false);
    if (execution.expectedOutput !== undefined) string(execution.expectedOutput, 8000, false);
  }
  function validateCourse(value) {
    object(value, ['protocol', 'id', 'title', 'summary', 'lessons']);
    if (value.protocol !== courseProtocol) fail('UNSUPPORTED_COURSE_PROTOCOL');
    const ids = new Set();
    const takeID = obj => { obj.id = uuid(obj.id); if (ids.has(obj.id)) fail('DUPLICATE_COURSE_ID'); ids.add(obj.id); };
    takeID(value); string(value.title, 240); string(value.summary, 2000, false); array(value.lessons, 1, 40);
    for (const lesson of value.lessons) {
      object(lesson, ['id', 'title', 'blocks', 'objectives', 'estimatedMinutes']); takeID(lesson); string(lesson.title, 240); array(lesson.blocks, 1, 80);
      if (lesson.objectives !== undefined) { array(lesson.objectives, 0, 6); for (const objective of lesson.objectives) string(objective, 500); }
      if (lesson.estimatedMinutes !== undefined && (!Number.isSafeInteger(lesson.estimatedMinutes) || lesson.estimatedMinutes < 1 || lesson.estimatedMinutes > 180)) fail();
      for (const block of lesson.blocks) {
        const blockFields = { text: ['text', 'presentation'], callout: ['text', 'presentation'], image: ['url', 'caption'], chart: ['chartType', 'points', 'caption'], question: ['text', 'questionType', 'options', 'correctOptionIDs', 'acceptedAnswers', 'explanation', 'code', 'hints', 'answerFormat', 'input', 'execution'] };
        if (!block || !Object.hasOwn(blockFields, block.type)) fail('UNSUPPORTED_COURSE_BLOCK');
        const fields = blockFields[block.type];
        object(block, ['id', 'type', 'title', ...fields]); takeID(block);
        if (block.title !== undefined) string(block.title, 240);
        if (block.caption !== undefined) string(block.caption, 2000, false);
        if (block.type === 'text' || block.type === 'callout' || block.type === 'question') string(block.text, block.type === 'question' ? 4000 : 20000);
        if (block.presentation !== undefined) validatePresentation(block.presentation);
        if (block.type === 'image') {
          string(block.url, 2048);
          let url; try { url = new URL(block.url); } catch { fail('INVALID_COURSE_IMAGE'); }
          if (url.protocol !== 'https:' || url.username || url.password || /\.svg(?:$|[?#])/i.test(block.url)) fail('INVALID_COURSE_IMAGE');
        }
        if (block.type === 'chart') {
          if (!['bar', 'line'].includes(block.chartType)) fail(); array(block.points, 1, 60);
          for (const point of block.points) { object(point, ['label', 'value']); string(point.label, 120); if (typeof point.value !== 'number' || !Number.isFinite(point.value) || Math.abs(point.value) > 1e15) fail(); }
        }
        if (block.type === 'question') {
          if (block.explanation !== undefined) string(block.explanation, 4000, false);
          if (block.code !== undefined) validateCode(block.code);
          if (block.hints !== undefined) { array(block.hints, 0, 5); for (const hint of block.hints) string(hint, 2000); }
          if (block.questionType === 'shortAnswer') {
            if (block.options !== undefined || block.correctOptionIDs !== undefined) fail();
            if (block.answerFormat !== undefined && !['text', 'code', 'output'].includes(block.answerFormat)) fail();
            if (block.input !== undefined) validateInput(block.input);
            if (block.execution !== undefined) validateExecution(block.execution, block.input);
            if (block.acceptedAnswers !== undefined) uniqueStrings(block.acceptedAnswers, 20, answer => string(answer, block.input?.kind === 'code' || (!block.input && block.execution) ? 20000 : (block.answerFormat ?? 'text') === 'text' ? 500 : answerTextLimit(block)));
            if (block.acceptedAnswers?.some(answer => !numericAnswerValid(block, answer))) fail();
          } else if (['singleChoice', 'multipleChoice'].includes(block.questionType)) {
            if (block.acceptedAnswers !== undefined || block.answerFormat !== undefined || block.input !== undefined || block.execution !== undefined) fail(); array(block.options, 2, 12);
            const options = new Set();
            for (const option of block.options) { object(option, ['id', 'text']); if (typeof option.id !== 'string' || !identifier.test(option.id) || options.has(option.id)) fail(); options.add(option.id); string(option.text, 1000); }
            uniqueStrings(block.correctOptionIDs, 12, id => { if (!options.has(id)) fail(); });
            if (block.correctOptionIDs.length < 1 || (block.questionType === 'singleChoice' && block.correctOptionIDs.length !== 1)) fail();
          } else fail('UNSUPPORTED_COURSE_QUESTION');
        }
      }
    }
    return value;
  }
  db.exec(`CREATE TABLE IF NOT EXISTS course_tokens(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL REFERENCES users(id),name TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,last_used INTEGER);
    CREATE TABLE IF NOT EXISTS courses(owner_id INTEGER NOT NULL REFERENCES users(id),id TEXT NOT NULL,revision INTEGER NOT NULL,document TEXT NOT NULL,updated_at TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,id));
    CREATE TABLE IF NOT EXISTS course_publications(owner_id INTEGER NOT NULL REFERENCES users(id),mutation_id TEXT NOT NULL,body_hash TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(owner_id,mutation_id));
    CREATE TABLE IF NOT EXISTS course_stars(user_id INTEGER NOT NULL REFERENCES users(id),owner_id INTEGER NOT NULL REFERENCES users(id),course_id TEXT NOT NULL,PRIMARY KEY(user_id,owner_id,course_id));
    CREATE TABLE IF NOT EXISTS course_progress(user_id INTEGER NOT NULL REFERENCES users(id),owner_id INTEGER NOT NULL REFERENCES users(id),course_id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(user_id,owner_id,course_id));
    CREATE TABLE IF NOT EXISTS course_progress_mutations(user_id INTEGER NOT NULL REFERENCES users(id),owner_id INTEGER NOT NULL REFERENCES users(id),course_id TEXT NOT NULL,mutation_id TEXT NOT NULL,body_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,owner_id,course_id,mutation_id));`);
  function credential(request) {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !/^Bearer wsc_[A-Za-z0-9_-]{43}$/.test(auth)) fail('INVALID_COURSE_TOKEN', 401);
    const row = db.prepare('SELECT * FROM course_tokens WHERE hash=? AND expires>?').get(hash(auth.slice(7)), now());
    if (!row) fail('INVALID_COURSE_TOKEN', 401); return row;
  }
  const endpoint = origin + coursePath, schemaURL = endpoint + '/schema';
  const metadata = { endpoint, protocol: courseProtocol, schemaURL, extensionVersion: courseExtensionVersion };
  const info = row => ({ id: row.id, name: row.name, created: row.created, expires: row.expires, ...(row.last_used != null ? { lastUsed: row.last_used } : {}) });
  async function read(request, max = limit, acceptsText = false) {
    if (request.headers['content-encoding'] != null && request.headers['content-encoding'] !== 'identity') fail('COURSE_ENCODING_UNSUPPORTED', 415);
    const contentType = request.headers['content-type'] ?? '';
    if (!(acceptsText ? /^(?:application\/json|text\/plain)(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i : /^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i).test(contentType)) fail('JSON_REQUIRED', 415);
    if (Number(request.headers['content-length']) > max) { request.resume(); fail('TOO_LARGE', 413); }
    const chunks = []; let size = 0;
    // Keep draining oversized bodies so a client receives the JSON error rather than a reset.
    for await (const chunk of request) { size += chunk.length; if (size <= max) chunks.push(chunk); }
    if (size > max) fail('TOO_LARGE', 413);
    const bytes = Buffer.concat(chunks); let value;
    try { const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); value = JSON.parse(text); } catch { fail('INVALID_COURSE_JSON', 400); }
    return { value, bytes };
  }
  function transaction(work) { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function match(request, required) {
    const value = request.headers['if-match'];
    if (value === undefined && !required) return null;
    if (value === undefined) fail('REVISION_REQUIRED', 428);
    if (typeof value !== 'string' || !/^"[1-9]\d{0,9}"$/.test(value)) fail('INVALID_REVISION', 422);
    return Number(value.slice(1, -1));
  }
  function course(owner, id) {
    const row = db.prepare('SELECT * FROM courses WHERE owner_id=? AND id=? AND deleted=0').get(owner, id);
    if (!row) fail('COURSE_NOT_FOUND', 404); return row;
  }
  function answerValid(answer, block) {
    if (!block || block.type !== 'question') return false;
    if (block.questionType === 'shortAnswer') return answer.selectedOptionIDs.length === 0 && answer.text.trim().length > 0 && numericAnswerValid(block, answer.text);
    return answer.text === '' && answer.selectedOptionIDs.length > 0 && (block.questionType !== 'singleChoice' || answer.selectedOptionIDs.length === 1) && answer.selectedOptionIDs.every(id => block.options.some(option => option.id === id));
  }
  function progress(user, owner, id, doc) {
    const saved = db.prepare('SELECT state FROM course_progress WHERE user_id=? AND owner_id=? AND course_id=?').get(user, owner, id);
    const stored = saved ? JSON.parse(saved.state) : null;
    const currentRevision = course(owner, id).revision;
    const state = stored?.courseRevision === currentRevision ? stored : { courseID: id, courseRevision: currentRevision, completedLessonIDs: [], answers: [] };
    state.answers = state.answers.filter(answer => answerValid(answer, doc.lessons.find(lesson => lesson.id === answer.lessonID)?.blocks.find(block => block.id === answer.blockID)));
    state.completedLessonIDs = state.completedLessonIDs.filter(id => {
      const lesson = doc.lessons.find(lesson => lesson.id === id); return lesson && lesson.blocks.filter(block => block.type === 'question').every(block => state.answers.some(answer => answer.lessonID === id && answer.blockID === block.id));
    });
    return state;
  }
  function publish(owner, key, expected, bytes, doc) {
    rateLimit('course-owner:' + owner, 3600000, 120);
    const digest = hash(Buffer.concat([Buffer.from(String(expected) + '\n'), bytes]));
    const prior = db.prepare('SELECT * FROM course_publications WHERE owner_id=? AND mutation_id=?').get(owner, key);
    if (prior) { if (prior.body_hash !== digest) fail('IDEMPOTENCY_CONFLICT', 409); return { ...JSON.parse(prior.result), title: doc.title, replayed: true }; }
    const old = db.prepare('SELECT revision,deleted FROM courses WHERE owner_id=? AND id=?').get(owner, doc.id);
    if (old ? old.deleted || expected !== old.revision : expected !== null) fail('COURSE_REVISION_CONFLICT', 409);
    if (!old && db.prepare('SELECT COUNT(*) AS n FROM courses WHERE owner_id=? AND deleted=0').get(owner).n >= 200) fail('COURSE_LIMIT');
    if (db.prepare('SELECT COUNT(*) AS n FROM course_publications WHERE owner_id=?').get(owner).n >= 20000) fail('COURSE_PUBLICATION_LIMIT');
    const result = { id: doc.id, title: doc.title, revision: (old?.revision ?? 0) + 1, updatedAt: new Date(now()).toISOString() };
    db.prepare('INSERT INTO courses(owner_id,id,revision,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at').run(owner, doc.id, result.revision, JSON.stringify(doc), result.updatedAt);
    db.prepare('INSERT INTO course_publications VALUES(?,?,?,?,?)').run(owner, key, digest, JSON.stringify(result), now());
    return { ...result, replayed: false };
  }
  const runningUsers = new Set();
  return async function handle(request, response, path) {
    // This static contract carries no credentials, account state or course data.
    if (path === coursePath + '/schema' && request.method === 'GET') { respond(response, 200, courseSchema); return true; }
    const tokens = path === '/api/native/v1/integrations/course-tokens';
    const native = /^\/api\/native\/v1\/courses(?:\/([^/]+)(\/(?:progress|star|run))?)?$/.exec(path);
    if (path !== coursePath && !tokens && !native) return false;
    sameWebOrigin(request);
    if (path === coursePath && request.method === 'POST') {
      rateLimit('course-ip:' + peer(request), 60000, 60); credential(request);
      if (request.headers['x-workspace-id'] != null) fail('COURSE_TOKEN_OWNS_PERSONAL_WORKSPACE');
      const key = uuid(request.headers['idempotency-key']), expected = match(request, false);
      const { value, bytes } = await read(request, limit, true), doc = validateCourse(value);
      const result = transaction(() => {
        const token = credential(request);
        const result = publish(token.user_id, key, expected, bytes, doc);
        db.prepare('UPDATE course_tokens SET last_used=? WHERE id=?').run(now(), token.id);
        return result;
      });
      respond(response, result.replayed || expected !== null ? 200 : 201, { data: result }); return true;
    }
    const user = userFor(request);
    if (tokens) {
      if (request.method === 'GET') {
        respond(response, 200, { data: { credentials: db.prepare('SELECT * FROM course_tokens WHERE user_id=? AND expires>? ORDER BY created,id').all(user, now()).map(info), ...metadata, prompt: coursePrompt(endpoint), manualPrompt: courseManualPrompt() } }); return true;
      }
      if (['POST', 'DELETE'].includes(request.method)) {
        const { value } = await read(request, 1024); object(value, request.method === 'POST' ? ['name'] : ['id'], 'INVALID_COURSE_TOKEN_REQUEST');
        const result = transaction(() => {
          const actor = userFor(request);
          if (request.method === 'DELETE') { const id = uuid(value.id); if (db.prepare('DELETE FROM course_tokens WHERE id=? AND user_id=?').run(id, actor).changes !== 1) fail('COURSE_TOKEN_NOT_FOUND', 404); return { revoked: true }; }
          const name = value.name === undefined ? 'AI课程发布' : value.name; string(name, 60);
          db.prepare('DELETE FROM course_tokens WHERE user_id=? AND expires<=?').run(actor, now());
          if (db.prepare('SELECT COUNT(*) AS n FROM course_tokens WHERE user_id=?').get(actor).n >= 10) fail('COURSE_TOKEN_LIMIT');
          const accessToken = 'wsc_' + randomBytes(32).toString('base64url'), credential = { id: randomUUID(), name, created: now(), expires: now() + 365 * 86400000 };
          db.prepare('INSERT INTO course_tokens(id,hash,user_id,name,created,expires) VALUES(?,?,?,?,?,?)').run(credential.id, hash(accessToken), actor, name, credential.created, credential.expires);
          return { credential, accessToken, ...metadata };
        });
        respond(response, request.method === 'POST' ? 201 : 200, { data: result }); return true;
      }
    }
    if (native) {
      const id = native[1] ? uuid(native[1]) : null, isProgress = native[2] === '/progress', isStar = native[2] === '/star', isRun = native[2] === '/run';
      if (id && isRun && request.method === 'POST') {
        workspaceAccess(request);
        const { value } = await read(request, 128 * 1024);
        object(value, ['courseRevision', 'lessonID', 'blockID', 'text', 'stdin'], 'INVALID_COURSE_RUN');
        const lessonID = uuid(value.lessonID), blockID = uuid(value.blockID);
        if (!Number.isSafeInteger(value.courseRevision) || value.courseRevision < 1) fail('INVALID_COURSE_RUN');
        string(value.text, 20000); if (value.stdin !== undefined) string(value.stdin, 4000, false);
        // Recheck after the streamed body: a revoked session or sharing invitation
        // must not start work merely because it was valid at the start of the upload.
        const actor = userFor(request), { ownerID } = workspaceAccess(request), row = course(ownerID, id);
        if (row.revision !== value.courseRevision) fail('COURSE_REVISION_CONFLICT', 409);
        const doc = JSON.parse(row.document), block = doc.lessons.find(lesson => lesson.id === lessonID)?.blocks.find(block => block.id === blockID);
        if (block?.type !== 'question' || block.questionType !== 'shortAnswer' || !block.execution) fail('COURSE_EXECUTION_NOT_ALLOWED');
        if (!numericAnswerValid(block, value.text)) fail('INVALID_COURSE_ANSWER');
        rateLimit('course-run-user:' + actor, 60000, 12); rateLimit('course-run-ip:' + peer(request), 60000, 30);
        if (runningUsers.has(actor) || runningUsers.size >= 2) fail('COURSE_RUN_BUSY', 429);
        const execution = block.execution, source = execution.template === undefined ? value.text : execution.template.replace('{{ANSWER}}', () => value.text);
        runningUsers.add(actor);
        try {
          let result;
          try { result = await runCode({ language: execution.language, source, stdin: value.stdin ?? execution.stdin ?? '' }); }
          catch { result = unavailableCourseExecution(); }
          const normalize = value => value.replace(/\r\n|\r/g, '\n').trimEnd();
          const passed = result.status === 'completed' && execution.expectedOutput !== undefined && value.stdin === undefined
            ? normalize(result.stdout) === normalize(execution.expectedOutput) : undefined;
          respond(response, 200, { data: { status: result.status, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs,
            ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }), ...(passed === undefined ? {} : { passed }) } }); return true;
        } finally { runningUsers.delete(actor); }
      }
      if (!id && request.method === 'POST') {
        rateLimit('course-ip:' + peer(request), 60000, 60);
        workspaceAccess(request, true);
        const key = uuid(request.headers['idempotency-key']), expected = match(request, false);
        const { value, bytes } = await read(request, limit, true), doc = validateCourse(value);
        const result = transaction(() => {
          const { ownerID } = workspaceAccess(request, true);
          return publish(ownerID, key, expected, bytes, doc);
        });
        respond(response, result.replayed || expected !== null ? 200 : 201, { data: result }); return true;
      }
      if (id && isStar && request.method === 'PUT') {
        workspaceAccess(request);
        const { value } = await read(request, 1024);
        object(value, ['starred'], 'INVALID_COURSE_STAR');
        if (typeof value.starred !== 'boolean') fail('INVALID_COURSE_STAR');
        transaction(() => {
          const actor = userFor(request), { ownerID } = workspaceAccess(request);
          course(ownerID, id);
          if (value.starred) db.prepare('INSERT OR IGNORE INTO course_stars VALUES(?,?,?)').run(actor, ownerID, id);
          else db.prepare('DELETE FROM course_stars WHERE user_id=? AND owner_id=? AND course_id=?').run(actor, ownerID, id);
        });
        respond(response, 200, { data: { starred: value.starred } }); return true;
      }
      if (!isStar && !isRun && request.method === 'GET') {
        const { ownerID } = workspaceAccess(request);
        if (!id) {
          const courses = db.prepare('SELECT id,revision,document,updated_at FROM courses WHERE owner_id=? AND deleted=0 ORDER BY updated_at DESC,id').all(ownerID).map(row => { const doc = JSON.parse(row.document); return { id: row.id, title: doc.title, summary: doc.summary, revision: row.revision, updatedAt: row.updated_at, lessonCount: doc.lessons.length }; });
          const starredCourseIDs = db.prepare('SELECT s.course_id FROM course_stars s JOIN courses c ON c.owner_id=s.owner_id AND c.id=s.course_id WHERE s.user_id=? AND s.owner_id=? AND c.deleted=0 ORDER BY s.course_id').all(user, ownerID).map(row => row.course_id);
          respond(response, 200, { data: { courses, starredCourseIDs } }); return true;
        }
        const row = course(ownerID, id), doc = JSON.parse(row.document);
        respond(response, 200, { data: isProgress ? progress(user, ownerID, id, doc) : { course: doc, revision: row.revision, updatedAt: row.updated_at } }); return true;
      }
      if (id && !isProgress && !isStar && !isRun && request.method === 'DELETE') {
        const expected = match(request, true);
        transaction(() => { const { ownerID } = workspaceAccess(request, true), row = course(ownerID, id); if (row.revision !== expected) fail('COURSE_REVISION_CONFLICT', 409); db.prepare('UPDATE courses SET deleted=1,revision=revision+1,updated_at=? WHERE owner_id=? AND id=?').run(new Date(now()).toISOString(), ownerID, id); db.prepare('DELETE FROM course_stars WHERE owner_id=? AND course_id=?').run(ownerID, id); });
        respond(response, 200, { data: { deleted: true } }); return true;
      }
      if (id && isProgress && request.method === 'POST') {
        const { value, bytes } = await read(request, 128 * 1024);
        object(value, ['mutationID', 'courseRevision', 'lessonID', 'blockID', 'selectedOptionIDs', 'text', 'completed'], 'INVALID_COURSE_PROGRESS');
        const mutation = uuid(value.mutationID), lessonID = uuid(value.lessonID), blockID = value.blockID === undefined ? null : uuid(value.blockID);
        if (!Number.isSafeInteger(value.courseRevision) || value.courseRevision < 1 || (blockID === null && typeof value.completed !== 'boolean') || (value.completed !== undefined && typeof value.completed !== 'boolean')) fail('INVALID_COURSE_PROGRESS');
        if (blockID === null && (value.selectedOptionIDs !== undefined || value.text !== undefined)) fail('INVALID_COURSE_PROGRESS');
        const digest = hash(bytes);
        const result = transaction(() => {
          const actor = userFor(request), { ownerID } = workspaceAccess(request), row = course(ownerID, id), doc = JSON.parse(row.document);
          if (row.revision !== value.courseRevision) fail('COURSE_REVISION_CONFLICT', 409);
          const prior = db.prepare('SELECT * FROM course_progress_mutations WHERE user_id=? AND owner_id=? AND course_id=? AND mutation_id=?').get(actor, ownerID, id, mutation);
          if (prior) { if (prior.body_hash !== digest) fail('IDEMPOTENCY_CONFLICT', 409); return progress(actor, ownerID, id, doc); }
          const lesson = doc.lessons.find(lesson => lesson.id === lessonID); if (!lesson) fail('INVALID_COURSE_PROGRESS');
          const state = progress(actor, ownerID, id, doc);
          if (blockID) {
            const selectedOptionIDs = value.selectedOptionIDs ?? [], text = value.text ?? '', block = lesson.blocks.find(block => block.id === blockID);
            uniqueStrings(selectedOptionIDs, 20, id => { if (typeof id !== 'string' || !identifier.test(id)) fail('INVALID_COURSE_PROGRESS'); }); string(text, answerTextLimit(block), false);
            const answer = { lessonID, blockID, selectedOptionIDs, text, updatedAt: new Date(now()).toISOString() };
            if (!answerValid(answer, block)) fail('INVALID_COURSE_ANSWER');
            state.answers = [...state.answers.filter(answer => answer.lessonID !== lessonID || answer.blockID !== blockID), answer];
          }
          if (value.completed === true && !lesson.blocks.filter(block => block.type === 'question').every(block => state.answers.some(answer => answer.lessonID === lessonID && answer.blockID === block.id))) fail('COURSE_ANSWERS_REQUIRED', 409);
          if (value.completed !== undefined) state.completedLessonIDs = [...state.completedLessonIDs.filter(id => id !== lessonID), ...(value.completed ? [lessonID] : [])];
          if (db.prepare('SELECT COUNT(*) AS n FROM course_progress_mutations WHERE user_id=? AND owner_id=? AND course_id=?').get(actor, ownerID, id).n >= 20000) fail('COURSE_PROGRESS_LIMIT');
          const serialized = JSON.stringify(state); if (Buffer.byteLength(serialized) > 2 * limit) fail('COURSE_PROGRESS_TOO_LARGE');
          db.prepare('INSERT INTO course_progress VALUES(?,?,?,?) ON CONFLICT(user_id,owner_id,course_id) DO UPDATE SET state=excluded.state').run(actor, ownerID, id, serialized);
          db.prepare('INSERT INTO course_progress_mutations VALUES(?,?,?,?,?,?)').run(actor, ownerID, id, mutation, digest, '{}'); return state;
        });
        respond(response, 200, { data: result }); return true;
      }
    }
    fail('NOT_FOUND', 404);
  };
}
