# 自建服务器 API v1

客户端只连接用户配置的 HTTPS 地址，拒绝重定向，不携带 Sites 身份头或服务访问凭据。下面的接口已经在 `Server/server.mjs` 实现，可用作你自己后端的参考。

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/health` | GET | 无鉴权运行检查 |
| `/api/native/v1/session` | POST | 邮箱/密码登录 |
| `/api/native/v1/session` | DELETE | 撤销当前会话 |
| `/api/native/v1/workspace` | GET | 读取账号的快照与服务器 revision |
| `/api/native/v1/workspace` | PUT | 按 If-Match 原子更新完整快照 |
| `/api/native/v1/devices` | PUT | 登记本账号的 APNs 设备 |
| `/api/native/v1/devices` | DELETE | 注销本账号设备 |

除登录和健康检查外，均要求 `Authorization: Bearer <accessToken>`。成功响应使用 `{ "data": ... }`；失败使用 `{ "error": { "code": "..." } }`。会话过期返回 401；版本冲突返回 409；缺少 If-Match 返回 428；校验失败返回 422。

## 登录

请求 `{ "email": "你配置的邮箱", "password": "你配置的密码" }`，响应 `data` 包含 `accessToken`、`displayName`，可选 `refreshToken`。原生客户端将服务器地址和令牌以一个 Keychain 项原子保存，不写入 UserDefaults、日志或备份文件。

初版后端会话有效期为 30 天，没有实现 refresh endpoint；失效后重新登录。登录限流按连接 IP；生产环境应结合反向代理配置精确客户端 IP 和更完善的账号限流。

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

接口仍以完整快照和单调 revision 为边界。客户端首次绑定账号时明确确认合并；之后以本机保存的账号专属远程基线做三方合并，并用 If-Match 上传。同一记录两端并发修改时暂停自动同步，要求用户逐项审阅；不会把当前 PUT 当作无条件定期覆盖。若后续改成操作日志式增量协议，还应增加 operationID 幂等、变更游标与附件单独传输。

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
  "id": "原生记录 UUID"
}
```

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
