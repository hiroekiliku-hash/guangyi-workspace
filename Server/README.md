# 自建后端初版

此目录提供与原生客户端契约一致的后端。用户已在真实服务器执行首次安装并提供 BACKEND_READY 输出；公网专用路由与证书仍待配置。需要 Node.js 24，使用系统内置 HTTP、HTTP/2、crypto 和 SQLite，不需要 npm install。

已有服务器实际使用 Node.js 22.13.1，且没有 Docker。可使用独立 Node.js 24 官方发行包与 systemd，候选配置见 `guangyi-workspace.service.example`：运行时放在 `/opt/guangyi-workspace/runtime`，代码在 `/opt/guangyi-workspace/current`，数据库在 `/var/lib/guangyi-workspace`，配置在 `/etc/guangyi-workspace.env`。这些目录、专用服务用户和配置需在服务器上另行准备，示例文件本身不会安装服务。不要替换主机的 `/usr/local/bin/node` 或改变现有 PM2 运行时。

`install-backend.sh` 提供该 x86_64 服务器的首次安装：固定 Node.js 24.21.0 并核验官方 SHA-256，先执行后端测试，创建专用账号与 systemd 服务，仅绑定 127.0.0.1:8087。在 root 网页终端运行；邮箱与密码交互输入，密码不会回显。遇到已有目录、同名账号/服务或占用端口时拒绝覆盖。失败时仅停用本次新建的广益服务，保留其配置与数据，不自动删除或重置数据库。脚本不修改 Nginx、DNS、证书或旧网站；本机检查通过后再单独配置公网路由。

```sh
bash install-backend.sh
```

成功标志为 BACKEND_READY。用户提供输出确认服务器上的 7 项测试通过、回环健康接口 ok、未登录接口 401；无需重新运行首装脚本。交互密码仅用于广益应用登录，不是腾讯云、宝塔或服务器 root 密码。真实配置位于服务器 /etc/guangyi-workspace.env，不能上传到 Git 或贴到聊天中。

随后在 root 网页终端执行 `configure-workspace-https.sh`，输入证书联系邮箱，申请 Let’s Encrypt 证书并新增独立的 `/etc/nginx/conf.d/guangyi-workspace.conf`。脚本先检查本机后端与旧 Nginx 配置，拒绝覆盖同名配置或证书；每次 reload 前执行 nginx -t，失败时移除本次新增站点并保留后端与数据。成功标志为 HTTPS_READY；后续还需从公网验证、核查证书续期定时任务，并配置专用自动发布通道。本脚本提供 API 路由，不部署网页版界面。

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

将真实 .p8 放入服务器 secrets 目录，限制权限并确保容器 uid 1000 可以只读访问。不要把它放入原生应用、Git 或交付包。配置后重启 API 容器，使用已签名真机/应用注册设备并验证后台发送。初版提供后台派发，不包含静默推送自动数据同步。

## 数据与边界

- SQLite WAL、本机 volume 持久化，完整快照按服务器 revision 原子更新。
- 密码使用随机 salt 和 scrypt；Bearer token 只保存 SHA-256 哈希。会话有效期 30 天。
- 每个账号隔离自己的工作空间与设备。此版没有公开注册、共享成员角色、账号找回或管理员 UI。
- 请求上限 128 MiB，单 PDF 10 MiB；保存最近约 5 个服务器快照版本供维护恢复，尚未提供管理恢复接口。
- 适合受控的个人服务器初版。大规模数据应将附件移到对象存储，加入数据库迁移、监控、独立备份、精确代理限流和运维恢复流程。
- APNs 每 30 秒检查，失败两分钟后重试；网络和 Apple/系统设置仍可能延迟或阻止收件。
- 同步目前是客户端明确确认的完整快照操作，不是自动实时双向合并。

测试：`node --test server.test.mjs`，只使用内存 SQLite、本机随机端口与模拟推送服务。
