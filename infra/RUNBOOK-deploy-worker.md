# Runbook — deploy the production worker (fix the localhost URLs)

## Why agents show `http://localhost:13xxx`

The web app (Vercel) is **intent-only**: it writes `queued` rows to Postgres. The
**deployer-worker** is the single process that boots containers, registers Caddy
routes, and writes the agent's `hostUrl`. Diagnosed 2026-06-09: no production
worker host existed — a worker running locally (dev default `DEPLOYER_SKIP_CADDY=true`)
booted containers on a laptop at `localhost:13xxx` and leaked the rows into the
shared RDS. Those URLs only resolve on that laptop.

`buildHostUrl` (packages/deployer-worker/src/lifecycle.ts):

```
SKIP_CADDY=true  -> http://localhost:<dashboardPort>   (dev only)
SKIP_CADDY=false -> https://<HERMES_DOMAIN>/<slug>      (prod)
```

The fix is to run ONE real worker on a public Docker+Caddy host with
`DEPLOYER_SKIP_CADDY=false` and a real `HERMES_DOMAIN`.

## Topology

- **Vercel** keeps serving the web UI (`hermes-deployer.vercel.app`). No change.
- **One VPS / EC2** runs: deployer-worker + Docker + Caddy, against the SAME RDS.
- A DNS name (e.g. `agents.zynd.ai`) points at that host; Caddy serves
  `https://agents.zynd.ai/<slug>` per agent.

> Do NOT reuse `hermes.zynd.ai` — it currently points at Vercel. Use a fresh
> subdomain for the worker host, or repoint after migrating the frontend.

## Prerequisites

- A Linux host (Ubuntu 24.04) with a **public IP** and ports **80 + 443** open.
- A DNS **A record**: `agents.zynd.ai -> <host public IP>`.
- The shared `DATABASE_URL` (the RDS the Vercel app uses).
- `SECRET_ENC_KEY` (same value as Vercel — the worker decrypts the secret blob
  the web app encrypts; they MUST match).
- `DEPLOYER_WS_SECRET` (same value as Vercel — shared HMAC for the deploy WS).
- `HERMES_IMAGE` (the UA-patched Hermes image tag).

## Steps

### 1. Bootstrap the host

```sh
git clone https://github.com/zyndai/heremes-deployer /opt/hermes-deployer
cd /opt/hermes-deployer
sudo HERMES_IMAGE=ghcr.io/your-org/hermes:0.16.0-ua bash infra/install.sh
```

Installs Docker, Caddy, Node 24, pnpm; creates the `hermes` user; installs the
systemd units. (Postgres is installed too but unused — you point at RDS.)

### 2. Write `/etc/hermes-deployer/worker.env`

```sh
DATABASE_URL=<the SAME RDS url Vercel uses>
SECRET_ENC_KEY=<same as Vercel>
DEPLOYER_WS_SECRET=<same as Vercel>
HERMES_IMAGE=ghcr.io/your-org/hermes:0.16.0-ua
HERMES_DOMAIN=agents.zynd.ai          # <-- the worker host's domain
DEPLOYER_SKIP_CADDY=false             # <-- MUST be false in prod
DEPLOYER_DATA_ROOT=/var/lib/hermes-deployer
AGE_IDENTITY_PATH=/var/lib/hermes-deployer/master.age
DEPLOYER_WS_PORT=7072
CADDY_ADMIN_URL=http://127.0.0.1:2019
```

### 3. Point Caddy at the domain

Edit `infra/Caddyfile`: replace `deployer.example.com` with `agents.zynd.ai`,
then reload:

```sh
sudo cp infra/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy   # Caddy auto-provisions the LE cert (HTTP-01)
```

### 4. Run DB migrations (first time only)

```sh
sudo -u hermes pnpm -C packages/deployer-worker exec prisma migrate deploy
```

### 5. Start the worker

```sh
sudo systemctl enable --now hermes-deployer-worker
sudo systemctl status hermes-deployer-worker     # expect active (running)
sudo journalctl -u hermes-deployer-worker -f     # watch it drain the queue
```

### 6. Re-enable the UI controls on Vercel

```sh
# from the repo root (where .vercel is linked)
echo -n 'true' | vercel env add NEXT_PUBLIC_WORKER_ENABLED production
vercel --prod --yes
```

Now Start/Restart/Stop reappear, and new agents get `https://agents.zynd.ai/<slug>`.

## Verify

1. Delete the stale localhost agents (the Delete button works without a worker).
2. Create a new agent. Deploy steps advance over the WS; final URL is
   `https://agents.zynd.ai/<slug>`, NOT localhost.
3. Click Open — the agent dashboard loads over HTTPS on the real domain.

## Gotchas (learned the hard way)

- **`DEPLOYER_SKIP_CADDY` must be false.** Any `true` (a copied dev env) →
  localhost URLs.
- **`HERMES_DOMAIN`, not `DEPLOYER_WILDCARD_DOMAIN`.** The code reads
  `HERMES_DOMAIN` (PR #1 fix); the old var name silently fell back to a bad default.
- **`SECRET_ENC_KEY` must match Vercel exactly**, or the worker can't decrypt the
  per-agent secret blob and every deploy fails at `starting`.
- **One worker only.** The queue claim is a pessimistic lock, but running two
  workers on different hosts against one RDS will fight over ports/routes.
- **No worker = no provisioning.** The web app cannot boot containers itself;
  Vercel is serverless with no Docker. The worker host is mandatory, not optional.
