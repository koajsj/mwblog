#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_ROOT="${APP_ROOT:-/opt/${APP_NAME}}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
DATA_DIR="${DATA_DIR:-/var/lib/${APP_NAME}}"
NPM_CACHE_DIR="${NPM_CACHE_DIR:-${DATA_DIR}/.npm-cache}"
ENV_FILE="${ENV_FILE:-/etc/${APP_NAME}.env}"
REPO_URL="${REPO_URL:-https://github.com/koajsj/mwblog.git}"
BRANCH="${BRANCH:-main}"
APP_USER="${APP_USER:-${APP_NAME}}"
PORT="${PORT:-4321}"

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo: sudo mwblog-update" >&2; exit 1; }
[ -L "$CURRENT_LINK" ] || { echo "Run the first deployment command before updating." >&2; exit 1; }
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$PORT" -le 65535 ] || { echo "Invalid port: $PORT" >&2; exit 1; }

previous="$(readlink -f "$CURRENT_LINK")"
stamp="$(date -u +%Y%m%d%H%M%S)"
release="$(mktemp -d "${RELEASES_DIR}/${stamp}-XXXXXX")"

rollback() {
  local status="$?"
  trap - ERR
  echo "Update failed. Returning to the previous release." >&2
  rm -f "${CURRENT_LINK}.new"
  ln -sfn "$previous" "${CURRENT_LINK}.rollback"
  mv -Tf "${CURRENT_LINK}.rollback" "$CURRENT_LINK"
  systemctl restart "$APP_NAME" || true
  rm -rf "$release"
  exit "$status"
}
trap rollback ERR

/usr/local/bin/mwblog-backup
git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$release"
chown -R "$APP_USER":"$APP_USER" "$release"
install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$NPM_CACHE_DIR"
runuser -u "$APP_USER" -- env HOME="$DATA_DIR" NPM_CONFIG_CACHE="$NPM_CACHE_DIR" bash -c \
  "set -a && source '$ENV_FILE' && set +a && cd '$release' && bash -n scripts/*.sh && npm ci && npm test && APP_DATA_DIR='$release/.build-data' npm run build && rm -rf '$release/.build-data'"
test -f "$release/dist/server/entry.mjs"

ln -sfn "$release" "${CURRENT_LINK}.new"
mv -Tf "${CURRENT_LINK}.new" "$CURRENT_LINK"
systemctl restart "$APP_NAME"
systemctl is-active --quiet "$APP_NAME"
for _ in $(seq 1 30); do
  curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/auth/login" >/dev/null && break
  sleep 2
done
curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/auth/login" >/dev/null

install -o root -g root -m 0755 "${CURRENT_LINK}/scripts/vps-update.sh" /usr/local/bin/mwblog-update
install -o root -g root -m 0755 "${CURRENT_LINK}/scripts/vps-backup.sh" /usr/local/bin/mwblog-backup
install -o root -g root -m 0755 "${CURRENT_LINK}/scripts/vps-restore.sh" /usr/local/bin/mwblog-restore
find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +6 | cut -d' ' -f2- | xargs -r rm -rf
trap - ERR
echo "Update complete: $(git -C "$release" rev-parse --short HEAD)"
