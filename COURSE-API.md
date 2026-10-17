# 工作坊课程接口

课程内容独立于日程快照。服务器保存课程，App 登录后在“课程”页获取并缓存；课程发布不会创建事项、提醒或重复日程。当前提供 JSON 文档协议，同时接受包含相同 JSON 的 UTF-8 纯文本。

`WORKSHOP-COURSE/1` 现提供 `structured-1` 可选扩展：结构化代码、Markdown、内联 SVG、离线 HTML/CSS/JavaScript 互动动画、表格、分步推演、对照、记忆卡片，以及带源码和提示的练习。旧文档无需迁移；本次扩展提供内容与互动能力，具体视觉呈现由客户端实现。

## 身份与账户

在已登录 App 的“配置 API 接口”中创建课程发布密钥，再把复制的课程说明交给 Agent。课程密钥以 `wsc_` 开头，绑定创建它的个人账户；请求不填写邮箱或用户 ID，也不接受 `X-Workspace-ID`。日程密钥 `wsi_` 和登录 session 均不能用于发布课程，课程密钥也不能读取日程或登录。

密钥随机生成，服务器只存 SHA-256 摘要；有效期 365 天，每账户最多 10 个，可立即撤销。明文只在创建时返回一次，不应出现在课程内容、日志、Git 或公开提示词中。

由登录 session 管理密钥：

- `GET /api/native/v1/integrations/course-tokens`：返回 `credentials`、`endpoint`、`protocol`、`schemaURL`、`extensionVersion`（`structured-1`）、`prompt`（密钥位置为 `{{API_KEY}}`）、`manualPrompt`（纯生成教程提示词，不含凭据，获取时不创建密钥）。
- `POST` 相同地址，JSON `{ "name": "课程发布" }`（name 可省略）：201 返回 `credential`、`accessToken`、`endpoint`、`protocol`、`schemaURL`、`extensionVersion`。
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

`singleChoice`、`multipleChoice` 需要 `options:[{id,text}]` 与 `correctOptionIDs`。单选恰有一个正确项，多选至少一个。`shortAnswer` 可提供 `acceptedAnswers:["答案"]`；省略或空数组表示自行核对，不伪造自动评分。原生 Code 源码与作答只作数据保存和展示，不会编译执行；HTML/SVG 则通过下文的显式 presentation 进入客户端离线沙盒，支持内联交互与动画。基础块枚举未变，不增加 HTML、视频或 iframe 的 block.type。旧 image 为兼容保留，默认不要使用；服务器只验证图片地址，不替用户请求该地址。

所有课程、课时、块 UUID 在同一文档内不能重复，统一小写存储。选项 ID 是 1–40 个 ASCII 字母、数字、下划线或连字符。未知字段或类型拒绝；服务器将所有字符串作为数据保存，不执行任何课程源码，允许 `#include <iostream>`、`std::vector<int>`、`a < b` 等源码与尖括号。禁止不支持的控制字符，普通正文与 Code 必须作为原生文字展示；仅显式 HTML/SVG presentation 在隔离沙盒中渲染，不能把其他课程字符串拼入执行环境。课程标题、课时标题最多 240 个 UTF-16 代码单元，summary 最多 2000；text/callout 正文最多 20000，题目正文及 explanation 最多 4000；caption 最多 2000，选项文字最多 1000，参考简答答案最多 500；图片 URL 最多 2048。每课程 1–40 课时，每课时 1–80 块；每图表 1–60 点，label 最多 120，value 有限且绝对值不超过 10^15；选择题 2–12 选项；参考简答答案最多 20 个。每账户最多 200 个未删除课程。

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

简答用 `text`，不同时提交选项。普通文字最多 4000、代码最多 20000、输出最多 8000 个 UTF-16 代码单元，按题目 `answerFormat` 校验；单次进度请求最多 128 KiB。仅改变课时完成状态时，省略 blockID/答案字段并提交 `completed:true/false`；也可在答题请求附上 completed。标记完成前该课时的每道题都必须有有效作答，不要求全对。未作答 409 `COURSE_ANSWERS_REQUIRED`。旧课程版本的提交 409，不能用重试恢复旧版答案。

mutationID 以学习者、空间、课程隔离；同 ID 同正文重试不会再次修改，返回当前进度（避免旧响应倒退当前界面），同 ID 不同正文 409。每课程每学习者最多 20000 个不同 mutation，进度总大小最多 2 MiB。保存过程在读完正文后于事务内重新验证 session 和关联权限。此版本使用拉取同步，不依赖 APNs，不向关闭的 App 承诺即时更新。

## 结构化扩展 `structured-1`

### 兼容与发现

