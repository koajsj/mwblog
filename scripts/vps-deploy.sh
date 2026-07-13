#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-${DATA_DIR}/.npm-cache}"
ACME_WEBROOT="${ACME_WEBROOT:-/var/www/${APP_NAME}-acme}"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"
REPO_URL="${REPO_URL:-https://github.com/koajsj/mwblog.git}"
BRANCH="${BRANCH:-main}"
DOMAIN="${DOMAIN:-076113.xyz}"
PORT="${PORT:-4321}"
APP_USER="${APP_USER:-${APP_NAME}}"
NODE_MAJOR="${NODE_MAJOR:-22}"
LOGIN_PASSWORD_HASH_DEFAULT='scrypt$CgVOR6AKPxC8GvlxbYfoRw$1SUYK2nVfVxIbOcJH_g3Bt8WQ368hOuZmlsgjufTXHk'
NEW_RELEASE=""
PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

[ "$(id -u)" -eq 0 ] || { echo "Please run this deployment command with sudo." >&2; exit 1; }
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || { echo "Invalid domain: $DOMAIN" >&2; exit 1; }
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || { echo "Invalid port: $PORT" >&2; exit 1; }

log() { printf '\n==> %s\n' "$*"; }
generate_key() { node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"; }

rollback_deploy() {
  local status="$?"
  trap - ERR
  echo "Deployment failed. Restoring the previous release." >&2
  if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    ln -sfn "$PREVIOUS_RELEASE" "${CURRENT_LINK}.rollback"
    mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
    systemctl restart "$APP_NAME" || true
  else
    rm -f "$CURRENT_LINK"
    systemctl stop "$APP_NAME" 2>/dev/null || true
  fi
  [ -z "$NEW_RELEASE" ] || rm -rf "$NEW_RELEASE"
  exit "$status"
}
trap rollback_deploy ERR

install_packages() {
  log "Installing Debian packages"
  apt-get update
  apt-get install -y ca-certificates curl gnupg git nginx certbot
  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -Eq "^v${NODE_MAJOR}\."; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi
  node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major<22||(major===22&&minor<16)) process.exit(1)" \
    || { echo "Node.js 22.16 or newer is required." >&2; exit 1; }
}

prepare_directories() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --user-group --no-create-home --shell /usr/sbin/nologin "$APP_USER"
  fi
  install -d -o root -g root -m 0755 "$APP_ROOT" "$RELEASES_DIR"
  install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$DATA_DIR" "$DATA_DIR/storage" "$BACKUP_DIR" "$NPM_CACHE_DIR"
  if [ ! -f "$ENV_FILE" ]; then
    umask 077
    printf 'APP_ORIGIN=https://%s\nAPP_DATA_DIR=%s\nBACKUP_ENCRYPTION_KEY=%s\nENABLE_IP_WEATHER=1\n' \
      "$DOMAIN" "$DATA_DIR" "$(generate_key)" > "$ENV_FILE"
  fi
  if ! grep -q '^LOGIN_PASSWORD_HASH=' "$ENV_FILE"; then
    printf "LOGIN_PASSWORD_HASH='%s'\n" "$LOGIN_PASSWORD_HASH_DEFAULT" >> "$ENV_FILE"
  fi
  if ! grep -q '^ENABLE_IP_WEATHER=' "$ENV_FILE"; then
    printf 'ENABLE_IP_WEATHER=1\n' >> "$ENV_FILE"
  fi
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  grep -Eq '^APP_ORIGIN=https://.+' "$ENV_FILE" || { echo "Invalid APP_ORIGIN in $ENV_FILE" >&2; exit 1; }
  grep -Eq '^APP_DATA_DIR=/.+' "$ENV_FILE" || { echo "Invalid APP_DATA_DIR in $ENV_FILE" >&2; exit 1; }
  grep -Eq "^LOGIN_PASSWORD_HASH='?scrypt\\\$[A-Za-z0-9_-]{22}\\\$[A-Za-z0-9_-]{43}'?$" "$ENV_FILE" \
    || { echo "Invalid LOGIN_PASSWORD_HASH in $ENV_FILE" >&2; exit 1; }
  runuser -u "$APP_USER" -- bash -c "set -a && source '$ENV_FILE' && set +a && node -e \"const k=String(process.env.BACKUP_ENCRYPTION_KEY||'').trim(); const b=/^[0-9a-f]{64}$/i.test(k)||Buffer.from(k,'base64').length===32; if(!b) process.exit(1)\"" \
    || { echo "Invalid backup key in $ENV_FILE" >&2; exit 1; }
}

build_release() {
  local stamp
  stamp="$(date -u +%Y%m%d%H%M%S)"
  NEW_RELEASE="$(mktemp -d "${RELEASES_DIR}/${stamp}-XXXXXX")"
  log "Building release ${stamp}"
  git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$NEW_RELEASE"
  chown -R "$APP_USER":"$APP_USER" "$NEW_RELEASE"
  runuser -u "$APP_USER" -- env HOME="$DATA_DIR" NPM_CONFIG_CACHE="$NPM_CACHE_DIR" bash -c \
    "set -a && source '$ENV_FILE' && set +a && cd '$NEW_RELEASE' && bash -n scripts/*.sh && npm ci && npm test && APP_DATA_DIR='$NEW_RELEASE/.build-data' npm run build && rm -rf '$NEW_RELEASE/.build-data'"
  test -f "$NEW_RELEASE/dist/server/entry.mjs" || { echo "Build output is missing." >&2; exit 1; }
  ln -sfn "$NEW_RELEASE" "${CURRENT_LINK}.new"
  mv -Tf "${CURRENT_LINK}.new" "$CURRENT_LINK"
}

