// Deploy state machine: drives a single Hermes agent from `queued` to
// `running`, one step at a time. Adapted from deployer/worker/lifecycle.ts
// (zynd-deployer). Hermes deltas (spec §2/§4):
//   - no unpack / writing_config / building steps (config is 100% env);
//   - allocating_port -> allocating_ports (API port + dashboard port);
//   - secret read + env build replace the upload/keypair flow;
//   - DB status is written FIRST, then emitStep — so a reconnecting socket
//     can backfill the current step from the row (DB = source of truth).

import { mkdir, chown, chmod, stat } from "node:fs/promises";

import { prisma } from "./db";
import { config, paths, HERMES_UID, HERMES_GID } from "./config";
import { allocatePort, releasePort } from "./ports";
import { runContainer, stopAndRemove, waitForHealth } from "./docker";
import { addRoute, removeRoute } from "./caddy";
import { readSecret } from "./db-secrets";
import { buildAgentEnv } from "./secrets";
import { startTailer, stopTailer, appendSystemLog } from "./logs";
import { emitStep, emitReady, emitDone, type StepName } from "./events";

export type AgentStatus =
  | "queued"
  | "allocating_ports"
  | "starting"
  | "health_checking"
  | "registering_route"
  | "running"
  | "unhealthy"
  | "failed"
  | "stopped"
  | "crashed";

interface AgentRow {
  id: string;
  userId: string;
  slug: string;
  status: string;
  llmProvider: string;
  secretRef: string;
  personalityId: string | null;
  apiPort?: number | null;
  dashboardPort?: number | null;
  containerId?: string | null;
}

const ACTIVE_STATUSES: ReadonlyArray<string> = [
  "queued",
  "allocating_ports",
  "starting",
  "health_checking",
  "registering_route",
  "running",
  "unhealthy",
];

function buildHostUrl(slug: string, dashboardPort: number): string {
  // No-Caddy modes: no reverse proxy on /<slug>, so the only reachable address
  // is the container's published dashboard port.
  if (config.skipCaddy) {
    // Public-host mode: a domainless deploy on a box with a public IP. Hand out
    // http://<publicHost>:<port> so the link works off-box (the worker's
    // security group must allow the agent port range). Falls back to localhost
    // for true local dev when DEPLOYER_PUBLIC_HOST is unset.
    if (config.publicHost) return `http://${config.publicHost}:${dashboardPort}`;
    return `http://localhost:${dashboardPort}`;
  }
  // Subdomain mode: each agent at its own root (https://<slug>.<base>), so the
  // dashboard's absolute /assets/* paths resolve. See config.agentSubdomainBase.
  if (config.agentSubdomainBase) {
    return `https://${slug}.${config.agentSubdomainBase}`;
  }
  // Legacy path-prefix mode (breaks dashboards with absolute asset paths).
  return `https://${config.wildcardDomain}/${slug}`;
}

/**
 * Lock down the per-agent HERMES_HOME bind dir so only the worker and the
 * container's uid can read its credentials (bot token in /opt/data/.env,
 * session files). World access is never granted. See the call site for the
 * threat model and the three ownership tiers.
 *
 * @throws if the worker can neither own the dir as HERMES_UID:GID nor place it
 *   in HERMES_GID — the deploy must fail rather than ship an over-permissive
 *   credential store.
 */
async function prepareDataDir(dataDir: string, agentId: string): Promise<void> {
  // Docker Desktop dev escape: the VM maps bind uids, so ownership is moot and
  // the strict tiers below would needlessly fail a non-root macOS worker. Never
  // set on native-Linux prod (see config.skipDataDirChown).
  if (config.skipDataDirChown) {
    await appendSystemLog(
      agentId,
      `[worker] DEPLOYER_SKIP_DATADIR_CHOWN set: leaving ${dataDir} ownership as-is ` +
        `(Docker Desktop dev only — do not use on native Linux)`,
    ).catch(() => undefined);
    return;
  }

  // Already secured: the image entrypoint chowns HERMES_HOME to HERMES_UID on
  // first boot, after which a non-root worker can no longer chown/chgrp the
  // dir (POSIX chgrp requires ownership) and the tiers below would fail every
  // redeploy/restart. Container-uid-owned with no world access — and group
  // access only via HERMES_GID — is at least as tight as either tier's target.
  const st = await stat(dataDir);
  const mode = st.mode & 0o777;
  const groupOk = (mode & 0o070) === 0 || st.gid === HERMES_GID;
  if (st.uid === HERMES_UID && groupOk && (mode & 0o007) === 0) return;

  // Tier 1: root worker — own the dir as the container uid, owner-only perms.
  try {
    await chown(dataDir, HERMES_UID, HERMES_GID);
    await chmod(dataDir, 0o700);
    return;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "ENOSYS") throw e;
  }

  // Tier 2: non-root worker that is a member of HERMES_GID — a non-root user may
  // chgrp to a group it belongs to. Group-owned + 0770 lets the container uid
  // (sharing HERMES_GID) write while leaving the dir unreadable to others.
  // chown(-1, gid) changes group only, preserving the current owner.
  try {
    await chown(dataDir, -1, HERMES_GID);
    await chmod(dataDir, 0o770);
    await appendSystemLog(
      agentId,
      `[worker] not root: set ${dataDir} group=${HERMES_GID} mode=0770 ` +
        `(worker + container uid only; no world access)`,
    ).catch(() => undefined);
    return;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "ENOSYS") throw e;
  }

  // Tier 3: cannot secure the dir. Fail loudly — never widen permissions.
  throw new Error(
    `cannot prepare a secure data dir for the agent container: the worker is ` +
      `not root and is not a member of HERMES_GID (${HERMES_GID}). Run the ` +
      `worker as root, or add its user to gid ${HERMES_GID}, or pre-create ` +
      `${dataDir} owned by ${HERMES_UID}:${HERMES_GID} with mode 0770.`,
  );
}

