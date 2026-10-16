# 自建服务器 API v1

客户端只连接用户配置的 HTTPS 地址，拒绝重定向，不携带 Sites 身份头或服务访问凭据。下面的接口已经在 `Server/server.mjs` 实现，可用作你自己后端的参考。

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/`、`/index.html` | GET/HEAD | 同账号只读网页版 |
| `/app.js`、`/app.css`、`/favicon.svg` | GET/HEAD | 同源网页资源 |
| `/native-login` | GET/HEAD | 原生 App 专用账号密码／通行密钥认证页，必须带有效 S256 请求 |
| `/native-login.js` | GET/HEAD | 专用认证页资源；不写浏览器 storage |
| `/health` | GET | 无鉴权运行检查 |
| `/api/native/v1/session` | POST | 邮箱/密码登录 |
| `/api/native/v1/session` | DELETE | 撤销当前会话 |
| `/api/native/v1/web-auth/authorize` | POST | Bearer 认证后签发一次性 App 授权码并撤销本次浏览器会话 |
| `/api/native/v1/web-auth/token` | POST | 以 PKCE verifier 兑换原生会话，无需 Bearer |
| `/api/native/v1/passkeys/login/options` | POST | 开始 discoverable 通行密钥登录 |
| `/api/native/v1/passkeys/login/verify` | POST | 验证通行密钥并建立会话 |
| `/api/native/v1/passkeys/register/options` | POST | 已登录账号开始新增通行密钥 |
| `/api/native/v1/passkeys/register/verify` | POST | 验证并保存新通行密钥公钥 |
| `/api/native/v1/passkeys` | GET / DELETE | 已登录账号列出或撤销通行密钥 |
| `/api/native/v1/passkeys/recovery/options` | POST | 用服务器本机签发的一次性令牌开始创建首枚通行密钥 |
| `/api/native/v1/passkeys/recovery/verify` | POST | 验证首枚通行密钥、消费令牌并建立会话 |
| `/api/native/v1/workspace` | GET | 读取账号的快照与服务器 revision |
| `/api/native/v1/workspace` | PUT | 按 If-Match 原子更新完整快照 |
| `/api/native/v1/devices` | PUT | 登记本账号的 APNs 设备 |
| `/api/native/v1/devices` | DELETE | 注销本账号设备 |

网页资源、健康检查、AASA、部署 revision、登录入口和一次性授权码兑换不要求 Bearer；工作空间、设备、通行密钥注册/管理、网页登录授权及退出均要求 `Authorization: Bearer <accessToken>`。成功响应使用 `{ "data": ... }`；失败使用 `{ "error": { "code": "..." } }`。会话过期返回 401；版本冲突返回 409；缺少 If-Match 返回 428；校验失败返回 422。

## 只读网页版

根路径的网页是 API 的同源客户端。它支持密码登录、discoverable passkey 登录和登录后创建新通行密钥，只读取 GET workspace；没有编辑入口，也不会调用 PUT workspace。行动入口包含 PROJECT/TASK/MILESTONE/REMINDER，另一个主入口只显示 DEADLINE。

日期型 DDL 截止于记录时区的 23:59:59，带时刻 DDL 使用保存的绝对时间；浏览器按秒更新显示，并在页面可见时每 30 秒重新读取服务器 revision。Bearer token 与账号显示信息只保存在当前标签页 `sessionStorage`。页面不用第三方资源，用户字段以 `textContent` 渲染，并设置 no-store、self-only CSP、frame-ancestors none、COOP、Permissions-Policy、no-referrer 和 nosniff。

## 登录

请求 `{ "email": "你配置的邮箱", "password": "你配置的密码" }`，响应 `data` 包含 `accessToken`、`displayName`，可选 `refreshToken`。原生客户端将服务器地址和令牌以一个 Keychain 项原子保存，不写入 UserDefaults、日志或备份文件。

初版后端会话有效期为 30 天，没有实现 refresh endpoint；失效后重新登录。登录限流按连接 IP；生产环境应结合反向代理配置精确客户端 IP 和更完善的账号限流。

### 网页认证后返回 App

Personal Team 测试版可通过系统网页认证会话打开同源 `/native-login`。原生客户端用系统随机数生成 verifier 和独立 state，将 verifier 的 SHA-256 base64url 值放入 `code_challenge`，同时传入 `code_challenge_method=S256` 与 `state`。challenge、state 均须为 43 字符 base64url；拒绝缺失、重复或额外 query 参数，包括任意 `redirect_uri`。生产 origin 使用配置的 HTTPS `PASSKEY_ORIGIN`。

专用页复用密码／已有通行密钥登录 API；密码与临时 Bearer 仅保存在内存，不读取或写入普通网页版的 `sessionStorage`。认证后 POST `/api/native/v1/web-auth/authorize`，发送 `Authorization: Bearer <临时会话>` 和 JSON `{ "codeChallenge": "...", "state": "..." }`，返回 `{ "data": { "callbackURL": "guangyi-workspace://auth/callback?code=...&state=..." } }`。回调 scheme、host、path 固定，禁止自定义跳转目标。服务器在同一事务中保存授权码哈希并撤销该临时会话；其他已登录设备不受影响。

用户点击“返回工作坊并合并”后，原生客户端校验完整回调目标与 state，再向同源 POST `/api/native/v1/web-auth/token`，发送 JSON `{ "code": "...", "codeVerifier": "..." }`，不带 Bearer。verifier 遵循 PKCE 的 43–128 字符 unreserved 格式。成功后返回常规 `data: { accessToken, displayName, account }`，由 App 保存至 Keychain，并按账号合并本地与云端内容；网页自身不读取或上传工作空间快照。

授权码为 32 随机字节，数据库只保存 SHA-256 哈希、账号 ID、challenge、state 与过期时间；有效期 90 秒，只能成功兑换一次。PKCE 不匹配、过期或重放返回 401 `INVALID_AUTHORIZATION_CODE`，不签发会话。错误 verifier 不消费合法授权码，所有授权／兑换按连接 IP 共用每十分钟 60 次限流。兑换与建立会话在一个事务中完成；数据库错误不丢失有效授权码。授权／兑换 body 上限 2048 字节，仅接受 JSON。带 Origin 的请求必须与配置 origin 完全一致，跨站请求被拒绝；原生兑换可不带 Origin。认证页和 JSON 响应设置 no-store 与 no-referrer，返回链接禁止包含长效 accessToken。

### 忘记密码且尚无通行密钥

服务器本机管理员可在当前 release 使用服务运行用户执行：

```bash
node server.mjs issue-passkey-recovery /实际数据库路径 [账号邮箱]
```

只有一个账号时可省略邮箱。命令直接访问 SQLite，因此不能从公网调用；它会输出一个十分钟有效的一次性 HTTPS 链接。链接秘密位于 URL fragment，浏览器读取后立即从地址栏和历史项移除，再以 POST body 发送。数据库只保存 SHA-256 哈希；同账号重新签发会废止旧链接，成功登记公钥与消费链接在同一事务完成。恢复不会重建账号、修改密码或替换工作空间，成功后直接建立该账号的作用域会话。管理员应通过受信任的本机界面把链接交给账号本人，不应写入工单、聊天记录或长期日志。

## 快照

GET 响应 `{ "data": { "revision": 0, "snapshot": { ... } } }`。PUT 发送 `{ "snapshot": { ... } }`，附带 `If-Match: "0"`；成功后 revision 增加一，返回同一结构。服务端在事务中比较旧版本、保留历史并保存新快照。

snapshot 与原生导出 JSON 一致：

```json
{
  "format": "guangyi-native",
  "schemaVersion": 1,
  "records": [],
  "series": [],
  "activities": [],
  "revisions": [],
  "assets": [],
  "trash": [],
  "profile": { "name": "广益", "timezone": "Asia/Shanghai" }
}
```

UUID 是字符串；Date 使用带时区的 ISO 8601 字符串，导出含毫秒；Data 使用 base64。字段与可选值以 `Shared/Core/WorkspaceModels.swift` 为准。记录 kind 使用 AREA/PROJECT/MILESTONE/TASK/DEADLINE/REMINDER/KNOWLEDGE。服务器可存储该结构，不能将 body Markdown 当作 HTML 执行。

接口仍以完整快照和单调 revision 为边界。客户端登录成功后自动合并本地与云端内容；之后以本机保存的账号专属远程基线做三方合并，并用 If-Match 上传。同一记录两端并发修改时暂停自动同步，要求用户逐项审阅；不会把当前 PUT 当作无条件定期覆盖。若后续改成操作日志式增量协议，还应增加 operationID 幂等、变更游标与附件单独传输。

原生客户端在 PUT 时附带 `X-Workspace-Device-ID`（UUID）。服务器只用它跳过向来源设备发送静默 revision 提示；它不是身份凭据，鉴权仍完全依赖 Bearer 会话。旧客户端可以省略此头。

## 设备注册

PUT 请求字段：deviceID（UUID）、platform（iOS/macOS）、token（十六进制 APNs 设备令牌）、bundleID、environment（sandbox/production）。响应 `{ "data": { "registered": true, "deliveryEnabled": false } }`；deliveryEnabled 反映是否配置发送器，注册成功不代表设备已收件。

DELETE 请求 `{ "deviceID": "..." }`，只允许注销当前账号的设备。退出登录时客户端先注销设备，再撤销会话；网络不可达时仍清除本机 Keychain，但服务器会话可能持续至过期。

## APNs payload

服务端发送：

```json
{
  "aps": {
    "alert": { "title": "广益 WorkSpace · 提醒", "body": "提醒标题" },
    "sound": "default",
    "category": "WORKSPACE_REMINDER"
  },
  "id": "原生记录 UUID",
  "scheduledAt": 1792045800000
}
```

`scheduledAt` 是这一次提醒时刻的 Unix 毫秒值。本机和远程通知操作都会把它与记录当前的提醒时刻比较；记录完成、关闭通知、改期或稍后提醒后，旧横幅不能再完成或延后当前记录。同步重新安排提醒时还会从通知中心移除这些失效横幅。

工作空间成功写入新 revision 后，已配置 APNs 的服务器还发送静默提示：

```json
{
  "aps": { "content-available": 1 },
  "kind": "WORKSPACE_SYNC",
  "revision": 17
}
```

提醒使用 alert push-type、优先级 10；同步提示使用 background push-type、优先级 5，并以工作空间固定折叠键只保留最新 revision。使用 ES256 provider JWT、对应 bundleID 的 apns-topic，以及独立 sandbox/production 服务，私钥只留在服务器。客户端仅在提示 revision 新于当前账号检查点时拉取；iOS 在 25 秒内未完成会取消任务并及时结束系统回调。通知点击对应的记录尚未在本机时，也会先尝试账号自动同步再定位。

后台初版每 30 秒检查到期记录，只补发过去 24 小时内、设备登记后到期的通知。按设备/记录/提醒时刻生成派发键，成功去重，失败后租约到期重试，410 清理失效设备。完成、归档、删除、停用通知和改期都会重新核验。服务已接受但成功状态尚未保存时发生进程中断，仍可能重复发送，不能承诺严格一次交付。

本地与远程通知为两种独立通道。远程验证成功后，可在设置中关闭本机定时提醒，避免重复。
