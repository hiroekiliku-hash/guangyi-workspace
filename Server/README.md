# Passkey build update

Backend source now lives in `server.source.mjs`; the read-only web client lives
in `web.mjs`. From the repository root, run
`npm ci && npm test` to generate and verify the single-file server.mjs release.
The server runtime still needs no npm install. See [PASSKEYS.md](../PASSKEYS.md)
for the authentication API and remaining Apple/domain acceptance steps.
The existing initial-install instructions below are historical; do not rerun
initial installation on the already deployed service.

纯文本日程写入接口、账户专用追加密钥、AI 提示词和幂等规则见 [TEXT-IMPORT.md](../TEXT-IMPORT.md)。`text-ingress.mjs` 在构建时一并打入 `server.mjs`，不增加发布包运行时文件。

# 自建后端初版

此目录提供与原生客户端契约一致的后端。真实服务器已经完成首次安装、专用 HTTPS、证书续期和 GitHub Actions 自动发布验收。运行时需要 Node.js 24，使用系统内置 HTTP、HTTP/2、crypto 和 SQLite，不需要 npm install；不要重新运行下面保留的历史首装步骤。

生产服务已使用独立 Node.js 24.21.0 与 systemd；主机共享 Node 和其他应用没有被替换或重启。路径约定见 `guangyi-workspace.service.example`：运行时位于 `/opt/guangyi-workspace/runtime`，代码由 `/opt/guangyi-workspace/current` release symlink 选择，数据库在 `/var/lib/guangyi-workspace`，配置在 `/etc/guangyi-workspace.env`。不要替换主机的 `/usr/local/bin/node` 或改变现有 PM2 运行时。

`install-backend.sh` 提供该 x86_64 服务器的首次安装：固定 Node.js 24.21.0 并核验官方 SHA-256，先执行后端测试，创建专用账号与 systemd 服务，仅绑定 127.0.0.1:8087。在 root 网页终端运行；邮箱与密码交互输入，密码不会回显。遇到已有目录、同名账号/服务或占用端口时拒绝覆盖。失败时仅停用本次新建的广益服务，保留其配置与数据，不自动删除或重置数据库。脚本不修改 Nginx、DNS、证书或旧网站；本机检查通过后再单独配置公网路由。

```sh
bash install-backend.sh
```

成功标志为 BACKEND_READY。用户提供输出确认服务器上的 7 项测试通过、回环健康接口 ok、未登录接口 401；无需重新运行首装脚本。交互密码仅用于广益应用登录，不是腾讯云、宝塔或服务器 root 密码。真实配置位于服务器 /etc/guangyi-workspace.env，不能上传到 Git 或贴到聊天中。

历史首次配置曾在 root 网页终端执行 `configure-workspace-https.sh`，申请 Let’s Encrypt 证书并新增独立的 `/etc/nginx/conf.d/guangyi-workspace.conf`。该站点、续期钩子、公网 TLS 和专用自动发布通道现已验收；不要重新运行首次配置脚本。首次配置脚本没有安装独立静态站点；当前网页版资源由同一个 `server.mjs` 在根路径直接提供。

直接运行服务默认仅监听 127.0.0.1，可用 HOST 配置；Dockerfile 显式设置 HOST=0.0.0.0 用于容器内部，Compose 仍只把端口发布到主机回环地址。

## 只读网页版

`GET /`（或 `/index.html`）加载行动与 DDL 页面，`/app.js`、`/app.css` 和 `/favicon.svg` 也由同一进程提供。资源在构建时打进单文件 `server.mjs`，所以发布网关仍只需原有的 `server.mjs`、`server.test.mjs` 和 `REVISION`，不需要扩大文件白名单。

若账号忘记密码且尚未登记通行密钥，可由服务器本机管理员使用当前 release 的 Node 运行时和服务运行用户生成一次性登记链接：

```bash
runuser -u guangyi-workspace -- /opt/guangyi-workspace/runtime/bin/node --preserve-symlinks-main /opt/guangyi-workspace/current/server.mjs issue-passkey-recovery /var/lib/guangyi-workspace/workspace.sqlite [账号邮箱]
```

上述运行用户和数据库路径已在 2026-10-15 对当前生产 systemd 单元与文件权限只读核验。命令只在本机直接打开 SQLite，不提供签发链接的公网 API。链接十分钟后失效、成功一次后失效，同账号新链接会废止旧链接；数据库只保存令牌哈希。不要通过 `source` 执行 EnvironmentFile，也不要把链接写入持久日志。若部署路径以后改变，应先用 `systemctl cat guangyi-workspace.service` 与只读文件检查重新确认，不要猜测或新建空数据库。

网页及 App 打开的登录页支持邮箱注册、密码和 discoverable passkey 登录；登录后可为同一账号创建新通行密钥。页面只调用 GET workspace，不提供编辑或 PUT，以免浏览器用旧快照覆盖原生客户端的合并结果。Bearer token 只进入当前标签页的 `sessionStorage`，页面关闭后清除；用户内容只通过 `textContent` 渲染。响应设置 self-only CSP、防嵌入、no-referrer、no-store 与 WebAuthn 权限策略。

