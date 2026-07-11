#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4321}"
APP_USER="${APP_USER:-${APP_NAME}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
DOMAIN="${DOMAIN:-}"
RUN_SETUP_USERS="${RUN_SETUP_USERS:-1}"
RESET_FIXED_USER_PASSWORDS="${RESET_FIXED_USER_PASSWORDS:-1}"
RUN_CLIENT_MIGRATION="${RUN_CLIENT_MIGRATION:-0}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

generate_encryption_key() {
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
}

log() {
  printf "\n==> %s\n" "$*"
}

env_has_value() {
  local name="$1"
  grep -Eq "^[[:space:]]*${name}=.+" "$APP_DIR/.env" 2>/dev/null
}

ensure_env_line() {
  local name="$1"
  local value="$2"
  if grep -q "^${name}=" "$APP_DIR/.env" 2>/dev/null; then
    return
  fi
  umask 077
  printf "\n%s=%s\n" "$name" "$value" >> "$APP_DIR/.env"
  $SUDO chown root:"$APP_USER" "$APP_DIR/.env"
  $SUDO chmod 640 "$APP_DIR/.env"
  echo "Added ${name} to $APP_DIR/.env."
}

ensure_app_origin() {
  if env_has_value "APP_ORIGIN"; then
    return
  fi

  local origin="${APP_ORIGIN:-}"
  if [ -z "$origin" ] && [ -n "$DOMAIN" ]; then
    origin="https://${DOMAIN}"
  fi
  if [ -z "$origin" ]; then
    local nginx_site="/etc/nginx/sites-available/${APP_NAME}"
    local configured_domain
    configured_domain="$($SUDO awk '/^[[:space:]]*server_name[[:space:]]+/ {gsub(/;/, "", $2); print $2; exit}' "$nginx_site" 2>/dev/null || true)"
    if [ -n "$configured_domain" ] && [ "$configured_domain" != "_" ]; then
      if $SUDO grep -q "ssl_certificate" "$nginx_site" 2>/dev/null; then
        origin="https://${configured_domain}"
      else
        origin="http://${configured_domain}"
      fi
    fi
  fi

  if [ -n "$origin" ]; then
    ensure_env_line "APP_ORIGIN" "$origin"
  fi
}

validate_env_file() {
  local missing=0
  local required=(
    SUPABASE_URL
    SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    BACKUP_ENCRYPTION_KEY
  )

  if [ ! -f "$APP_DIR/.env" ]; then
    echo "Missing $APP_DIR/.env" >&2
    exit 1
  fi

  for name in "${required[@]}"; do
    if ! env_has_value "$name"; then
      echo "Missing ${name} in $APP_DIR/.env" >&2
      missing=1
    fi
  done

  if [ "$missing" = "1" ]; then
    exit 1
  fi

  $SUDO chown root:"$APP_USER" "$APP_DIR/.env"
  $SUDO chmod 640 "$APP_DIR/.env"
}

ensure_clean_checkout() {
  if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
    echo "Git checkout has local changes. Commit or remove them before updating: $APP_DIR" >&2
    exit 1
  fi
}

ensure_app_user() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    echo "Missing service account ${APP_USER}. Run scripts/vps-deploy.sh first." >&2
    exit 1
  fi

  $SUDO install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$BACKUP_DIR"
}

install_dependencies() {
  [ -f package-lock.json ] || { echo "package-lock.json is required." >&2; exit 1; }
  npm ci
}

wait_for_app() {
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/auth/login" >/dev/null; then
      return
    fi
    sleep 2
  done
  echo "Application health check failed." >&2
  return 1
}

install_systemd_service() {
  local node_path
  node_path="$(command -v node)"

  $SUDO tee "/etc/systemd/system/${APP_NAME}.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Astro app
After=network.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
UMask=0077
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=${PORT}
Environment=TMPDIR=/run/${APP_NAME}
ExecStart=${node_path} ${APP_DIR}/dist/server/entry.mjs
Restart=always
RestartSec=5
RuntimeDirectory=${APP_NAME}
RuntimeDirectoryMode=0700
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectSystem=full
ReadOnlyPaths=${APP_DIR}
ReadWritePaths=/run/${APP_NAME} /tmp /var/tmp

[Install]
WantedBy=multi-user.target
EOF
}

install_backup_timer() {
  $SUDO tee "/etc/systemd/system/${APP_NAME}-backup.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} encrypted backup
After=network-online.target

[Service]
Type=oneshot
User=${APP_USER}
Group=${APP_USER}
UMask=0077
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=BACKUP_DIR=${BACKUP_DIR}
ExecStart=/usr/bin/env bash ${APP_DIR}/scripts/vps-backup.sh
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadOnlyPaths=${APP_DIR}
ReadWritePaths=${BACKUP_DIR} /tmp /var/tmp
EOF

  $SUDO tee "/etc/systemd/system/${APP_NAME}-backup.timer" >/dev/null <<EOF
[Unit]
Description=Daily ${APP_NAME} encrypted backup

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "${APP_NAME}-backup.timer"
}

PREVIOUS_REV=""
ROLLBACK_ACTIVE=0

rollback() {
  local status="$?"
  trap - ERR
  if [ "$ROLLBACK_ACTIVE" = "1" ] && [ -n "$PREVIOUS_REV" ]; then
    echo "Update failed. Restoring ${PREVIOUS_REV:0:7}." >&2
    git checkout "$BRANCH" >&2 || true
    git reset --hard "$PREVIOUS_REV" >&2 || true
    install_dependencies >&2 || true
    npm run build >&2 || true
    install_systemd_service >&2 || true
    install_backup_timer >&2 || true
    $SUDO systemctl daemon-reload >&2 || true
    $SUDO systemctl restart "$APP_NAME" >&2 || true
  fi
  exit "$status"
}

if [ ! -d "$APP_DIR/.git" ]; then
  echo "App directory is not a git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
log "Preparing environment"
if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env. Run scripts/vps-deploy.sh first or create the environment file manually." >&2
  exit 1
fi
ensure_env_line "BACKUP_ENCRYPTION_KEY" "$(generate_encryption_key)"
ensure_app_origin
ensure_app_user
validate_env_file

ensure_clean_checkout
PREVIOUS_REV="$(git rev-parse HEAD)"
ROLLBACK_ACTIVE=1
trap rollback ERR

log "Updating ${BRANCH}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

log "Installing dependencies and building"
install_dependencies
if [ "$RUN_SETUP_USERS" = "1" ]; then
  RESET_FIXED_USER_PASSWORDS="$RESET_FIXED_USER_PASSWORDS" npm run setup:users
fi

if [ "$RUN_CLIENT_MIGRATION" = "1" ]; then
  npm run migrate:client-encryption
else
  echo "Skipping client-encryption migration. After applying migration 023, run it with SPACE_RECOVERY_CODE and SPACE_NEW_PASSPHRASE."
fi

npm test
npm run build

log "Restarting service"
install_systemd_service
$SUDO systemctl daemon-reload
$SUDO systemctl restart "$APP_NAME"
$SUDO systemctl is-active --quiet "$APP_NAME"
wait_for_app
install_backup_timer
ROLLBACK_ACTIVE=0
trap - ERR
echo "Update complete."
echo "Previous revision: ${PREVIOUS_REV:0:7}"
echo "Current revision: $(git rev-parse --short HEAD)"
echo "Service: systemctl status ${APP_NAME}"
echo "Backup timer: systemctl status ${APP_NAME}-backup.timer"
echo "URL: $(grep '^APP_ORIGIN=' "$APP_DIR/.env" | tail -n 1 | cut -d= -f2-)"
