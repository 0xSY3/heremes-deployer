// Central env lookup for the deployer-worker. Fail fast at boot if anything
// critical is missing. Ported from zynd-deployer's config.ts, Hermes-shaped:
// the agent image is fixed (HERMES_IMAGE, required — no per-agent build), there
// are two container ports instead of one, and the upload/runtime keys are gone.

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be numeric, got: ${raw}`);
  }
  return n;
}

function boolEnv(name: string): boolean {
  return (process.env[name] ?? "").toLowerCase() === "true";
}

// Fixed Hermes container ports. The gateway API and the dashboard always listen
// on these inside the container; only the *host* side of the binding varies per
// agent (apiPort/dashboardPort columns). Not env-tunable — they are part of the
// image contract, not deployer policy.
export const API_PORT = 8642;
export const DASHBOARD_PORT = 9119;

const dataRoot = optional("DEPLOYER_DATA_ROOT", "/var/lib/hermes-deployer");

export const config = {
  // Fixed agent image. No default: a misconfigured worker must not silently
  // boot the wrong (or a non-existent) image, so we fail fast at load.
  hermesImage: required("HERMES_IMAGE"),

  dataRoot,
  // Public host agents are reached on: https://<wildcardDomain>/<slug>. The
  // canonical var is HERMES_DOMAIN (the same one the Caddyfile + web app use);
  // DEPLOYER_WILDCARD_DOMAIN is kept only as a legacy alias so an older
  // worker.env still resolves. Reading the wrong var here silently shipped a
  // bogus default domain (and, with SKIP_CADDY, localhost URLs) to clients.
  wildcardDomain: optional(
    "HERMES_DOMAIN",
    optional("DEPLOYER_WILDCARD_DOMAIN", "deployer.hermes.ai"),
  ),
  caddyAdminUrl: optional("CADDY_ADMIN_URL", "http://127.0.0.1:2019"),
  caddyServerName: optional("CADDY_SERVER_NAME", "srv0"),
  dockerSocket: optional("DOCKER_SOCKET", "/var/run/docker.sock"),
  ageIdentityPath: optional("AGE_IDENTITY_PATH", `${dataRoot}/master.age`),

  portMin: numberEnv("DEPLOYER_PORT_MIN", 13000),
  portMax: numberEnv("DEPLOYER_PORT_MAX", 14000),
  containerMemoryMb: numberEnv("DEPLOYER_CONTAINER_MEM_MB", 1536),
  containerCpuMillis: numberEnv("DEPLOYER_CONTAINER_CPU_MILLIS", 1000),

  // Size of the writable /tmp tmpfs mounted into each container. The rootfs is
  // read-only (see docker.ts); the gateway only needs scratch space, so this is
  // far smaller than zynd's (no npm/pip caches, no installed node_modules).
  containerTmpfsMb: numberEnv("DEPLOYER_CONTAINER_TMPFS_MB", 128),

  // How long to wait for a freshly started container's /health to return 200
  // before declaring the deploy FAILED. The image is already complete (no
  // entrypoint install step), so only the gateway's ~20-45s boot remains.
  bootHealthTimeoutMs: numberEnv("DEPLOYER_BOOT_HEALTH_TIMEOUT_MS", 120_000),
  bootHealthIntervalMs: numberEnv("DEPLOYER_BOOT_HEALTH_INTERVAL_MS", 500),

  // Per-line container logs are pruned after logRetentionDays; system lines
  // (the [CRASH]/[FAILED] post-mortems) are kept longer. 0 disables pruning.
  logRetentionDays: numberEnv("DEPLOYER_LOG_RETENTION_DAYS", 7),
  systemLogRetentionDays: numberEnv("DEPLOYER_SYSTEM_LOG_RETENTION_DAYS", 30),
  metricRetentionDays: numberEnv("DEPLOYER_METRIC_RETENTION_DAYS", 3),
  // Retention loop cadence (minutes); one run deletes in 10k batches so it does
  // not lock the table.
  retentionIntervalMinutes: numberEnv("DEPLOYER_RETENTION_INTERVAL_MIN", 60),

  // CPU/memory sampler for running containers.
  metricsIntervalSeconds: numberEnv("DEPLOYER_METRICS_INTERVAL_SEC", 30),

  // Periodic /health probe for running containers. Catches hangs where the
  // process is alive (invisible to the crash watcher) but no longer serving.
  // Three consecutive failures move the agent running -> unhealthy.
  healthProbeIntervalSeconds: numberEnv("DEPLOYER_HEALTH_INTERVAL_SEC", 60),
  healthProbeTimeoutMs: numberEnv("DEPLOYER_HEALTH_TIMEOUT_MS", 2000),
  healthProbeFailThreshold: numberEnv("DEPLOYER_HEALTH_FAIL_THRESHOLD", 3),

  // Local-dev escape hatch: skip the Caddy admin API and mark the agent running
  // without a route. The container is still reachable at 127.0.0.1:<apiPort>.
  skipCaddy: boolEnv("DEPLOYER_SKIP_CADDY"),

  // Domainless public deploy: with skipCaddy set, hand out
  // http://<publicHost>:<dashboardPort> instead of localhost so the dashboard
  // link is reachable off-box (the worker SG must open the agent port range).
  // Empty = fall back to localhost (true local dev).
  publicHost: optional("DEPLOYER_PUBLIC_HOST", ""),

  // Per-agent subdomain base (e.g. "100.24.70.231.sslip.io" or "app.example.com").
  // When set, each agent is served at https://<slug>.<base> on its OWN root via
  // a host-matched Caddy route (no path-prefix strip). Required for dashboards
  // that use absolute asset paths (/assets/*) — path-prefix routing breaks those
  // because the browser fetches assets at the domain root. Empty = legacy
  // path-prefix routing on wildcardDomain (/<slug>).
  agentSubdomainBase: optional("DEPLOYER_AGENT_SUBDOMAIN_BASE", ""),

  // Local-dev escape hatch (DOCKER DESKTOP ONLY): skip chown/chmod of the
  // per-agent /opt/data bind dir. On Docker Desktop the Linux VM maps bind-mount
  // uids transparently, so the container writes regardless of host ownership and
  // the strict tiers in prepareDataDir would otherwise fail the deploy (a macOS
  // dev user is neither root nor in HERMES_GID). NEVER set this in production on
  // native Linux — it leaves the credential dir at the worker's default perms.
  skipDataDirChown: boolEnv("DEPLOYER_SKIP_DATADIR_CHOWN"),

  // Keep crashed container corpses for `docker inspect`/`docker logs` post-mortem
  // instead of sweeping them. Ports are still released so new deploys proceed.
  keepCrashedContainers: boolEnv("DEPLOYER_KEEP_CRASHED_CONTAINERS"),

  // Worker WebSocket port for live deploy steps + boot logs (spec §2). Clients
  // connect to ws://<host>:<port>/v1/agents/<agentId>/deploy?token=<owner token>.
  wsPort: numberEnv("DEPLOYER_WS_PORT", 7071),

  // HMAC secret for the short-lived deploy-WS owner tokens (spec §5). Empty
  // disables WS auth (verifyToken fails closed) — set it in prod via env.
  wsSecret: optional("DEPLOYER_WS_SECRET", ""),

  // Default LLM model injected as HERMES_MODEL. Works with any OpenRouter key
  // out of the box, unlike the image default (minimax) which 404s without a
  // data-policy toggle. A personality preset may override it.
  defaultModel: optional("DEPLOYER_DEFAULT_MODEL", "google/gemini-2.5-flash"),
};

// Guard against an inverted/empty port range at boot — an allocator over an
// empty range would spin forever instead of failing here.
if (config.portMin >= config.portMax) {
  throw new Error(
    `DEPLOYER_PORT_MIN (${config.portMin}) must be less than DEPLOYER_PORT_MAX (${config.portMax})`,
  );
}

// Paths derived from dataRoot. The age-encrypted per-agent secrets live under
// dataRoot/secrets (spec §5); each agent also gets a writable data dir bound
// into the container at HERMES_HOME=/opt/data — the gateway writes its .env
// (bot tokens), config.yaml, gateway_state.json, sessions/, and logs/ there.
// Without it the read-only rootfs blocks every runtime write (e.g. the Telegram
// onboarding apply step that persists TELEGRAM_BOT_TOKEN to /opt/data/.env).
export const paths = {
  secrets: `${config.dataRoot}/secrets`,
  agentData: (agentId: string): string => `${config.dataRoot}/agents/${agentId}/data`,
};

// The image runs the gateway as this uid:gid (Dockerfile HERMES_UID/GID, default
// 10000) and owns /opt/data as 10000:10000. The host-side bind dir must be
// writable by that uid, so the worker chowns it to these values before start.
export const HERMES_UID = numberEnv("HERMES_UID", 10000);
export const HERMES_GID = numberEnv("HERMES_GID", 10000);

export type Config = typeof config;
