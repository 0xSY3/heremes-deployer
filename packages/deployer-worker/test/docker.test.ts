import { beforeEach, expect, test, vi } from "vitest";

const getContainer = vi.fn();
vi.mock("dockerode", () => ({
  default: vi.fn().mockImplementation(() => ({ getContainer })),
}));

vi.mock("../src/config", () => ({
  config: {
    dockerSocket: "/var/run/docker.sock",
    hermesImage: "hermes/gateway:latest",
    containerMemoryMb: 1536,
    containerCpuMillis: 1000,
    containerTmpfsMb: 512,
    bootHealthTimeoutMs: 1000,
    bootHealthIntervalMs: 10,
  },
}));

const { tailLogs, stopAndRemove, inspectExitCode, inspectTerminalState } = await import(
  "../src/docker"
);

beforeEach(() => {
  getContainer.mockReset();
});

// Build one dockerode multiplexed log frame: 8-byte header + payload.
// Header = [streamType, 0,0,0, payloadLen as uint32 BE].
function frame(streamType: number, payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(8);
  header[0] = streamType; // 1=stdout, 2=stderr
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

test("tailLogs strips 8-byte frame headers and concatenates payloads in order", async () => {
  const multiplexed = Buffer.concat([
    frame(1, "hello\n"),
    frame(2, "world\n"),
  ]);
  const logs = vi.fn().mockResolvedValue(multiplexed);
  getContainer.mockReturnValue({ logs });

  const out = await tailLogs("cid", 200);

  expect(out).toBe("hello\nworld\n");
  // The 22021 gotcha: not one NUL header byte survives into the stored text.
  expect(out.includes(" ")).toBe(false);
  expect(logs).toHaveBeenCalledWith({
    stdout: true,
    stderr: true,
    tail: 200,
    timestamps: false,
  });
});

test("tailLogs returns '' when the daemon throws", async () => {
  getContainer.mockReturnValue({
    logs: vi.fn().mockRejectedValue(new Error("no such container")),
  });
  expect(await tailLogs("cid")).toBe("");
});

test("stopAndRemove swallows already-stopped and already-gone errors", async () => {
  const stop = vi.fn().mockRejectedValue(new Error("already stopped"));
  const remove = vi.fn().mockRejectedValue(new Error("already gone"));
  getContainer.mockReturnValue({ stop, remove });
  await expect(stopAndRemove("cid")).resolves.toBeUndefined();
  expect(stop).toHaveBeenCalledWith({ t: 5 });
  expect(remove).toHaveBeenCalledWith({ force: true });
});

test("inspectExitCode returns the code, and null on inspect failure", async () => {
  getContainer.mockReturnValueOnce({
    inspect: vi.fn().mockResolvedValue({ State: { ExitCode: 137 } }),
  });
  expect(await inspectExitCode("cid")).toBe(137);

  getContainer.mockReturnValueOnce({
    inspect: vi.fn().mockRejectedValue(new Error("gone")),
  });
  expect(await inspectExitCode("cid")).toBeNull();
});

test("inspectTerminalState maps state + converts the memory limit to MB", async () => {
  getContainer.mockReturnValue({
    inspect: vi.fn().mockResolvedValue({
      State: {
        ExitCode: 0,
        OOMKilled: true,
        Error: "",
        StartedAt: "2026-06-08T00:00:00Z",
        FinishedAt: "2026-06-08T00:01:00Z",
      },
      HostConfig: { Memory: 1536 * 1024 * 1024 },
    }),
  });
  const s = await inspectTerminalState("cid");
  expect(s).toEqual({
    exitCode: 0,
    oomKilled: true,
    error: "",
    startedAt: "2026-06-08T00:00:00Z",
    finishedAt: "2026-06-08T00:01:00Z",
    memoryLimitMb: 1536,
  });
});
