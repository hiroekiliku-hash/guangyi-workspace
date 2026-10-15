# 自建服务器部署交接

## 当前阶段：准备独立部署

用户已完成 root 网页终端和 DNS 管理入口核查，并在 OrcaTerm 执行首装脚本，提供 BACKEND_READY 输出：独立 Node.js 24.21.0、本机 8087 健康 ok、未登录 401、服务器 7 项测试通过。专用 HTTPS 和自动发布仍待完成。本会话不能直接管理员 SSH 或操控用户电脑；用户要求交给本地 Codex，完整纯文本见 LOCAL-CODEX-HANDOFF.txt。

用户已确认：域名为 **kdfz.com.cn 名下**，目标服务器继续使用 **146.56.249.84**；不使用 workspace.chenqirui.cn。建议候选子域名为 workspace.kdfz.com.cn，具体服务主机名尚未确认，不覆盖根域名现有网站。

本次只读检查：kdfz.com.cn 在当前解析器解析到 146.56.249.84，通过云环境 HTTP 代理进行正常 TLS 校验的 HTTPS HEAD 返回 200。workspace.kdfz.com.cn 在当前解析器未查到地址，其 HTTPS 请求被代理拒绝（403），不能据此判断服务器 HTTPS 状态。

本环境未配置服务器 SSH TCP 访问或管理员凭据，Cloud 直接 SSH 仍未建立；用户的网页终端与 DNS 管理入口核查结果见下文。现有 GitHub 仓库可读，旅行发布通道限制仍然适用。

更新核查：用户的 OrcaTerm 输出确认 root 管理员终端、SSH 22 监听与公钥认证开启；ED25519 公钥指纹与旅行部署记录匹配。用户已打开 kdfz.com.cn 的 DNSPod 主账号记录页，有添加和修改记录入口。服务器已有 Node.js 22.13.1、Nginx、PM2，无 Docker；3011–3014、4000、8080 已占用，未看到 8087 监听，根分区约有 29 GB 可用。

workspace.kdfz.com.cn 当前已解析到 146.56.249.84，HTTPS 返回 200，但根页面和 /health 实际返回“毕业生蹭饭地图”HTML，/api/native/v1/workspace 返回 404。这说明新后端尚未上线；需要核查 Nginx 虚拟主机，不能把现有网站响应当作 API 健康检查成功。候选方式为独立 Node.js 24 + systemd，保留原 Node.js 22 和所有现有服务；详见 Server/guangyi-workspace.service.example。

先前用于检查权限的交接请求（目前已收到用户网页终端与 DNS 管理入口证据）：

> 请仅核查广益独立后端的部署可行性。用户确认继续使用 146.56.249.84，域名使用 kdfz.com.cn 名下；建议候选 workspace.kdfz.com.cn，具体主机名后续确认，不覆盖根域名现有网站，也不使用 workspace.chenqirui.cn。请确认是否存在可用的管理员 SSH，或腾讯云 OrcaTerm／执行命令通道，并报告安装依赖、创建服务目录、配置 PM2／systemd／容器、修改 Nginx、申请 HTTPS 证书及管理 kdfz.com.cn DNS 的权限。域名 DNS 权限需单独核查，服务器 root 权限不代表拥有 DNS 权限。本轮只检查，不安装、不部署、不改配置，保留旅行网站、数据库和通知服务。不输出、复制或发送密码、私钥、令牌；只报告已验证通道、权限范围、证据时间及仍缺少的条件。

## 当前核验结果（2026-10-14）

此工程 ZIP 已准备并校验；广益本机后端已首装成功，公网专用 API 路由仍未验收。原生工程未在 Apple SDK 下编译或进行真机验收。

用户提供的既有服务器配置：腾讯云南京轻量应用服务器，OpenCloudOS 9，公网 IP `146.56.249.84`，SSH `root:22`；用户确认新后端沿用此服务器。系统与 SSH 信息此前于 2026-10-07 成功验证，本次没有通过管理员 SSH 重新核验。

本次经 GitHub connector 读取 `chenqr02/hong-kong-travel-2026` 默认分支的 `deploy/CLOUD.md` 和 `.github/workflows/deploy-site.yml`，确认：

- 旅行网站的 Actions 在 main push 时发布，手动操作限 deploy/status/rollback。
- 仓库文档记载专用 SSH 公钥使用 restrict 与强制命令网关 `/opt/travel-site/deploy-channel/gateway.sh`；它允许旅行网站状态、发布与回滚，不提供任意 shell、PTY 或端口转发。
- 该密钥不能作为安装新后端的通用 SSH 凭据。新增一个 Actions 文件不会自动获得服务器上的管理员执行权限。
- 本次没有推送旅行仓库、触发 Actions、提取密钥或修改服务器。