/**
 * DB is the source of truth (spec §2): write Agent.status FIRST, then emit
 * the matching step frame. `state` lets the UI render a live checklist —
 * `started` when a step begins, `ok` when it completes.
 */
async function setStatus(
  id: string,
  status: AgentStatus,
  patch: Record<string, unknown> = {}
): Promise<void> {
  await prisma.agent.update({ where: { id }, data: { status, ...patch } });
  emitStep(id, status as StepName, "started");
}

/**
 * Scrub anything that could surface a secret in a client-facing error.
 * dockerode passes env as an array (no argv leak), but a daemon stderr or
 * a careless throw can still echo a value back — defense in depth (spec §5).
 */
function scrubError(msg: string, secretValues: string[]): string {
  let out = msg;
  for (const v of secretValues) {
    if (v) out = out.split(v).join("***");
  }
  return out.slice(0, 500);
}

async function failDeployment(
  id: string,
  step: StepName,
  msg: string,
  cleanup: () => Promise<void>
): Promise<void> {
  console.error(`[lifecycle] ${id} FAILED at ${step}: ${msg}`);
  emitStep(id, step, "failed");
  await appendSystemLog(id, `[FAILED] ${msg}`).catch(() => undefined);
  await prisma.agent.update({
    where: { id },
    data: {
      status: "failed",
      errorMessage: msg,
      apiPort: null,
      dashboardPort: null,
      containerId: null,
    },
  });
  await cleanup().catch(() => undefined);
  emitDone(id, "failed");
}

