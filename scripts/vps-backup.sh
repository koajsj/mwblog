#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/${APP_NAME}}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

ensure_backup_key() {
  if [ ! -f "$APP_DIR/.env" ]; then
    echo "Missing $APP_DIR/.env" >&2
    exit 1
  fi

  if ! grep -Eq "^BACKUP_ENCRYPTION_KEY=.+" "$APP_DIR/.env"; then
    echo "Missing BACKUP_ENCRYPTION_KEY in $APP_DIR/.env" >&2
    exit 1
  fi
}

ensure_backup_key
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

cd "$APP_DIR"
BACKUP_DIR="$BACKUP_DIR" npm run backup

find "$BACKUP_DIR" -type f -name "*.tar.gz.enc" -mtime "+${RETENTION_DAYS}" -delete
echo "Backup complete. Directory: $BACKUP_DIR"
