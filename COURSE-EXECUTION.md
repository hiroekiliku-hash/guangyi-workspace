# 课程作答与代码运行

课程仍采用 `WORKSHOP-COURSE/1`；新增字段均可省略，旧课程照常使用。普通代码展示、Markdown 与 trace 不会自动执行。只有 `questionType: "shortAnswer"` 的题目可以声明 `input` 和 `execution`。

## 输入契约

```json
{
  "input": {
    "kind": "code",
    "language": "cpp",
    "placeholder": "编写一个输出 42 的程序",
    "starterCode": "#include <iostream>\nint main() {\n    \n}",
    "minLines": 4,
    "maxLines": 16
  },
  "execution": {
    "language": "cpp",
    "stdin": "",
    "expectedOutput": "42"
  }
}
```

- `kind`: `text`、`integer`、`decimal`、`code`。数字在 App 使用紧凑数字键盘，代码使用多行语法高亮编辑器。
- `language`: 仅 code 输入可提供；运行支持 `javascript`、`python`、`cpp`，与 execution 同时提供时必须相同。
- `placeholder` 最多 500 个 UTF-16 单元，`starterCode` 仅 code 可用，最多 20000；二者均可为空。
- `minLines`、`maxLines` 各为 2–24 的整数，同时提供时 max 不小于 min。数字输入仍紧凑显示。
- 不提供 input 时，execution 或 `answerFormat: "code"` 推断为代码输入，其他为文本输入。answerFormat 仍决定原有文本比较方式。
- integer 使用 `^[+-]?[0-9]+$`；decimal 使用 `^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$`。检查前去除首尾空白；不接受指数、逗号、NaN、Infinity。acceptedAnswers 也须符合声明的数字格式。

填空题可以用课程作者指定的完整程序模板包裹学生答案：

```json
{
  "questionType": "shortAnswer",
  "answerFormat": "output",
  "input": { "kind": "integer", "placeholder": "输入整数" },
  "execution": {
    "language": "cpp",
    "template": "#include <iostream>\nint main() { std::cout << {{ANSWER}}; }",
    "expectedOutput": "42"
  }
}
```

`template` 非空，最多 20000，必须恰好包含一次 `{{ANSWER}}`，以字面方式替换，禁止 shell 拼接。显式非 code 输入必须提供模板；完整代码题可省略模板。stdin 最多 4000，expectedOutput 最多 8000；实际执行作答最多 20000。模板、默认输入、预期输出是公开教学数据，不适合保存秘密或隐藏测试。

## 原生运行接口

`POST /api/native/v1/courses/<course UUID>/run`

使用现有登录 Bearer token，以及当前共享工作空间所需的 `X-Workspace-ID`。拥有只读课程权限的关联账户也能运行自己的答案。课程发布专用令牌不能登录此接口。

```json
{
  "courseRevision": 1,
  "lessonID": "c0000000-0000-4000-8000-000000000002",
  "blockID": "c0000000-0000-4000-8000-000000000003",
  "text": "#include <iostream>\nint main(){ std::cout << 42; }"
}
```

可以追加 `stdin`（最多 4000，空字符串也表示显式覆盖）；未知字段拒绝。服务端从持久化课程读取语言、模板、默认输入与预期输出，不接收客户端 language/source/template/expectedOutput，也不能脱离真实课程执行任意提交。请求体读取后重新验证登录与共享权限，课程版本不匹配返回 409。运行不保存/覆盖答案、学习进度或课程。

```json
{
  "data": {
    "status": "completed",
    "stdout": "42",
    "stderr": "",
    "exitCode": 0,
    "durationMs": 73,
    "passed": true
  }
}
```

状态：`completed`、`timeout`、`compileError`、`runtimeError`、`unavailable`、`outputLimit`。stdout/stderr 各最多 16 KiB，durationMs 为非负整数，exitCode 可省略。仅成功运行并存在预期输出、未覆盖 stdin 时返回 passed；统一换行并去末尾空白比较。一次示例输出核对不是通用判分，也不阻止学生编辑答案。