export async function drive(agentId: string): Promise<void> {
  const agent = (await prisma.agent.findUnique({
    where: { id: agentId },
  })) as AgentRow | null;
  if (!agent) return;
  if (!ACTIVE_STATUSES.includes(agent.status)) return;

  // Restart safety: a re-queued agent (control: restart, or a re-driven row)
  // may still carry a container + ports from its previous run. Tear those down
  // BEFORE allocating new ones — otherwise the old container (RestartPolicy:
  // unless-stopped) keeps running and its PortAllocation rows leak. Idempotent:
  // a fresh `queued` agent has no containerId/ports, so this is a no-op.
  if (agent.containerId || agent.apiPort != null || agent.dashboardPort != null) {
    if (agent.containerId) await stopAndRemove(agent.containerId).catch(() => undefined);
    await removeRoute(agentId).catch(() => undefined);
    await releasePort(agentId).catch(() => undefined);
    await prisma.agent.update({
      where: { id: agentId },
      data: { containerId: null, apiPort: null, dashboardPort: null },
    });
  }

  let apiPort: number | null = null;
  let dashboardPort: number | null = null;
  let containerId: string | null = null;
  let routeAdded = false;
  const secretValues: string[] = [];

  // Reverse-order teardown (spec §5): container -> route -> ports.
  const cleanup = async () => {
    if (containerId) await stopAndRemove(containerId).catch(() => undefined);
    if (routeAdded) await removeRoute(agentId).catch(() => undefined);
    // Both ports were allocated under the same agentId; releasePort clears
    // every PortAllocation row for the agent in one call.
    if (apiPort !== null || dashboardPort !== null) {
      await releasePort(agentId).catch(() => undefined);
    }
  };

  let step: StepName = "allocating_ports";
  try {
    // --- 1. allocate two ports (API + dashboard) ---------------------
    step = "allocating_ports";
    await setStatus(agentId, "allocating_ports");
    apiPort = await allocatePort(agentId);
    dashboardPort = await allocatePort(agentId);
    await appendSystemLog(
      agentId,
      `[worker] allocated apiPort=${apiPort} dashboardPort=${dashboardPort}`
    );
    emitStep(agentId, "allocating_ports", "ok");

    // --- 2. start the container --------------------------------------
    step = "starting";
    await setStatus(agentId, "starting");
    const secret = await readSecret(agentId);
    secretValues.push(...Object.values(secret).filter((v): v is string => typeof v === "string"));
    const env = buildAgentEnv({
      secret,
      llmProvider: agent.llmProvider as "openrouter" | "anthropic",
      ...(agent.personalityId ? { personalityId: agent.personalityId } : {}),
    });

    // Writable HERMES_HOME bind. The image runs as HERMES_UID:HERMES_GID and
    // owns /opt/data as that uid, so the gateway (non-root) can only write its
    // .env/config/sessions — and complete the Telegram onboarding apply step —
    // if the host bind dir is writable by that uid. mkdir is idempotent so the
    // persisted bot token + sessions survive a redeploy.
    //
    // SECURITY: this dir stores the agent's Telegram bot token (/opt/data/.env)
    // and session files. It must NEVER be world-readable. Three tiers, each
    // strictly limiting access to the worker + the container uid:
    //   1. root worker (prod systemd): chown uid:gid, perms 0700 — only the
    //      container uid (== owner) can touch it.
    //   2. non-root worker that belongs to HERMES_GID: set the dir's group to
    //      HERMES_GID (a non-root user may chgrp to a group it is a member of)
    //      and perms 0770 — worker user + container uid (via shared gid) only.
    //   3. neither possible: fail the deploy with an operator-actionable error
    //      rather than weaken permissions. No 0777 fallback ever.
    const dataDir = paths.agentData(agentId);
    await mkdir(dataDir, { recursive: true });
    await prepareDataDir(dataDir, agentId);

    containerId = await runContainer({
      agentId,
      apiPort,
      dashboardPort,
      image: config.hermesImage,
      env,
      dataDir,
    });
    await prisma.agent.update({
      where: { id: agentId },
      data: { apiPort, dashboardPort, containerId, startedAt: new Date() },
    });
    await appendSystemLog(agentId, `[worker] started container ${containerId.slice(0, 12)}`);
    // Tail now so the user sees boot output while we wait on /health.
    await startTailer(agentId, containerId).catch(() => undefined);
    emitStep(agentId, "starting", "ok");

    // --- 3. health check (API port only) -----------------------------
    step = "health_checking";
    await setStatus(agentId, "health_checking");
    await waitForHealth(apiPort);
    emitStep(agentId, "health_checking", "ok");

    // --- 4. register the Caddy route to the dashboard port -----------
    step = "registering_route";
    await setStatus(agentId, "registering_route");
    await addRoute(agentId, agent.slug, dashboardPort);
    routeAdded = true;
    emitStep(agentId, "registering_route", "ok");

    // --- 5. running --------------------------------------------------
    const hostUrl = buildHostUrl(agent.slug, dashboardPort);
    await prisma.agent.update({
      where: { id: agentId },
      data: { status: "running", hostUrl },
    });
    emitStep(agentId, "running", "ok");
    emitReady(agentId, hostUrl);
    await appendSystemLog(agentId, `[worker] live at ${hostUrl}`);

    // Pre-warm the TLS cert: with on-demand TLS (subdomain mode), the FIRST
    // HTTPS hit to a brand-new <slug> host triggers a Let's Encrypt mint
    // (~5-10s), which the user would otherwise wait through on "Open dashboard".
    // Hitting it ourselves now mints the cert before they click. Fire-and-forget
    // — never block or fail the deploy on this.
    if (hostUrl.startsWith("https://")) {
      void fetch(hostUrl, { method: "HEAD", signal: AbortSignal.timeout(20_000) }).catch(
        () => undefined,
      );
    }
  } catch (e) {
    const msg = scrubError((e as Error).message, secretValues);
    await failDeployment(agentId, step, msg, cleanup);
  }
}

export async function controlAgent(
  agentId: string,
  action: "start" | "stop" | "restart"
): Promise<void> {
  const agent = (await prisma.agent.findUnique({
    where: { id: agentId },
  })) as AgentRow | null;
  if (!agent) return;

  if (action === "stop") {
    if (agent.containerId) await stopAndRemove(agent.containerId).catch(() => undefined);
    if (agent.dashboardPort !== null && agent.dashboardPort !== undefined) {
      await removeRoute(agentId).catch(() => undefined);
    }
    await releasePort(agentId).catch(() => undefined);
    stopTailer(agentId);
    await prisma.agent.update({
      where: { id: agentId },
      data: {
        status: "stopped",
        containerId: null,
        apiPort: null,
        dashboardPort: null,
        stoppedAt: new Date(),
      },
    });
    emitStep(agentId, "stopped", "ok");
    emitDone(agentId, "stopped");
    return;
  }

  // start AND restart both re-run the deploy from the top using the
  // persisted secretRef (spec: restart works without re-entering the key).
  // For restart we first tear down whatever is currently up.
  if (action === "restart" && agent.containerId) {
    await stopAndRemove(agent.containerId).catch(() => undefined);
    await removeRoute(agentId).catch(() => undefined);
    await releasePort(agentId).catch(() => undefined);
    stopTailer(agentId);
  }
  await prisma.agent.update({
    where: { id: agentId },
    data: { status: "queued", containerId: null, apiPort: null, dashboardPort: null },
  });
  await drive(agentId);
}
