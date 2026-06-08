// Deploy state machine: drives a single Hermes agent from `queued` to
// `running`, one step at a time. Adapted from deployer/worker/lifecycle.ts
// (zynd-deployer). Hermes deltas (spec §2/§4):
//   - no unpack / writing_config / building steps (config is 100% env);
//   - allocating_port -> allocating_ports (API port + dashboard port);
//   - secret read + env build replace the upload/keypair flow;
//   - DB status is written FIRST, then emitStep — so a reconnecting socket
//     can backfill the current step from the row (DB = source of truth).

import { mkdir, chown, chmod } from "node:fs/promises";

import { prisma } from "./db";
import { config, paths, HERMES_UID, HERMES_GID } from "./config";
import { allocatePort, releasePort } from "./ports";
import { runContainer, stopAndRemove, waitForHealth } from "./docker";
import { addRoute, removeRoute } from "./caddy";
import { readSecret, buildAgentEnv } from "./secrets";
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
  // Local-dev escape hatch: no Caddy means no reverse proxy on /<slug>, so the
  // only reachable address is the container's published dashboard port. Hand
  // that out so the "Open dashboard" link actually works locally.
  if (config.skipCaddy) return `http://localhost:${dashboardPort}`;
  return `https://${config.wildcardDomain}/${slug}`;
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
    // chown to HERMES_UID:GID is the right answer and works when the worker runs
    // as root (the production systemd unit). A non-root worker (local dev) can't
    // chown and hits EPERM; fall back to world-writable so the container uid can
    // still write. Both paths leave a dir the gateway can write — never fail the
    // deploy over dir ownership.
    const dataDir = paths.agentData(agentId);
    await mkdir(dataDir, { recursive: true });
    try {
      await chown(dataDir, HERMES_UID, HERMES_GID);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "ENOSYS") throw e;
      await chmod(dataDir, 0o777);
      await appendSystemLog(
        agentId,
        `[worker] chown ${dataDir} -> ${HERMES_UID}:${HERMES_GID} failed (${code}); ` +
          `worker is not root, fell back to world-writable mode 0777`,
      ).catch(() => undefined);
    }

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