基础 `protocol` 仍为 `WORKSHOP-COURSE/1`。现有五个 `type`、三种 `questionType`、UUID、revision、幂等与完成条件保持兼容。新字段全部可选，普通课程仍按原方式读写。

`GET /api/integrations/v1/courses/schema` 返回不含账户数据的 JSON Schema，**直接返回 Schema 对象，不使用 `data` 包裹**。课程凭据元数据同时返回 `schemaURL` 与 `extensionVersion`。离线版本见 [Server/course.schema.json](Server/course.schema.json)，完整可导入的 C++ 例子见 [Server/Fixtures/course-programming.json](Server/Fixtures/course-programming.json)。Schema 表达字段与长度上界；全局 UUID 唯一、表格行宽、有效代码行号等跨字段条件仍由服务端与 Swift 验证。

课时可增加 `objectives:[String]`（最多 6 条，每条 1–500）和 `estimatedMinutes`（1–180 的整数）。任意块可增加非空 `title`（最多 240）。它们用于内容组织，不改变完成条件。

`text` / `callout` 可增加 `presentation`。必须保留完整、有阅读价值的 `text` 作为兼容退路；旧展示端可继续阅读，支持扩展的界面优先展示结构化内容，避免重复输出两份正文。不要只在退路写“见代码”或“见上图”。

| `presentation.kind` | 唯一对应内容 | 适合用途 |
|---|---|---|
| `code` | `code: Code` | 源码、输入输出、行高亮与注解 |
| `table` | `table:{columns:[String],rows:[[String]]}` | 变量追踪、地址与值、复杂度对比 |
| `steps` | `steps:[{title,text,code?}]` | 分步讲解、函数调用过程、执行推演 |
| `comparison` | `items:[{title,text,code?}]` | 正反例、两种写法或思路的比较 |
| `flashcards` | `cards:[{front,back}]` | 概念回忆、先思考再揭示解释 |
| `markdown` | `markdown:{source}` | 标题、列表、表格、引用与带语言名的代码围栏 |
| `html` | `html:{source,height?}` | 内联 CSS/JavaScript、SVG/canvas、滑块按钮与交互动画 |
| `svg` | `svg:{source,height?}` | 不依赖位图的矢量图解和轻量动画 |

`presentation` 只允许 `kind` 和对应的一个载荷字段，不混放多个形式，不任意递归嵌套。表格 1–8 列、1–60 行，每行格数必须与列数一致；列名非空最多 120，单元格可空最多 2000。步骤 1–20 项，对照 2–4 项；每项 `title` 非空最多 240，`text` 非空最多 4000，`code` 可省略。记忆卡 1–20 张，`front` 非空最多 2000、`back` 非空最多 4000。所有长度按 UTF-16 代码单元计。

### 富内容与离线演示

`markdown.source` 非空最多 20000 个 UTF-16 代码单元；`html.source` / `svg.source` 非空最多 60000。HTML/SVG 的 `height` 可省略，提供时为 120–640 的整数（显示点），Markdown 不接受 height。三种载荷只允许表中字段，HTML/SVG 均须保留完整 `text` 退路。示例见 [Server/Fixtures/course-rich.json](Server/Fixtures/course-rich.json)。

编程课优先用 `Code` 专用代码框，或 Markdown 的带语言名围栏。HTML 用于可实际操作的概念演示，例如指针指向、排序交换、递归栈和时间复杂度，不假称运行了原生 C++/Python。SVG 通过 viewBox 适配移动屏，适合代替图片。HTML 可使用完全内联的样式、脚本和 canvas，无需安装插件或下载资源。演示应尊重 `prefers-reduced-motion`，动画附暂停/重置控制，避免固定宽度和无休止后台循环。

客户端隔离渲染富内容：不提供账号信息、凭据或原生桥接，使用非持久网页数据；沙盒和 CSP 禁止网络请求、外链脚本/样式/字体、导航、嵌入、图片、音频、视频及 worker。作者不要使用 CDN、iframe/object/embed、data/base64、SVG image/foreignObject 或任何外链资源。Markdown 不启用原始 HTML，也不加载图片；要交互请使用 html presentation。服务器只验证字段、限额并存储源码，不运行它，也不靠字符串黑名单判断教学源码。沙盒允许内联 JavaScript 演示，不代表可访问服务器、App 数据或设备能力。

单课程仍最多 1 MiB，不提供图片/视频上传或转码服务，默认不用旧 image 块。丰富形式优先靠文字、矢量和短脚本完成，避免给小服务器增加媒体存储与传输负担。

### `Code` 对象

```json
{
  "language": "cpp",
  "filename": "main.cpp",
  "source": "#include <iostream>\nint main() { std::cout << 6; }",
  "highlightLines": [2],
  "annotations": [{"line": 2, "text": "输出整数 6。"}],
  "stdin": "",
  "expectedOutput": "6"
}
```

