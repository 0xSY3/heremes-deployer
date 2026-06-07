#!/usr/bin/env bash
# Hermes Deployer one-shot bootstrap for a fresh Ubuntu 24.04 VM.
#
#   sudo bash infra/install.sh
#
# Idempotent — safe to re-run. After this finishes:
#   - Docker, Postgres 16, Caddy, age, Node 24, pnpm are installed
#   - A 'hermes' user owns /opt/hermes-deployer and /var/lib/hermes-deployer
#   - The fixed Hermes agent image is pulled (no per-agent build)
#   - Systemd units are installed (operator starts them)
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEPLOY_ROOT=/opt/hermes-deployer
DATA_ROOT=/var/lib/hermes-deployer
ETC_DIR=/etc/hermes-deployer
HERMES_USER=hermes
# Override with HERMES_IMAGE=... before running to pin a different tag.
HERMES_IMAGE=${HERMES_IMAGE:-ghcr.io/your-org/hermes:latest}

if [[ $EUID -ne 0 ]]; then
  echo "Run me as root (sudo bash infra/install.sh)" >&2
  exit 1
fi

echo "==> Installing system packages"
apt-get update
apt-get install -y --no-install-recommends \
  curl ca-certificates gnupg lsb-release \
  postgresql postgresql-contrib \
  age \
  build-essential

# ---- Docker -----------------------------------------------------------------
if ! command -v docker >/dev/null; then
  echo "==> Installing Docker"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
fi

# ---- Caddy ------------------------------------------------------------------
if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update
  apt-get install -y caddy
fi
# NOTE: no caddy-dns plugin — Hermes uses HTTP-01 (single host, path-based), not wildcard DNS-01.

# ---- Node 24 + pnpm ---------------------------------------------------------
if ! node -v 2>/dev/null | grep -q '^v24'; then
  echo "==> Installing Node 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare pnpm@latest --activate

# ---- User + dirs ------------------------------------------------------------
echo "==> Creating hermes user + data dirs"
id -u "$HERMES_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$HERMES_USER"
usermod -aG docker "$HERMES_USER"

# secrets/ holds the per-agent age files (<id>.age). No blobs/work dirs —
# Hermes has no uploads and no bind-mounted workdir (config is 100% env).
install -d -o "$HERMES_USER" -g "$HERMES_USER" -m 0750 "$DEPLOY_ROOT" "$DATA_ROOT" \
  "$DATA_ROOT/secrets"
install -d -m 0755 "$ETC_DIR"

# ---- Age master key ---------------------------------------------------------
if [[ ! -f "$DATA_ROOT/master.age" ]]; then
  echo "==> Generating age master key at $DATA_ROOT/master.age"
  sudo -u "$HERMES_USER" age-keygen -o "$DATA_ROOT/master.age"
  chmod 0600 "$DATA_ROOT/master.age"
fi

# ---- Postgres database ------------------------------------------------------
echo "==> Ensuring postgres role + database"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes') THEN
    CREATE ROLE hermes LOGIN PASSWORD 'hermes';
  END IF;
END \$\$;
SQL
sudo -u postgres createdb -O hermes hermes_deployer 2>/dev/null || true

# ---- App install ------------------------------------------------------------
echo "==> Copying app to $DEPLOY_ROOT"
rsync -a --delete --exclude .git --exclude node_modules --exclude .next "$REPO_ROOT/" "$DEPLOY_ROOT/"
chown -R "$HERMES_USER:$HERMES_USER" "$DEPLOY_ROOT"

cd "$DEPLOY_ROOT"
sudo -u "$HERMES_USER" pnpm install --frozen-lockfile
sudo -u "$HERMES_USER" pnpm -C packages/deployer-worker exec prisma generate
sudo -u "$HERMES_USER" pnpm -C packages/deployer-worker exec prisma migrate deploy
sudo -u "$HERMES_USER" pnpm -C apps/web build

# ---- Systemd env files ------------------------------------------------------
if [[ ! -f "$ETC_DIR/worker.env" ]]; then
  echo "==> Writing $ETC_DIR/{web,worker}.env from infra/.env.example (EDIT THE SECRETS)"
  install -m 0640 "$DEPLOY_ROOT/infra/.env.example" "$ETC_DIR/web.env"
  install -m 0640 "$DEPLOY_ROOT/infra/.env.example" "$ETC_DIR/worker.env"
fi

# ---- Hermes image -----------------------------------------------------------
# Fixed, complete image — pulled, never built per-agent (spec §4).
echo "==> Pulling Hermes image $HERMES_IMAGE"
docker pull "$HERMES_IMAGE"

# ---- Systemd units + Caddy --------------------------------------------------
install -m 0644 "$DEPLOY_ROOT/infra/systemd/hermes-deployer-web.service"    /etc/systemd/system/
install -m 0644 "$DEPLOY_ROOT/infra/systemd/hermes-deployer-worker.service" /etc/systemd/system/
install -m 0644 "$DEPLOY_ROOT/infra/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload

echo ""
echo "==> Done. To finish:"
echo "   1. Edit /etc/hermes-deployer/{web,worker}.env — set DEPLOYER_WS_SECRET, HERMES_DOMAIN, HERMES_IMAGE, AUTH_* "
echo "   2. Edit /etc/caddy/Caddyfile — set your real domain"
echo "   3. sudo systemctl enable --now caddy"
echo "   4. sudo systemctl enable --now hermes-deployer-web hermes-deployer-worker"
echo ""
echo "Web UI:  https://<your-domain>"
echo "Data:    $DATA_ROOT   (per-agent age secrets in $DATA_ROOT/secrets)"
echo "Deploy:  $DEPLOY_ROOT"
