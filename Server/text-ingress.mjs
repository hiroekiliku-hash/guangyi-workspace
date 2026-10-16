import { randomUUID } from 'node:crypto';

export const textImportPath = '/api/integrations/v1/calendar-text';
export const textImportProtocol = 'WORKSHOP/1';
export const textImportLimit = 64 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = new Set(['类型', '标题', '计划', '截止', '提醒', '时区', '项目', '备注', '重复', '星期', '第1周', '重复结束']);

// Errors expose only a fixed code, a line number and a known protocol field.
// Never place submitted text, credentials or arbitrary field names in errors.
export class TextImportError extends Error {
  constructor(code, line, field) { super(code); this.status = 422; this.line = line; this.field = fields.has(field) ? field : undefined; }
}
const fail = (code, line, field) => { throw new TextImportError(code, line, field); };
function civil(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(0); date.setUTCFullYear(year, month - 1, day); date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}
function zoneFormatter(zone, line) {
  if (typeof zone !== 'string' || zone.length > 100 || !(zone === 'UTC' || /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)+$/.test(zone))) fail('INVALID_TEXT_TIMEZONE', line, '时区');
  try { return new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { fail('INVALID_TEXT_TIMEZONE', line, '时区'); }
}
const wallParts = (date, formatter) => Object.fromEntries(formatter.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
function sameWall(parts, components) {
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].every((key, index) => parts[key] === components[index]);
}
function localInstant(values, formatter, line, field) {
  const components = [...values, ...Array(6 - values.length).fill(0)], target = civil(...components);
  if (!target) fail('INVALID_TEXT_DATE', line, field);
  let estimate = target.getTime();
  for (let i = 0; i < 4; i++) {
    const parts = wallParts(new Date(estimate), formatter);
    const represented = civil(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
    if (!represented) fail('INVALID_TEXT_DATE', line, field);
    estimate += target.getTime() - represented.getTime();
  }
  if (!sameWall(wallParts(new Date(estimate), formatter), components)) fail('INVALID_TEXT_LOCAL_DATE', line, field);
  return new Date(estimate);
}
function parseDate(value, field, line, formatter, allowDateOnly = false) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly && allowDateOnly) {
    const instant = localInstant(dateOnly.slice(1).map(Number), formatter, line, field);
    return { iso: instant.toISOString(), day: value, dateOnly: true };
  }
  const timed = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!timed) fail('ABSOLUTE_TEXT_DATE_REQUIRED', line, field);
  const components = timed.slice(1, 7).map(part => Number(part ?? 0));
  const wall = civil(...components);
  if (!wall) fail('INVALID_TEXT_DATE', line, field);
  const offset = timed[7]; let offsetMinutes = 0;
  if (offset !== 'Z') {
    const hours = Number(offset.slice(1, 3)), minutes = Number(offset.slice(4));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail('INVALID_TEXT_DATE', line, field);
    offsetMinutes = (hours * 60 + minutes) * (offset[0] === '-' ? -1 : 1);
  }
  const instant = new Date(wall.getTime() - offsetMinutes * 60000);
  if (!sameWall(wallParts(instant, formatter), components)) fail('TEXT_DATE_TIMEZONE_MISMATCH', line, field);
  return { iso: instant.toISOString(), day: value.slice(0, 10), dateOnly: false };
}
const dayNumber = value => civil(...value.split('-').map(Number)).getTime() / 86400000;
const isoWeekday = value => (new Date(dayNumber(value) * 86400000).getUTCDay() + 6) % 7 + 1;
const monday = value => dayNumber(value) - (isoWeekday(value) - 1);

// Keep these civil-day overrides aligned with Shared/Core/RecurrenceEngine.swift.
// No future instances are generated here. Unsupported workday years are rejected.
const holidayRanges = [
  ['2025-01-01', '2025-01-01'], ['2025-01-28', '2025-02-04'], ['2025-04-04', '2025-04-06'],
  ['2025-05-01', '2025-05-05'], ['2025-05-31', '2025-06-02'], ['2025-10-01', '2025-10-08'],
  ['2026-01-01', '2026-01-03'], ['2026-02-15', '2026-02-23'], ['2026-04-04', '2026-04-06'],
  ['2026-05-01', '2026-05-05'], ['2026-06-19', '2026-06-21'], ['2026-09-25', '2026-09-27'], ['2026-10-01', '2026-10-07']
];
const workingWeekends = new Set(['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11',
  '2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']);
