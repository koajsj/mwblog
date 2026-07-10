#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
BRANCH="${BRANCH:-main}"
RUN_SETUP_USERS="${RUN_SETUP_USERS:-0}"
RUN_LEGACY_ENCRYPTION="${RUN_LEGACY_ENCRYPTION:-0}"
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
  chmod 600 "$APP_DIR/.env"
  echo "Added ${name} to $APP_DIR/.env."
}

validate_env_file() {
  local missing=0
  local required=(
    SUPABASE_URL
    SUPABASE_ANON_KEY
    SUPABASE_SERVICE_ROLE_KEY
    APP_ENCRYPTION_KEY
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

  chmod 600 "$APP_DIR/.env"
}

ensure_clean_checkout() {
  if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
    echo "Git checkout has local changes. Commit or remove them before updating: $APP_DIR" >&2
    exit 1
  fi
}

install_dependencies() {
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
}

install_backup_timer() {
  $SUDO tee "/etc/systemd/system/${APP_NAME}-backup.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} encrypted backup
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
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
log "Preparing environment"
if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env. Run scripts/vps-deploy.sh first or create the environment file manually." >&2
  exit 1
fi
ensure_env_line "APP_ENCRYPTION_KEY" "$(generate_encryption_key)"
ensure_env_line "BACKUP_ENCRYPTION_KEY" "$(generate_encryption_key)"
validate_env_file

ensure_clean_checkout
PREVIOUS_REV="$(git rev-parse --short HEAD)"

log "Updating ${BRANCH}"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

log "Installing dependencies and building"
install_dependencies
if [ "$RUN_SETUP_USERS" = "1" ]; then
  npm run setup:users
fi

if [ "$RUN_LEGACY_ENCRYPTION" = "1" ]; then
  npm run encrypt:existing
else
  echo "Skipping legacy server-side encryption migration. Set RUN_LEGACY_ENCRYPTION=1 to run it."
fi

if [ "$RUN_CLIENT_MIGRATION" = "1" ]; then
  npm run migrate:client-encryption
else
  echo "Skipping client-encryption data migration. Run npm run migrate:client-encryption manually after unlocking the private-space key."
fi

npm run build

log "Restarting service"
$SUDO systemctl restart "$APP_NAME"
install_backup_timer
echo "Update complete."
echo "Previous revision: ${PREVIOUS_REV}"
echo "Current revision: $(git rev-parse --short HEAD)"
echo "Service: systemctl status ${APP_NAME}"
echo "Backup timer: systemctl status ${APP_NAME}-backup.timer"
