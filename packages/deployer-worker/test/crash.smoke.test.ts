import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventEmitter } from "node:events";

const getEventsMock = vi.fn();
const inspectExitCodeMock = vi.fn();
const inspectTerminalStateMock = vi.fn();
const stopAndRemoveMock = vi.fn();
const tailLogsMock = vi.fn();
vi.mock("../src/docker", () => ({
  docker: { getEvents: (...a: unknown[]) => getEventsMock(...a) },
  inspectExitCode: (...a: unknown[]) => inspectExitCodeMock(...a),
  inspectTerminalState: (...a: unknown[]) => inspectTerminalStateMock(...a),
  stopAndRemove: (...a: unknown[]) => stopAndRemoveMock(...a),
  tailLogs: (...a: unknown[]) => tailLogsMock(...a),
}));

const findUniqueMock = vi.fn();
const updateMock = vi.fn();
vi.mock("../src/db", () => ({
  prisma: {
    agent: {
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      update: (...a: unknown[]) => updateMock(...a),
    },
  },
}));

vi.mock("../src/config", () => ({ config: { keepCrashedContainers: false } }));

const releasePortMock = vi.fn();
vi.mock("../src/ports", () => ({ releasePort: (...a: unknown[]) => releasePortMock(...a) }));

vi.mock("../src/logs", () => ({
  appendSystemLog: vi.fn().mockResolvedValue(undefined),
  stopTailer: vi.fn(),
}));

const { watchCrashes } = await import("../src/crash");

let stream: EventEmitter;
beforeEach(() => {
  stream = new EventEmitter();
  getEventsMock.mockReset().mockResolvedValue(stream);
  inspectExitCodeMock.mockReset().mockResolvedValue(1);
  inspectTerminalStateMock.mockReset().mockResolvedValue({
    exitCode: 1, oomKilled: false, error: "", startedAt: "s", finishedAt: "f", memoryLimitMb: 512,
  });
  stopAndRemoveMock.mockReset().mockResolvedValue(undefined);
  tailLogsMock.mockReset().mockResolvedValue("boom\n");
  findUniqueMock.mockReset().mockResolvedValue({ status: "running" });
  updateMock.mockReset().mockResolvedValue({});
  releasePortMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

test("a die event on a hermes.agent container marks the agent crashed and frees the port", async () => {
  // #given the watcher is attached
  await watchCrashes();

  // #when docker emits a `die` event carrying the hermes.agent label
  const ev = JSON.stringify({
    Action: "die",
    Actor: { ID: "container-xyz", Attributes: { "hermes.agent": "agent-1", exitCode: "1" } },
  });
  stream.emit("data", Buffer.from(ev + "\n"));
  // let the async handler settle
  await new Promise((r) => setTimeout(r, 10));

  // #then the agent is marked crashed and its port released
  const crashUpdate = updateMock.mock.calls.find(
    (c) => (c[0] as { data?: { status?: string } }).data?.status === "crashed"
  );
  expect(crashUpdate).toBeDefined();
  expect(releasePortMock).toHaveBeenCalledWith("agent-1");
  expect(stopAndRemoveMock).toHaveBeenCalledWith("container-xyz");
});