const workday = day => workingWeekends.has(day) || (!holidayRanges.some(([start, end]) => day >= start && day <= end) && isoWeekday(day) <= 5);
const repeatKinds = { '每天': ['DAILY', 1], '每周': ['WEEKLY', 1], '每2周': ['WEEKLY', 2], '每月': ['MONTHLY', 1],
  '周一至周五': ['WEEKDAYS', 1], '工作日（含调休）': ['CHINA_WORKDAYS', 1], '单周': ['ODD_WEEKS', 1], '双周': ['EVEN_WEEKS', 1] };
function recurrence(block, dates, formatter, record) {
  const value = block.values, at = key => block.lines[key] ?? block.line;
  if (value['重复'] === undefined) {
    for (const key of ['星期', '第1周', '重复结束']) if (value[key] !== undefined) fail('TEXT_REPEAT_REQUIRED', at(key), key);
    return null;
  }
  const spec = Object.hasOwn(repeatKinds, value['重复']) ? repeatKinds[value['重复']] : null;
  if (!spec) fail('INVALID_TEXT_REPEAT', at('重复'), '重复');
  const [frequency, interval] = spec;
  const anchor = dates['计划'] ?? dates['截止'] ?? dates['提醒'];
  // A deadline's recurrence anchor always follows its due date, like native.
  const effectiveAnchor = record.kind === 'DEADLINE' ? dates['截止'] : anchor;
  if (!effectiveAnchor) fail('TEXT_REPEAT_DATE_REQUIRED', at('重复'), '重复');
  const weekdaysAllowed = ['WEEKLY', 'ODD_WEEKS', 'EVEN_WEEKS'].includes(frequency), parity = frequency === 'ODD_WEEKS' || frequency === 'EVEN_WEEKS';
  let weekdays = [];
  if (value['星期'] !== undefined) {
    if (!weekdaysAllowed || !/^[1-7](?:,[1-7])*$/.test(value['星期'])) fail('INVALID_TEXT_WEEKDAYS', at('星期'), '星期');
    weekdays = value['星期'].split(',').map(Number);
    if (new Set(weekdays).size !== weekdays.length) fail('INVALID_TEXT_WEEKDAYS', at('星期'), '星期');
    weekdays.sort();
  }
  const rule = { frequency, interval, weekdays };
  if (parity) {
    if (value['第1周'] === undefined) fail('TEXT_WEEK_ONE_REQUIRED', at('重复'), '第1周');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value['第1周'])) fail('INVALID_TEXT_DATE', at('第1周'), '第1周');
    const first = parseDate(value['第1周'], '第1周', at('第1周'), formatter, true);
    if (isoWeekday(first.day) !== 1 || monday(first.day) > monday(effectiveAnchor.day)) fail('INVALID_TEXT_WEEK_ONE', at('第1周'), '第1周');
    rule.weekOneStart = first.iso;
  } else if (value['第1周'] !== undefined) fail('INVALID_TEXT_WEEK_ONE', at('第1周'), '第1周');
  if (value['重复结束'] !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value['重复结束'])) fail('INVALID_TEXT_DATE', at('重复结束'), '重复结束');
    const until = parseDate(value['重复结束'], '重复结束', at('重复结束'), formatter, true);
    if (until.day < effectiveAnchor.day) fail('TEXT_REPEAT_END_BEFORE_START', at('重复结束'), '重复结束');
    rule.until = until.iso;
  }
  if (frequency === 'CHINA_WORKDAYS' && !['2025', '2026'].includes(effectiveAnchor.day.slice(0, 4))) fail('TEXT_WORKDAY_YEAR_UNSUPPORTED', at('重复'), '重复');
  const selected = weekdays.length ? weekdays : [isoWeekday(effectiveAnchor.day)];
  const exception = frequency === 'WEEKDAYS' ? isoWeekday(effectiveAnchor.day) > 5 : frequency === 'CHINA_WORKDAYS' ? !workday(effectiveAnchor.day) : parity
    ? !selected.includes(isoWeekday(effectiveAnchor.day)) || ((monday(effectiveAnchor.day) - monday(value['第1周'])) / 7) % 2 !== (frequency === 'ODD_WEEKS' ? 0 : 1)
    : false;
  return { rule, anchor: effectiveAnchor, exception };
}
function parseBlocks(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > textImportLimit) fail('INVALID_TEXT_SIZE', 1);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) fail('INVALID_TEXT_CHARACTER', 1);
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if (lines[0] !== textImportProtocol || text.replaceAll('\r\n', '').includes('\r')) fail('INVALID_TEXT_PROTOCOL', 1);
  const blocks = []; let block = { values: {}, lines: {}, line: 2 }, previous;
  function finish(line) {
    if (!Object.keys(block.values).length) fail('EMPTY_TEXT_ITEM', line);
    blocks.push(block);
    if (blocks.length > 50) fail('TEXT_BATCH_LIMIT', line);
    block = { values: {}, lines: {}, line: line + 1 }; previous = undefined;
  }
  for (let index = 1; index < lines.length; index++) {
    const line = index + 1, raw = lines[index];
    if (raw === '---') { finish(line); continue; }
    if (/^[ \t]/.test(raw) && raw.trim()) {
      if (previous !== '备注') fail('INVALID_TEXT_CONTINUATION', line);
      block.values['备注'] += '\n' + raw.replace(/^(?:\t| {1,2})/, ''); continue;
    }
    if (!raw.trim()) continue;
    const match = /^([^:：]+)[:：][ \t]*(.*)$/.exec(raw);
    if (!match) fail('INVALID_TEXT_FIELD', line);
    const key = match[1].trim();
    if (!fields.has(key)) fail('UNKNOWN_TEXT_FIELD', line);
    if (Object.hasOwn(block.values, key)) fail('DUPLICATE_TEXT_FIELD', line, key);
    if (key !== '备注' && !match[2].trim()) fail('EMPTY_TEXT_FIELD', line, key);
    block.values[key] = match[2].trim(); block.lines[key] = line; previous = key;
  }
  finish(lines.length);
  return blocks;
}
function visibleProjectIDs(records) {
  const ids = new Set(records.map(record => record.id)), children = new Map(), hidden = new Set();
  for (const record of records) {
    if (record.deletedAt || record.archivedAt) hidden.add(record.id);
    for (const parent of [record.projectID, record.areaID].filter(Boolean)) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(record.id);
      if (!ids.has(parent)) hidden.add(record.id);
    }
  }
  const queue = [...hidden];
  for (let cursor = 0; cursor < queue.length; cursor++) for (const child of children.get(queue[cursor]) ?? []) {
    if (!hidden.has(child)) { hidden.add(child); queue.push(child); }
  }
  return new Set(records.filter(record => ['PROJECT', 'AREA'].includes(record.kind) && !hidden.has(record.id)).map(record => record.id));
}

