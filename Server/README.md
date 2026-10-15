# Passkey build update

Backend source now lives in `server.source.mjs`. From the repository root, run
`npm ci && npm test` to generate and verify the single-file server.mjs release.
The server runtime still needs no npm install. See [PASSKEYS.md](../PASSKEYS.md)
for the authentication API and remaining Apple/domain acceptance steps.
The existing initial-install instructions below are historical; do not rerun
initial installation on the already deployed service.

# 自建后端初版

此目录提供与原生客户端契约一致的后端。真实服务器已经完成首次安装、专用 HTTPS、证书续期和 GitHub Actions 自动发布验收。运行时需要 Node.js 24，使用系统内置 HTTP、HTTP/2、crypto 和 SQLite，不需要 npm install；不要重新运行下面保留的历史首装步骤。

已有服务器实际使用 Node.js 22.13.1，且没有 Docker。可使用独立 Node.js 24 官方发行包与 systemd，候选配置见 `guangyi-workspace.service.example`：运行时放在 `/opt/guangyi-workspace/runtime`，代码在 `/opt/guangyi-workspace/current`，数据库在 `/var/lib/guangyi-workspace`，配置在 `/etc/guangyi-workspace.env`。这些目录、专用服务用户和配置需在服务器上另行准备，示例文件本身不会安装服务。不要替换主机的 `/usr/local/bin/node` 或改变现有 PM2 运行时。

`install-backend.sh` 提供该 x86_64 服务器的首次安装：固定 Node.js 24.21.0 并核验官方 SHA-256，先执行后端测试，创建专用账号与 systemd 服务，仅绑定 127.0.0.1:8087。在 root 网页终端运行；邮箱与密码交互输入，密码不会回显。遇到已有目录、同名账号/服务或占用端口时拒绝覆盖。失败时仅停用本次新建的广益服务，保留其配置与数据，不自动删除或重置数据库。脚本不修改 Nginx、DNS、证书或旧网站；本机检查通过后再单独配置公网路由。

```sh
bash install-backend.sh
```

成功标志为 BACKEND_READY。用户提供输出确认服务器上的 7 项测试通过、回环健康接口 ok、未登录接口 401；无需重新运行首装脚本。交互密码仅用于广益应用登录，不是腾讯云、宝塔或服务器 root 密码。真实配置位于服务器 /etc/guangyi-workspace.env，不能上传到 Git 或贴到聊天中。

历史首次配置曾在 root 网页终端执行 `configure-workspace-https.sh`，申请 Let’s Encrypt 证书并新增独立的 `/etc/nginx/conf.d/guangyi-workspace.conf`。该站点、续期钩子、公网 TLS 和专用自动发布通道现已验收；不要重新运行首次配置脚本。脚本只提供 API 路由，不部署网页版界面。

直接运行服务默认仅监听 127.0.0.1，可用 HOST 配置；Dockerfile 显式设置 HOST=0.0.0.0 用于容器内部，Compose 仍只把端口发布到主机回环地址。

## 部署前

先核验服务器现有服务、可用端口、Docker/Node 版本、磁盘和域名解析。不要覆盖现有数据库或反向代理。默认独立容器仅绑定主机 `127.0.0.1:8087`，生产必须由 HTTPS 反向代理转发。

```sh
cd Server
mkdir -p secrets
cp .env.example .env
chmod 600 .env
# 在服务器上安全编辑 ADMIN_EMAIL 与独立强密码；不得使用示例密码
docker compose up -d --build
curl http://127.0.0.1:8087/health
```

这里是操作说明，未在本次执行。Docker 数据保存在独立 volume，不导入或修改原 Sites D1/R2。ADMIN_PASSWORD 只用于首次创建对应账号；已有账号不会因为更改 .env 自动重置密码。不要运行 `docker compose down -v`，这会删除数据。

如果已有 Nginx/Caddy，请在现有配置中增加受控的独立域名路由到 8087，保留原配置。没有已有反向代理时，才考虑 `Caddyfile.example`。请勿把内部 HTTP 端口开放到公网。

## APNs

未配置 APNs 时，登录与同步仍可工作，后台不会发送通知。准备好 Apple Team ID、Key ID、.p8 私钥、应用 Bundle IDs 和两个目标的签名后，再配置：

```text
APNS_TEAM_ID=你的TeamID
APNS_KEY_ID=你的KeyID
APNS_PRIVATE_KEY_FILE=/run/secrets/apns-key.p8
APNS_ALLOWED_BUNDLE_IDS=你实际使用的iOSBundleID,你实际使用的MacBundleID
```

将真实 .p8 放入服务器 secrets 目录，限制权限并确保容器 uid 1000 可以只读访问。不要把它放入原生应用、Git 或交付包。配置后重启 API 容器，使用已签名真机/应用注册设备并验证后台发送。服务端会派发到期提醒，也会在工作空间 revision 更新后发送只含 revision 的静默同步提示。

## 数据与边界

- SQLite WAL、本机 volume 持久化，完整快照按服务器 revision 原子更新。
- 密码使用随机 salt 和 scrypt；Bearer token 只保存 SHA-256 哈希。会话有效期 30 天。
- 每个账号隔离自己的工作空间与设备。此版没有公开注册、共享成员角色、账号找回或管理员 UI。
- 请求上限 128 MiB，单 PDF 10 MiB；保存最近约 5 个服务器快照版本供维护恢复，尚未提供管理恢复接口。
- 适合受控的个人服务器初版。大规模数据应将附件移到对象存储，加入数据库迁移、监控、独立备份、精确代理限流和运维恢复流程。
- APNs 每 30 秒检查，失败两分钟后重试；网络和 Apple/系统设置仍可能延迟或阻止收件。
- 静默 revision 提示是低优先级尽力投递，使用固定折叠键保留最新值；Apple 可能延迟或节流，客户端仍保留前台定时同步和 BGAppRefresh 兜底。
- 首次账号绑定需明确确认；之后客户端使用完整快照、If-Match 与三方合并自动同步。静默 APNs 只负责提示拉取，不能代替版本检查或冲突审阅。

测试：`node --test server.test.mjs`，只使用内存 SQLite、本机随机端口与模拟推送服务。
