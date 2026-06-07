import { afterEach, beforeEach, expect, test, vi } from "vitest";

const executeRawMock = vi.fn();
const deleteManyMock = vi.fn();
vi.mock("../src/db", () => ({
  prisma: {
    $executeRaw: (...a: unknown[]) => executeRawMock(...a),
    agentMetric: { deleteMany: (...a: unknown[]) => deleteManyMock(...a) },
  },
}));

vi.mock("../src/config", () => ({
  config: {
    logRetentionDays: 7,
    systemLogRetentionDays: 30,
    metricRetentionDays: 3,
    retentionIntervalMinutes: 60,
  },
}));

const { pruneOldLogs } = await import("../src/retention");

beforeEach(() => {
  // Each prune loop deletes < BATCH_SIZE so it terminates after one pass.
  executeRawMock.mockReset().mockResolvedValue(0);
  deleteManyMock.mockReset().mockResolvedValue({ count: 0 });
});

afterEach(() => vi.restoreAllMocks());

test("pruneOldLogs runs stdout, stderr, system prunes and the metric deleteMany", async () => {
  // #when retention runs
  await pruneOldLogs();

  // #then three log prune queries (stdout/stderr/system) and one metric sweep fire
  expect(executeRawMock).toHaveBeenCalledTimes(3);
  expect(deleteManyMock).toHaveBeenCalledTimes(1);
});
