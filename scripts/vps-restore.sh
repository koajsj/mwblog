#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
CURRENT_LINK="${APP_ROOT:-/opt/${APP_NAME}}/current"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
APP_USER="${APP_USER:-${APP_NAME}}"
PORT="${PORT:-4321}"
input="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo mwblog-restore /path/to/backup.tar.gz.enc" >&2; exit 1; }
[ -f "$input" ] || { echo "Backup file not found: $input" >&2; exit 1; }

echo "Creating a safety backup before restore..."
/usr/local/bin/mwblog-backup
safety_backup="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.tar.gz.enc' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
systemctl stop "$APP_NAME"
restart_service() { systemctl start "$APP_NAME" || true; }
trap restart_service EXIT
set -a
source "$ENV_FILE"
set +a
cd "$CURRENT_LINK"
npm run restore -- "$input"
chown -R "$APP_USER":"$APP_USER" "$APP_DATA_DIR"
systemctl start "$APP_NAME"
systemctl is-active --quiet "$APP_NAME"
if ! curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/auth/login" >/dev/null; then
  echo "Restored data did not pass the health check. Rolling back." >&2
  systemctl stop "$APP_NAME"
  npm run restore -- "$safety_backup"
  chown -R "$APP_USER":"$APP_USER" "$APP_DATA_DIR"
  systemctl start "$APP_NAME"
  exit 1
fi
trap - EXIT
echo "Restore complete. Please log in again."
