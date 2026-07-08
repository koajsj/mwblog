#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

generate_backup_key() {
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
}

ensure_backup_key() {
  if [ ! -f "$APP_DIR/.env" ]; then
    echo "Missing $APP_DIR/.env" >&2
    exit 1
  fi

  if ! grep -q "^BACKUP_ENCRYPTION_KEY=" "$APP_DIR/.env"; then
    umask 077
    printf "\nBACKUP_ENCRYPTION_KEY=%s\n" "$(generate_backup_key)" >> "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
    echo "Added BACKUP_ENCRYPTION_KEY to $APP_DIR/.env"
    echo "Save this recovery key outside the VPS:"
    grep "^BACKUP_ENCRYPTION_KEY=" "$APP_DIR/.env"
  fi
}

ensure_backup_key
$SUDO mkdir -p "$BACKUP_DIR"
$SUDO chmod 700 "$BACKUP_DIR"
if [ -n "$SUDO" ]; then
  $SUDO chown "$(id -un):$(id -gn)" "$BACKUP_DIR"
fi

cd "$APP_DIR"
BACKUP_DIR="$BACKUP_DIR" npm run backup

find "$BACKUP_DIR" -type f -name "*.tar.gz.enc" -mtime "+${RETENTION_DAYS}" -delete
echo "Backup complete. Directory: $BACKUP_DIR"
