#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
CURRENT_LINK="${APP_ROOT:-/opt/${APP_NAME}}/current"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-${DATA_DIR}/.npm-cache}"
APP_USER="${APP_USER:-${APP_NAME}}"
PORT="${PORT:-4321}"
input="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo mwblog-restore /path/to/backup.tar.gz.enc" >&2; exit 1; }
[ -f "$input" ] || { echo "Backup file not found: $input" >&2; exit 1; }
[ -f "$ENV_FILE" ] && [ -L "$CURRENT_LINK" ] || { echo "The site has not been deployed yet." >&2; exit 1; }
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || { echo "Invalid port: $PORT" >&2; exit 1; }

run_restore() {
  runuser -u "$APP_USER" -- env \
    HOME="$DATA_DIR" \
    NPM_CONFIG_CACHE="$NPM_CACHE_DIR" \
    APP_DATA_DIR="$APP_DATA_DIR" \
    BACKUP_ENCRYPTION_KEY="$BACKUP_ENCRYPTION_KEY" \
    bash -c 'cd "$1" && npm run restore -- "$2"' _ "$CURRENT_LINK" "$1"
}

health_check() {
  systemctl is-active --quiet "$APP_NAME" \
    && curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/auth/login" >/dev/null
}

echo "Creating a safety backup before restore..."
/usr/local/bin/mwblog-backup
safety_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.tar.gz.enc' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
[ -n "$safety_backup" ] && [ -f "$safety_backup" ] || { echo "Could not find the safety backup." >&2; exit 1; }
systemctl stop "$APP_NAME"
restart_service=1
restart_if_safe() { [ "$restart_service" = "1" ] && systemctl start "$APP_NAME" || true; }
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$NPM_CACHE_DIR"
trap restart_if_safe EXIT
set -a
source "$ENV_FILE"
set +a
run_restore "$input"
chown -R "$APP_USER":"$APP_USER" "$APP_DATA_DIR"
systemctl start "$APP_NAME"
if ! health_check; then
  echo "Restored data did not pass the health check. Rolling back." >&2
  systemctl stop "$APP_NAME"
  if ! run_restore "$safety_backup"; then
    restart_service=0
    echo "Rollback failed. The service has been left stopped to protect the data." >&2
    exit 1
  fi
  chown -R "$APP_USER":"$APP_USER" "$APP_DATA_DIR"
  systemctl start "$APP_NAME"
  if ! health_check; then
    restart_service=0
    echo "Rollback health check failed. The service has been left stopped to protect the data." >&2
    exit 1
  fi
  exit 1
fi
trap - EXIT
echo "Restore complete. Please log in again."
