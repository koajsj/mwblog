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

if [ ! -d "$APP_DIR/.git" ]; then
  echo "App directory is not a git checkout: $APP_DIR" >&2
  exit 1
fi

cd "$APP_DIR"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

npm install --package-lock=false
if [ "$RUN_SETUP_USERS" = "1" ]; then
  npm run setup:users
fi
npm run build

$SUDO systemctl restart "$APP_NAME"
echo "Update complete."
echo "Service: systemctl status ${APP_NAME}"
