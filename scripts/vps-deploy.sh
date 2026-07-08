#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="${APP_NAME:-mwblog}"
APP_DIR="${APP_DIR:-/opt/${APP_NAME}}"
REPO_URL="${REPO_URL:-https://github.com/koajsj/mwblog.git}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-4321}"
NODE_MAJOR="${NODE_MAJOR:-22}"
DOMAIN="${DOMAIN:-}"
RUN_SETUP_USERS="${RUN_SETUP_USERS:-1}"
ENABLE_SSL="${ENABLE_SSL:-0}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

need_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: ${name}" >&2
    exit 1
  fi
}

prompt_env() {
  local name="$1"
  local label="$2"
  if [ -n "${!name:-}" ]; then
    return
  fi
  if [ ! -r /dev/tty ]; then
    need_env "$name"
  fi
  printf "%s: " "$label" >/dev/tty
  IFS= read -r "$name" </dev/tty
  export "$name"
  need_env "$name"
}

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
}

install_system_packages() {
  $SUDO apt-get update
  $SUDO apt-get install -y ca-certificates curl gnupg git nginx

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "^v${NODE_MAJOR}\\."; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | $SUDO bash -
    $SUDO apt-get install -y nodejs
  fi

  if [ "$ENABLE_SSL" = "1" ]; then
    $SUDO apt-get install -y certbot python3-certbot-nginx
  fi
}

checkout_code() {
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
  else
    $SUDO mkdir -p "$APP_DIR"
    $SUDO chown -R "$(id -un):$(id -gn)" "$APP_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
}

write_env_file() {
  if [ -f "$APP_DIR/.env" ]; then
    echo "Keeping existing $APP_DIR/.env"
    ensure_env_line "APP_ENCRYPTION_KEY" "$(generate_encryption_key)"
    chmod 600 "$APP_DIR/.env"
    return
  fi

  prompt_env SUPABASE_URL "Supabase URL"
  prompt_env SUPABASE_ANON_KEY "Supabase anon key"
  prompt_env SUPABASE_SERVICE_ROLE_KEY "Supabase service role key"
  APP_ENCRYPTION_KEY="${APP_ENCRYPTION_KEY:-$(generate_encryption_key)}"

  umask 077
  cat > "$APP_DIR/.env" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
APP_ENCRYPTION_KEY=${APP_ENCRYPTION_KEY}
EOF
  chmod 600 "$APP_DIR/.env"
}

build_app() {
  cd "$APP_DIR"
  npm install --package-lock=false
  if [ "$RUN_SETUP_USERS" = "1" ]; then
    npm run setup:users
  fi
  if ! npm run encrypt:existing; then
    echo "Existing-data encryption skipped. Apply Supabase migrations 014/015, then run: cd ${APP_DIR} && npm run encrypt:existing" >&2
  fi
  npm run build
}

install_systemd_service() {
  local node_path
  node_path="$(command -v node)"

  $SUDO tee "/etc/systemd/system/${APP_NAME}.service" >/dev/null <<EOF
[Unit]
Description=${APP_NAME} Astro app
After=network.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=HOST=127.0.0.1
Environment=PORT=${PORT}
ExecStart=${node_path} ${APP_DIR}/dist/server/entry.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable "${APP_NAME}"
  $SUDO systemctl restart "${APP_NAME}"
}

install_nginx_site() {
  if [ -z "$DOMAIN" ]; then
    echo "DOMAIN not set; skipping Nginx site config."
    return
  fi

  $SUDO tee "/etc/nginx/sites-available/${APP_NAME}" >/dev/null <<EOF
server {
  listen 80;
  server_name ${DOMAIN};
  client_max_body_size 60m;

  location / {
    proxy_pass http://127.0.0.1:${PORT};
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
EOF

  $SUDO ln -sfn "/etc/nginx/sites-available/${APP_NAME}" "/etc/nginx/sites-enabled/${APP_NAME}"
  $SUDO nginx -t
  $SUDO systemctl reload nginx

  if [ "$ENABLE_SSL" = "1" ]; then
    $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "admin@${DOMAIN}" || {
      echo "Certbot failed. Check DNS, then run: sudo certbot --nginx -d ${DOMAIN}" >&2
    }
  fi
}

install_system_packages
checkout_code
write_env_file
build_app
install_systemd_service
install_nginx_site

echo "Deployment complete."
echo "Service: systemctl status ${APP_NAME}"
echo "Important: back up ${APP_DIR}/.env. APP_ENCRYPTION_KEY is required to read encrypted private content."
if [ -n "$DOMAIN" ]; then
  echo "URL: http://${DOMAIN}"
else
  echo "Local URL: http://127.0.0.1:${PORT}"
fi
