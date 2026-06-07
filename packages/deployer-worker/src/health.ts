// Periodic liveness probe.
//
// The crash watcher catches containers that EXIT — it does not catch the
// case where the gateway process is alive but stuck (deadlock, stalled event
// loop, blocked on a hung upstream). This loop hits
// http://127.0.0.1:<apiPort>/health for every running agent and flips the row
// to `unhealthy` after config.healthProbeFailThreshold consecutive failures.
// A successful probe resets the counter and recovers an `unhealthy` row.
//
// The fail counter is in-process, not in the DB: the state is ephemeral, a
// reset on worker restart is fine (it re-fails and re-marks within a minute),
// and a DB write per probe would be pointless traffic.

import { prisma } from "./db";
import { config } from "./config";
import { appendSystemLog } from "./logs";

const failCounts = new Map<string, number>();

async function probeOne(apiPort: number): Promise<boolean> {
  const url = `http://127.0.0.1:${apiPort}/health`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(config.healthProbeTimeoutMs),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function markUnhealthy(agentId: string, apiPort: number): Promise<void> {
  // Only transition from `running` — leave crashed/stopped/failed/unhealthy alone.
  const updated = await prisma.agent.updateMany({
    where: { id: agentId, status: "running" },
    data: { status: "unhealthy" },
  });
  if (updated.count > 0) {
    await appendSystemLog(
      agentId,
      `[UNHEALTHY] /health probe failed ${config.healthProbeFailThreshold} times in a row on port ${apiPort}`,
    ).catch(() => undefined);
    console.warn(
      `[health] agent=${agentId} port=${apiPort} marked unhealthy ` +
        `after ${config.healthProbeFailThreshold} consecutive failures`,
    );
  }
}

export async function probeAll(): Promise<void> {
  // Probe both `running` and `unhealthy` so a recovered agent flips back.
  const targets = await prisma.agent.findMany({
    where: {
      status: { in: ["running", "unhealthy"] },
      apiPort: { not: null },
    },
    select: { id: true, apiPort: true, status: true },
  });
  if (targets.length === 0) return;

  const started = Date.now();
  let recovered = 0;
  let newlyUnhealthy = 0;

  await Promise.all(
    targets.map(async (t) => {
      if (t.apiPort === null) return;
      const ok = await probeOne(t.apiPort);

      if (ok) {
        failCounts.delete(t.id);
        if (t.status === "unhealthy") {
          const u = await prisma.agent.updateMany({
            where: { id: t.id, status: "unhealthy" },
            data: { status: "running" },
          });
          if (u.count > 0) {
            recovered++;
            await appendSystemLog(
              t.id,
              `[RECOVERED] /health is responsive again on port ${t.apiPort}`,
            ).catch(() => undefined);
          }
        }
        return;
      }

      const next = (failCounts.get(t.id) ?? 0) + 1;
      failCounts.set(t.id, next);
      if (next >= config.healthProbeFailThreshold && t.status === "running") {
        await markUnhealthy(t.id, t.apiPort);
        newlyUnhealthy++;
      }
    }),
  );

  console.log(
    `[health] probed ${targets.length} target(s) in ${Date.now() - started}ms ` +
      `(newlyUnhealthy=${newlyUnhealthy} recovered=${recovered})`,
  );
}

export function startHealthLoop(): void {
  const sec = Math.max(5, config.healthProbeIntervalSeconds);
  console.log(
    `[health] loop starting (interval=${sec}s threshold=${config.healthProbeFailThreshold})`,
  );
  setInterval(() => {
    probeAll().catch((e) => console.error("[health] sweep failed:", e));
  }, sec * 1000);
}
