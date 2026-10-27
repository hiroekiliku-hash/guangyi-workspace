# C++ 设计题（服务器网页框架）

使用 `WORKSHOP-CPP-EXAM/1` 封装发布，内部 `course` 仍投影为兼容的 `WORKSHOP-COURSE/1`，客户端网页容器与原生上下步按钮继续使用 `WORKSHOP-PLAYER/1`。不增加客户端调试权限。

完整可上传示例见 `Server/Fixtures/course-cpp-exam.json`。发布地址仍是 `/api/integrations/v1/courses`，使用课程发布密钥、Idempotency-Key，更新时必须使用正确 If-Match。手动入口为 `/course-cpp-import`，密钥不放网址或 localStorage。既有 App 的普通课程导入器只接受普通课程文档；设计题封装应通过上述网页或 API 发布。

## 三种题型

- `understanding`：公开完整 `block.code`，题干指定要填写的输出。`grading.kind=compare` 按完整答案比对，不把学生输入作为代码编译。
- `fill`：`template` 是完整程序，有 1–8 个唯一 `{{id}}` 空格，`blanks:[{id,label}]` 定义片段编辑区。学生提交保存为只有这些键的 JSON 对象；服务器用回调做字面替换，防止 `$&` 等被误当替换语法。`compare` 比较补齐后的整份源码；`tests` 实际运行。
- `program`：题干包括完整输入输出要求与数据范围。学生从空白编辑器写完整源码，包括头文件与 main；`tests` 是推荐判题方式。`compare` 仅是精确源码文本比对，不能判断等价程序。

`grading` 为 `{kind:"compare",comparison:"exact"|"tokens",acceptedAnswers:[...]}` 或 `{kind:"tests",comparison:"exact"|"tokens",tests:[{stdin,expectedOutput}]}`。`exact` 统一换行并去末尾空白、区分大小写；`tokens` 按空白分词。测试 1–8 组，stdin 每组最多4000、expectedOutput最多8000。`sampleInput` 可选，属于公开自测数据。

## 隐藏测试与保存

私有规则按 owner、course、revision、block 存入独立 SQLite 表。公共课程、课程列表、网页 HTML、进度与运行响应均不附带私有测试或标准答案。运行节点只接收输入，不接收预期答案；判题响应只给通过数量/总量，隐藏运行的 stdout、stderr 和输入不对学习者回显。编译阶段的错误诊断允许显示，自定义输入试运行可回显自己的输出。

课程更新与私有规则写入处于同一事务，受修订号与幂等控制。普通课程更新不能无声抹掉已有设计题的判题配置。运行前后重新核对账号、共享空间与修订。运行结果不代表掌握度，回答保存与进度沿用现有接口；当前完成规则仍是有效作答，不强制全对。

现有原生桥接会将与默认样例相同的 stdin 省略，因此相同输入的试运行会执行正式检查。隐藏测试不是密码学秘密，也不能保证抵御无限的自适应查询；现有账户/IP频率与并发限制继续生效。通过已配置测试集不等于算法正确性的形式证明。

## C++ 范围与资源

考试练习使用 C++17：iostream、iomanip、string、sstream、vector、array、algorithm、numeric、limits、cmath、cctype、cstring、cstdio、cstdlib、climits、cfloat、cstdint、cstddef、utility。范围是本框架的练习约定，不是任何大学考试完整规定。拒绝非字面 include、非白名单头文件、替代预处理符号、宏拼接、系统/调试调用与自定义编译参数。源码检查是课程配置限制，实际安全边界仍是原有隔离容器，不声称静态词法检查等价于完整 C++ 沙盒。

同次提交在一次性容器里编译一次，再以独立进程运行各测试。没有 -g、断点、单步或调试器通道。编译上限5秒，测试共享4.5秒、单组最多1.5秒，容器256MiB、无网络、非root、只读根、丢弃capabilities并限制进程与输出。编译和运行超时会诚实返回；不会把运行服务缺失当作通过。

## 电脑编辑体验

C++ 代码区使用文本层着色，不把源码拼进 HTML。支持 Tab/Shift+Tab、自动缩进、Ctrl/Command+Enter 检查。输入时只更新代码着色层，不重建整节课。题干/参考代码与作答区在大屏并排，小屏上下排列，编辑区随内容与可用视口调整。继续先判题并保存，再次继续才翻页；显式运行与自定义标准输入保留，不复制一套提交答案按钮。

服务器运行节点需要更新 runner、container-exec、cpp-basic-policy 与镜像；仅发布 API 而未更新节点时，测试集判题会返回 unavailable，不能声称启用。
