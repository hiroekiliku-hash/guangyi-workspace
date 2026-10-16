# 纯文本日程写入 API：WORKSHOP/1

工作坊可接收 UTF-8 纯文本，向密钥所属账户的云端工作空间新增事项。接口只追加记录，不提供读取、覆盖、删除或新建项目组的能力。App 在“个人资料与账号 → 添加日程 API”中提供专用密钥、可复制的 AI 提示词与撤销入口。App 正常同步后便能读取新增内容；未配置 APNs 时依然沿用前台同步。

## 地址、身份与账户

```text
POST https://workspace.kdfz.com.cn/api/integrations/v1/calendar-text
Authorization: Bearer wsi_专用密钥
Content-Type: text/plain; charset=utf-8
Idempotency-Key: 8bc3b52f-e140-45d5-9c54-4f17486ed148
```

实际完整地址由服务器的 `PASSKEY_ORIGIN` 提供，App 读取返回的 `endpoint`，不根据请求 `Host` 拼接。其他部署可使用自己的 HTTPS 域名，不需要另开公网端口。普通登录会话不能调用此写入接口；写入密钥也不能调用 workspace、账号安全或密钥管理接口。

密钥格式为 `wsi_` 加 32 个随机字节的 base64url，无 padding。服务端仅保存 SHA-256 哈希，并绑定签发时已登录账户的内部 user_id。请求不接受邮箱、用户 ID、密码或账户字段，无法通过正文切换收件账户。密钥有效期为 365 天，每账户最多 10 个有效密钥，可立即撤销；明文仅在创建成功时返回一次。App 可把当前设备创建的密钥保存在本机 Keychain，便于再次复制提示词。分享密钥即授予该账户的日程追加权限。

密钥应只放在 `Authorization` 请求头，不放 URL、正文、日志或代码仓库。接口不开放浏览器跨域 CORS，拒绝来自其他 Origin 和 `Sec-Fetch-Site: cross-site` 的请求；命令行或服务端调用可以不发送 Origin。请求只使用正常 HTTPS 证书校验。

## 正文规则

- 第一行必须完整等于 `WORKSHOP/1`；不加 BOM、Markdown 围栏、JSON 外壳或解释文字。
- 使用 LF 或 CRLF；每行格式为 `字段: 值`，也接受中文冒号。字段名区分字符，不能重复或使用未知字段。
- 多条记录之间使用单独一行 `---`。一次最多 50 条，整个 UTF-8 请求体最多 65,536 字节；支持空行，末尾不能有空的分隔块。
- 备注续行以两个空格（或 Tab）缩进；其他字段不能续行。
- 整批校验、追加、revision 更新及幂等记录在同一个 SQLite 事务中完成。一条失败则全部不写入。

| 字段 | 约定 |
| --- | --- |
| 类型 | 必填：`事项`、`截止事项`、`提醒`，分别对应 TASK、DEADLINE、REMINDER。 |
| 标题 | 必填，非空，最多 240 个 UTF-16 code units，确保符合原生端的 240 字符上限。 |
| 计划 | 可选，带偏移的绝对 ISO 8601 时刻。 |
| 截止 | 截止事项必填；绝对 ISO 8601 时刻或 `YYYY-MM-DD`。日期型使用该时区的全天截止语义。 |
| 提醒 | 提醒类型必填；绝对 ISO 8601 时刻。普通事项填写后开启通知。 |
| 时区 | 可选 IANA 时区，例如 `Asia/Shanghai` 或 `America/New_York`；默认账户资料时区，资料缺失时为 `Asia/Shanghai`。也支持 `UTC`。 |
| 项目 | 可选，现有且未删除/归档的项目组 UUID，或完整、唯一的项目组名称；未知、同名时拒绝，不自动创建。兼容 PROJECT 和 AREA。 |
| 备注 | 可选，多行纯文本，写入 body。 |
| 重复 | 可选：`每天`、`每周`、`每2周`、`每月`、`周一至周五`、`工作日（含调休）`、`单周`、`双周`。 |
| 星期 | 仅用于每周/每2周/单周/双周；英文逗号分隔的 1–7，周一为 1，不能重复；省略时使用首次日期的星期。 |
| 第1周 | 单周/双周必填，其他重复类型不能使用；`YYYY-MM-DD`，必须为周一，不能晚于首次事项所在周。 |
| 重复结束 | 可选，`YYYY-MM-DD`，包含当天且不能早于首次日期。 |

普通事项可不设置时间。重复事项必须有计划、截止或提醒，按原生规则取首次日期：截止事项使用截止；普通事项/提醒优先使用计划，其次截止，最后提醒。星期、第1周、重复结束均不能脱离重复单独填写。

时间格式为 `YYYY-MM-DDTHH:mm[:ss]±HH:mm` 或 `YYYY-MM-DDTHH:mm[:ss]Z`。年份 0001–9999，偏移最多 ±14:00，不接受毫秒、无偏移时刻、24:00、无效日期或自然语言。时刻给出的偏移必须与所选 IANA 时区当时的真实偏移相符，包括夏令时；例如默认上海时区的 `2026-10-20T09:00Z` 会被拒绝，应使用 `2026-10-20T09:00+08:00` 或明确选择 UTC。日期型被换算为该时区的当地零点，不能表示的当地日期会被拒绝。

截止事项遵循现有通知模型：不写提醒时，带时刻 DDL 默认在截止时刻提醒，日期型 DDL 默认在当地 09:00 提醒。填写提醒时，时间不得晚于上述通知基准，并须与基准相差整数分钟；服务端换算为 `notificationLeadMinutes`。若相差秒数无法表示或晚于基准，返回 422。普通事项不写提醒就不开启通知。

