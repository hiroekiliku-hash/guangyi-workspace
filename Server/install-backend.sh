#!/usr/bin/env bash
# First installation only. Does not edit Nginx, DNS, existing Node or PM2.
set -Eeuo pipefail
umask 077

service_name=guangyi-workspace.service
app_root=/opt/guangyi-workspace
env_path=/etc/guangyi-workspace.env
unit_path=/etc/systemd/system/guangyi-workspace.service
service_user=guangyi-workspace
node_version=24.21.0
node_archive="node-v${node_version}-linux-x64.tar.xz"
node_sha256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
source_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
staging=''
started=0

fail() { printf '%s\n' "$*" >&2; exit 1; }
cleanup() { if [[ -n "$staging" ]]; then rm -rf -- "$staging"; fi; }
on_error() {
    local rc=$?
    trap - ERR
    if [[ "$started" == 1 ]]; then systemctl disable --now "$service_name" >/dev/null 2>&1 || true; fi
    printf '%s\n' '安装未完成；仅停用本次创建的广益服务，现有服务未重启。保留配置和数据，请把错误信息发给协作者，不要发送密码或环境文件。' >&2
    exit "$rc"
}
trap cleanup EXIT
trap on_error ERR

[[ "$EUID" == 0 ]] || fail '请在服务器 root 网页终端运行。'
[[ -t 0 ]] || fail '需要交互终端输入登录资料，不支持 curl | bash。'
[[ "$(uname -m)" == x86_64 ]] || fail '此安装包仅用于已确认的 x86_64 服务器。'
for tool in curl tar xz sha256sum install useradd getent systemctl systemd-analyze ss mktemp awk; do
    command -v "$tool" >/dev/null || fail "缺少工具：$tool；停止安装，不自动安装系统依赖。"
done
[[ -f "$source_dir/server.mjs" && -f "$source_dir/server.test.mjs" && -f "$source_dir/guangyi-workspace.service.example" ]] || fail '部署包文件不完整。'
for target in "$app_root" "$env_path" "$unit_path" /var/lib/guangyi-workspace; do
    [[ ! -e "$target" && ! -L "$target" ]] || fail "目标已存在，避免覆盖而停止：$target"
done
if getent passwd "$service_user" >/dev/null || getent group "$service_user" >/dev/null; then
    fail '广益服务账号已存在；停止，不复用未知账号。'
fi
unit_state=$(systemctl show "$service_name" --property=LoadState --value)
[[ "$unit_state" == not-found ]] || fail '同名服务已存在；停止，不覆盖现有服务。'
[[ -z "$(ss -H -lnt 'sport = :8087')" ]] || fail '8087 已被占用；停止，不关闭任何现有进程。'

printf '%s\n' '将安装独立 Node.js 24 与 guangyi-workspace systemd 服务，仅监听 127.0.0.1:8087。' 
printf '%s\n' '不会替换系统 Node.js，不操作现有 PM2，不修改 Nginx、DNS 或证书。'
read -r -p '设置广益应用登录邮箱：' admin_email
[[ "$admin_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail '邮箱格式不正确。'
read -r -s -p '设置独立密码（16–256 字符，输入不会显示）：' admin_password
printf '\n'
[[ ${#admin_password} -ge 16 && ${#admin_password} -le 256 ]] || fail '密码长度需为 16–256 字符。'
[[ ! "$admin_password" =~ ^replace[-_] ]] || fail '请勿使用示例密码。'
read -r -s -p '再次输入密码：' password_confirmation
printf '\n'
[[ "$admin_password" == "$password_confirmation" ]] || fail '两次密码不一致。'
unset password_confirmation

staging=$(mktemp -d /var/tmp/guangyi-bootstrap.XXXXXXXX)
printf '%s\n' '下载专用 Node.js 24.21.0 并验证固定 SHA-256……'
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --connect-timeout 15 --max-time 180 --retry 2 \
    "https://nodejs.org/dist/v${node_version}/${node_archive}" -o "$staging/$node_archive"
printf '%s  %s\n' "$node_sha256" "$staging/$node_archive" | sha256sum --check --status
tar -xJf "$staging/$node_archive" -C "$staging" --no-same-owner
node_binary="$staging/node-v${node_version}-linux-x64/bin/node"
"$node_binary" --check "$source_dir/server.mjs"
"$node_binary" --test "$source_dir/server.test.mjs"

useradd --system --user-group --home-dir /nonexistent --no-create-home --shell /sbin/nologin "$service_user"
install -d -m 0755 "$app_root" "$app_root/current"
mv -- "$staging/node-v${node_version}-linux-x64" "$app_root/runtime"
chmod 0755 "$app_root/runtime"
install -m 0644 "$source_dir/server.mjs" "$app_root/current/server.mjs"

write_env() {
    local escaped=${2//\\/\\\\}
    escaped=${escaped//\"/\\\"}
    printf '%s="%s"\n' "$1" "$escaped"
}
{
    write_env ADMIN_EMAIL "$admin_email"
    write_env ADMIN_PASSWORD "$admin_password"
    write_env DISPLAY_NAME '广益'
    write_env APNS_ALLOWED_BUNDLE_IDS 'com.guangyi.workspace.native.ios,com.guangyi.workspace.native.mac'
} > "$staging/config.env"
install -m 0600 -o root -g root "$staging/config.env" "$env_path"
unset admin_password admin_email
install -m 0644 "$source_dir/guangyi-workspace.service.example" "$unit_path"
systemd-analyze verify "$unit_path"
systemctl daemon-reload
started=1
systemctl enable --now "$service_name"

healthy=0
for attempt in {1..20}; do
    response=$(curl --silent --show-error --fail --max-time 2 http://127.0.0.1:8087/health 2>/dev/null) || response=''
    if [[ "$response" == '{"status":"ok"}' ]]; then healthy=1; break; fi
    sleep 1
done
[[ "$healthy" == 1 ]] || { printf '%s\n' '本机健康检查失败。' >&2; false; }
status=$(curl --silent --show-error --max-time 3 --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8087/api/native/v1/workspace)
[[ "$status" == 401 ]] || { printf '%s\n' '未登录接口检查未返回 401。' >&2; false; }
bind_address=$(ss -H -lnt 'sport = :8087' | awk '{print $4}')
[[ "$bind_address" == '127.0.0.1:8087' ]] || { printf '%s\n' '监听地址检查失败。' >&2; false; }
printf '%s\n' 'BACKEND_READY: health=ok, unauthenticated=401, listen=127.0.0.1:8087' 
printf '%s\n' '广益后端本机服务已启动。公网域名路由和 HTTPS 尚未配置，不要通过现有旧网站测试登录。'