export function parseCalendarText(text, snapshot, now = Date.now()) {
  const blocks = parseBlocks(text), records = [], series = [];
  const stamp = new Date(now).toISOString(), projectsVisible = blocks.some(block => block.values['项目'] !== undefined) ? visibleProjectIDs(snapshot.records) : null;
  for (const block of blocks) {
    const value = block.values, at = key => block.lines[key] ?? block.line;
    const kind = value['类型'] === '事项' ? 'TASK' : value['类型'] === '截止事项' ? 'DEADLINE' : value['类型'] === '提醒' ? 'REMINDER' : null;
    if (!kind) fail('INVALID_TEXT_KIND', at('类型'), '类型');
    if (!value['标题'] || value['标题'].length > 240) fail('INVALID_TEXT_TITLE', at('标题'), '标题');
    const timezone = value['时区'] ?? snapshot.profile?.timezone ?? 'Asia/Shanghai';
    const formatter = zoneFormatter(timezone, at('时区'));
    const dates = {};
    for (const key of ['计划', '截止', '提醒']) if (value[key] !== undefined) dates[key] = parseDate(value[key], key, at(key), formatter, key === '截止');
    if (kind === 'DEADLINE' && !dates['截止']) fail('TEXT_DUE_REQUIRED', at('类型'), '截止');
    if (kind === 'REMINDER' && !dates['提醒']) fail('TEXT_REMINDER_REQUIRED', at('类型'), '提醒');
    const record = { id: randomUUID(), kind, title: value['标题'], version: 1, createdAt: stamp, updatedAt: stamp,
      status: kind === 'TASK' ? 'TODO' : 'OPEN', summary: '', body: value['备注'] ?? '', category: '笔记', tags: [], pinned: false,
      projectKind: 'RESEARCH', dateOnly: dates['截止']?.dateOnly ?? true, timezone,
      notificationsEnabled: !!dates['提醒'] || kind === 'DEADLINE', notificationLeadMinutes: 0, isException: false };
    if (dates['计划']) record.scheduledAt = dates['计划'].iso;
    if (dates['截止']) record.dueDate = dates['截止'].iso;
    if (dates['提醒']) record.remindAt = dates['提醒'].iso;
    if (kind === 'DEADLINE' && dates['提醒']) {
      const base = dates['截止'].dateOnly ? localInstant([...dates['截止'].day.split('-').map(Number), 9], formatter, at('截止'), '截止').getTime() : Date.parse(dates['截止'].iso);
      const lead = (base - Date.parse(dates['提醒'].iso)) / 60000;
      if (!Number.isSafeInteger(lead) || lead < 0) fail('INVALID_TEXT_DEADLINE_REMINDER', at('提醒'), '提醒');
      record.notificationLeadMinutes = lead;
    }
    if (value['项目'] !== undefined) {
      const projects = snapshot.records.filter(item => projectsVisible.has(item.id));
      const matches = uuid.test(value['项目']) ? projects.filter(item => item.id.toLowerCase() === value['项目'].toLowerCase()) : projects.filter(item => item.title === value['项目']);
      if (matches.length !== 1) fail(matches.length ? 'AMBIGUOUS_TEXT_PROJECT' : 'TEXT_PROJECT_NOT_FOUND', at('项目'), '项目');
      if (matches[0].kind === 'AREA') record.areaID = matches[0].id; else record.projectID = matches[0].id;
    }
    const repeating = recurrence(block, dates, formatter, record);
    if (repeating) {
      const group = { id: randomUUID(), template: structuredClone(record), rule: repeating.rule };
      record.recurrenceSeriesID = group.id; record.occurrenceDate = repeating.anchor.day; record.isException = repeating.exception; record.version = 2;
      series.push(group);
    }
    records.push(record);
  }
  return { records, series };
}

