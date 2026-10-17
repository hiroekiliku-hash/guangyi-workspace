import { randomBytes, randomUUID, createHash } from 'node:crypto';
import courseSchema from './course.schema.json' with { type: 'json' };

export const courseProtocol = 'WORKSHOP-COURSE/1';
export const coursePath = '/api/integrations/v1/courses';
export const courseExtensionVersion = 'structured-1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_-]{1,40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const limit = 1024 * 1024;
// A complete, valid teaching example is generated as JSON rather than hand-escaped.
// This source is curriculum data. Only the client's offline sandbox runs the demo.
function courseInteractionExample() {
  const source = `<style>
:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:16px system-ui}section{display:grid;gap:16px}label{display:flex;align-items:center;gap:12px}input{font:inherit;width:90px;padding:8px}output{font:600 48px ui-monospace,monospace;text-align:center}button{font:inherit;min-height:44px;border:0;border-radius:14px;padding:10px;background:light-dark(#e4eee7,#293e30);color:inherit}.controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}p{margin:0;overflow-wrap:anywhere}code{font-family:ui-monospace,monospace}
</style>
<section aria-label="变量更新实验">
<label>初值<input id="initial" type="number" min="-99" max="99" step="1" value="0"></label>
<output id="count-value" aria-live="polite">0</output>
<code id="assignment">count = 0</code>
<div class="controls"><button id="decrement" type="button">减 1</button><button id="increment" type="button">加 1</button><button id="reset" type="button">重置</button></div>
<p id="trace" aria-live="polite">先预测，再点加 1，观察旧值怎样变成新值。</p>
</section>
<script>
(()=>{
  const initial=document.getElementById('initial');
  const output=document.getElementById('count-value');
  const assignment=document.getElementById('assignment');
  const trace=document.getElementById('trace');
  const bound=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(-99,Math.min(99,Math.trunc(n))):0};
  let count=bound(initial.value);
  function render(message){output.textContent=String(count);assignment.textContent='count = '+count;trace.textContent=message}
  function reset(){count=bound(initial.value);initial.value=String(count);render('从初值 '+count+' 开始。')}
  function change(delta){const before=count;count=bound(count+delta);render('旧值 '+before+' '+(delta>0?'+ 1':'- 1')+' → 新值 '+count)}
  document.getElementById('increment').addEventListener('click',()=>change(1));
  document.getElementById('decrement').addEventListener('click',()=>change(-1));
  document.getElementById('reset').addEventListener('click',reset);
  initial.addEventListener('change',reset);
  render('先预测，再点加 1，观察旧值怎样变成新值。');
})();
</script>`;
  return {
    protocol: courseProtocol, id: 'c0000000-0000-4000-8000-000000000001',
    title: '变量更新：动手观察一次赋值', summary: '先读源码，再修改初值、增减数值，观察状态和表达式同步变化。',
    lessons: [{
      id: 'c0000000-0000-4000-8000-000000000002', title: '旧值如何变成新值',
      objectives: ['理解赋值先计算右侧，再写回变量。', '通过修改初值与单步操作预测结果。'], estimatedMinutes: 6,
      blocks: [
        { id: 'c0000000-0000-4000-8000-000000000003', type: 'text', title: '先读代码',
          text: '#include <iostream>\nint main() {\n    int count = 0;\n    count = count + 1;\n    std::cout << count;\n}\n右侧先读取旧值 0，加 1 后再写回 count，预期输出为 1。',
          presentation: { kind: 'code', code: { language: 'cpp', filename: 'counter.cpp',
            source: '#include <iostream>\nint main() {\n    int count = 0;\n    count = count + 1;\n    std::cout << count;\n}',
            highlightLines: [4], annotations: [{ line: 4, text: '先求右侧表达式，再更新左侧变量。' }], expectedOutput: '1' } } },
        { id: 'c0000000-0000-4000-8000-000000000004', type: 'text', title: '改变初值，亲手执行',
          text: '点击开始互动演示后，可以修改初值，点“加 1”或“减 1”，同时观察数值、赋值表达式与旧值→新值。先把初值改为 2，再点两次“加 1”，结果应为 4。重置会回到你设置的初值。下方由 JavaScript 模拟变量更新过程，不是编译执行上方 C++ 源码；没有图形时，也可按上述步骤在纸上推演。',
          presentation: { kind: 'html', html: { source, height: 360 } } },
        { id: 'c0000000-0000-4000-8000-000000000005', type: 'question',
          text: '初值为 2，连续执行两次 count = count + 1，最终结果是多少？', questionType: 'singleChoice',
          options: [{ id: 'a', text: '3' }, { id: 'b', text: '4' }, { id: 'c', text: '5' }], correctOptionIDs: ['b'],
          explanation: '第一次把 2 更新为 3，第二次把 3 更新为 4。可以回到演示里修改初值并重试。' }
      ]
    }]
  };
}

