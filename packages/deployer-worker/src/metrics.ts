// Per-container CPU / memory sampler. Verbatim port of
// deployer/worker/metrics.ts (zynd-deployer); deltas only: table
// Deployment -> Agent, DeploymentMetric -> AgentMetric, key
// deploymentId -> agentId.
//
// Single-shot `docker stats` per running agent (not a stream) to avoid
// keeping a hot socket per container; a sequential timer sweep is one
// request per container per interval.

import { docker } from "./docker";
import { prisma } from "./db";
import { config } from "./config";

// dockerode's stats payload is untyped in the public interface but the
// shape is stable across daemon versions — pick only what we use.
interface DockerStats {
  cpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
  memory_stats?: { usage?: number; limit?: number };
}

/**
 * CPU fraction of ONE logical CPU, per Docker's documented formula:
 *   delta_container / delta_system * online_cpus
 * Returned in [0, online_cpus]; the UI divides by online_cpus for a 0..1
 * host fraction.
 */
function computeCpuPct(s: DockerStats): number {
  const cpu = s.cpu_stats?.cpu_usage?.total_usage ?? 0;
  const preCpu = s.precpu_stats?.cpu_usage?.total_usage ?? 0;
  const sys = s.cpu_stats?.system_cpu_usage ?? 0;
  const preSys = s.precpu_stats?.system_cpu_usage ?? 0;
  const online = s.cpu_stats?.online_cpus ?? 1;

  const cpuDelta = cpu - preCpu;
  const sysDelta = sys - preSys;
  if (cpuDelta <= 0 || sysDelta <= 0) return 0;
  return (cpuDelta / sysDelta) * online;
}

async function sampleOne(agentId: string, containerId: string): Promise<void> {
  try {
    const raw = (await docker
      .getContainer(containerId)
      .stats({ stream: false })) as unknown as DockerStats;

    const memUsed = raw.memory_stats?.usage ?? 0;
    const memLimit = raw.memory_stats?.limit ?? 0;
    const cpuPct = computeCpuPct(raw);

    await prisma.agentMetric.create({
      data: {
        agentId,
        memUsedMb: Math.round(memUsed / 1024 / 1024),
        memLimitMb: Math.round(memLimit / 1024 / 1024),
        cpuPct,
      },
    });
  } catch (e) {
    // Container may have exited between findMany and stats. Log once per
    // miss; don't spam the error channel on every tick.
    console.warn(
      `[metrics] sample agent=${agentId} container=${containerId.slice(0, 12)} failed: ${(e as Error).message}`
    );
  }
}

export async function sampleMetrics(): Promise<void> {
  const running = await prisma.agent.findMany({
    where: { status: "running", containerId: { not: null } },
    select: { id: true, containerId: true },
  });
  if (running.length === 0) return;

  const started = Date.now();
  // Sequential to avoid hammering the daemon with N parallel stats requests.
  for (const r of running) {
    if (!r.containerId) continue;
    await sampleOne(r.id, r.containerId);
  }
  console.log(`[metrics] sampled ${running.length} container(s) in ${Date.now() - started}ms`);
}

export function startMetricsLoop(): void {
  const sec = Math.max(5, config.metricsIntervalSeconds);
  console.log(`[metrics] loop starting (interval=${sec}s)`);
  setInterval(() => {
    sampleMetrics().catch((e) => console.error("[metrics] sweep failed:", e));
  }, sec * 1000);
}
