// Log/metric retention. Verbatim port of deployer/worker/retention.ts
// (zynd-deployer); deltas only: table DeploymentLog -> AgentLog,
// DeploymentMetric -> AgentMetric.
//
// AgentLog grows one row per container stdout/stderr line, so we delete
// rows older than the configured window on a timer. System lines are kept
// longer (post-mortems). Deletes are batched so a sweep never holds a long
// transaction against an active table.

import { prisma } from "./db";
import { config } from "./config";

const BATCH_SIZE = 10_000;

async function pruneStream(
  stream: "stdout" | "stderr" | "system",
  olderThan: Date
): Promise<number> {
  let deleted = 0;
  // Prisma deleteMany has no LIMIT, so cap each batch with a subquery via
  // $executeRaw to avoid a long transaction on a hot table.
  while (true) {
    const n = await prisma.$executeRaw`
      DELETE FROM "AgentLog"
      WHERE id IN (
        SELECT id FROM "AgentLog"
        WHERE "stream" = ${stream} AND "ts" < ${olderThan}
        LIMIT ${BATCH_SIZE}
      )
    `;
    deleted += Number(n);
    if (Number(n) < BATCH_SIZE) break;
  }
  return deleted;
}

export async function pruneOldLogs(): Promise<void> {
  const lineDays = config.logRetentionDays;
  const sysDays = config.systemLogRetentionDays;
  if (lineDays <= 0 && sysDays <= 0) return;

  const now = Date.now();
  const started = now;

  let lineDeleted = 0;
  let sysDeleted = 0;

  // 86_400_000 = ms per day.
  if (lineDays > 0) {
    const cutoff = new Date(now - lineDays * 86_400_000);
    lineDeleted =
      (await pruneStream("stdout", cutoff)) + (await pruneStream("stderr", cutoff));
  }

  if (sysDays > 0) {
    const cutoff = new Date(now - sysDays * 86_400_000);
    sysDeleted = await pruneStream("system", cutoff);
  }

  let metricsDeleted = 0;
  if (config.metricRetentionDays > 0) {
    const cutoff = new Date(now - config.metricRetentionDays * 86_400_000);
    // Smaller table, covered by the sampledAt index — one unconditional
    // deleteMany, no per-batch cap.
    const res = await prisma.agentMetric.deleteMany({
      where: { sampledAt: { lt: cutoff } },
    });
    metricsDeleted = res.count;
  }

  console.log(
    `[retention] pruned ${lineDeleted} stdout/stderr + ${sysDeleted} system log rows ` +
      `+ ${metricsDeleted} metric rows in ${Date.now() - started}ms`
  );
}

export function startRetentionLoop(): void {
  const intervalMs = Math.max(1, config.retentionIntervalMinutes) * 60_000;
  console.log(
    `[retention] loop starting (lineDays=${config.logRetentionDays} ` +
      `systemDays=${config.systemLogRetentionDays} intervalMin=${config.retentionIntervalMinutes})`
  );
  // Run once on startup to catch up from downtime. Swallow errors so the
  // retention task never kills the worker.
  pruneOldLogs().catch((e) => console.error("[retention] initial prune failed:", e));
  setInterval(() => {
    pruneOldLogs().catch((e) => console.error("[retention] prune failed:", e));
  }, intervalMs);
}
