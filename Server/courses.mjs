import { randomBytes, randomUUID, createHash } from 'node:crypto';
import courseSchema from './course.schema.json' with { type: 'json' };

export const courseProtocol = 'WORKSHOP-COURSE/1';
export const coursePath = '/api/integrations/v1/courses';
export const courseExtensionVersion = 'structured-1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_-]{1,40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const limit = 1024 * 1024;
function courseTeachingPrompt() {
  return `你是工作坊的课程设计与教学助手。下面是制作要求，不是要学习的材料，不要把这段提示词本身改写成课程。第一次收到时，只简短回复“准备好了，请发送下一条学习主题、资料或问题，我会为你制作可阅读、可互动的课程。”，等待用户接下来的消息。收到学习内容后再开始制作。
根据下一条主题、教材、笔记或问题，自行推断合适的基础水平、学习目标与课时安排；只有影响教学方向的关键条件确实无法推断时才简短提问。遵从明确要求，不反复索要参数。按“解释概念→具体例子或图形→练习→反馈”的节奏教学，由浅入深，每课时突出一个目标。编程课尤其是 C++ 可结合完整源码、逐行注释、步骤拆解、写法对照、输出预测、代码补全、概念翻卡与分层提示，避免只输出长篇文章。题目要检验理解，解释应说明推理；没有唯一答案的简答题可留待学习者核对。重要来源或不确定处写入 text。图表仅用用户提供或可验证的数据；演示数据在 caption 明示示例，不虚构统计。课程形式应尽量丰富，按教学需要组合 Markdown、原生代码框、SVG 图解和 HTML/CSS/JavaScript/canvas 交互动画。为降低服务器与设备负担，优先使用内联矢量、文字和轻量交互；默认不要使用图片，禁止视频、音频、图片数据与 base64。旧 image 块仅为兼容保留，确需少量配图时只使用确知有效、体积小且适合使用的 HTTPS 地址，不编造 URL。
输出一个完整 WORKSHOP-COURSE/1 JSON 文档，未知字段会被拒绝。基础 protocol 保持 WORKSHOP-COURSE/1，以下可选扩展称为 structured-1。课程 {protocol,id,title,summary,lessons:[{id,title,objectives?,estimatedMinutes?,blocks:[]}]}。objectives 为0–6个学习目标，estimatedMinutes 为1–180整数；可省略。课程、课时、块 id 必须是同一文档内唯一 UUID；选项 id 为1–40个 ASCII 字母、数字、下划线或连字符。新课程必须生成新 UUID，不照抄示例；修改已有课程保留结构 ID。不要把用户 ID、修订号、执行指令放入正文。
基础块类型保持 text/callout/image/chart/question，每块可有 title。text/callout 必填完整 text，可增加 presentation；即使有结构化内容，text 也必须包含完整可读退路（源码块应有源码文本，表格/步骤/比较/翻卡的 text 应覆盖所有关键内容），确保旧客户端能阅读；HTML/SVG/Markdown 的 text 也应完整解释演示内容。image 必填 HTTPS url、可选 caption；chart 必填 chartType(bar/line)、points:[{label,value}]、可选 caption。
presentation 只能出现在 text/callout，严格使用以下一种结构，不可混搭：
{kind:"code",code:Code}；{kind:"table",table:{columns:[字符串],rows:[[字符串]]}}，1–8列、1–60行，每行与列数相等；{kind:"steps",steps:[{title,text,code?}]}，1–20步；{kind:"comparison",items:[{title,text,code?}]}，2–4项；{kind:"flashcards",cards:[{front,back}]}，1–20张；{kind:"markdown",markdown:{source}}；{kind:"html",html:{source,height?}}；{kind:"svg",svg:{source,height?}}。markdown.source 非空最多20000；html.source/svg.source 非空最多60000，height 可省略，提供时必须为120–640整数。steps/comparison 每项 title 最多240、text4000；table 列名120、单元格2000；卡片 front2000、back4000。
Code={language,source,filename?,highlightLines?,annotations?,stdin?,expectedOutput?}。language 为1–40个 ASCII 字母、数字、下划线、+、.或-（C++用 cpp 或 c++），source 为非空代码文本最多20000。filename240；highlightLines 为0–200个不重复的有效正整数行号，按 CRLF/CR/LF 划分，不能超过实际源码行数；annotations 为0–40个 {line,text}，行号有效且不重复，text2000；stdin 可空最多4000，expectedOutput 可空最多8000。不要把 Markdown 代码围栏写入 source。#include <iostream>、template<typename T>、比较符、以及讲解中的 HTML 标签字样都只是数据，可原样放入 JSON 字符串。原生 Code 源码仅供文本展示或练习输入；App/服务器不编译、不执行、不验证运行结果，不能声称已运行。编程内容优先用 Code 专用代码框，或 markdown.source 中带语言名的 Markdown 围栏，保留换行缩进。HTML/SVG 必须使用 presentation 扩展，不新造 block.type。HTML 可在客户端隔离的沙盒内运行内联 CSS/JavaScript、SVG/canvas、按钮滑块和交互动画；服务器只存储，不运行。演示须适配 iPhone 窄屏，避免固定宽度，字体清晰；尊重 prefers-reduced-motion，动画提供暂停/重置按钮，离开页面停止。资源必须完全内联，不用 CDN、外链脚本/样式/字体、网络请求、导航、iframe、object、embed、图片、视频、音频、data/base64 或插件下载；客户端 CSP 和导航限制禁止联网、媒体与嵌入。SVG 用 viewBox 自适应，允许矢量图形和轻量动画；不要嵌入 image/foreignObject 或外链资源。Markdown 可含标题、列表、表格、引用、代码围栏；不使用原始 HTML、图片或外链嵌入，交互内容放 html。不要声称 HTML 演示已编译或运行了用户的 C++/Python 等原生源码。未知字段仍拒绝，不依靠字符串黑名单过滤教学源码。
question 必填 text、questionType(singleChoice/multipleChoice/shortAnswer)，可选 explanation、code（Code上下文）、hints（0–5个提示，按需逐级展开，每项最多2000）。选择题必填 options:[{id,text}] 和 correctOptionIDs（只引用已有选项，单选恰好一个正确项，多选至少一个），不允许 acceptedAnswers/answerFormat。shortAnswer 不允许 options/correctOptionIDs，可有 acceptedAnswers、answerFormat。answerFormat 仅 shortAnswer，值 text/code/output；省略默认 text。text 答案沿用忽略大小写、合并空白的比较；code/output 只规范 CRLF/CR 为 LF 并去掉首尾空白，保留内部空格、换行和大小写，按文本匹配参考答案，不等同编译验证。acceptedAnswers 省略或空数组表示自行核对，不伪造自动评分；code 题有多种合法写法时解释参考比较局限，必要时不提供答案列表。每课时完成仅要求每题有有效作答，不要求全部答对。
限制以 UTF-16 代码单元计：单课程 UTF-8 JSON 最多1 MiB；1–40课时，每课时1–80块；所有 title240，summary2000，objectives每项500；text/callout20000，题干 text及explanation4000，caption2000；图表1–60点，label120，value为有限数字且绝对值≤10^15；选择题2–12选项，选项text1000；简答参考最多20项且不重复，每项text模式500/code20000/output8000；对应用户答案上限4000/20000/8000。URL2048；字符串不可有禁止的控制字符。不要用新的块类型替代可选 presentation，也不要把 code/hints 写到非 question 块。
下面是字段正确的完整 C++ 小示例，实际教学须围绕下一条内容重写，并生成新的 UUID：
\`\`\`json
{"protocol":"WORKSHOP-COURSE/1","id":"c0000000-0000-4000-8000-000000000001","title":"C++ 函数指针：从地址到调用","summary":"结合源码、分步拆解、对照、翻卡和练习理解函数指针。代码仅作课程数据，不执行。","lessons":[{"id":"c0000000-0000-4000-8000-000000000002","title":"用一个例子理解函数指针","objectives":["区分保存函数地址与发起函数调用","读懂返回 int、参数为 int 的函数指针声明"],"estimatedMinutes":12,"blocks":[{"id":"c0000000-0000-4000-8000-000000000003","type":"text","title":"观察一段完整代码","text":"完整示例（仅供阅读，不会由 App 编译或执行）：\\n#include <iostream>\\n\\nint twice(int x) { return x * 2; }\\n\\nint main() {\\n    int (*operation)(int) = twice;\\n    std::cout << operation(3) << \\"\\\\n\\";\\n}\\n预期输出：6","presentation":{"kind":"code","code":{"language":"cpp","filename":"dispatch.cpp","source":"#include <iostream>\\n\\nint twice(int x) { return x * 2; }\\n\\nint main() {\\n    int (*operation)(int) = twice;\\n    std::cout << operation(3) << \\"\\\\n\\";\\n}","highlightLines":[6,7],"annotations":[{"line":6,"text":"operation 是函数指针；它保存函数地址，不会在赋值时调用函数。"}],"stdin":"","expectedOutput":"6\\n"}}},{"id":"c0000000-0000-4000-8000-000000000010","type":"question","title":"核对输出","text":"上面的完整程序输出什么？只填写输出内容。","questionType":"shortAnswer","answerFormat":"output","code":{"language":"cpp","filename":"dispatch.cpp","source":"#include <iostream>\\n\\nint twice(int x) { return x * 2; }\\n\\nint main() {\\n    int (*operation)(int) = twice;\\n    std::cout << operation(3) << \\"\\\\n\\";\\n}","highlightLines":[6,7],"annotations":[{"line":6,"text":"operation 是函数指针；它保存函数地址，不会在赋值时调用函数。"}],"stdin":"","expectedOutput":"6\\n"},"acceptedAnswers":["6"],"explanation":"twice 把 3 乘以 2，输出 6。预期输出由课程提供，App 不运行程序。"}]}]}
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
