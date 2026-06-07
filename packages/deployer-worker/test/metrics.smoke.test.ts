import { afterEach, beforeEach, expect, test, vi } from "vitest";

const statsMock = vi.fn();
const getContainerMock = vi.fn(() => ({ stats: statsMock }));
vi.mock("../src/docker", () => ({ docker: { getContainer: getContainerMock } }));

const findManyMock = vi.fn();
const createMock = vi.fn();
vi.mock("../src/db", () => ({
  prisma: {
    agent: { findMany: (...a: unknown[]) => findManyMock(...a) },
    agentMetric: { create: (...a: unknown[]) => createMock(...a) },
  },
}));

vi.mock("../src/config", () => ({ config: { metricsIntervalSeconds: 30 } }));

const { sampleMetrics } = await import("../src/metrics");

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([{ id: "agent-1", containerId: "c1" }]);
  createMock.mockReset().mockResolvedValue({});
  statsMock.mockReset().mockResolvedValue({
    cpu_stats: { cpu_usage: { total_usage: 200 }, system_cpu_usage: 2000, online_cpus: 2 },
    precpu_stats: { cpu_usage: { total_usage: 100 }, system_cpu_usage: 1000 },
    memory_stats: { usage: 100 * 1024 * 1024, limit: 512 * 1024 * 1024 },
  });
  getContainerMock.mockClear();
});

afterEach(() => vi.restoreAllMocks());

test("sampleMetrics writes a memUsedMb/memLimitMb/cpuPct row per running agent", async () => {
  // #when one running agent is sampled
  await sampleMetrics();

  // #then an AgentMetric row is created with rounded MB values
  expect(createMock).toHaveBeenCalledWith({
    data: { agentId: "agent-1", memUsedMb: 100, memLimitMb: 512, cpuPct: expect.any(Number) },
  });
});
