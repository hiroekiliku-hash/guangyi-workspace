# 工作坊课程接口

课程内容独立于日程快照。服务器保存课程，App 登录后在“课程”页获取并缓存；课程发布不会创建事项、提醒或重复日程。当前提供 JSON 文档协议，同时接受包含相同 JSON 的 UTF-8 纯文本。

## 身份与账户

在已登录 App 的“配置 API 接口”中创建课程发布密钥，再把复制的课程说明交给 Agent。课程密钥以 `wsc_` 开头，绑定创建它的个人账户；请求不填写邮箱或用户 ID，也不接受 `X-Workspace-ID`。日程密钥 `wsi_` 和登录 session 均不能用于发布课程，课程密钥也不能读取日程或登录。

密钥随机生成，服务器只存 SHA-256 摘要；有效期 365 天，每账户最多 10 个，可立即撤销。明文只在创建时返回一次，不应出现在课程内容、日志、Git 或公开提示词中。

由登录 session 管理密钥：

- `GET /api/native/v1/integrations/course-tokens`：返回 `credentials`、`endpoint`、`protocol`、`prompt`（密钥位置为 `{{API_KEY}}`）。
- `POST` 相同地址，JSON `{ "name": "课程发布" }`（name 可省略）：201 返回 `credential`、`accessToken`、`endpoint`、`protocol`。
- `DELETE` 相同地址，JSON `{ "id": "密钥 UUID" }`：撤销自己的密钥。

元数据 `created`、`expires`、可选 `lastUsed` 为 Unix 毫秒时间戳。

## 发布协议

```
POST https://workspace.kdfz.com.cn/api/integrations/v1/courses
Authorization: Bearer wsc_...
Content-Type: application/json; charset=utf-8
Idempotency-Key: 操作 UUID
```

也可使用 `Content-Type: text/plain; charset=utf-8`，正文仍须是同样的 JSON。仅 UTF-8，不接受压缩正文。最多 1 MiB。以账户推断目标，不能通过用户字段写入其他人的账户。

```json
{
  "protocol": "WORKSHOP-COURSE/1",
  "id": "c94f9316-6fbc-4cb3-9bcf-64770cbb76cd",
  "title": "把一天安排得更从容",
  "summary": "用图文与练习了解时间安排。",
  "lessons": [{
    "id": "9258d251-24d9-43e7-8a5a-e17ccb87353a",
    "title": "先确定重点",
    "blocks": [
      {"id":"1042e09b-5496-42fb-88db-89dfc753ec68","type":"text","text":"先给最重要的事情留出时间。"},
      {"id":"18863be6-e114-4933-a467-bd04e8091f65","type":"chart","chartType":"bar","points":[{"label":"学习","value":4},{"label":"休息","value":1}]},
      {"id":"d84c54c9-22b4-4c50-8d32-776369678df9","type":"question","text":"先安排哪一项？","questionType":"singleChoice","options":[{"id":"a","text":"最重要的事情"},{"id":"b","text":"随手看到的事情"}],"correctOptionIDs":["a"],"explanation":"先确定重点，再留出弹性时间。"}
    ]
  }]
}
```

支持块：

| type | 字段 |
|---|---|
| `text` | 必填 `text`，App 以原生文本呈现 |
| `callout` | 必填 `text`，强调提示 |
| `image` | 必填 `url`（HTTPS），可选 `caption` |
| `chart` | 必填 `chartType`（`bar`/`line`）、`points:[{label,value}]`，可选 `caption` |
| `question` | 必填 `text`、`questionType`，可选 `explanation`；其余依题型如下 |

`singleChoice`、`multipleChoice` 需要 `options:[{id,text}]` 与 `correctOptionIDs`。单选恰有一个正确项，多选至少一个。`shortAnswer` 可提供 `acceptedAnswers:["答案"]`；省略或空数组表示自行核对，不伪造自动评分。不支持自由执行代码、HTML、原始 SVG、视频或 iframe；新内容形式应通过新协议版本增加。服务器只验证图片地址，不替用户请求该地址。

所有课程、课时、块 UUID 在同一文档内不能重复，统一小写存储。选项 ID 是 1–40 个 ASCII 字母、数字、下划线或连字符。未知字段或类型拒绝；禁止原始 HTML 标签。课程标题、课时标题最多 240 个 UTF-16 代码单元，summary 最多 2000；text/callout 正文最多 20000，题目正文及 explanation 最多 4000；caption 最多 2000，选项文字最多 1000，参考简答答案最多 500；图片 URL 最多 2048。每课程 1–40 课时，每课时 1–80 块；每图表 1–60 点，label 最多 120，value 有限且绝对值不超过 10^15；选择题 2–12 选项；参考简答答案最多 20 个。每账户最多 200 个未删除课程。

