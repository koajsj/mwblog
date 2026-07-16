#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
CURRENT_LINK="${APP_ROOT:-/opt/${APP_NAME}}/current"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-${DATA_DIR}/.npm-cache}"
APP_USER="${APP_USER:-${APP_NAME}}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo mwblog-backup" >&2; exit 1; }
[ -f "$ENV_FILE" ] && [ -L "$CURRENT_LINK" ] || { echo "The site has not been deployed yet." >&2; exit 1; }
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$BACKUP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$NPM_CACHE_DIR"

write_backup_status() {
  local status="$1"
  node - "$DATA_DIR/backup-status.json" "$status" "$APP_USER" <<'NODE'
const { existsSync, readFileSync, renameSync, rmSync, writeFileSync, chownSync } = require("node:fs");
const [target, status, owner] = process.argv.slice(2);
const now = new Date().toISOString();
let previous = {};
try { previous = JSON.parse(readFileSync(target, "utf8")); } catch {}
const previousSuccess = typeof previous.last_success_at === "string" ? previous.last_success_at : null;
const payload = {
  version: 1,
  status,
  last_attempt_at: now,
  last_success_at: status === "ok" ? now : previousSuccess,
  snapshot_verified_at: status === "ok" ? now : null,
};
const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
try {
  writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  chownSync(temporary, owner, owner);
  renameSync(temporary, target);
} finally {
  if (existsSync(temporary)) rmSync(temporary, { force: true });
}
NODE
}

was_active=0
if systemctl is-active --quiet "$APP_NAME"; then
  was_active=1
  systemctl stop "$APP_NAME"
fi
restart_service_on_exit() {
  if [ "$was_active" = "1" ]; then systemctl start "$APP_NAME" || true; fi
}
trap restart_service_on_exit EXIT
backup_failed() {
  local exit_code="$?"
  trap - ERR
  write_backup_status "failed" || true
  exit "$exit_code"
}
trap backup_failed ERR
runuser -u "$APP_USER" -- env HOME="$DATA_DIR" NPM_CONFIG_CACHE="$NPM_CACHE_DIR" BACKUP_DIR="$BACKUP_DIR" bash -c \
  "cd '$CURRENT_LINK' && set -a && source '$ENV_FILE' && set +a && npm run backup"
find "$BACKUP_DIR" -type f -name '*.tar.gz.enc' -mtime "+${RETENTION_DAYS}" -delete
write_backup_status "ok"
trap - ERR
if [ "$was_active" = "1" ] && ! systemctl start "$APP_NAME"; then
  write_backup_status "failed" || true
  trap - EXIT
  exit 1
fi
trap - EXIT
echo "Backup complete: $BACKUP_DIR"
