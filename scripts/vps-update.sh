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

if [ ! -d "$APP_DIR/.git" ]; then
  echo "App directory is not a git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
if [ -f "$APP_DIR/.env" ] && ! grep -q "^APP_ENCRYPTION_KEY=" "$APP_DIR/.env"; then
  umask 077
  printf "\nAPP_ENCRYPTION_KEY=%s\n" "$(generate_encryption_key)" >> "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "Added APP_ENCRYPTION_KEY to $APP_DIR/.env. Back this file up before creating private content."
fi
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm install --package-lock=false
if [ "$RUN_SETUP_USERS" = "1" ]; then
  npm run setup:users
fi
if ! npm run encrypt:existing; then
  echo "Existing-data encryption skipped. Apply Supabase migrations 014/015, then run: cd ${APP_DIR} && npm run encrypt:existing" >&2
fi
npm run build

$SUDO systemctl restart "$APP_NAME"
echo "Update complete."
echo "Service: systemctl status ${APP_NAME}"