每账户每分钟 12 次、每 IP 每分钟 30 次；每账户同一时间 1 次，API 实例总共 2 次，繁忙返回 429 `COURSE_RUN_BUSY`。本机 JavaScript 在 App 的隔离 Worker 中运行。Python/C++ 由独立运行服务处理；没有配置时诚实返回 `unavailable`，仍可正常输入和保存答案。

## 独立 runner 运维（本次仅提供文件，尚未安装启用）

API 主进程不运行编译器、解释器、shell，也不连接 Docker socket。它只通过 `COURSE_RUNNER_SOCKET=/run/workshop-course-runner/runner.sock` 连接独立 runner 的 Unix socket。API 用户只获得这个 socket 的组权限，不加入 docker 组，不获得 Docker 引擎权限。

文件：

- `Server/course-execution.mjs`：API 到 runner 的有界 HTTP 客户端。
- `Server/CourseRunner/runner.mjs`：单独安装的 runner；固定命令启动一次性容器。
- `Server/CourseRunner/container-exec.mjs`：容器内写入临时源码、编译并运行，绝不在宿主机运行学生源码。
- `Server/CourseRunner/Dockerfile`：Node.js 24、Python 3、g++ 的预构建镜像。
- `Server/CourseRunner/workshop-course-runner.service.example`：独立 systemd 服务示例。

在专用 runner 账户/主机准备 Docker（推荐 rootless）。需要 Linux、cgroup v2、systemd cgroup 驱动、默认 seccomp，以及 CPU/内存/swap/PID 限制有效；启动前检查，不满足时拒绝启动。官方资源限制说明：[Docker run](https://docs.docker.com/engine/containers/run/)、[Rootless cgroup 条件](https://docs.docker.com/engine/security/rootless/tips/)。容器共享宿主内核；面向不受信任的公网账户开放前，宜在专用运行节点或额外内核沙盒运行，不把账户数据库挂到该节点。

1. 在 runner 主机构建已审阅镜像：`docker build -t workshop-course-runner:reviewed Server/CourseRunner`。
2. 使用 `docker image inspect --format '{{.Id}}' workshop-course-runner:reviewed` 获取镜像 ID。配置只接受 `sha256:` 加 64 位十六进制的固定镜像 ID；运行时 `--pull=never`，不临时安装依赖。
3. 将 runner.mjs 和专用 Node 可执行文件放在 `/opt/workshop-course-runner`。创建独立 `workshop-runner` 用户和 `workshop-course-api` 组，使 API 用户只加入后者。若使用 rootless Docker，runner 用户须为该引擎的所属用户；在环境文件设置对应 DOCKER_HOST 与必要的 XDG_RUNTIME_DIR。
4. 将已核对的 systemd 示例与环境文件安装到独立路径。环境文件至少包含 `COURSE_RUNNER_IMAGE=sha256:...`、`COURSE_RUNNER_DOCKER=/usr/bin/docker`、`COURSE_RUNNER_CONCURRENCY=1`。服务上限只允许 1–2 并发。
5. 使用临时测试课程验证各语言成功、编译错误、死循环、输出洪泛与引擎不可用；确认未对真实账号内容产生写入后，再给 API 环境添加 COURSE_RUNNER_SOCKET 并重启本项目服务。

每次运行：无网络、只读根文件系统、UID/GID 10001、删除全部 capabilities、no-new-privileges、默认 seccomp、256 MiB 内存及同额 memory-swap（无额外 swap）、0.5 CPU、48 PID、文件/句柄/核心转储限制。仅两个有界 tmpfs 可写，不挂载宿主目录、账户数据库、凭据或 Docker socket；日志驱动关闭。编译上限 5 秒、程序上限 2 秒、宿主整体上限 10 秒；超时和输出超限会终止并强制删除容器；无法确认已删除时停止接收新运行，待管理员处理并重启。容器内 `/workspace` 必须可执行以启动 C++ 产物，`/tmp` 使用 noexec。

本轮未操作生产服务器、安装 Docker 或启用远程代码执行。相关单元测试使用内存 SQLite、临时 socket 与假的 Docker 命令驱动；它们不能替代启用前的真实容器隔离验证。