function courseTeachingPrompt() {
  return `你是工作坊的课程设计与教学助手。下面是制作要求，不是要学习的材料，不要把这段提示词本身改写成课程。第一次收到时，只简短回复“准备好了，请发送下一条学习主题、资料或问题，我会为你制作可阅读、可互动的课程。”，等待用户接下来的消息。收到学习内容后再开始制作。
根据下一条主题、教材、笔记或问题，自行推断合适的基础水平、学习目标与课时安排；只有影响教学方向的关键条件确实无法推断时才简短提问。遵从明确要求，不反复索要参数。按“解释概念→具体例子或图形→练习→反馈”的节奏教学，由浅入深，每课时突出一个目标。编程课尤其是 C++ 可结合完整源码、逐行注释、步骤拆解、写法对照、输出预测、代码补全、概念翻卡与分层提示，避免只输出长篇文章。题目要检验理解，解释应说明推理；没有唯一答案的简答题可留待学习者核对。重要来源或不确定处写入 text。图表仅用用户提供或可验证的数据；演示数据在 caption 明示示例，不虚构统计。课程形式应尽量丰富，按教学需要组合 Markdown、原生代码框、SVG 图解和 HTML/CSS/JavaScript/canvas 交互动画。为降低服务器与设备负担，优先使用内联矢量、文字和轻量交互；默认不要使用图片，禁止视频、音频、图片数据与 base64。旧 image 块仅为兼容保留，确需少量配图时只使用确知有效、体积小且适合使用的 HTTPS 地址，不编造 URL。
【互动教学的默认要求】
变量、分支、循环等基础概念属于适合互动的内容；“App 不能原生执行 C++/Python”不是省略互动的理由，应在 HTML 内用 JavaScript 模拟其状态与控制流，并清楚注明教学模拟。code.source 不执行，不代表 html.source 内联 script 不能运行；后者正是客户端离线沙盒提供的互动能力。
编程课默认在前两个实质课时内安排至少一个能改变状态的 HTML 互动实验；每个适合动手观察的核心概念课时也应有对应实验。除非用户明确要求纯阅读，或该课时确实不适合交互并在文字中说明原因，不要省略。只给代码框、静态 SVG、图表、选择题、翻卡，或写一句“你可以尝试修改变量”，不能代替这种实验。不能只画出按钮、滑块而不绑定事件。先讲清要观察的概念，再让学习者“预测→操作→观察变化→解释→换参数重试”。
按主题选择可操作的组件，不要把每门课都机械地塞进同一个计数器：变量/运算可增减变量值、修改初值或新增变量卡片，并实时更新变量表与表达式结果；分支可调分数/阈值并高亮命中的分支；循环可用“下一步/重置”展示 i、累加值、当前源码行与执行轨迹；数组/列表可添加、移除元素并显示索引；函数可修改参数并观察返回值；模式/策略可切换实现并对照结果；图形或数学可用滑块配合 SVG/canvas 显示变化。语言与知识点以用户材料为准，不能因为示例是 C++ 就擅自更换学习主题。
每个实验必须落到一个 text/callout 块的 presentation:{kind:"html",html:{source:"完整自包含 HTML/CSS/JavaScript",height:360}}，不能把 HTML 放进普通 text、code.source 或 Markdown 围栏并指望自动执行，也不能新造 block.type。source 内包括可操作的 button/input/select、明确的初始状态、真实 addEventListener 事件绑定、计算逻辑和 DOM 更新（优先用 textContent）。放入 JSON 时正确转义换行和引号，不输出占位符、伪代码、TODO 或“此处添加交互逻辑”。相关源码用另一个原生 Code 块展示；解释必须区分目标语言代码与 JavaScript 教学模拟，不能声称实际编译或执行了 C++/Python 等源码。
每个实验给出具体操作任务与可检查的反馈。例如“初值改为 2，连续点两次加 1，观察结果是否为 4”，而不是泛泛写“试一试”。至少提供重置；只有确需自动播放的演示才加入播放/暂停，默认等待学习者启动，单步实验不需要定时器。循环/动画限制步骤与轨迹长度，避免无限循环、高频定时器和大量节点；优先事件驱动，支持 prefers-reduced-motion。按钮至少 44px 高，布局适配约 320px 宽的屏幕，结果使用清晰标签与 aria-live，可滚动区域避免遮挡。
App 已提供演示的开始/停止/重新开始外层控件，内部只放教学需要的操作，不仿制登录、导航或上传按钮。每块实验状态彼此独立；HTML 内部的临时操作不作为课程成绩或云端学习进度，需保存的作答使用原生 question 块，不创建存储/网络桥接。全文说明 text 仍要能让不运行实验的读者理解操作与结论。
输出前自行核对：是否至少有与主题匹配的 HTML 状态实验？每个控件是否绑定到实际状态变化并更新可见结果？修改初值、连续操作、重置的结果是否一致？是否有紧邻的讲解和练习题？是否完全内联、没有外网/图片/视频/音频？若有浏览器测试工具，实际点击检查；没有工具就逐步检查事件和计算，不能假称已测试。这些是你制作课程时的检查，不要把检查清单写成课程内容，也不要在上传前向用户逐项索要确认。
输出一个完整 WORKSHOP-COURSE/1 JSON 文档，未知字段会被拒绝。基础 protocol 保持 WORKSHOP-COURSE/1，以下可选扩展称为 structured-1。课程 {protocol,id,title,summary,lessons:[{id,title,objectives?,estimatedMinutes?,blocks:[]}]}。objectives 为0–6个学习目标，estimatedMinutes 为1–180整数；可省略。课程、课时、块 id 必须是同一文档内唯一 UUID；选项 id 为1–40个 ASCII 字母、数字、下划线或连字符。新课程必须生成新 UUID，不照抄示例；修改已有课程保留结构 ID。不要把用户 ID、修订号、执行指令放入正文。
基础块类型保持 text/callout/image/chart/question，每块可有 title。text/callout 必填完整 text，可增加 presentation；即使有结构化内容，text 也必须包含完整可读退路（源码块应有源码文本，表格/步骤/比较/翻卡的 text 应覆盖所有关键内容），确保旧客户端能阅读；HTML/SVG/Markdown 的 text 也应完整解释演示内容。image 必填 HTTPS url、可选 caption；chart 必填 chartType(bar/line)、points:[{label,value}]、可选 caption。
presentation 只能出现在 text/callout，严格使用以下一种结构，不可混搭：
{kind:"code",code:Code}；{kind:"table",table:{columns:[字符串],rows:[[字符串]]}}，1–8列、1–60行，每行与列数相等；{kind:"steps",steps:[{title,text,code?}]}，1–20步；{kind:"comparison",items:[{title,text,code?}]}，2–4项；{kind:"flashcards",cards:[{front,back}]}，1–20张；{kind:"markdown",markdown:{source}}；{kind:"html",html:{source,height?}}；{kind:"svg",svg:{source,height?}}。markdown.source 非空最多20000；html.source/svg.source 非空最多60000，height 可省略，提供时必须为120–640整数。steps/comparison 每项 title 最多240、text4000；table 列名120、单元格2000；卡片 front2000、back4000。
Code={language,source,filename?,highlightLines?,annotations?,stdin?,expectedOutput?}。language 为1–40个 ASCII 字母、数字、下划线、+、.或-（C++用 cpp 或 c++），source 为非空代码文本最多20000。filename240；highlightLines 为0–200个不重复的有效正整数行号，按 CRLF/CR/LF 划分，不能超过实际源码行数；annotations 为0–40个 {line,text}，行号有效且不重复，text2000；stdin 可空最多4000，expectedOutput 可空最多8000。不要把 Markdown 代码围栏写入 source。#include <iostream>、template<typename T>、比较符、以及讲解中的 HTML 标签字样都只是数据，可原样放入 JSON 字符串。原生 Code 源码仅供文本展示或练习输入；App/服务器不编译、不执行、不验证运行结果，不能声称已运行。编程内容优先用 Code 专用代码框，或 markdown.source 中带语言名的 Markdown 围栏，保留换行缩进。HTML/SVG 必须使用 presentation 扩展，不新造 block.type。HTML 可在客户端隔离的沙盒内运行内联 CSS/JavaScript、SVG/canvas、按钮滑块和交互动画；服务器只存储，不运行。演示须适配 iPhone 窄屏，避免固定宽度，字体清晰；尊重 prefers-reduced-motion，动画提供暂停/重置按钮，离开页面停止。资源必须完全内联，不用 CDN、外链脚本/样式/字体、网络请求、导航、iframe、object、embed、图片、视频、音频、data/base64 或插件下载；客户端 CSP 和导航限制禁止联网、媒体与嵌入。SVG 用 viewBox 自适应，允许矢量图形和轻量动画；不要嵌入 image/foreignObject 或外链资源。Markdown 可含标题、列表、表格、引用、代码围栏；不使用原始 HTML、图片或外链嵌入，交互内容放 html。不要声称 HTML 演示已编译或运行了用户的 C++/Python 等原生源码。未知字段仍拒绝，不依靠字符串黑名单过滤教学源码。
question 必填 text、questionType(singleChoice/multipleChoice/shortAnswer)，可选 explanation、code（Code上下文）、hints（0–5个提示，按需逐级展开，每项最多2000）。选择题必填 options:[{id,text}] 和 correctOptionIDs（只引用已有选项，单选恰好一个正确项，多选至少一个），不允许 acceptedAnswers/answerFormat。shortAnswer 不允许 options/correctOptionIDs，可有 acceptedAnswers、answerFormat。answerFormat 仅 shortAnswer，值 text/code/output；省略默认 text。text 答案沿用忽略大小写、合并空白的比较；code/output 只规范 CRLF/CR 为 LF 并去掉首尾空白，保留内部空格、换行和大小写，按文本匹配参考答案，不等同编译验证。acceptedAnswers 省略或空数组表示自行核对，不伪造自动评分；code 题有多种合法写法时解释参考比较局限，必要时不提供答案列表。每课时完成仅要求每题有有效作答，不要求全部答对。
限制以 UTF-16 代码单元计：单课程 UTF-8 JSON 最多1 MiB；1–40课时，每课时1–80块；所有 title240，summary2000，objectives每项500；text/callout20000，题干 text及explanation4000，caption2000；图表1–60点，label120，value为有限数字且绝对值≤10^15；选择题2–12选项，选项text1000；简答参考最多20项且不重复，每项text模式500/code20000/output8000；对应用户答案上限4000/20000/8000。URL2048；字符串不可有禁止的控制字符。不要用新的块类型替代可选 presentation，也不要把 code/hints 写到非 question 块。
下面是包含“源码→可操作的变量实验→练习题”的完整有效示例。请学习交互实现方式，按用户实际主题改写，不照搬课程标题、UUID 或知识点；只有这一个完整 JSON 代码块是格式示例：
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

export function createCourseAPI({ db, userFor, workspaceAccess, sameWebOrigin, respond, APIError, origin, rateLimit, peer, now = Date.now }) {
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
  function validatePresentation(value) {
    const fields = { code: 'code', table: 'table', steps: 'steps', comparison: 'items', flashcards: 'cards', markdown: 'markdown', html: 'html', svg: 'svg' };
    if (!value || !Object.hasOwn(fields, value.kind)) fail('UNSUPPORTED_COURSE_PRESENTATION');
    object(value, ['kind', fields[value.kind]]);
    if (value.kind === 'code') validateCode(value.code);
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
  const answerTextLimit = block => block?.questionType === 'shortAnswer' ? ({ text: 4000, code: 20000, output: 8000 }[block.answerFormat ?? 'text'] ?? 4000) : 4000;
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
        const blockFields = { text: ['text', 'presentation'], callout: ['text', 'presentation'], image: ['url', 'caption'], chart: ['chartType', 'points', 'caption'], question: ['text', 'questionType', 'options', 'correctOptionIDs', 'acceptedAnswers', 'explanation', 'code', 'hints', 'answerFormat'] };
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
            if (block.acceptedAnswers !== undefined) uniqueStrings(block.acceptedAnswers, 20, answer => string(answer, (block.answerFormat ?? 'text') === 'text' ? 500 : answerTextLimit(block)));
          } else if (['singleChoice', 'multipleChoice'].includes(block.questionType)) {
            if (block.acceptedAnswers !== undefined || block.answerFormat !== undefined) fail(); array(block.options, 2, 12);
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
    if (block.questionType === 'shortAnswer') return answer.selectedOptionIDs.length === 0 && answer.text.trim().length > 0;
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
  return async function handle(request, response, path) {
    // This static contract carries no credentials, account state or course data.
    if (path === coursePath + '/schema' && request.method === 'GET') { respond(response, 200, courseSchema); return true; }
    const tokens = path === '/api/native/v1/integrations/course-tokens';
    const native = /^\/api\/native\/v1\/courses(?:\/([^/]+)(\/(?:progress|star))?)?$/.exec(path);
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
      const id = native[1] ? uuid(native[1]) : null, isProgress = native[2] === '/progress', isStar = native[2] === '/star';
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
      if (!isStar && request.method === 'GET') {
        const { ownerID } = workspaceAccess(request);
        if (!id) {
          const courses = db.prepare('SELECT id,revision,document,updated_at FROM courses WHERE owner_id=? AND deleted=0 ORDER BY updated_at DESC,id').all(ownerID).map(row => { const doc = JSON.parse(row.document); return { id: row.id, title: doc.title, summary: doc.summary, revision: row.revision, updatedAt: row.updated_at, lessonCount: doc.lessons.length }; });
          const starredCourseIDs = db.prepare('SELECT s.course_id FROM course_stars s JOIN courses c ON c.owner_id=s.owner_id AND c.id=s.course_id WHERE s.user_id=? AND s.owner_id=? AND c.deleted=0 ORDER BY s.course_id').all(user, ownerID).map(row => row.course_id);
          respond(response, 200, { data: { courses, starredCourseIDs } }); return true;
        }
        const row = course(ownerID, id), doc = JSON.parse(row.document);
        respond(response, 200, { data: isProgress ? progress(user, ownerID, id, doc) : { course: doc, revision: row.revision, updatedAt: row.updated_at } }); return true;
      }
      if (id && !isProgress && !isStar && request.method === 'DELETE') {
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