install_service() {
  local node_path
  node_path="$(command -v node)"
  cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Our Nest private website
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
UMask=0077
WorkingDirectory=${CURRENT_LINK}
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=${PORT}
Environment=TMPDIR=/run/${APP_NAME}
ExecStart=${node_path} ${CURRENT_LINK}/dist/server/entry.mjs
Restart=always
RestartSec=5
RuntimeDirectory=${APP_NAME}
RuntimeDirectoryMode=0700
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=strict
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=${DATA_DIR} /run/${APP_NAME}

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$APP_NAME"
  systemctl restart "$APP_NAME"
}

install_nginx() {
  local acme_probe_path="${ACME_WEBROOT}/.well-known/acme-challenge/mwblog-probe"
  local acme_probe_url="http://${DOMAIN}/.well-known/acme-challenge/mwblog-probe"
  install -d -o root -g root -m 0755 "$ACME_WEBROOT"
  install -d -o root -g root -m 0755 "$(dirname "$acme_probe_path")"
  printf 'mwblog-acme-probe\n' > "$acme_probe_path"
  chmod 0644 "$acme_probe_path"
  cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};

  location ^~ /.well-known/acme-challenge/ {
    root ${ACME_WEBROOT};
    default_type text/plain;
    try_files \$uri =404;
  }

  location / { return 404; }
}
EOF
  ln -sfn "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  curl --noproxy '*' --fail --silent --show-error --resolve "${DOMAIN}:80:127.0.0.1" "$acme_probe_url" | grep -qx 'mwblog-acme-probe' \
    || { echo "Nginx could not serve the local ACME challenge probe." >&2; exit 1; }
  if ! certbot certonly --webroot --webroot-path "$ACME_WEBROOT" --cert-name "$DOMAIN" --keep-until-expiring -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email; then
    echo "HTTPS certificate setup failed. The application remains unavailable; the ACME probe is left online for diagnosis: ${acme_probe_url}" >&2
    exit 1
  fi
  rm -f "$acme_probe_path"

  cat > "/etc/nginx/sites-available/${APP_NAME}" <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name ${DOMAIN};

  location ^~ /.well-known/acme-challenge/ {
    root ${ACME_WEBROOT};
    default_type text/plain;
    try_files \$uri =404;
  }

  location / { return 301 https://\$host\$request_uri; }
}

server {
  listen 443 ssl;
  listen [::]:443 ssl;
  server_name ${DOMAIN};
  ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  client_max_body_size 55m;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;

  set_real_ip_from 173.245.48.0/20;
  set_real_ip_from 103.21.244.0/22;
  set_real_ip_from 103.22.200.0/22;
  set_real_ip_from 103.31.4.0/22;
  set_real_ip_from 141.101.64.0/18;
  set_real_ip_from 108.162.192.0/18;
  set_real_ip_from 190.93.240.0/20;
  set_real_ip_from 188.114.96.0/20;
  set_real_ip_from 197.234.240.0/22;
  set_real_ip_from 198.41.128.0/17;
  set_real_ip_from 162.158.0.0/15;
  set_real_ip_from 104.16.0.0/13;
  set_real_ip_from 104.24.0.0/14;
  set_real_ip_from 172.64.0.0/13;
  set_real_ip_from 131.0.72.0/22;
  set_real_ip_from 2400:cb00::/32;
  set_real_ip_from 2606:4700::/32;
  set_real_ip_from 2803:f800::/32;
  set_real_ip_from 2405:b500::/32;
  set_real_ip_from 2405:8100::/32;
  set_real_ip_from 2a06:98c0::/29;
  set_real_ip_from 2c0f:f248::/32;
  real_ip_header CF-Connecting-IP;
  real_ip_recursive on;

  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Forwarded-Port \$server_port;
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
  }
}
EOF
  nginx -t
  systemctl reload nginx
  systemctl enable --now certbot.timer
  curl -fsS --max-time 10 "https://${DOMAIN}/auth/login" >/dev/null \
    || { echo "HTTPS health check failed; deployment is not complete." >&2; exit 1; }
}

install_commands() {
  install -o root -g root -m 0755 "${CURRENT_LINK}/scripts/vps-update.sh" /usr/local/bin/mwblog-update
  install -o root -g root -m 0755 "${CURRENT_LINK}/scripts/vps-backup.sh" /usr/local/bin/mwblog-backup
  install -o root -g root -m 0755 "${CURRENT_LINK}/scripts/vps-restore.sh" /usr/local/bin/mwblog-restore

  cat > "/etc/systemd/system/${APP_NAME}-backup.service" <<EOF
[Unit]
Description=Our Nest encrypted backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/mwblog-backup
EOF
  cat > "/etc/systemd/system/${APP_NAME}-backup.timer" <<EOF
[Unit]
Description=Daily Our Nest encrypted backup

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now "${APP_NAME}-backup.timer"
}

install_packages
prepare_directories
build_release
install_service
install_nginx
install_commands
systemctl is-active --quiet "$APP_NAME"
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -rf
trap - ERR

echo
echo "Deployment complete: https://${DOMAIN}"
echo "Accounts: kikou / scoinmic"
echo "Update later: sudo mwblog-update"
echo "Back up now: sudo mwblog-backup"
echo "Restore: sudo mwblog-restore /var/backups/${APP_NAME}/backup-file.tar.gz.enc"
