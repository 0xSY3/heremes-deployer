import { afterEach, expect, test, vi } from "vitest";

// Mocked in callback form so node:util promisify (used by docker.ts) can wrap it.
const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { stopContainer, removeContainer } = await import("../src/local/docker");

afterEach(() => {
  execFileMock.mockReset();
});

function mockSuccess(): void {
  execFileMock.mockImplementation((_cmd, _args, cb: (e: unknown, r: unknown) => void) => {
    cb(null, { stdout: "ok\n", stderr: "" });
  });
}

// Error carries .stderr, mirroring how child_process surfaces a non-zero docker exit.
function mockFailure(stderr: string): void {
  execFileMock.mockImplementation((_cmd, _args, cb: (e: unknown, r: unknown) => void) => {
    const err = new Error("Command failed") as Error & { stderr: string };
    err.stderr = stderr;
    cb(err, null);
  });
}

test("stopContainer swallows 'No such container' so teardown is idempotent", async () => {
  mockFailure("Error response from daemon: No such container: hermes-alice");
  await expect(stopContainer("hermes-alice")).resolves.toBeUndefined();
});

test("removeContainer swallows 'No such container'", async () => {
  mockFailure("Error response from daemon: No such container: hermes-alice");
  await expect(removeContainer("hermes-alice")).resolves.toBeUndefined();
});

test("stopContainer rethrows when the daemon is unreachable (no silent orphan)", async () => {
  // Daemon down: container may still be running, so the store record must NOT be deleted.
  mockFailure("Cannot connect to the Docker daemon at unix:///var/run/docker.sock");
  await expect(stopContainer("hermes-alice")).rejects.toThrow(/docker stop failed/);
});

test("removeContainer rethrows on a genuine (non-missing) failure", async () => {
  mockFailure("Cannot connect to the Docker daemon at unix:///var/run/docker.sock");
  await expect(removeContainer("hermes-alice")).rejects.toThrow(/docker rm failed/);
});

test("stopContainer resolves on a clean stop", async () => {
  mockSuccess();
  await expect(stopContainer("hermes-alice")).resolves.toBeUndefined();
});