来源：

- https://github.com/chenqr02/hong-kong-travel-2026/blob/main/deploy/CLOUD.md
- https://github.com/chenqr02/hong-kong-travel-2026/blob/main/.github/workflows/deploy-site.yml

## 独立服务布局

以下为后续阶段的候选布局，本轮不执行。目标服务器、域名与权限核查完成并获得部署指示后，再由管理员经腾讯云网页终端、管理员 SSH 或其他受信任管理通道安装：

| 项目 | 广益后端建议配置 |
| --- | --- |
| 代码目录 | `/opt/guangyi-workspace/Server`，与旅行目录分离 |
| 运行时 | 专用 Node.js 24 容器，保留主机现有 Node/PM2 配置 |
| 回环端口 | `127.0.0.1:8087`，先确认未占用 |
| Compose 项目 | `guangyi-workspace`，独立容器与持久卷 |
| 外网入口 | 用户确认的新 HTTPS 域名，经现有 Nginx 转发到 8087 |
| 数据 | 独立 SQLite；不迁移或修改现有账户库 |
| 密钥 | 专用 .env 与只读 APNs 私钥，留在服务器上 |

原网站 `/opt/travel-site`、`travelhk.chenqirui.cn`、3011、3014，以及其账户数据库、通知服务、VAPID 密钥与发布网关都必须保留。

## 首次安装操作

以下保留为后续部署参考，不属于当前只核查任务，不应执行。未来开始安装时先检查实际服务器的监听端口、Docker/Compose、磁盘、Nginx 配置和现有服务状态；确认路径和端口可用、Docker 已具备后再操作，不自动替换系统运行时或反向代理。

1. 将本包的 `Server/` 上传到独立的 `/opt/guangyi-workspace/Server/`。不把整个原生工程放进旅行站点，不通过旅行 site-only 发布安装后端。
2. 在服务器上准备配置：

```sh
cd /opt/guangyi-workspace/Server
mkdir -p secrets
# 仅第一次创建；保留已经存在的真实配置。
test -f .env || (umask 077; cp .env.example .env)
chmod 600 .env
```

使用服务器编辑器填写独立的 ADMIN_EMAIL 与唯一的至少 16 字符 ADMIN_PASSWORD。不要在聊天、Git、终端输出或 Actions 日志中复制实际值。首次安装先保持 APNs 凭据为空。

3. 启动与本机检查：

```sh
docker compose -p guangyi-workspace up -d --build
curl --fail http://127.0.0.1:8087/health
```

`health` 应返回 status=ok。不要运行 down -v；它会删除工作空间持久数据。

4. 确认用户选择的域名解析到服务器，为现有 Nginx 新增独立虚拟主机和有效 HTTPS 证书。转发保留 `/api/native/v1/...` 路径，支持 PUT、DELETE 与 If-Match，HTTP 请求大小上限与 API 的 128 MiB 对齐。先运行 `nginx -t`，通过后才 reload。不要用本包的 Caddy 示例替换现有 Nginx，不停止旅行网站，不把 8087 开放到公网。
5. 从公网验证健康接口、未登录返回 401、登录成功、快照版本冲突；在 iPhone/Mac 中填入新的 HTTPS 地址，测试下载审阅和上传。

## 后续 Cloud 发布

首次安装后，由管理员创建专用于广益的新部署通道（独立仓库/工作流、专用部署密钥、服务器受限命令入口、主机身份固定校验）。密钥仅供受信任 runner 使用，不发送给聊天，也不复用旅行网站的受限密钥。

新通道应只更新广益代码/容器，保留 .env、APNs 私钥和持久卷；测试 Node 24 服务，健康检查失败时恢复上一版，不执行全局 PM2 重启、数据库重建或旅行 site-only 发布。具体入口应在管理员确认服务器真实状态后编写，不能假定本包已安装该网关。

## APNs 另行验收

服务器登录与快照同步可先上线。真实远程通知还需 Apple 开发者签名、两个应用的 Push Notifications capability、匹配 Bundle ID/环境、服务器专用 .p8 与真机设备注册。原有网页 VAPID 与行程通知服务不能代替 APNs。接口返回已接受不等于设备已显示通知。

后续版本已加入首次确认后的三方快照自动合并、iOS 尽力而为后台刷新及可选静默 revision 提示；运行步骤与接口以 `README.md`、`Server/README.md` 和 `API-CONTRACT.md` 为准。真实 APNs 和两台签名设备仍需单独验收。
