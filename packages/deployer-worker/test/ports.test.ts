// packages/deployer-worker/test/ports.test.ts
import { beforeEach, expect, test, vi } from "vitest";

const findMany = vi.fn();
const create = vi.fn();
const deleteMany = vi.fn();

vi.mock("../src/db", () => ({
  prisma: {
    portAllocation: {
      findMany: (...a: unknown[]) => findMany(...a),
      create: (...a: unknown[]) => create(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

// Narrow the allocation range so exhaustion is reachable in a test.
vi.mock("../src/config", () => ({
  config: { portMin: 13000, portMax: 13002 },
}));

const { allocatePort, releasePort } = await import("../src/ports");

beforeEach(() => {
  findMany.mockReset();
  create.mockReset();
  deleteMany.mockReset();
});

test("allocatePort returns the lowest free port", async () => {
  findMany.mockResolvedValue([]);
  create.mockResolvedValue({});
  const port = await allocatePort("agent-1");
  expect(port).toBe(13000);
  expect(create).toHaveBeenCalledWith({ data: { port: 13000, agentId: "agent-1" } });
});

test("allocatePort skips ports already taken in the table", async () => {
  findMany.mockResolvedValue([{ port: 13000 }, { port: 13001 }]);
  create.mockResolvedValue({});
  const port = await allocatePort("agent-1");
  expect(port).toBe(13002);
  expect(create).toHaveBeenCalledWith({ data: { port: 13002, agentId: "agent-1" } });
});

test("allocatePort retries the next port when create loses the unique-insert race", async () => {
  findMany.mockResolvedValue([]);
  // 13000 was grabbed by another worker between our read and insert -> create throws.
  create.mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`port`)"));
  create.mockResolvedValueOnce({});
  const port = await allocatePort("agent-1");
  expect(port).toBe(13001);
  expect(create).toHaveBeenCalledTimes(2);
});

test("allocatePort throws when the whole range is exhausted", async () => {
  findMany.mockResolvedValue([{ port: 13000 }, { port: 13001 }, { port: 13002 }]);
  await expect(allocatePort("agent-1")).rejects.toThrow(/No free ports in range 13000-13002/);
  expect(create).not.toHaveBeenCalled();
});

test("allocatePort can be called twice for one agent (api + dashboard) — two distinct rows", async () => {
  // First call: nothing taken -> 13000. Second call: 13000 now taken -> 13001.
  findMany.mockResolvedValueOnce([]);
  findMany.mockResolvedValueOnce([{ port: 13000 }]);
  create.mockResolvedValue({});
  const apiPort = await allocatePort("agent-1");
  const dashboardPort = await allocatePort("agent-1");
  expect(apiPort).toBe(13000);
  expect(dashboardPort).toBe(13001);
});

test("releasePort deletes every row for the agent (both ports) and swallows errors", async () => {
  deleteMany.mockResolvedValue({ count: 2 });
  await releasePort("agent-1");
  expect(deleteMany).toHaveBeenCalledWith({ where: { agentId: "agent-1" } });

  deleteMany.mockRejectedValue(new Error("db down"));
  await expect(releasePort("agent-1")).resolves.toBeUndefined();
});