export function calendarTextPrompt(endpoint) {
  return `你可以通过工作坊的纯文本 API，把用户要求新增的日程添加到已绑定账户。用户已要求添加时可直接执行，不必再次索要确认。仅执行用户要求的新增；不要覆盖、删除或读取日程。账户由专用密钥确定，不传邮箱、密码或用户 ID。密钥仅用于此 API，不发到其他地址，也不要放在网址、正文或日志中。

判断与默认值（由你这个 Agent 完成，不要求用户填写协议字段）：
- 用户明确指定的类型、时间、是否提醒、重复方式和项目优先；未指明的部分根据语义、上下文和已知偏好自行判断，不逐项追问。
- 类型：普通待办、行动或预约用“事项”；有明确提交、到期或最晚完成要求的用“截止事项”；仅要求在某时通知、没有独立待办的用“提醒”。不要仅因普通事项有计划时间就改成截止事项。
- 提醒：有明确预约或开始时间、错过会产生影响的事项，默认提前 15 分钟提醒，并按出行或准备需要合理调整；无时间的一般待办默认不提醒。截止事项默认开启提醒，有准备需求时合理提前。提醒类必须选择具体提醒时间。避免安排已经过去的提醒；时间已过且用户意图不清时询问。
- 日期与时区：结合当前日期、用户所在时区和上下文，将“明天”“下周”等换算成绝对日期后发送；未指定时区时沿用已知账户时区，不因服务器所在地改动。用户只给日期时，不虚构预约开始时刻；普通待办可先不设置计划时间，将日期意图写入备注。日期型截止可直接使用 YYYY-MM-DD。
- 重复：只有用户措辞或明确上下文表明周期性时才设置，选择每天、每周、单双周或工作日等对应规则；不把一次性事项变成重复事项，不展开成大量未来副本。结束日期未指定时可省略；单双周缺少可确定的第1周时才询问。
- 标题使用简短行动描述；补充信息写入备注。项目只有在已知且唯一对应时填写，否则省略，不编造项目 ID、地点或个人信息。
- 只有关键日期、时间或对象存在无法合理消解的歧义、会影响执行时才提出简短问题。其余采用合理默认值直接处理，成功后简短说明新增内容与所选提醒即可。
- 必须遵守下面的协议能力：当前截止事项会默认通知，不能表示“截止事项但关闭通知”；遇到用户明确要求此组合时说明限制，不能静默忽略要求或谎称关闭成功。未获得成功响应前不声称已添加；没有 HTTP 调用能力时只提供待发送正文。

接口：POST ${endpoint}
请求头（名称使用 ASCII）：
Authorization: Bearer {{API_KEY}}
Content-Type: text/plain; charset=utf-8
Idempotency-Key: 每次新操作生成一个 UUID；超时或重试必须复用同一个 UUID 和完全相同的 UTF-8 正文。

正文第一行必须是 WORKSHOP/1。后面每行一个字段，格式“字段: 值”（也接受中文冒号）。多条事项之间单独一行 ---。一次最多 50 条，整个正文最多 64 KiB。不支持 JSON、Markdown 代码围栏或自然语言日期。不允许未知字段、重复字段、账户/用户字段。可用字段只有：类型、标题、计划、截止、提醒、时区、项目、备注、重复、星期、第1周、重复结束。

类型必填：事项 / 截止事项 / 提醒。标题必填，最多 240 字符（按 UTF-16 长度计，兼容 App）。截止事项必须有截止；提醒必须有提醒；普通事项可以不设置时间。
计划、提醒必须使用带时区偏移的 ISO 8601 绝对时间，例如 2026-10-20T09:00:00+08:00；秒可省略，也可使用 Z（该时刻的偏移必须匹配所选时区）。截止也可使用 YYYY-MM-DD，表示当地全天截止。时区为 IANA 名称，例如 Asia/Shanghai；省略时使用账户时区。截止事项默认在截止时刻提醒，日期型默认为当地 09:00；填写其提醒时，须不晚于该基准，且与基准相差整数分钟，否则拒绝。普通事项没有提醒字段就不开启通知。所有日期必须真实有效；相对日期由 Agent 按上述规则换算，接口只接收绝对日期，不接收“明天”“下周”等原文。
项目可省略；填写现有项目组的 UUID 或完全相同且唯一的名称；不自动新建项目，找不到或同名时整批拒绝。备注可省略；续行以两个空格缩进。
重复可省略，允许：每天 / 每周 / 每2周 / 每月 / 周一至周五 / 工作日（含调休） / 单周 / 双周。重复必须有计划、截止或提醒时间。星期仅用于每周、每2周、单周、双周，以英文逗号连接 1 至 7（周一为 1），不重复；省略时使用首次日期的星期。单周/双周必须提供第1周: YYYY-MM-DD（周一，不能晚于首次事项所在周）。重复结束可省略或填写 YYYY-MM-DD（包含当天且不能早于首次日期）；星期、第1周和重复结束不能脱离重复单独使用。工作日调休日历仅支持 2025—2026 年首次日期，后续年份在日历更新前不会推算。服务端只保存首次事项与重复规则，不无限生成未来副本。

单条示例：
WORKSHOP/1
类型: 事项
标题: 去图书馆还书
计划: 2026-10-20T09:00:00+08:00
提醒: 2026-10-20T08:45:00+08:00
时区: Asia/Shanghai
备注: 带上借阅卡

批量示例：
WORKSHOP/1
类型: 事项
标题: 晨间整理
计划: 2026-10-20T08:00:00+08:00
重复: 周一至周五
重复结束: 2026-12-31
---
类型: 截止事项
标题: 提交课程报告
截止: 2026-10-23
时区: Asia/Shanghai
备注: 检查参考文献
  导出 PDF 后提交

curl 示例（先把原文保存为 UTF-8 的 calendar.txt，并在安全环境设置 WORKSHOP_API_KEY）：
curl --fail-with-body -X POST '${endpoint}' \\
  -H "Authorization: Bearer $WORKSHOP_API_KEY" \\
  -H 'Content-Type: text/plain; charset=utf-8' \\
  -H "Idempotency-Key: $(uuidgen)" \\
  --data-binary @calendar.txt
实际重试时保存并复用首次生成的 UUID；不要重复运行 uuidgen 生成新键。

成功新增返回 201，data 中含 revision、created、recordIDs、seriesIDs、replayed:false。同一账户的同一幂等键和相同原文重试返回 200、相同 ID/首次 revision、replayed:true，不重复新增；同键不同原文返回 409。整批原子提交，一条错误则全部不写入。401 表示密钥无效/过期/撤销，413 表示正文过大，415 表示类型错误，422 表示格式/字段/日期错误（error.line、error.field），429 表示限流；错误时先更正，不盲目换键重试。每 IP 每分钟最多 60 次、每账户每小时最多 120 次；密钥最长一年，可随时在账户设置撤销。`;
}