重复只保存首次事项和 `DeadlineSeries` 规则，**不向未来批量生成实例**。原生端使用已有的 30 天近期缓存与按需日历投影。工作日调休日历与 `Shared/Core/RecurrenceEngine.swift` 保持一致，只接受 2025–2026 年首次日期；当前调休日历覆盖范围外的后续日期不会推算，更新日历后可继续。每周间隔与单双周语义保持原生逻辑，首次日期即使不匹配规则仍保留并标记为例外。

## 示例

```text
WORKSHOP/1
类型: 事项
标题: 晨间整理
计划: 2026-10-20T08:00:00+08:00
提醒: 2026-10-20T07:50:00+08:00
时区: Asia/Shanghai
重复: 周一至周五
重复结束: 2026-12-31
备注: 整理今天的课表
  检查需要携带的材料
---
类型: 截止事项
标题: 提交课程报告
截止: 2026-10-23
---
类型: 提醒
标题: 给打印机补纸
提醒: 2026-10-22T12:00:00+08:00
```

将正文保存为 UTF-8 的 `calendar.txt`。在安全环境设置 `WORKSHOP_API_KEY` 后，生成并保存本次操作的 UUID：

```sh
operation_id="$(uuidgen)"
curl --fail-with-body -X POST 'https://workspace.kdfz.com.cn/api/integrations/v1/calendar-text' \
  -H "Authorization: Bearer $WORKSHOP_API_KEY" \
  -H 'Content-Type: text/plain; charset=utf-8' \
  -H "Idempotency-Key: $operation_id" \
  --data-binary @calendar.txt
```

超时或网络重试时，复用同一个 `operation_id` 和完全相同的正文 bytes。不要每次重试生成新 UUID，否则会视为新的新增请求。

首次成功返回 201：

```json
{"data":{"revision":42,"created":3,"recordIDs":["...","...","..."],"seriesIDs":["..."],"replayed":false}}
```

同账户同幂等键、同正文返回 200 和首次保存的 ID/revision，`replayed:true`，不新增、不增加 revision、不重复发同步提示。幂等键属于账户，换发密钥后仍能安全重试；UUID 大小写被归一。正文按原始 UTF-8 bytes 的 SHA-256 比较，换行或空格变化也属于不同正文。同键不同正文返回 409 `IDEMPOTENCY_CONFLICT`，应核对原请求。幂等记录持久保存在 SQLite，随同数据库备份，不按密钥撤销或过期清除。

## 错误与限流

| HTTP | 含义 |
| --- | --- |
| 400 | 缺失/无效的幂等 UUID，或请求体未完整送达。 |
| 401 | 密钥无效、过期、撤销，或把普通会话用作写入密钥。 |
| 403 | 不允许的 Origin / 跨站浏览器请求。 |
| 409 | 同幂等键的正文不同。 |
| 413 | 正文超过 64 KiB。 |
| 415 | Content-Type 不是 UTF-8 text/plain，或不支持的 Content-Encoding。 |
| 422 | 格式、字段、日期、重复规则或项目有误。 |
| 429 | 超过每 IP 每分钟 60 次或每账户每小时 120 次的限额。 |
| 500 | 服务器写入失败；事务回滚，可用原 UUID/原正文重试。 |

422 示例：`{"error":{"code":"INVALID_TEXT_DATE","line":5,"field":"截止"}}`。错误只提供固定代码、行号及协议已知字段，不回显原始输入或任意未知字段名。非法 UTF-8 返回 `INVALID_TEXT_UTF8`。限流包含幂等重试；未认证请求计入 IP 额度，认证成功且读完正文的请求另计账户额度。计数 Map 最多 10,000 项，进程重启会重置，生产代理可另外限流。仅从回环连接信任 Nginx 覆盖且通过 IP 格式校验的 `X-Real-IP`。

## App 的会话专用密钥管理

以下接口仅接受普通已登录会话的 `Authorization: Bearer <session>`，要求同源；POST/DELETE 还要求 `application/json`。写入密钥无法使用。

- `GET /api/native/v1/integrations/text-tokens` → `{data:{credentials:[{id,name,created,expires,lastUsed?}],endpoint,protocol:"WORKSHOP/1",prompt}}`。只列有效密钥，不返回明文。prompt 包含完整规范、示例与 `{{API_KEY}}` 占位符。
- `POST /api/native/v1/integrations/text-tokens`，JSON `{name?}`；默认 `AI日程写入`，trim 后 1–60 个字符，禁止额外字段。返回 201 `{data:{credential:{id,name,created,expires},accessToken,endpoint,protocol:"WORKSHOP/1"}}`，这是唯一返回明文的时机。
- `DELETE /api/native/v1/integrations/text-tokens`，JSON `{id}`。仅撤销本账户的 UUID，成功返回 `{data:{revoked:true}}`，不存在或其他账户的 ID 均返回 404。

时间戳为 Unix 毫秒。写入接口在接收正文前验证密钥，并在 SQLite `BEGIN IMMEDIATE` 内重新验证撤销/过期状态，随后重新读取最新快照再追加；没有 await 窗口让旧快照覆盖并发更新。沿用原生 PUT 的 revision/history 保留规则，每个批次只递增一次 revision，推送只发送已有的静默 revision 提示。所有其他记录、资料、附件、活动及未知快照字段保持原值。

构建时 `text-ingress.mjs` 打包进 `server.mjs`。发布仍只有原先白名单中的 `server.mjs`、`server.test.mjs` 和 `REVISION`，不改变网关或部署权限。后端测试通过实际 HTTP 和隔离内存 SQLite 验证格式、账户隔离、撤销、过期、原子性、幂等、并发 PUT 与通知提示。
