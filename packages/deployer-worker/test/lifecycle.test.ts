import { afterEach, beforeEach, expect, test, vi } from "vitest";

// --- Prisma ---
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

// --- config ---
vi.mock("../src/config", () => ({
  config: { wildcardDomain: "agents.hermes.dev", skipCaddy: false },
}));

// --- ports ---
const allocatePortMock = vi.fn();
const releasePortMock = vi.fn();
vi.mock("../src/ports", () => ({
  allocatePort: (...a: unknown[]) => allocatePortMock(...a),
  releasePort: (...a: unknown[]) => releasePortMock(...a),
}));

// --- docker (waitForHealth lives here, not in a ./health module) ---
const runContainerMock = vi.fn();
const stopAndRemoveMock = vi.fn();
const waitForHealthMock = vi.fn();
vi.mock("../src/docker", () => ({
  runContainer: (...a: unknown[]) => runContainerMock(...a),
  stopAndRemove: (...a: unknown[]) => stopAndRemoveMock(...a),
  waitForHealth: (...a: unknown[]) => waitForHealthMock(...a),
}));

// --- caddy ---
const addRouteMock = vi.fn();
const removeRouteMock = vi.fn();
vi.mock("../src/caddy", () => ({
  addRoute: (...a: unknown[]) => addRouteMock(...a),
  removeRoute: (...a: unknown[]) => removeRouteMock(...a),
}));

// --- secrets ---
const readSecretMock = vi.fn();
const buildAgentEnvMock = vi.fn();
vi.mock("../src/secrets", () => ({
  readSecret: (...a: unknown[]) => readSecretMock(...a),
  buildAgentEnv: (...a: unknown[]) => buildAgentEnvMock(...a),
}));

// --- logs ---
const startTailerMock = vi.fn();
const appendSystemLogMock = vi.fn();
vi.mock("../src/logs", () => ({
  startTailer: (...a: unknown[]) => startTailerMock(...a),
  appendSystemLog: (...a: unknown[]) => appendSystemLogMock(...a),
  stopTailer: vi.fn(),
}));

// --- events: capture the emitted step frames in order ---
const stepCalls: Array<{ step: string; state: string }> = [];
const emitReadyMock = vi.fn();
const emitDoneMock = vi.fn();
vi.mock("../src/events", () => ({
  emitStep: (_agentId: string, step: string, state: string) =>
    stepCalls.push({ step, state }),
  emitReady: (...a: unknown[]) => emitReadyMock(...a),
  emitDone: (...a: unknown[]) => emitDoneMock(...a),
}));

const { drive } = await import("../src/lifecycle");

const AGENT = {
  id: "agent-1",
  userId: "user-1",
  slug: "my-bot",
  status: "queued",
  llmProvider: "openrouter",
  secretRef: "/data/secrets/agent-1.age",
  personalityId: null,
};

beforeEach(() => {
  stepCalls.length = 0;
  findUniqueMock.mockReset().mockResolvedValue({ ...AGENT });
  updateMock.mockReset().mockResolvedValue({});
  allocatePortMock.mockReset();
  allocatePortMock.mockResolvedValueOnce(8001).mockResolvedValueOnce(9001);
  releasePortMock.mockReset().mockResolvedValue(undefined);
  runContainerMock.mockReset().mockResolvedValue("container-abc");
  stopAndRemoveMock.mockReset().mockResolvedValue(undefined);
  addRouteMock.mockReset().mockResolvedValue(undefined);
  removeRouteMock.mockReset().mockResolvedValue(undefined);
  readSecretMock.mockReset().mockResolvedValue({ API_SERVER_KEY: "k", OPENROUTER_API_KEY: "v" });
  buildAgentEnvMock.mockReset().mockReturnValue({ API_SERVER_KEY: "k" });
  waitForHealthMock.mockReset().mockResolvedValue(undefined);
  startTailerMock.mockReset().mockResolvedValue(undefined);
  appendSystemLogMock.mockReset().mockResolvedValue(undefined);
  emitReadyMock.mockReset();
  emitDoneMock.mockReset();
});

afterEach(() => vi.restoreAllMocks());

test("drive emits step frames in order, each started -> ok", async () => {
  // #when a healthy deploy is driven end to end
  await drive("agent-1");

  // #then the step frames are exactly the Hermes lifecycle, each started then ok
  expect(stepCalls).toEqual([
    { step: "allocating_ports", state: "started" },
    { step: "allocating_ports", state: "ok" },
    { step: "starting", state: "started" },
    { step: "starting", state: "ok" },
    { step: "health_checking", state: "started" },
    { step: "health_checking", state: "ok" },
    { step: "registering_route", state: "started" },
    { step: "registering_route", state: "ok" },
    { step: "running", state: "ok" },
  ]);
});

