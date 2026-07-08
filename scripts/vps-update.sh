#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
BRANCH="${BRANCH:-main}"
RUN_SETUP_USERS="${RUN_SETUP_USERS:-0}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

generate_encryption_key() {
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
}

ensure_env_line() {
  local name="$1"
  local value="$2"
  if grep -q "^${name}=" "$APP_DIR/.env" 2>/dev/null; then
    return
  fi
  umask 077
  printf "\n%s=%s\n" "$name" "$value" >> "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "Added ${name} to $APP_DIR/.env."
}

install_backup_timer() {
  $SUDO tee "/etc/systemd/system/${APP_NAME}-backup.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} encrypted backup
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/env bash ${APP_DIR}/scripts/vps-backup.sh
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

if [ ! -d "$APP_DIR/.git" ]; then
  echo "App directory is not a git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
if [ -f "$APP_DIR/.env" ]; then
  ensure_env_line "APP_ENCRYPTION_KEY" "$(generate_encryption_key)"
  ensure_env_line "BACKUP_ENCRYPTION_KEY" "$(generate_encryption_key)"
fi
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm install --package-lock=false
if [ "$RUN_SETUP_USERS" = "1" ]; then
  npm run setup:users
fi
if ! npm run encrypt:existing; then
  echo "Existing-data encryption skipped. Apply Supabase migrations 014/015/016, then run: cd ${APP_DIR} && npm run encrypt:existing" >&2
fi
npm run build

$SUDO systemctl restart "$APP_NAME"
install_backup_timer
echo "Update complete."
echo "Service: systemctl status ${APP_NAME}"
echo "Backup timer: systemctl status ${APP_NAME}-backup.timer"