`POST /api/native/v1/accounts` 接受 JSON `{email,password}`，成功返回 201 和普通登录相同的会话。密码为 8–1024 个字符，仅保存独立随机 salt 和 scrypt 哈希；邮箱去除首尾空格并转为小写。账号、空工作空间和会话在同一事务中创建，重复账号不会重置原密码或内容。每个账号从 revision 0 开始，数据按 user_id 隔离。App 注册后沿用 PKCE 回传及本机/云端合并流程。

邮箱目前用作登录标识，不发送验证邮件，也不代表邮箱归属已验证。注册接口要求同源 JSON、请求体至多 4 KiB；每个客户端地址十分钟最多尝试六次，全站最多六十次。只有来自回环地址的本机代理可通过 `X-Real-IP` 提供经校验的客户端地址，现有 Nginx 配置会覆盖该头；不信任外部连接的转发头。后续若更换代理，应保留这一边界。

日期型 DDL 以记录自身时区的 23:59:59 为截止，包含夏令时转换；带时刻 DDL 使用原始绝对时间。倒计时每秒更新，页面可见时每 30 秒重新读取服务器 revision。旧 Sites 项目没有在当前账号或仓库中找到，因此本实现按现有 API 与原生模型重建。

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

生产 systemd 安装应把真实 .p8 放在 release 目录之外的专用 secrets 路径，设为 `root:guangyi-workspace` 且权限不宽于 `0640`，并让 `APNS_PRIVATE_KEY_FILE` 指向该文件；若使用上面的历史 Docker 方案，则改为确保容器实际运行用户可以只读访问。不要把私钥放入原生应用、Git 或交付包。更新 EnvironmentFile 后只重启 `guangyi-workspace.service`；Docker 方案才重启对应 API 容器。随后用已签名真机/应用注册设备并验证后台发送。服务端会派发到期提醒，也会在工作空间 revision 更新后发送只含 revision 的静默同步提示。

## 数据与边界

- SQLite WAL、本机 volume 持久化，完整快照按服务器 revision 原子更新。
- 密码使用随机 salt 和 scrypt；Bearer token 只保存 SHA-256 哈希。会话有效期 30 天。
- 每个账号隔离自己的工作空间与设备。此版没有公开注册、共享成员角色、密码重置或管理员 UI；只有需要服务器 SQLite 文件权限的短时一次性通行密钥恢复命令。
- 请求上限 128 MiB，单 PDF 10 MiB；保存最近约 5 个服务器快照版本供维护恢复，尚未提供管理恢复接口。
- 适合受控的个人服务器初版。大规模数据应将附件移到对象存储，加入数据库迁移、监控、独立备份、精确代理限流和运维恢复流程。
- APNs 每 30 秒检查，失败两分钟后重试；网络和 Apple/系统设置仍可能延迟或阻止收件。
- 静默 revision 提示是低优先级尽力投递，使用固定折叠键保留最新值；Apple 可能延迟或节流，客户端仍保留前台定时同步和 BGAppRefresh 兜底。
- 首次账号绑定需明确确认；之后客户端使用完整快照、If-Match 与三方合并自动同步。静默 APNs 只负责提示拉取，不能代替版本检查或冲突审阅。

测试：在仓库根目录执行 `npm test`；测试只使用内存 SQLite、本机随机端口与模拟推送服务，并验证生成后的单文件发布包。


### 可选验证码验证（Apple「密码」）

已登录账号可启用 RFC 6238 TOTP：`GET /api/native/v1/totp` 返回 `{data:{enabled}}`；`POST /totp/setup`（完整前缀同前，JSON `{}`）返回仅本次设置所需的 `{data:{secret,uri,appleURI}}`。标准 `otpauth://` URI 可加入兼容验证器；`apple-otpauth://` 可在 Apple「密码」中设置验证码，issuer 使用当前站点域名。密钥为随机 160 位、SHA-1、6 位数字、30 秒周期。待确认设置 10 分钟过期，重复设置替换未确认密钥，不替换已经启用的配置。

`POST /totp/enable` 以 `{code}` 确认首个验证码后才启用，返回十个一次性恢复码 `{data:{recoveryCodes}}`，前端必须提示用户保存；服务端仅保存恢复码的 SHA-256 哈希。启用后，密码登录在正确校验密码之后要求额外的 `code`；未提供时返回 `SECOND_FACTOR_REQUIRED`，无效或重复使用时返回 `INVALID_SECOND_FACTOR`，不会提前签发会话。可使用当前验证码或恢复码；允许前后一个 30 秒窗口，每个已接受时间步只允许使用一次，包含设置确认。恢复码也只能使用一次。消费凭据与签发会话在同一事务中，失败时一起回滚。

`POST /totp/disable` 需要已有会话及 `{code}`（验证码或未使用恢复码），成功清除验证码与恢复码。设置、确认、关闭要求同源 JSON；这些操作与密码登录的验证码验证共用每账号每 10 分钟 20 次限流，密码登录另有既有的 IP 请求限流。通行密钥的服务端验证始终要求用户验证，可独立登录，不叠加 TOTP。已有会话不会因启用 TOTP 自动退出。

TOTP 是可选功能，邮箱仍只是登录标识，不代表已验证邮箱归属。验证码密钥和未确认密钥保存在 SQLite 中（恢复码仅有哈希），不依赖额外生产密钥；数据库及备份应视为敏感凭据，仅管理员/服务用户可读取。日志、版本包和 UI 错误均不应包含设置密钥或恢复码。