只有 `language`、`source` 必填。`language` 是 1–40 个 ASCII 字母、数字或 `+ - . _`，例如 `cpp`、`c++`、`python`、`plaintext`；不限定课程语言。`source` 非空最多 20000，`filename` 非空最多 240（仅显示名称，不作为文件路径执行），`stdin` 可空最多 4000，`expectedOutput` 可空最多 8000。

`highlightLines` 最多 200 个不重复的有效行号，`annotations` 最多 40 条，行号不重复、注解非空最多 2000。行号从 1 开始，按源码实际的 CRLF/CR/LF 行分隔计算；超出范围拒绝。`expectedOutput` 是作者提供的教学参考，不表示服务器已运行或验证代码；不凭空编造编译结果。

### 编程练习

`question` 可增加 `code:Code` 作为题目上下文，`hints:[String]` 提供最多 5 条逐级提示（每条非空最多 2000）。源码和提示可配合单选、多选或简答，方便制作找错题、声明辨认、填空和输出预测。选择题仍只提交选项 ID。

`shortAnswer` 可增加 `answerFormat`：

| 值 | 语义 | 作答 / 每项参考答案长度 |
|---|---|---|
| 省略或 `text` | 原有自然语言简答；参考答案忽略大小写并合并空白 | 4000 / 500 |
| `code` | 代码、表达式、声明或填空 | 20000 / 20000 |
| `output` | 预测程序输出 | 8000 / 8000 |

`code` / `output` 比较时统一 CRLF/CR 为 LF、去除答案首尾空白，**保留内部空白并区分大小写**。例如 `Value` 不等于 `value`，`"a b"` 不等于 `"a  b"`。这是对作者参考答案的文字核对，不是编译器、判题沙箱或 C++ 语义等价检查；不同正确写法应列入 `acceptedAnswers`。省略或空参考答案仍表示不自动判分，课时完成仍只要求有效作答，不要求答对。

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

Swift 类型定义位于 `Shared/Core/CourseModels.swift`：`CoursePresentation` / `CoursePresentationKind`、`CourseCodeSample`、`CourseTableContent`、`CourseTeachingItem`、`CourseFlashcardContent`、`CourseAnswerFormat`。入口是 `block.presentation`、题目 `block.code/hints/answerFormat` 和 `lesson.objectives/estimatedMinutes`。原 `CourseBlockType`、`CourseQuestionType` 枚举未增加分支，不会要求现有 `switch` 改写；新客户端编码解码会保留扩展数据。

界面可把代码展示为等宽文本、按行高亮与注解；步骤逐步展开；对照并排或纵向切换；卡片翻面；提示逐级揭示。它们都是同一份结构化课程的展示方式。不要重新解析兼容 `text` 来猜测结构，普通文档文字和 Code 不进入 HTML 执行环境，只有显式 HTML/SVG presentation 进入专用离线沙盒。引用块与作答继续使用原 UUID，展示拆分不能生成新题目 ID。

## 给 Agent 的约定

优先遵从用户指定；未指定时自行决定课时拆分、块类型和练习形式。形式尽量丰富，按教学需要组合代码框、Markdown、SVG、HTML 交互动画和练习；优先用内联矢量代替图片。图表用于真正有数据的内容，不为装饰填入虚构统计。不得凭空编造参考答案或版权图片来源。发布已获用户请求授权时直接执行；只在无法决定教学目标、目标账户或会覆盖未知版本等实质问题时询问。新建课程生成新 UUID，更新保留已有结构 ID 并使用已知 revision；重试保留原 key、字节正文和 If-Match。只有 HTTP 成功后才报告已发布；把版本冲突解释为需要获取最新课程后再编辑。App 可复制的权威提示词由服务器 `coursePrompt` 输出，自动填入端点，并在本地替换密钥占位符。

## 教学提示词与无网络导入

服务器提供两种权威提示词，均明确等待用户的下一条学习主题或资料，不把提示词本身当成教学内容。AI 自行推断水平、目标和课时，按概念解释、具体例子或图形、练习、反馈组织课程，受支持块与完整有效 JSON 示例均包含在提示词内。禁止虚构统计、图片地址和参考答案。

`prompt` 面向有 HTTP 工具的 Agent，发布凭据仅放 Authorization；若不能联网，只输出一个完整课程 JSON（建议唯一 json 代码块），不声称已上传。`manualPrompt` 完全不含凭据或网络配置，用户可直接复制给普通 AI；生成的课程通过 App 的“粘贴课程并上传”（课程页右上角 + 或课程 API 设置中）在当前登录空间保存。获取和复制 manualPrompt 不会创建密钥，注册/登录 session 已有权限即可导入。更新课程时由 App 核对当前版本，不猜测覆盖。