test("drive allocates two ports (api + dashboard) and runs the container with them", async () => {
  // #when driven
  await drive("agent-1");

  // #then allocatePort was called twice and runContainer got both ports
  expect(allocatePortMock).toHaveBeenCalledTimes(2);
  const runArg = runContainerMock.mock.calls[0]?.[0] as {
    apiPort: number;
    dashboardPort: number;
  };
  expect(runArg.apiPort).toBe(8001);
  expect(runArg.dashboardPort).toBe(9001);
});

test("drive registers the Caddy route to the dashboard port and emits ready", async () => {
  // #when driven
  await drive("agent-1");

  // #then route is keyed agentId/slug/dashboardPort and ready carries the URL
  expect(addRouteMock).toHaveBeenCalledWith("agent-1", "my-bot", 9001);
  expect(emitReadyMock).toHaveBeenCalledWith(
    "agent-1",
    "https://agents.hermes.dev/my-bot"
  );
});

test("health probe targets the API port, not the dashboard port", async () => {
  // #when driven
  await drive("agent-1");

  // #then waitForHealth was called with the api port
  expect(waitForHealthMock).toHaveBeenCalledWith(8001);
});

test("a failed health check triggers failDeployment with reverse cleanup", async () => {
  // #given the container never becomes healthy
  waitForHealthMock.mockRejectedValue(
    new Error("Container /health did not return 200")
  );

  // #when driven
  await drive("agent-1");

  // #then status is set to failed and cleanup runs in reverse:
  //   container removed, both ports released, route NOT added (we never got there)
  expect(stopAndRemoveMock).toHaveBeenCalledWith("container-abc");
  expect(releasePortMock).toHaveBeenCalledWith("agent-1");
  expect(addRouteMock).not.toHaveBeenCalled();

  const failUpdate = updateMock.mock.calls.find(
    (c) => (c[0] as { data?: { status?: string } }).data?.status === "failed"
  );
  expect(failUpdate).toBeDefined();

  // #and the failed step frame was emitted for health_checking
  expect(stepCalls).toContainEqual({ step: "health_checking", state: "failed" });
  expect(emitDoneMock).toHaveBeenCalledWith("agent-1", "failed");
});

test("the error message is scrubbed of the LLM key and capped at 500 chars", async () => {
  // #given a secret whose key would be catastrophic to surface
  readSecretMock.mockResolvedValue({ API_SERVER_KEY: "k", OPENROUTER_API_KEY: "sk-secret-123" });
  // #and runContainer throws an error that accidentally contains the key
  runContainerMock.mockRejectedValue(new Error("docker run failed: env had sk-secret-123 set"));

  // #when driven
  await drive("agent-1");

  // #then the persisted errorMessage does not contain the key
  const failUpdate = updateMock.mock.calls.find(
    (c) => (c[0] as { data?: { status?: string } }).data?.status === "failed"
  );
  const msg = (failUpdate?.[0] as { data: { errorMessage: string } }).data.errorMessage;
  expect(msg).not.toContain("sk-secret-123");
  expect(msg.length).toBeLessThanOrEqual(500);
});

test("drive is a no-op when the agent row is missing", async () => {
  // #given no such agent
  findUniqueMock.mockResolvedValue(null);

  // #when driven
  await drive("missing");

  // #then nothing was attempted
  expect(allocatePortMock).not.toHaveBeenCalled();
  expect(stepCalls).toEqual([]);
});

test("restart: drive tears down a stale container + ports before re-allocating", async () => {
  // #given a re-queued agent that still carries its previous run's container
  //   and ports (control: restart sets status=queued without clearing them)
  findUniqueMock.mockResolvedValue({
    ...AGENT,
    status: "queued",
    containerId: "stale-container",
    apiPort: 8001,
    dashboardPort: 9001,
  });

  // #when driven
  await drive("agent-1");

  // #then the stale container is removed, its route cleared, and its ports
  //   released BEFORE the new allocation — no orphaned container, no leaked ports
  expect(stopAndRemoveMock).toHaveBeenCalledWith("stale-container");
  expect(removeRouteMock).toHaveBeenCalledWith("agent-1");
  expect(releasePortMock).toHaveBeenCalledWith("agent-1");
  const clearCall = updateMock.mock.calls.find(
    (c) =>
      (c[0] as { data?: Record<string, unknown> }).data?.containerId === null &&
      (c[0] as { data?: Record<string, unknown> }).data?.apiPort === null,
  );
  expect(clearCall).toBeDefined();
  // #and the redeploy still completes (fresh ports allocated, new container run)
  expect(allocatePortMock).toHaveBeenCalledTimes(2);
  expect(stepCalls).toContainEqual({ step: "running", state: "ok" });
});
