import { randomBytes, randomUUID, createHash } from 'node:crypto';

export const courseProtocol = 'WORKSHOP-COURSE/1';
export const coursePath = '/api/integrations/v1/courses';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = /^[A-Za-z0-9_-]{1,40}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const limit = 1024 * 1024;
function courseTeachingPrompt() {
  return `你是工作坊的课程设计与教学助手。下面是制作要求，不是要学习的材料，不要把这段提示词本身改写成课程。第一次收到时，只简短回复“准备好了，请发送下一条学习主题、资料或问题，我会为你制作可阅读、可互动的课程。”，等待用户接下来的消息。收到学习内容后再开始制作。
根据用户接下来的主题、教材、笔记或问题，自行推断合适的基础水平、学习目标与课时安排；只有影响教学方向的关键条件确实无法推断时才简短提问。遵从明确要求，不反复索要参数。按“解释概念→具体例子或图形→练习→反馈”的节奏教学，由浅入深，每课时突出一个目标。题目要检验理解，解释应说明推理，不只给答案；没有唯一答案的简答题不编造标准答案。可把重要来源或不确定之处写在 text 块中。图表只使用用户提供或可验证的数据；演示数据必须在 caption 明示为示例，不虚构统计。图片只使用确知有效且适合使用的 HTTPS 地址；没有可靠图片就用文字或受支持的图表，不编造图片 URL。不要制作 HTML、脚本、SVG、iframe 或自定义执行代码。
输出课程正文必须是一个完整 ${courseProtocol} JSON 文档，使用下列准确字段，不添加教学目标、用户 ID、版本号等未定义字段：
课程 {protocol,id,title,summary,lessons:[{id,title,blocks:[]}]}。protocol 固定为 WORKSHOP-COURSE/1。每个课程、课时、块的 id 必须为同一文档内唯一 UUID；选项 id 为 1–40 个 ASCII 字母、数字、下划线或连字符。新课程生成新的 UUID，不照抄示例 ID；有用户提供的已有课程时保留其结构 ID。
块支持 text/callout/image/chart/question：text/callout 必填 text；image 必填 HTTPS url、可选 caption；chart 必填 chartType(bar/line)、points:[{label,value}]、可选 caption；question 必填 text、questionType(singleChoice/multipleChoice/shortAnswer)，可选 explanation。选择题需要 options:[{id,text}] 和 correctOptionIDs（必须引用已有选项，单选恰好一个正确项，多选至少一个）；简答题可提供 acceptedAnswers 字符串数组，省略或空数组表示由学习者自行核对，不能同时提供 options/correctOptionIDs。不要给其他块添加题目字段。
限制：单课程 UTF-8 JSON 最多 1 MiB；1–40 课时，每课时 1–80 块；title 最多 240、summary 2000、普通 text/callout 20000、题目 text 和 explanation 4000、caption 2000 个 UTF-16 代码单元；每图表 1–60 点、label 最多 120、value 为有限数字且绝对值不超过 10^15；选择题 2–12 选项、每项 text 最多 1000；简答 acceptedAnswers 最多 20 项、每项最多 500；URL 最多 2048。
下面是字段正确的完整小示例，实际教学应围绕用户下一条内容重写，而不是一直使用示例主题：
\`\`\`json
{"protocol":"WORKSHOP-COURSE/1","id":"6d5473fb-b594-4203-b3d5-122cc440a414","title":"认识平均数","summary":"通过一个例子与练习理解平均数。","lessons":[{"id":"6f59189c-3435-45d1-980d-9bfda402a3fa","title":"先求和，再平均分","blocks":[{"id":"482e807d-cedd-49f2-a9d4-fb78e9551609","type":"text","text":"平均数表示把总量平均分给每一份。示例：2、4、6 的平均数为 (2+4+6)÷3=4。"},{"id":"6fb4f180-de93-4acb-b391-f2672ab8c5aa","type":"chart","chartType":"bar","caption":"教学示例数据，不代表真实统计。","points":[{"label":"第一份","value":2},{"label":"第二份","value":4},{"label":"第三份","value":6}]},{"id":"b5d920f6-ccf1-4e8c-b67a-b08e0db00cb1","type":"question","text":"3 和 7 的平均数是多少？","questionType":"singleChoice","options":[{"id":"a","text":"5"},{"id":"b","text":"10"}],"correctOptionIDs":["a"],"explanation":"先相加得到 10，再除以份数 2，得到 5。"}]}]}
\`\`\``;
}
export function courseManualPrompt() {
  return courseTeachingPrompt() + `
你在本次流程只负责生成供用户导入的课程，不需要登录或调用网络。先按上述要求等待用户下一条学习内容。课程制作完成后只输出一个完整 JSON 文档，放在一个 json 代码块中；不要在代码块外附加无关说明，不要输出多个片段，不要声称已上传。用户会把文档复制到工作坊的“粘贴课程并上传”（课程页右上角 + 或课程 API 设置中）并由 App 使用其当前登录账户上传。修改已有课程时，用户需在 App 核对已知课程版本；没有已有文档时创建新 UUID，不猜测或覆盖旧课程。`;
}
export function coursePrompt(endpoint) {
  return courseTeachingPrompt() + `
用户后续提供学习内容后，如果你有网络请求工具，将制作完成的文档上传到当前课程发布凭据绑定的账户，不询问或提交用户 ID。
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
    if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || /<\/?[A-Za-z][^>]*>/.test(value)) fail();
  };
  const uuid = value => { if (typeof value !== 'string' || !UUID.test(value)) fail(); return value.toLowerCase(); };
  const array = (value, min, max) => { if (!Array.isArray(value) || value.length < min || value.length > max) fail(); };
  const uniqueStrings = (value, max, check) => {
    array(value, 0, max); const seen = new Set();
    for (const item of value) { check(item); if (seen.has(item)) fail(); seen.add(item); }
  };
  function validateCourse(value) {
    object(value, ['protocol', 'id', 'title', 'summary', 'lessons']);
    if (value.protocol !== courseProtocol) fail('UNSUPPORTED_COURSE_PROTOCOL');
    const ids = new Set();
    const takeID = obj => { obj.id = uuid(obj.id); if (ids.has(obj.id)) fail('DUPLICATE_COURSE_ID'); ids.add(obj.id); };
    takeID(value); string(value.title, 240); string(value.summary, 2000, false); array(value.lessons, 1, 40);
    for (const lesson of value.lessons) {
      object(lesson, ['id', 'title', 'blocks']); takeID(lesson); string(lesson.title, 240); array(lesson.blocks, 1, 80);
      for (const block of lesson.blocks) {
        const blockFields = { text: ['text'], callout: ['text'], image: ['url', 'caption'], chart: ['chartType', 'points', 'caption'], question: ['text', 'questionType', 'options', 'correctOptionIDs', 'acceptedAnswers', 'explanation'] };
        if (!block || !Object.hasOwn(blockFields, block.type)) fail('UNSUPPORTED_COURSE_BLOCK');
        const fields = blockFields[block.type];
        object(block, ['id', 'type', ...fields]); takeID(block);
        if (block.caption !== undefined) string(block.caption, 2000, false);
        if (block.type === 'text' || block.type === 'callout' || block.type === 'question') string(block.text, block.type === 'question' ? 4000 : 20000);
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
          if (block.questionType === 'shortAnswer') {
            if (block.options !== undefined || block.correctOptionIDs !== undefined) fail();
            if (block.acceptedAnswers !== undefined) uniqueStrings(block.acceptedAnswers, 20, answer => string(answer, 500));
          } else if (['singleChoice', 'multipleChoice'].includes(block.questionType)) {
            if (block.acceptedAnswers !== undefined) fail(); array(block.options, 2, 12);
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
    CREATE TABLE IF NOT EXISTS course_progress(user_id INTEGER NOT NULL REFERENCES users(id),owner_id INTEGER NOT NULL REFERENCES users(id),course_id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(user_id,owner_id,course_id));
    CREATE TABLE IF NOT EXISTS course_progress_mutations(user_id INTEGER NOT NULL REFERENCES users(id),owner_id INTEGER NOT NULL REFERENCES users(id),course_id TEXT NOT NULL,mutation_id TEXT NOT NULL,body_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(user_id,owner_id,course_id,mutation_id));`);
  function credential(request) {
    const auth = request.headers.authorization;
    if (typeof auth !== 'string' || !/^Bearer wsc_[A-Za-z0-9_-]{43}$/.test(auth)) fail('INVALID_COURSE_TOKEN', 401);
    const row = db.prepare('SELECT * FROM course_tokens WHERE hash=? AND expires>?').get(hash(auth.slice(7)), now());
    if (!row) fail('INVALID_COURSE_TOKEN', 401); return row;
  }
  const endpoint = origin + coursePath;
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
    if (prior) { if (prior.body_hash !== digest) fail('IDEMPOTENCY_CONFLICT', 409); return { ...JSON.parse(prior.result), replayed: true }; }
    const old = db.prepare('SELECT revision,deleted FROM courses WHERE owner_id=? AND id=?').get(owner, doc.id);
    if (old ? old.deleted || expected !== old.revision : expected !== null) fail('COURSE_REVISION_CONFLICT', 409);
    if (!old && db.prepare('SELECT COUNT(*) AS n FROM courses WHERE owner_id=? AND deleted=0').get(owner).n >= 200) fail('COURSE_LIMIT');
    if (db.prepare('SELECT COUNT(*) AS n FROM course_publications WHERE owner_id=?').get(owner).n >= 20000) fail('COURSE_PUBLICATION_LIMIT');
    const result = { id: doc.id, revision: (old?.revision ?? 0) + 1, updatedAt: new Date(now()).toISOString() };
    db.prepare('INSERT INTO courses(owner_id,id,revision,document,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,id) DO UPDATE SET revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at').run(owner, doc.id, result.revision, JSON.stringify(doc), result.updatedAt);
    db.prepare('INSERT INTO course_publications VALUES(?,?,?,?,?)').run(owner, key, digest, JSON.stringify(result), now());
    return { ...result, replayed: false };
  }
  return async function handle(request, response, path) {
    const tokens = path === '/api/native/v1/integrations/course-tokens';
    const native = /^\/api\/native\/v1\/courses(?:\/([^/]+)(\/progress)?)?$/.exec(path);
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
        respond(response, 200, { data: { credentials: db.prepare('SELECT * FROM course_tokens WHERE user_id=? AND expires>? ORDER BY created,id').all(user, now()).map(info), endpoint, protocol: courseProtocol, prompt: coursePrompt(endpoint), manualPrompt: courseManualPrompt() } }); return true;
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
          return { credential, accessToken, endpoint, protocol: courseProtocol };
        });
        respond(response, request.method === 'POST' ? 201 : 200, { data: result }); return true;
      }
    }
    if (native) {
      const id = native[1] ? uuid(native[1]) : null, isProgress = !!native[2];
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
      if (request.method === 'GET') {
        const { ownerID } = workspaceAccess(request);
        if (!id) {
          const courses = db.prepare('SELECT id,revision,document,updated_at FROM courses WHERE owner_id=? AND deleted=0 ORDER BY updated_at DESC,id').all(ownerID).map(row => { const doc = JSON.parse(row.document); return { id: row.id, title: doc.title, summary: doc.summary, revision: row.revision, updatedAt: row.updated_at, lessonCount: doc.lessons.length }; });
          respond(response, 200, { data: { courses } }); return true;
        }
        const row = course(ownerID, id), doc = JSON.parse(row.document);
        respond(response, 200, { data: isProgress ? progress(user, ownerID, id, doc) : { course: doc, revision: row.revision, updatedAt: row.updated_at } }); return true;
      }
      if (id && !isProgress && request.method === 'DELETE') {
        const expected = match(request, true);
        transaction(() => { const { ownerID } = workspaceAccess(request, true), row = course(ownerID, id); if (row.revision !== expected) fail('COURSE_REVISION_CONFLICT', 409); db.prepare('UPDATE courses SET deleted=1,revision=revision+1,updated_at=? WHERE owner_id=? AND id=?').run(new Date(now()).toISOString(), ownerID, id); });
        respond(response, 200, { data: { deleted: true } }); return true;
      }
      if (id && isProgress && request.method === 'POST') {
        const { value, bytes } = await read(request, 16384);
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
            const selectedOptionIDs = value.selectedOptionIDs ?? [], text = value.text ?? '';
            uniqueStrings(selectedOptionIDs, 20, id => { if (typeof id !== 'string' || !identifier.test(id)) fail('INVALID_COURSE_PROGRESS'); }); string(text, 4000, false);
            const answer = { lessonID, blockID, selectedOptionIDs, text, updatedAt: new Date(now()).toISOString() };
            if (!answerValid(answer, lesson.blocks.find(block => block.id === blockID))) fail('INVALID_COURSE_ANSWER');
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
