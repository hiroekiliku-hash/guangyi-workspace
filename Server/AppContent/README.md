# App 内容发布通道

此目录是随服务器发布的公开只读内容源。内容由 `catalog.mjs` 静态导入并打入 `server.mjs`，使用现有部署通道发布，不增加公开写接口、管理密码或 App 权限。更新演示课、体验课、教程与公告后，已经安装且支持此协议的 App 可以下载更新，无需重新编译 App。

## 读取协议

`GET /api/native/v1/app-content` 返回：

```json
{
  "protocol": "WORKSHOP-CONTENT/1",
  "revision": "清单所有 entries 的 SHA-256 十六进制摘要",
  "entries": [
    {
      "id": "demo-course",
      "kind": "course",
      "version": 3,
      "minimumContentVersion": 1,
      "sha256": "对应包响应原始 UTF-8 字节的 SHA-256 十六进制摘要",
      "byteCount": 1234
    }
  ]
}
```

`GET /api/native/v1/app-content/demo-course` 返回包原始 JSON 字节：

```json
{
  "protocol": "WORKSHOP-CONTENT/1",
  "id": "demo-course",
  "kind": "course",
  "version": 3,
  "minimumContentVersion": 1,
  "payload": {}
}
```

- 当前内容种类为 `course`、`tutorial`、`announcement`。课程 payload 使用现有 `WORKSHOP-COURSE/1` 对象；教程 payload 为 `{pages:[{id,title,subtitle,sectionTitle?,symbol?}]}`；公告为 `{id,title,message}`。
- 同一内容保留 `id`，更新时增加正整数 `version`。课程内部 UUID、课时和题目 ID 应保持稳定，以便保留学习进度；新内容才使用新的 ID。
- `minimumContentVersion` 表示客户端内容解释器需要支持的最低版本，不是 App 的构建编号。客户端跳过未知 `kind` 或超出其支持范围的条目，继续处理其他内容。
- `id` 为 1–80 位小写英文字母、数字和连字符，首位必须为字母或数字。`kind` 为 1–40 位小写英文字母、数字和连字符，首位必须为字母。
- 最多 32 个条目，单包至多 1 MiB，全部包总计至多 4 MiB。服务在启动时计算准确字节数与摘要；超限或重复 ID 会拒绝加载该发布版本。
- 两个接口均支持 `HEAD`、强 ETag 与 `If-None-Match` 的 `304`，缓存为 `public, max-age=300, must-revalidate`。错误响应不缓存。POST/PUT/PATCH/DELETE 等返回 `405`，不接收上传。
- 清单 `revision` 是按 ID 排序的 `entries` JSON UTF-8 字节的摘要。包摘要应使用下载的原始字节校验，不能将 JSON 重新排版后计算。内容在构建时固定，清单与包来自同一服务器发布；若客户端在切换发布时发现摘要不符，应保留上次有效缓存并稍后重试。

## 发布步骤

1. 修改对应 JSON 的 `payload` 并增加 `version`；新增条目时在 `catalog.mjs` 增加静态导入。
2. 验证实际内容仍满足对应课程/教程协议；执行服务器构建与本次相关测试。
3. 通过现有服务器代码审阅、发布和回滚流程发布。客户端按需拉取并校验后替换其内容缓存。

该通道更新客户端已经支持的数据和展示内容。原生功能、签名权限及新的内容解释能力仍随 App 版本发布。
