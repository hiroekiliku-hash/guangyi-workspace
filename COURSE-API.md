# 工作坊课程接口

课程内容独立于日程快照。服务器保存课程，App 登录后在“课程”页获取并缓存；课程发布不会创建事项、提醒或重复日程。当前提供 JSON 文档协议，同时接受包含相同 JSON 的 UTF-8 纯文本。

`WORKSHOP-COURSE/1` 现提供 `structured-2`：支持结构化程序推演 `trace`、课程/课时共享的 `referenceCode`、内容块的 `focusLines/focusSpans` 与 Code 的 `highlightSpans`，以及结构化代码、Markdown、SVG、离线 HTML、表格、分步、对照、记忆卡片与练习。作者提供语义数据，服务器托管的 HTML renderer 统一布局和交互；旧版 App 继续使用内建组件，新版 App 可直接接收服务器更新的学习界面。

## 复制给 AI 的简短引导与在线规范

App 复制的提示词只保留“访问官方课程制作规范、等待用户学习内容、按规范制作课程”的简短引导。完整协议、教学要求、互动组件用法和可导入 JSON 示例统一在公开规范中维护，后续可由服务器直接更新；不再让用户复制整份长文。

- 手动导入规范：[课程制作规范](https://workspace.kdfz.com.cn/course-authoring?mode=manual)。AI 阅读后制作完整 JSON，由用户粘贴到 App 上传；不需要发布密钥，也不能声称已经上传。
- 自动发布规范：[课程制作与发布规范](https://workspace.kdfz.com.cn/course-authoring?mode=automatic)。AI 阅读后按用户提供的独立课程密钥上传；密钥仅放在 Authorization 请求头。没有网络请求工具时，退回输出 JSON 供用户导入，不假装完成上传。
- 机器读取：`GET /api/integrations/v1/courses/guide?mode=manual|automatic` 返回 UTF-8 `text/plain` 完整规范；网页路径 `/course-authoring` 返回 HTML。两者均无需登录或发布密钥，省略 mode 默认 manual，仅接受一个合法 mode 参数，未知参数、重复 mode 或非法值返回 422；仅支持 GET/HEAD，其余方法返回 404。

公开的 `GET/HEAD /robots.txt` 只允许抓取课程规范网页、纯文本规范与 JSON Schema；其他路径继续禁止抓取，账户 API 的鉴权要求保持不变。

公共规范不包含账户内容或真实凭据；发布引导中的 `{{API_KEY}}` 是待替换占位符，不会加入公开规范。复制自动发布引导时 App 可在独立正文位置填入当前密钥，不能把密钥、邮箱、用户 ID 等放进规范网址。两个路径均提供 ETag/304、HEAD 与 gzip，让 AI 读取最新规范时减少带宽；JSON Schema 发现地址保持不变。如果 AI 无法访问网页或文本规范，应明确说明并请用户提供规范内容，不依据短引导猜测字段。

## AI 互动教学要求

自动上传版与手动导入版在线规范共用一套约定：**每屏一个问题、一个变化，先清楚再丰富**。编程课围绕一个短程序，按“预测 → 单步观察 → 迁移题 → 自行改写”展开，通常 4–6 块即可。保留必要的完整代码区，不为形式丰富而重复铺设源码、参数面板、输出、对照、时间轴、标签与多种练习。

逐步语义优先用结构化 `trace`。默认每帧最多两个对象、一句不超过 60 字的解释。同一程序贯穿的课程或课时必须提供 `referenceCode`，App 在讲解、推演与做题时始终保留完整代码区，长程序在区内滚动；不能只露当前一行或要求用户回忆前页源码。解释变量、关键字、运算符或表达式时主动使用 `focusSpans` 精确标记一两处，整行相关时才用 `focusLines`，不逐字标满程序。trace 使用当前 `frame.focusSpans`，省略或空时回退 `frame.line`。作者不指定布局、坐标、配色、按钮。对象身份在帧间稳定；引用的多个名字放在同一个对象的 `names`，不能伪装成副本。开放代码题默认不提供 `acceptedAnswers`，解析给参考实现和检查点，不能用代码文本比对充当通用程序判分。

不再要求前两课或每节课包含 HTML。只有连续拖动等结构化组件无法表达的核心交互才使用离线 HTML，并明确教学模拟边界。普通正文、Markdown 围栏和 Code 展示不执行，正式作答与进度使用 `question`。制作练习时必须按答案内容选择 `input.kind`：整数和小数使用数值输入，真正要用户编写源码时使用代码编辑器并声明语言。Python/C++ 代码填空、改错与程序题默认必须增加 `execution`，每个含编程练习的课时至少一道可运行题；纯讲解、预测输出或选择题不强加执行。在线规范的唯一完整示例保留紧凑结构化 trace 与迁移选择题，并附 Python 数值填空、C++ 表达式填空和两种语言的完整程序题。这些属于内容生成要求，不是服务器对教学质量的强制判定。线上完整规范随服务器部署更新，复制的短引导持续指向该规范，旧课程不会自动改写。

## 身份与账户

在已登录 App 的“配置 API 接口”中创建课程发布密钥，再把复制的课程说明交给 Agent。课程密钥以 `wsc_` 开头，绑定创建它的个人账户；请求不填写邮箱或用户 ID，也不接受 `X-Workspace-ID`。日程密钥 `wsi_` 和登录 session 均不能用于发布课程，课程密钥也不能读取日程或登录。

密钥随机生成，服务器只存 SHA-256 摘要；有效期 365 天，每账户最多 10 个，可立即撤销。明文只在创建时返回一次，不应出现在课程内容、日志、Git 或公开提示词中。

由登录 session 管理密钥：

- `GET /api/native/v1/integrations/course-tokens`：返回 `credentials`、`endpoint`、`protocol`、`schemaURL`、`guideURL`（自动发布网页）、`manualGuideURL`（手动导入网页）、`extensionVersion`（`structured-2`）、`prompt`（简短自动发布引导，密钥位置为 `{{API_KEY}}`）、`manualPrompt`（简短手动导入引导，不含凭据，获取时不创建密钥）。
- `POST` 相同地址，JSON `{ "name": "课程发布" }`（name 可省略）：201 返回 `credential`、`accessToken`、`endpoint`、`protocol`、`schemaURL`、`guideURL`、`manualGuideURL`、`extensionVersion`。
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

`singleChoice`、`multipleChoice` 需要 `options:[{id,text}]` 与 `correctOptionIDs`。单选恰有一个正确项，多选至少一个。`shortAnswer` 可提供 `acceptedAnswers:["答案"]`；省略或空数组表示不进行参考答案文本评分。可选 `input` 声明数值、普通文字或代码编辑器，可选 `execution` 允许用户主动运行作答；运行输出与原有答案保存相互独立。原生 Code 展示不自动执行；HTML/SVG 则通过下文的显式 presentation 进入客户端离线沙盒，支持内联交互与动画。基础块枚举未变，不增加 HTML、视频或 iframe 的 block.type。旧 image 为兼容保留，默认不要使用；服务器只验证图片地址，不替用户请求该地址。

所有课程、课时、块 UUID 在同一文档内不能重复，统一小写存储。选项 ID 是 1–40 个 ASCII 字母、数字、下划线或连字符。未知字段或类型拒绝；发布课程与保存进度时只保存数据，不运行源码，允许 `#include <iostream>`、`std::vector<int>`、`a < b` 等源码与尖括号。禁止不支持的控制字符，普通正文与 Code 必须作为原生文字展示；显式 HTML/SVG presentation 在隔离沙盒中渲染，声明 execution 的题目另由用户主动运行，不能把其他课程字符串拼入执行环境。课程标题、课时标题最多 240 个 UTF-16 代码单元，summary 最多 2000；text/callout 正文最多 20000，题目正文及 explanation 最多 4000；caption 最多 2000，选项文字最多 1000，普通参考简答答案最多 500（代码与输出见后文）；图片 URL 最多 2048。每课程 1–40 课时，每课时 1–80 块；每图表 1–60 点，label 最多 120，value 有限且绝对值不超过 10^15；选择题 2–12 选项；参考简答答案最多 20 个。每账户最多 200 个未删除课程。

首次发布无需 `If-Match`，返回 201；更新必须提供 `If-Match: "当前修订号"`，成功返回 200，修订号加一。删除后的 UUID 保留墓碑，不可重新发布；可使用新 UUID 新建。课程内容更新会开启新的学习版本，原版本答案和完成标记不作为新版进度显示；客户端应保留未提交的旧版练习草稿供用户核对。

成功响应（除下述静态 JSON Schema 外，API 均使用 `data` 包裹）：

```json
{"data":{"id":"c94f9316-6fbc-4cb3-9bcf-64770cbb76cd","title":"把一天安排得更从容","revision":1,"updatedAt":"2026-10-17T08:00:00.000Z","replayed":false}}
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

- `POST /api/native/v1/courses`：App 粘贴导入课程，正文是完整课程 JSON，使用登录 session；必需 `Idempotency-Key`，更新需要 `If-Match`。所有者或编辑成员可向当前空间发布，只读成员 403；不需要创建课程发布密钥。schema、大小限制、事务内鉴权、幂等和版本规则与发布接口共用，返回相同 `{id,title,revision,updatedAt,replayed}`。
- `GET /api/native/v1/courses` → `data:{courses:[{id,title,summary,revision,updatedAt,lessonCount}],starredCourseIDs:[课程 UUID]}`。星标只返回当前空间中尚未删除的课程，按“当前学习者 + 空间”隔离。
- `PUT /api/native/v1/courses/:uuid/star`，JSON `{ "starred": true }` 或 `{ "starred": false }` → `data:{starred:布尔值}`。只读成员也可管理自己的星标；布尔值必填，未知字段拒绝。幂等设置，无需 mutation ID 或 If-Match，不改变课程修订号、更新时间或学习进度；课程不存在或已删除返回 404。读取正文后事务内重新验证会话和空间访问，撤销立即生效。删除课程时清除该课程在该空间中的全部星标。
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

简答用 `text`，不同时提交选项。普通文字最多 4000、代码最多 20000、输出最多 8000 个 UTF-16 代码单元；显式或推断的 `input.kind=code` 使用代码上限，其余沿用 `answerFormat`。数值输入在提交时校验格式，不接受单位、表达式、指数或非数字字符；首尾空白可省略。单次进度请求最多 128 KiB。仅改变课时完成状态时，省略 blockID/答案字段并提交 `completed:true/false`；也可在答题请求附上 completed。标记完成前该课时的每道题都必须有有效作答，不要求全对；无需先运行程序。未作答 409 `COURSE_ANSWERS_REQUIRED`。旧课程版本的提交 409，不能用重试恢复旧版答案。

mutationID 以学习者、空间、课程隔离；同 ID 同正文重试不会再次修改，返回当前进度（避免旧响应倒退当前界面），同 ID 不同正文 409。每课程每学习者最多 20000 个不同 mutation，进度总大小最多 2 MiB。保存过程在读完正文后于事务内重新验证 session 和关联权限。此版本使用拉取同步，不依赖 APNs，不向关闭的 App 承诺即时更新。

## 结构化扩展 `structured-2`

### 版本与发现

基础 `protocol` 仍为 `WORKSHOP-COURSE/1`，元数据 `extensionVersion` 为 `structured-2`。五个 `type`、三种 `questionType`、UUID、revision、幂等和完成条件保留；新增 trace 需要支持该版本的客户端。旧结构仍可读写，但新内容不再要求旧客户端展示等价效果。

`GET /api/integrations/v1/courses/schema` 返回不含账户数据的 JSON Schema，**直接返回 Schema 对象，不使用 `data` 包裹**。课程凭据元数据同时返回 `schemaURL` 与 `extensionVersion`。离线版本见 [Server/course.schema.json](Server/course.schema.json)，完整可导入的 C++ 例子见 [Server/Fixtures/course-programming.json](Server/Fixtures/course-programming.json)。Schema 表达字段与长度上界；全局 UUID 唯一、表格行宽、有效代码行号等跨字段条件仍由服务端与 Swift 验证。

课时可增加 `objectives:[String]`（最多 6 条，每条 1–500）和 `estimatedMinutes`（1–180 的整数）。任意块可增加非空 `title`（最多 240）。它们用于内容组织，不改变完成条件。

`text` / `callout` 可增加 `presentation`。`text` 保留简短、有教学意义的摘要，无需重复完整源码、逐帧状态或整个表格；客户端优先展示结构化内容，避免一屏重复输出两份正文。

| `presentation.kind` | 唯一对应内容 | 适合用途 |
|---|---|---|
| `trace` | `trace:{variants:[{id,title,code,frames}]}` | 原生单步程序推演、对象身份与别名 |
| `code` | `code: Code` | 源码、输入输出、行高亮与注解 |
| `table` | `table:{columns:[String],rows:[[String]]}` | 变量追踪、地址与值、复杂度对比 |
| `steps` | `steps:[{title,text,code?}]` | 分步讲解、函数调用过程、执行推演 |
| `comparison` | `items:[{title,text,code?}]` | 正反例、两种写法或思路的比较 |
| `flashcards` | `cards:[{front,back}]` | 概念回忆、先思考再揭示解释 |
| `markdown` | `markdown:{source}` | 标题、列表、表格、引用与带语言名的代码围栏 |
| `html` | `html:{source,height?}` | 内联 CSS/JavaScript、SVG/canvas、滑块按钮与交互动画 |
| `svg` | `svg:{source,height?}` | 不依赖位图的矢量图解和轻量动画 |

`presentation` 只允许 `kind` 和对应的一个载荷字段，不混放多个形式，不任意递归嵌套。表格 1–8 列、1–60 行，每行格数必须与列数一致；列名非空最多 120，单元格可空最多 2000。步骤 1–20 项，对照 2–4 项；每项 `title` 非空最多 240，`text` 非空最多 4000，`code` 可省略。记忆卡 1–20 张，`front` 非空最多 2000、`back` 非空最多 4000。所有长度按 UTF-16 代码单元计。

### 原生程序推演 `trace`

```json
{
  "kind": "trace",
  "trace": {
    "variants": [{
      "id": "reference",
      "title": "引用传递",
      "code": {"language": "cpp", "source": "void award(int& points) {\n    points += 3;\n}"},
      "frames": [
        {"title": "绑定别名", "line": 1, "note": "points 与 score 是同一个对象的两个名字。", "objects": [{"id": "score", "names": ["score", "points"], "value": "7", "scope": "main"}]},
        {"title": "修改原值", "line": 2, "note": "通过 points 修改，原对象也变成 10。", "objects": [{"id": "score", "names": ["score", "points"], "value": "10", "scope": "main", "changed": true}]}
      ]
    }]
  }
}
```

`variants` 1–4 项且 id 唯一；每项 `frames` 2–24 帧。variant 必填 `id/title/code/frames`；frame 必填 `title/line/note/objects`，可有 `output`。frame 表示执行当前行之后的状态，`line` 必须在本 variant 的源码中有效。函数返回帧可以指向其右花括号。

每帧 `objects` 1–4 项且 id 唯一。对象必填 `id/names/value`，可有 `scope/changed`；同一 variant 中对象 id 应跨帧保持稳定。variant/object id 为 1–40 个 ASCII 字母、数字、下划线或连字符。`names` 1–3 个非空字符串，每个最多 80，作者应避免重复，表示**同一个对象**的名字；作用域结束时移除失效名字或对象。`value` 非空最多 120，`scope` 非空最多 80，`changed` 为布尔值。variant/frame 的 `title` 非空最多 120；`note` 非空最多 400（生成时默认一句不超过 60 字），`output` 可空最多 2000，仅在产生输出时提供。

载荷不接受布局、坐标、颜色或按钮字段。客户端控制切换、单步、回退、持续可见的完整代码区和视觉层级。切换 variant 时同步切换完整代码。当前 frame 的非空 `focusSpans` 只高亮对应片段；省略或 `[]` 时高亮 `line`，均覆盖块的静态焦点。这是作者提供的教学状态，不声称编译或运行过源码。值/引用传参示范见 [Shared/LearningLabs/CppValueReference.json](Shared/LearningLabs/CppValueReference.json)。

### 富内容与离线演示

`markdown.source` 非空最多 20000 个 UTF-16 代码单元；`html.source` / `svg.source` 非空最多 60000。HTML/SVG 的 `height` 可省略，提供时为 120–640 的整数（显示点），Markdown 不接受 height。三种载荷只允许表中字段，HTML/SVG 的 `text` 用简短摘要说明实验目的。示例见 [Server/Fixtures/course-rich.json](Server/Fixtures/course-rich.json)。

编程课的逐步状态优先 `trace`，静态源码用 `Code` 或 Markdown 的带语言名围栏。HTML 仅用于原生结构无法表达的特殊交互，不假称运行了原生 C++/Python。SVG 通过 viewBox 适配移动屏，适合代替图片。HTML 可使用完全内联的样式、脚本和 canvas，无需安装插件或下载资源。演示应尊重 `prefers-reduced-motion`，动画附暂停/重置控制，避免固定宽度和无休止后台循环。

互动内容应把状态计算与绘制分开：滑块/拖动先更新模型数据，再通过 `requestAnimationFrame` 合并绘制；避免每次输入都替换整个 `innerHTML`，复用 SVG/DOM 节点，先集中读取布局再写入，动画优先用 `transform`/`opacity`。长计算拆成每批约 4ms 的小步骤并主动让出执行机会，轨迹/节点数要有上限。按 `performance.now()` 的时间差计算运动，不能把定时回调次数当成真实经过时间。

新版客户端提供可选的离线 `window.WorkshopRuntime`（不含任何账户、存储或网络权限）：`invalidate(key, render)` 为同一 key 在下一帧只保留最新绘制，`cancelInvalidation(key)` 取消，`await yield()` 等待下一帧让出执行；`active` 和 `workshopvisibilitychange` 事件的 `detail.active` 表示当前是否可见。使用时先检测是否存在，旧客户端退回原生 `requestAnimationFrame`。正常动画直接用 `requestAnimationFrame`；新版会保留状态并暂停离屏的计时/动画，回到屏幕不补跑积压的帧。小于 16ms 的重复计时共用每帧约 4ms 的计算预算，耗时的单次 JavaScript 回调无法被抢占，仍需作者拆分。

```js
const slider = document.querySelector('input[type="range"]');
let value = Number(slider.value), pending = false;
function render() { document.querySelector('output').textContent = String(value); }
slider.addEventListener('input', () => {
  value = Number(slider.value); // 同步记录最新模型状态
  if (window.WorkshopRuntime?.invalidate) WorkshopRuntime.invalidate('model', render);
  else if (!pending) {
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  }
});
```


客户端隔离渲染富内容：不提供账号信息、凭据或原生桥接，使用非持久网页数据；沙盒和 CSP 禁止网络请求、外链脚本/样式/字体、导航、嵌入、图片、音频、视频及 worker。作者不要使用 CDN、iframe/object/embed、data/base64、SVG image/foreignObject 或任何外链资源。Markdown 不启用原始 HTML，也不加载图片；特殊交互可使用 html presentation；逐步程序语义优先原生 trace。服务器只验证字段、限额并存储源码，不运行它，也不靠字符串黑名单判断教学源码。沙盒允许内联 JavaScript 演示，不代表可访问服务器、App 数据或设备能力。

单课程仍最多 1 MiB，不提供图片/视频上传或转码服务，默认不用旧 image 块。丰富形式优先靠文字、矢量和短脚本完成，避免给小服务器增加媒体存储与传输负担。

### `Code` 对象

```json
{
  "language": "cpp",
  "filename": "main.cpp",
  "source": "#include <iostream>\nint main() { std::cout << 6; }",
  "highlightLines": [2],
  "highlightSpans": [{"line": 2, "text": "std::cout"}, {"line": 2, "text": "<<"}],
  "annotations": [{"line": 2, "text": "输出整数 6。"}],
  "stdin": "",
  "expectedOutput": "6"
}
```

只有 `language`、`source` 必填。`language` 是 1–40 个 ASCII 字母、数字或 `+ - . _`，例如 `cpp`、`c++`、`python`、`plaintext`；不限定课程语言。`source` 非空最多 20000，`filename` 非空最多 240（仅显示名称，不作为文件路径执行），`stdin` 可空最多 4000，`expectedOutput` 可空最多 8000。

`highlightLines` 最多 200 个不重复的有效行号，`annotations` 最多 40 条，行号不重复、注解非空最多 2000。行号从 1 开始，按源码实际的 CRLF/CR/LF 行分隔计算；超出范围拒绝。`expectedOutput` 是作者提供的教学参考，不表示服务器已运行或验证代码；不凭空编造编译结果。

### 变量、单词和字符片段

`Code.highlightSpans`、任意块的 `focusSpans`、trace 每帧的 `focusSpans` 使用相同的可选数组，每处最多 200 个标记。每项严格为 `{line,text,occurrence?}`：`line` 为有效的 1 起始整数行号；`text` 是原行精确存在的字面片段，区分大小写、不做 Unicode 规范化，非空且不全为空白，最多 2000 个 UTF-16 代码单元，不能包含 CR/LF、tab、C0/C1 控制字符或 U+2028/U+2029 行分隔。可以标记单个字符、变量、运算符、中文、emoji 或连续表达式，不使用正则表达式，也不要求作者数列号。

`occurrence` 是 1–20000 的整数，省略为 1，按该行从左到右**互不重叠**的出现次数计数。同一行 `count = count + 1;` 可用下列标记只突出右侧 `count` 和加号：

```json
{"focusSpans":[{"line":4,"text":"count","occurrence":2},{"line":4,"text":"+"}]}
```

`aaaa` 中 `aa` 的 occurrence 2 有效，`aaa` 中 occurrence 2 无效。不同片段允许重叠并合并显示；相同 `(line,text,occurrence ?? 1)` 的重复项拒绝，所以省略 occurrence 与显式 1 不能重复指定。每个标记必须在实际源码找到，Code 标记检查自己的 source、块标记检查当前解析的可见代码、trace 帧标记检查所在 variant.code；`[]` 允许在没有代码时清除焦点。行号、字面片段或出现次数无效均拒绝发布，不猜测作者意图。标记只影响阅读展示，不执行代码或公开解答。

### 持续显示的参考程序与行聚焦

课程根对象和每个课时均可增加可选的 `referenceCode:Code`，沿用上述完整 Code 校验。全课程共用一个程序放根对象；只有一个课时共用则放课时。所有类型的块均可增加可选 `focusLines:[整数行号]`，按当前实际显示的完整源码定位，最多 200 个且不能重复。`focusLines` 和 `focusSpans` 只要显式提供任一个，两个焦点都以当前块为准，未提供的另一个按空数组处理；两个都省略才沿用显式 Code 的 `highlightLines/highlightSpans`。显式 `[]` 可清除静态高亮，即使没有代码也允许。非空时必须能解析到代码，且每个行号与片段在源码范围内。trace 在播放时由当前 frame 的非空 spans 覆盖静态焦点，否则回退 frame.line。

同一课时里的讲解和题目可以共用程序，无须在每块重复源码：

```json
{
  "id": "9258d251-24d9-43e7-8a5a-e17ccb87353a",
  "title": "逐次取值",
  "referenceCode": {"language":"python","filename":"loop.py","source":"for i in range(1, 4):\n    print(i)\nprint('结束')"},
  "blocks": [
    {"id":"1042e09b-5496-42fb-88db-89dfc753ec68","type":"text","text":"先从 range 中取第一个值。","focusLines":[1]},
    {"id":"d84c54c9-22b4-4c50-8d32-776369678df9","type":"question","text":"循环体第一次输出什么？","questionType":"shortAnswer","input":{"kind":"integer"},"acceptedAnswers":["1"],"focusLines":[2]}
  ]
}
```

当前代码解析顺序为：当前 `block.code` → `presentation.code` → 当前 trace 的 variant.code → 当前 `execution.template`（保留字面 `{{ANSWER}}`）→ 课时 `referenceCode` → 课程 `referenceCode`。没有以上来源的旧课程才回退到同课时最近的前置代码块；无前置则取首个后置代码块，不跨课时，也不从 HTML/Markdown 猜测源码。邻居块按同样的 `code/presentation.code/trace 首 variant/template` 顺序取直接代码，并清除邻居的两种静态高亮，避免沿用上一段讲解的行与片段。服务器以 trace 首 variant 校验块的静态 `focusLines/focusSpans`，播放期间选中 variant 的 frame.line/focusSpans 已分别验证有效。

填空改动了程序时，完整 `execution.template` 优先于共享参考程序，使用户看到实际带 `{{ANSWER}}` 缺口的代码；若另有 `block.code`，它必须是同一个未解答程序。完整程序题的 `code` 可以复用 `input.starterCode` 骨架，不能公开标准解答。参考程序只帮助阅读，不自动运行，也不从 `acceptedAnswers` 或解析合成补全代码。旧课程无须重发即可使用同课时来源回退；新字段不更改课程 ID、题目 ID、运行配置或进度格式，基础协议与 extensionVersion 保持不变。

### 编程练习

`question` 可增加 `code:Code` 作为题目上下文，`hints:[String]` 提供最多 5 条逐级提示（每条非空最多 2000）。源码和提示可配合单选、多选或简答，方便制作找错题、声明辨认、填空和输出预测。选择题仍只提交选项 ID。

`shortAnswer` 可增加 `answerFormat`：

| 值 | 语义 | 作答 / 每项参考答案长度 |
|---|---|---|
| 省略或 `text` | 原有自然语言简答；参考答案忽略大小写并合并空白 | 4000 / 500 |
| `code` | 代码、表达式、声明或填空 | 20000 / 20000 |
| `output` | 预测程序输出 | 8000 / 8000 |

`code` / `output` 比较时统一 CRLF/CR 为 LF、去除答案首尾空白，**保留内部空白并区分大小写**。例如 `Value` 不等于 `value`，`"a b"` 不等于 `"a  b"`。这是对作者参考答案的文字核对，不是编译器、判题沙箱或 C++ 语义等价检查；不同正确写法应列入 `acceptedAnswers`。省略或空参考答案仍表示不自动判分，课时完成仍只要求有效作答，不要求答对。

#### 输入方式与编辑器

仅 `shortAnswer` 支持 `input`，发布课程时即可指定，不依赖客户端猜测题目文字：

| 字段 | 约定 |
|---|---|
| `kind` | 必填，`text`、`integer`、`decimal`、`code` |
| `language` | 仅 code，可选 `javascript`、`python`、`cpp`；用于语法着色 |
| `placeholder` | 可选，最多 500，简短说明需要填什么，不堆入题干 |
| `starterCode` | 仅 code，可空，最多 20000；首次作答的初始源码，不覆盖已保存的答案或用户草稿 |
| `minLines` / `maxLines` | 可选整数，各为 2–24，双提供时 max 不小于 min；指定编辑区行数而非整屏高度 |

`integer` 接受带可选正负号的十进制整数，例如 `0`、`-12`；`decimal` 额外接受小数点，例如 `3.5`、`-.5`、`2.`。数值输入使用紧凑数字输入面板；不把数值题强行变成多行文字编辑。代码编辑区以等宽字体和语言着色呈现，保留缩进和换行。输入类型不会自动修改用户的作答内容。

未提供 `input` 时保持旧课程兼容：`answerFormat=code` 或显式配置 `execution` 使用代码编辑器，其余为普通文字；代码语言优先来自 execution，再取题目 `code.language`，再默认 JavaScript。旧代码语言的常见别名可以识别，未知语言仍以等宽普通源码呈现。`input.kind=code` 的答案与参考答案各最多 20000，文本核对使用 code 的字面规则；其余仍沿用 answerFormat，不将数值相等误称为文字相等。

#### 主动运行作答

仅 `shortAnswer` 可声明 `execution`。它使题目提供独立的运行操作；保存答案、检查 acceptedAnswers 和切换课时不会暗中运行源码。没有该字段的旧代码题继续只保存与核对文字。

| 字段 | 约定 |
|---|---|
| `language` | 必填，`javascript`、`python`、`cpp`；与显式代码输入语言相同 |
| `template` | 可选，非空最多 20000，必须恰含一次 `{{ANSWER}}`；用用户答案原样替换这一处，适合表达式、语句或数值填空 |
| `stdin` | 可选，可空最多 4000；完整程序的标准输入 |
| `expectedOutput` | 可选，可空最多 8000；作者提供的参考输出，只检查这一组输入输出，不表示通用判题 |

未提供 template 时运行用户的完整代码；非 code 输入要运行时必须提供 template。模板使用语言本身的语法组织填空位置，不自动添加引号、不转义成字符串。运行结果与 acceptedAnswers 的文本评分分开呈现，开放程序题不要穷举源码文本作为标准答案。编写 starterCode 时给出可修改的骨架，不直接泄露填空答案；提供确定、轻量的样例输入和输出。

在线制作规范要求 Python/C++ 编程练习显式配置 `execution`：数值填空用 `integer/decimal` 加完整模板，表达式/语句填空用对应语言的 `code` 输入加模板，模板恰含一次 `{{ANSWER}}`；完整程序题用 `code` 输入与 `starterCode` 骨架，并省略模板。每道运行题提供 `execution.stdin`（无输入用空字符串）与 `execution.expectedOutput`，后者来自完整参考程序对默认输入的输出，不是填入的片段，也不能只放在展示用 `code` 字段里。Python 兼容 3.11 标准库、C++ 兼容 g++ 12.2 支持的 C++20 标准库并包含完整 `main`，不要求安装依赖、联网或使用图形界面；样例保持轻量且确定。多种正确源码的题目省略 `acceptedAnswers`，只把本组样例输出作为运行反馈，不宣称隐藏测试或通用判题。此要求同时进入自动上传与手动制作规范；AI 访问短引导中的地址时获取最新要求，无需重建发布密钥。

数值代码填空示例：

```json
{
  "id": "c0000000-0000-4000-8000-000000000021",
  "type": "question",
  "text": "补全循环上限，让程序输出 10。",
  "questionType": "shortAnswer",
  "input": {"kind":"integer","placeholder":"输入一个整数","minLines":2,"maxLines":2},
  "acceptedAnswers": ["4"],
  "execution": {"language":"javascript","template":"let sum = 0; for (let i = 0; i <= {{ANSWER}}; i++) sum += i; console.log(sum);","expectedOutput":"10"},
  "explanation": "0 + 1 + 2 + 3 + 4 = 10。"
}
```

完整程序练习可使用 `"input":{"kind":"code","language":"python","starterCode":"a, b = map(int, input().split())\n# 计算并输出最大公约数\n","minLines":8,"maxLines":16}`，配合 `"execution":{"language":"python","stdin":"12 18","expectedOutput":"6"}`。只有用户主动运行时才提交运行请求；作者不指定运行主机或自定义执行命令。

JavaScript 使用本机一次性离线 Web Worker，禁止联网并限制运行时间为 2 秒。Python / C++ 使用已登录账户的独立执行接口：

```text
POST /api/native/v1/courses/:uuid/run
Content-Type: application/json

{"courseRevision":1,"lessonID":"课时 UUID","blockID":"题目 UUID","text":"用户答案","stdin":"可选的本次输入"}
```

请求沿用课程读取的会话和空间权限；服务器从对应课程版本读取 execution，不接受用户自定义编译命令或运行目标。成功响应为 `data:{status,stdout,stderr,exitCode?,durationMs,passed?}`。`passed` 仅在提供参考输出时比较本次输出；运行不会保存答案、改变完成度或课程源码。工作坊生产环境已于 2026-10-18 启用 Python / C++ 的独立 rootless Docker 受限运行服务，运维与资源边界见 [COURSE-EXECUTION.md](COURSE-EXECUTION.md)。其他部署仍须配置 Unix socket；未配置或服务不可用时返回 `unavailable`，不回退到直接在 API 主进程或宿主环境执行源码。

```json
{
  "id": "c0000000-0000-4000-8000-000000000020",
  "type": "question",
  "title": "补全声明",
  "text": "填写把 twice 的地址存入 operation 的完整声明。",
  "questionType": "shortAnswer",
  "answerFormat": "code",
  "code": {"language":"cpp","source":"int twice(int x) { return x * 2; }\n// 在这里补全函数指针声明"},
  "hints": ["声明中需要把指针名放进括号。", "返回类型和参数类型都是 int。"],
  "acceptedAnswers": ["int (*operation)(int) = twice;", "int (*operation)(int) = &twice;"],
  "explanation": "operation 保存与 twice 签名兼容的函数地址。"
}
```

### 给界面实现者

Swift 类型定义位于 `Shared/Core/CourseModels.swift`：`CoursePresentation` / `CoursePresentationKind`、`CourseCodeSample`、`CourseCodeSpan`、`CourseTableContent`、`CourseTeachingItem`、`CourseFlashcardContent`、`CourseAnswerFormat`、`CourseQuestionInput` / `CourseQuestionInputKind`、`CourseExecutionConfiguration`。入口是 `course/lesson.referenceCode`、`code.highlightSpans`、`block.focusLines/focusSpans/presentation`、`frame.focusSpans`、题目 `block.code/hints/answerFormat/input/execution`、计算属性 `block.resolvedInput` 和 `lesson.objectives/estimatedMinutes`。原 `CourseBlockType`、`CourseQuestionType` 枚举未增加分支，不会要求现有 `switch` 改写；新客户端编码解码会保留扩展数据。

界面可把代码展示为等宽文本、按行高亮与注解；步骤逐步展开；对照并排或纵向切换；卡片翻面；提示逐级揭示。它们都是同一份结构化课程的展示方式。不要重新解析兼容 `text` 来猜测结构，普通文档文字和 Code 不进入 HTML 执行环境，只有显式 HTML/SVG presentation 进入专用离线沙盒。引用块与作答继续使用原 UUID，展示拆分不能生成新题目 ID。

## 给 Agent 的约定

优先遵从用户指定；未指定时自行决定课时拆分、块类型和练习形式。优先清楚简短的原生教学序列，逐步程序语义用 trace；按需要补充代码框、Markdown、SVG 和练习，HTML 只用于原生无法表达的特殊交互。图表用于真正有数据的内容，不为装饰填入虚构统计。不得凭空编造参考答案或版权图片来源。发布已获用户请求授权时直接执行；只在无法决定教学目标、目标账户或会覆盖未知版本等实质问题时询问。新建课程生成新 UUID，更新保留已有结构 ID 并使用已知 revision；重试保留原 key、字节正文和 If-Match。只有 HTTP 成功后才报告已发布；把版本冲突解释为需要获取最新课程后再编辑。App 可复制的短引导由服务器 `coursePrompt` 输出，指向完整在线规范，并在本地替换独立的密钥占位符。

## 教学规范与手动导入

服务器提供手动导入与自动发布两种在线规范，App 只复制指向对应规范的短引导。两种规范均明确等待用户的下一条学习主题或资料，不把规范本身当成教学内容。AI 自行推断水平、目标和课时，按概念解释、具体例子或图形、练习、反馈组织课程；受支持块与完整有效 JSON 示例均包含在规范网页及纯文本接口内。禁止虚构统计、图片地址和参考答案。

`prompt` 面向有 HTTP 工具的 Agent，发布凭据仅放 Authorization；若不能联网，只输出一个完整课程 JSON（建议唯一 json 代码块），不声称已上传。`manualPrompt` 只含公开规范地址和生成要求，不含凭据，用户可直接复制给能读取网页的 AI；生成的课程通过 App 的“粘贴课程并上传”（课程页右上角 + 或课程 API 设置中）在当前登录空间保存。获取和复制 manualPrompt 不会创建密钥，注册/登录 session 已有权限即可导入。更新课程时由 App 核对当前版本，不猜测覆盖。

## 服务器托管的学习界面：WORKSHOP-PLAYER/1

新客户端把学习区交给服务器生成的离线 HTML 页面，原生外壳保留账户、课程目录、进度持久化、真实代码运行和上下步按钮。AI 仍上传上述 `WORKSHOP-COURSE/1` 结构化课程；服务器负责可信页面的 HTML/CSS/JavaScript，不允许 AI 上传或替换可信壳。旧客户端继续读取原 JSON，现有上传文档无需迁移。

已登录客户端请求：

```http
GET /api/native/v1/courses/{courseID}/player?lessonID={lessonUUID}
Authorization: Bearer {App session token}
Accept-Encoding: gzip
X-Workspace-ID: {optional shared workspace ID}
```

权限与课程读取相同，使用当前有权访问的个人或共享工作空间，不能通过课程发布密钥读取。不接受额外查询参数、重复 `lessonID` 或不存在的课时；课程被撤销共享、删除或课程 ID 不属于当前工作空间时拒绝。成功响应：

```json
{"data":{"protocol":"WORKSHOP-PLAYER/1","rendererVersion":"2026.10.21.2","courseID":"UUID","lessonID":"UUID","courseRevision":1,"html":"<!doctype html>…"}}
```

每次进入课时可重新获取当前 renderer；相同课程 revision 的教学内容也可以因 renderer 版本更新而获得新的布局、样式和互动逻辑。HTML 单课时上限 4 MiB，响应支持 gzip；服务端采用总容量 16 MiB 的 LRU，缓存键包含工作空间所有者、课程、课时、课程 revision 与 rendererVersion。HTTP 使用 `private, no-store`，缓存不保存任何人的答案、会话或凭据。客户端离线缓存必须按账户/工作空间/课程/课时/课程 revision 隔离，在线成功后更新，不能把服务端失败的鉴权当作离线展示授权。

当前 renderer 支持 text、callout、chart、question，以及 code、Markdown（代码围栏/标题/列表/引用/基础表格）、table、steps、comparison、flashcards、HTML、SVG、trace。完整参考程序保持可见；按行/按字高亮、trace 变体与逐帧对象/输出、选择题、带输入类型的填空和代码题可用。HTML/SVG 演示在唯一来源 `sandbox="allow-scripts"` iframe 内执行，未授予 same-origin、表单、弹窗、下载或顶层导航能力。外部图片块仅显示说明文字，不自动联网下载。

页面 CSP 禁止网络、外链资源、媒体、表单和对象；所有课程字符串安全序列化，再由 DOM `textContent` 构建。AI HTML/SVG 不得取得原生桥接、凭据或进度。WKWebView 必须额外拒绝所有子 frame 的 script message（`message.frameInfo.isMainFrame`），限制跳转仅为本地可信页面/离线 sandbox，不能只相信 JS 的消息字段。原生还必须校验 blockID 属于本课时、题目类型、消息大小、requestID、答案上限与运行配置；运行接口仍由服务端按原课程 revision 二次验证。

### 学习区与原生壳的桥接

原生调用 `window.WorkshopPlayer.receive(message)`，页面调用 `window.webkit.messageHandlers.workshopPlayer.postMessage(message)`。消息仅传递结构化数据，不能包含任意 JavaScript 求值指令。

原生发给页面：

- `init`: `{type:"init",progress:{answers:[{lessonID,blockID,selectedOptionIDs,text}],completedLessonIDs:[]},theme:"dark"|"light"}`。首次初始化恢复已保存答案，以后同类型消息可更新主题。
- `next` / `previous`: 请求继续或上一步。未提交的题目先提交并停留显示反馈；trace 先推进/退回一帧，到帧边界才翻页；HTML/SVG 可按下文注册沙盒内的演示主动作，没有可用动作时才按块翻页。
- `saved`: `{type:"saved",requestID,ok,error?}`，只能确认对应尚未完成的保存请求。
- `runResult`: `{type:"runResult",requestID,result?,error?}`，result 为现有课程运行响应。

原生前后按钮保持原生 Liquid Glass，按用户偏好悬浮在左下或右下，页面占满阅读区，不以底部整行工具栏挤占网页。`init` 还提供 `controlSide:"left"|"right"`、`hapticsEnabled:boolean`；偏好变化只更新环境，不重新载入页面或清空草稿。页面只在实际内容会进入按钮角落时保留可滚动的末尾空间，短页不固定填充整块底部空白。原生继续按钮在上、上一步在下；页面不重复显示题目提交或 trace 前后步骤按钮，重置、变体、变量与真实代码运行操作保留。

页面发给原生：

- `haptic`：`{type:"haptic",style:"selection"|"impact"|"success"|"warning"|"error"}`。只接受当前可信主框架，遵循 App 触感设置与节流；不能请求任意系统 API。普通操作使用轻触 `impact`，选项变更使用 `selection`，重复点选同一单选项不反馈。保存回答后只在判题正确时使用 `success`，错误答案或运行输出不符使用 `warning`，未配置判题的保存/运行完成仅用 `impact`；保存失败、运行异常/超时使用 `error`。普通操作约 70 ms 节流，结果按类型单独去重，紧接点按的结果反馈不会被普通操作吞掉。旧客户端不识别 `warning` 时可静默忽略，不影响保存或运行。AI HTML/SVG 内的控件仅可由宿主经当前 iframe 来源、随机 token、可见状态与样式白名单校验后转发触感，不得直接调用原生接口或提交答案。
- `ready`：可信 renderer 已挂载，原生可发送 init。
- `state`：`{type:"state",index,count,canPrevious,canNext}`，index 从 0 开始。
- `submit`：`{type:"submit",requestID,blockID,selectedOptionIDs,text}`。用户按下一步时，如当前题有未保存答案，先提交并停留当前题，必须收到成功 saved 才显示解析；用户再次按下一步才翻页。保存失败保持草稿，可重试。
- `complete`：`{type:"complete",requestID,completed:true}`，课时末尾请求完成，收到成功 saved 后才能进入下一课。
- `navigation`：`{type:"navigation",direction:"nextLesson"|"previousLesson"}`，仅边界请求，外壳决定切换课时/完成课程。
- `run`：`{type:"run",requestID,blockID,answer,stdin}`，只请求该题已声明的执行方式；原生不得接受页面自定义语言、模板、URL 或额外权限。

### HTML/SVG 演示的统一主动作

服务器托管的新学习页在每个隔离 iframe 内提供可选的 `window.WorkshopRuntime.setPrimaryAction(config)`；这与旧原生富内容读器的绘制调度 API 分开检测，不能假设所有客户端都有。`config` 仅包含沙盒内的 `next` / `previous` 函数与 `canNext` / `canPrevious` 布尔状态。状态变化后重新注册；传 `null` 取消。函数可同步或返回 Promise，宿主等待结果时禁用导航，超时可重试；作者仍应分帧绘制，不能阻塞 JavaScript 主线程。

```html
<output id="step">0</output>
<button id="next" data-workshop-primary="next">继续演示</button>
<button id="reset">重置</button>
<script>
let step = 0;
const paint = () => {
  document.querySelector('#step').textContent = step;
  window.WorkshopRuntime?.setPrimaryAction?.({
    next: () => { step++; paint(); },
    previous: () => { step--; paint(); },
    canNext: step < 3,
    canPrevious: step > 0
  });
};
document.querySelector('#next').onclick = () => { if (step < 3) { step++; paint(); } };
document.querySelector('#reset').onclick = () => { step = 0; paint(); };
paint();
</script>
```

新 renderer 注册 `next`/`previous` 回调后，只隐藏带相应 `data-workshop-primary` 标记的兼容按钮；不猜测删除任意旧 HTML 按钮，旧内容未注册时仍正常操作。`canNext:false` 表示本地演示结束，下一次继续切到后续课程块；`canPrevious:false` 时上一步按课程边界回退。不要用“始终可继续”的无限演示拦住翻页。选择、拖动、重置、暂停等辅操作继续留在内容区，持久化练习仍必须建 `question`。

原生按钮只向可信主框架发送既有 next/previous；宿主仅向当前已登记的 iframe 下发带随机 token 的方向消息。注册/结果只接受当前 iframe 的 `contentWindow`、token、布尔状态、方向和本次 requestID；离开页面即清除登记。iframe 只执行自己的函数，不得发送持久答案、complete、run、navigation 或获得账户/网络/任意原生能力。原生仍拒绝子 frame 的直接桥接消息。

HTML 演示的临时实验状态不自动保存为课程答案，持久化作答必须使用标准 question。服务端 renderer 可以持续更新布局、新增兼容的组件表现与教学交互；账户、系统权限、系统通知、原生导航、原生运行授权与桥接能力的新增仍需 App 更新。协议不允许服务端绕过这些边界。

演示模式使用 `GET /api/native/v1/course-player/demo?courseID={UUID}&lessonID={UUID}` 获取同格式页面；这个公开只读通道只接受部署包 `Server/AppContent/catalog.mjs` 中 `kind=course` 的固定课程，不接受文件路径或用户内容，revision 为该发布内容条目的 version。匿名访问不能读取任何私人课程，其他参数与不存在的课程/课时一律拒绝。


## 词汇学习（服务器渲染，2026-10-25）

【词汇学习课程】
用户提供单词表、短语或希望背词时，制作词汇学习课程，沿用已有协议，不新增 vocabulary 类型或未知字段。推荐每课 3–8 个词，按“主动回忆词义 → 语境辨析 → 拼写提取 → 自主造句”组织；按目标精简，不必每个词重复全部题型。
认词使用 text 块的 presentation:{kind:"flashcards",cards:[{front,back}]}，cards 上限仍为20。front 第一行放单词或短语，第二行可放音标；back 放词性和核心释义，再用空行分隔自然例句与译文，都是纯文本，不含 HTML。不要把答案或词义放在 front 或该块 text 中。例子：front 为 adapt\n/əˈdæpt/，back 为 v. 适应；调整\n\nWe adapt our plans when the weather changes.\n天气变化时，我们会调整计划。无把握的音标或释义不要编造。
新版服务器一次显示一张闪卡，点击卡片或原生继续先揭示释义，再按继续进入下一词；上一步可回看。闪卡翻面与位置仅为当前阅读临时状态，不表示已掌握，也不是跨设备保存的记忆或间隔复习记录。不要生成第二套翻页/提交按钮或自制 HTML 背词器；无需媒体、外部词典或语音资源。
需要保存的练习必须用 question：语境辨析用 singleChoice/multipleChoice，选项均为同层次且有区分度；拼写用 shortAnswer + input.kind:"text" + acceptedAnswers，题干提供释义或留空的例句，题干、标题和 placeholder 不要泄露目标词。允许多个词形时在 acceptedAnswers 中明确枚举。自主造句省略 acceptedAnswers，给 explanation 自查参考，不能伪称 AI 自动批改。答案仍由原生继续先提交、显示反馈，再按继续翻页。词汇题无需 execution，不把拼写当作代码；不会播放音频或自动跟踪长期熟练度。
上传仍使用同一个课程发布接口、发布密钥和修订规则；手动导入仍输出完整 WORKSHOP-COURSE/1 JSON。服务器已更新演示课程中的“词汇学习：从认词到主动回忆”课时，课程无媒体，适合低带宽。只有服务器网页播放器有新版逐张交互；旧版离线阅读器可按现有 flashcards/question 显示。

完整可导入示例：`Server/Fixtures/course-vocabulary.json`。对 AI 复制的简短提示词保持不变；访问公开制作规范时会自动读到上述要求。新内容必须重新读取服务器播放器；已打开页面与旧离线缓存不会被后台强行替换。
