#!/usr/bin/env bash
# Dedicated vhost only. Does not edit existing site configs or private app data.
set -Eeuo pipefail
umask 077

domain=workspace.kdfz.com.cn
config=/etc/nginx/conf.d/guangyi-workspace.conf
webroot=/var/lib/guangyi-workspace-acme
certificate=/etc/letsencrypt/live/workspace.kdfz.com.cn
staging=''
created=0
ready=0

fail() { printf '%s\n' "$*" >&2; exit 1; }
finish() {
    local rc=$?
    trap - EXIT
    if [[ "$created" == 1 && "$ready" != 1 ]]; then
        rm -f -- "$config"
        if nginx -t; then systemctl reload nginx || true; fi
        printf '%s\n' '域名配置未完成，已移除本次新增站点；保留现有站点、广益后端、证书与数据。请发送末尾错误信息，不要发送私钥。' >&2
    fi
    if [[ -n "$staging" ]]; then rm -rf -- "$staging"; fi
    exit "$rc"
}
trap finish EXIT

[[ "$EUID" == 0 && -t 0 ]] || fail '请在服务器 root 网页终端运行。'
for tool in nginx certbot curl systemctl mktemp install awk flock; do
    command -v "$tool" >/dev/null || fail "缺少工具：$tool"
done
exec 9>/run/lock/guangyi-workspace-https.lock
flock -n 9 || fail '另一个广益域名配置操作正在运行。'
[[ ! -e "$config" && ! -L "$config" ]] || fail '同名站点配置已存在；停止，不覆盖。'
[[ ! -e "$webroot" && ! -L "$webroot" ]] || fail '同名 ACME 目录已存在；停止，请核查先前配置结果。'
[[ ! -e "$certificate" && ! -L "$certificate" && ! -e /etc/letsencrypt/renewal/workspace.kdfz.com.cn.conf ]] || fail '同名证书已存在；停止，不替换证书或续期配置。'
nginx -t
systemctl is-active --quiet guangyi-workspace.service || fail '广益后端服务未运行。'
health=$(curl --silent --show-error --fail --max-time 5 http://127.0.0.1:8087/health)
[[ "$health" == '{"status":"ok"}' ]] || fail '本机广益健康检查不通过。'
if nginx -T 2>/dev/null | awk '
    /^[[:space:]]*server_name[[:space:]]/ {
        sub(/;.*/, "");
        for (i=2; i<=NF; i++) if ($i == "workspace.kdfz.com.cn") found=1;
    }
    END { exit !found }
'; then
    fail '已有站点显式配置 workspace.kdfz.com.cn；停止，避免抢占站点。'
fi

printf '%s\n' '将新增广益专用 Nginx 站点，申请 Let’s Encrypt 证书；不改现有 kdfz/travel 配置。'
read -r -p '证书联系邮箱（用于证书申请及到期联系）：' contact_email
[[ "$contact_email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || fail '邮箱格式不正确。'
staging=$(mktemp -d /var/tmp/guangyi-https.XXXXXXXX)
install -d -m 0755 "$webroot" "$webroot/.well-known" "$webroot/.well-known/acme-challenge"
cat > "$staging/http.conf" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name workspace.kdfz.com.cn;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/guangyi-workspace-acme;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 404; }
}
NGINX
install -m 0644 "$staging/http.conf" "$config"
created=1
nginx -t
systemctl reload nginx

# Public challenges must be readable by the existing nginx worker.
(
    umask 022
    certbot certonly --webroot --webroot-path "$webroot" \
        --cert-name "$domain" --domain "$domain" \
        --non-interactive --agree-tos --email "$contact_email"
)
unset contact_email
[[ -r "$certificate/fullchain.pem" && -r "$certificate/privkey.pem" ]] || fail '证书文件未生成。'

cat > "$staging/https.conf" <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name workspace.kdfz.com.cn;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/guangyi-workspace-acme;
        default_type text/plain;
        try_files $uri =404;
    }
    location / { return 301 https://workspace.kdfz.com.cn$request_uri; }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name workspace.kdfz.com.cn;
    ssl_certificate /etc/letsencrypt/live/workspace.kdfz.com.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/workspace.kdfz.com.cn/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:GuangyiTLS:10m;
    ssl_session_timeout 1d;
    client_max_body_size 128m;
    location / {
        proxy_pass http://127.0.0.1:8087;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}
NGINX
install -m 0644 "$staging/https.conf" "$config"
nginx -t
systemctl reload nginx
health=$(curl --silent --show-error --fail --max-time 10 \
    --resolve "$domain:443:127.0.0.1" "https://$domain/health")
[[ "$health" == '{"status":"ok"}' ]] || fail 'HTTPS 健康检查不通过。'
status=$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' \
    --resolve "$domain:443:127.0.0.1" "https://$domain/api/native/v1/workspace")
[[ "$status" == 401 ]] || fail 'HTTPS 未登录接口没有返回 401。'
ready=1
printf '%s\n' 'HTTPS_READY: https://workspace.kdfz.com.cn/health, health=ok, unauthenticated=401'
printf '%s\n' '应用服务器地址：https://workspace.kdfz.com.cn。当前 release 可同时提供 API 与只读网页版。'
printf '%s\n' '证书续期仍需核查现有 Certbot 定时任务与续期后的 Nginx reload；自动发布通道尚未配置。'
