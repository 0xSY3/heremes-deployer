import { afterEach, beforeEach, expect, test, vi } from "vitest";

// --- Prisma ---
const findFirstMock = vi.fn();
const findManyMock = vi.fn();
const updateManyMock = vi.fn();
const updateMock = vi.fn();
vi.mock("../src/db", () => ({
  prisma: {
    agent: {
      findFirst: (...a: unknown[]) => findFirstMock(...a),
      findMany: (...a: unknown[]) => findManyMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
  },
}));

const driveMock = vi.fn();
vi.mock("../src/lifecycle", () => ({ drive: (...a: unknown[]) => driveMock(...a) }));

const stopAndRemoveMock = vi.fn();
vi.mock("../src/docker", () => ({ stopAndRemove: (...a: unknown[]) => stopAndRemoveMock(...a) }));

const removeRouteMock = vi.fn();
vi.mock("../src/caddy", () => ({
  ensureServer: vi.fn().mockResolvedValue(undefined),
  removeRoute: (...a: unknown[]) => removeRouteMock(...a),
}));

const releasePortMock = vi.fn();
vi.mock("../src/ports", () => ({ releasePort: (...a: unknown[]) => releasePortMock(...a) }));

const startTailerMock = vi.fn();
const stopTailerMock = vi.fn();
const appendSystemLogMock = vi.fn();
vi.mock("../src/logs", () => ({
  startTailer: (...a: unknown[]) => startTailerMock(...a),
  stopTailer: (...a: unknown[]) => stopTailerMock(...a),
  appendSystemLog: (...a: unknown[]) => appendSystemLogMock(...a),
}));

vi.mock("../src/crash", () => ({ watchCrashes: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/health", () => ({ startHealthLoop: vi.fn() }));
vi.mock("../src/metrics", () => ({ startMetricsLoop: vi.fn() }));
vi.mock("../src/retention", () => ({ startRetentionLoop: vi.fn() }));
vi.mock("../src/ws", () => ({ startWsServer: vi.fn() }));

const { drainQueue, drainStops, resumeTailers } = await import("../bin/main");

beforeEach(() => {
  findFirstMock.mockReset();
  findManyMock.mockReset();
  updateManyMock.mockReset();
  updateMock.mockReset().mockResolvedValue({});
  driveMock.mockReset().mockResolvedValue(undefined);
  stopAndRemoveMock.mockReset().mockResolvedValue(undefined);
  removeRouteMock.mockReset().mockResolvedValue(undefined);
  releasePortMock.mockReset().mockResolvedValue(undefined);
  startTailerMock.mockReset().mockResolvedValue(undefined);
  stopTailerMock.mockReset();
  appendSystemLogMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

test("drainQueue claims a queued agent via updateMany status=allocating_ports, then drives it", async () => {
  // #given one queued agent that we win the claim race for
  findFirstMock.mockResolvedValue({ id: "agent-1" });
  updateManyMock.mockResolvedValue({ count: 1 });

  // #when the queue is drained
  await drainQueue();

  // #then the claim lock is the allocating_ports updateMany guarded on status=queued
  expect(updateManyMock).toHaveBeenCalledWith({
    where: { id: "agent-1", status: "queued" },
    data: { status: "allocating_ports" },
  });
  expect(driveMock).toHaveBeenCalledWith("agent-1");
});

test("drainQueue does not drive when it loses the claim race (count=0)", async () => {
  // #given another worker claimed the row first
  findFirstMock.mockResolvedValue({ id: "agent-1" });
  updateManyMock.mockResolvedValue({ count: 0 });

  // #when drained
  await drainQueue();

  // #then drive is never called
  expect(driveMock).not.toHaveBeenCalled();
});

test("drainQueue is a no-op when the queue is empty", async () => {
  // #given no queued agents
  findFirstMock.mockResolvedValue(null);

  // #when drained
  await drainQueue();

  // #then nothing is claimed or driven
  expect(updateManyMock).not.toHaveBeenCalled();
  expect(driveMock).not.toHaveBeenCalled();
});

test("drainStops tears down a stopped agent and clears its container/port columns", async () => {
  // #given one stopped agent with a live container
  findManyMock.mockResolvedValue([{ id: "agent-1", containerId: "c1" }]);

  // #when stops are drained
  await drainStops();

  // #then the container is removed, route removed, ports released, and the
  //   container/port columns cleared so the row stops being selected
  expect(stopTailerMock).toHaveBeenCalledWith("agent-1");
  expect(stopAndRemoveMock).toHaveBeenCalledWith("c1");
  expect(removeRouteMock).toHaveBeenCalledWith("agent-1");
  expect(releasePortMock).toHaveBeenCalledWith("agent-1");
  expect(updateMock).toHaveBeenCalledWith({
    where: { id: "agent-1" },
    data: { containerId: null, apiPort: null, dashboardPort: null },
  });
});

test("resumeTailers re-attaches a tailer for every running agent with a container", async () => {
  // #given two running agents
  findManyMock.mockResolvedValue([
    { id: "agent-1", containerId: "c1" },
    { id: "agent-2", containerId: "c2" },
  ]);

  // #when tailers are resumed
  await resumeTailers();

  // #then a tailer is started for each
  expect(startTailerMock).toHaveBeenCalledWith("agent-1", "c1");
  expect(startTailerMock).toHaveBeenCalledWith("agent-2", "c2");
});
