import { afterEach, beforeEach, expect, test, vi } from "vitest";

const findManyMock = vi.fn();
const updateManyMock = vi.fn();
vi.mock("../src/db", () => ({
  prisma: {
    agent: {
      findMany: (...a: unknown[]) => findManyMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
    },
  },
}));
vi.mock("../src/config", () => ({
  config: { healthProbeTimeoutMs: 2000, healthProbeFailThreshold: 3, healthProbeIntervalSeconds: 60 },
}));
vi.mock("../src/logs", () => ({ appendSystemLog: vi.fn().mockResolvedValue(undefined) }));

const { probeAll } = await import("../src/health");

beforeEach(() => {
  findManyMock.mockReset();
  updateManyMock.mockReset().mockResolvedValue({ count: 0 });
});
afterEach(() => vi.restoreAllMocks());

test("probeAll is a no-op when there are no running/unhealthy targets", async () => {
  findManyMock.mockResolvedValue([]);
  await probeAll();
  expect(updateManyMock).not.toHaveBeenCalled();
});

test("probeAll marks an agent unhealthy after the failure threshold of failed probes", async () => {
  findManyMock.mockResolvedValue([{ id: "agent-1", apiPort: 13000, status: "running" }]);
  // /health always rejects -> probeOne returns false
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
  // threshold is 3: three sweeps needed to cross it
  await probeAll();
  await probeAll();
  expect(updateManyMock).not.toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: "unhealthy" } }),
  );
  await probeAll();
  expect(updateManyMock).toHaveBeenCalledWith({
    where: { id: "agent-1", status: "running" },
    data: { status: "unhealthy" },
  });
});