首次发布无需 `If-Match`，返回 201；更新必须提供 `If-Match: "当前修订号"`，成功返回 200，修订号加一。删除后的 UUID 保留墓碑，不可重新发布；可使用新 UUID 新建。课程内容更新会开启新的学习版本，原版本答案和完成标记不作为新版进度显示；客户端应保留未提交的旧版练习草稿供用户核对。

成功响应（所有 API 均使用 `data` 包裹）：

```json
{"data":{"id":"c94f9316-6fbc-4cb3-9bcf-64770cbb76cd","revision":1,"updatedAt":"2026-10-17T08:00:00.000Z","replayed":false}}
```

同一 Idempotency-Key、完全相同正文及 If-Match 重试，返回之前的发布结果，`replayed:true`，不会增加版本；同 key 不同正文或版本返回 409。并发更新冲突返回 409 `COURSE_REVISION_CONFLICT`，不得猜测版本并强行覆盖。鉴权失败 401，非法内容 400/422，超限 413，限流 429。错误正文仅包含安全错误码，不回显课程或凭据。发布按 IP 每分钟 60 次、账户每小时 120 次限流。

```sh
# 从环境变量读取专用课程密钥；请勿把真实密钥写入脚本。
curl --fail-with-body 'https://workspace.kdfz.com.cn/api/integrations/v1/courses' \
  -H "Authorization: Bearer $WORKSHOP_COURSE_KEY" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H 'Idempotency-Key: d05621e0-c579-4e95-9e94-cf32b06f3cb7' \
  --data-binary @course.json
```

## App 读取与练习

以下均使用用户登录 session，支持 `X-Workspace-ID` 选择有权访问的关联账户空间。未指定为个人空间。只读成员能阅读课程、提交自己的练习；学习答案和完成度按“学习者 + 空间 + 课程”隔离，不会同步为别人的进度。取消关联后立即失去在线访问。

- `GET /api/native/v1/courses` → `data.courses:[{id,title,summary,revision,updatedAt,lessonCount}]`。
- `GET /api/native/v1/courses/:uuid` → `data:{course:完整协议文档,revision,updatedAt}`。
- `DELETE /api/native/v1/courses/:uuid` + `If-Match`：空间所有者或可编辑成员软删除；只读成员 403。
- `GET /api/native/v1/courses/:uuid/progress` → `data:{courseID,courseRevision,completedLessonIDs:[],answers:[{lessonID,blockID,selectedOptionIDs:[],text:"",updatedAt:"ISO"}]}`。
- `POST` 同 progress 路径：保存一次回答或完成/取消完成课时；响应当前完整进度。

```json
{
  "mutationID":"f8c17b4d-a5eb-4215-a8dd-7da038ce12cc",
  "courseRevision":1,
  "lessonID":"9258d251-24d9-43e7-8a5a-e17ccb87353a",
  "blockID":"d84c54c9-22b4-4c50-8d32-776369678df9",
  "selectedOptionIDs":["a"]
}
```

简答用 `text`（最多 4000），不同时提交选项。仅改变课时完成状态时，省略 blockID/答案字段并提交 `completed:true/false`；也可在答题请求附上 completed。标记完成前该课时的每道题都必须有有效作答，不要求全对。未作答 409 `COURSE_ANSWERS_REQUIRED`。旧课程版本的提交 409，不能用重试恢复旧版答案。

mutationID 以学习者、空间、课程隔离；同 ID 同正文重试不会再次修改，返回当前进度（避免旧响应倒退当前界面），同 ID 不同正文 409。每课程每学习者最多 20000 个不同 mutation，进度总大小最多 2 MiB。保存过程在读完正文后于事务内重新验证 session 和关联权限。此版本使用拉取同步，不依赖 APNs，不向关闭的 App 承诺即时更新。

## 给 Agent 的约定

优先遵从用户指定；未指定时自行决定课时拆分、块类型和练习形式。文字优先，图表用于真正有数据的内容，练习用于检验理解，不为装饰填入虚构统计。不得凭空编造参考答案或版权图片来源。发布已获用户请求授权时直接执行；只在无法决定教学目标、目标账户或会覆盖未知版本等实质问题时询问。新建课程生成新 UUID，更新保留已有结构 ID 并使用已知 revision；重试保留原 key、字节正文和 If-Match。只有 HTTP 成功后才报告已发布；把版本冲突解释为需要获取最新课程后再编辑。App 可复制的权威提示词由服务器 `coursePrompt` 输出，自动填入端点，并在本地替换密钥占位符。
