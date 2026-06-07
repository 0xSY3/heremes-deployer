import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { WebSocket as WsClient } from "ws";
import type { AddressInfo } from "node:net";

process.env.DEPLOYER_WS_SECRET = "test-secret-ws-server-000000000000000";
// A fixed high port: startWsServer treats port<=0 as "disabled" (Task 89), so
// the integration test cannot use 0 to mean "ephemeral". The server still
// reports the bound port back via handle.address() for the client URL.
process.env.DEPLOYER_WS_PORT = "57321";
process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";

// Mock the Prisma singleton: the WS server only reads Agent.{userId,status}.
const findUnique = vi.fn();
vi.mock("../src/db.js", () => ({
  prisma: { agent: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

const { mintToken } = await import("../src/ws-auth.js");
const { emitStep, emitReady, clearSteps } = await import("../src/events.js");
const { startWsServer } = await import("../src/ws.js");

let baseUrl: string;
let close: () => void;

beforeAll(async () => {
  const handle = await startWsServer();
  if (!handle) throw new Error("server did not start");
  const addr = handle.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${addr.port}`;
  close = () => handle.close();
});

afterAll(() => close?.());
beforeEach(() => {
  findUnique.mockReset();
  clearSteps("agent_abc");
});

// Buffer every inbound frame so a synchronous server-side burst (hello +
// backfilled steps) is never lost between successive `.once("message")`
// registrations. nextMessage drains the queue in arrival order.
type Reader = (msg: Record<string, unknown>) => void;
const inbox = new WeakMap<WsClient, Record<string, unknown>[]>();
const waiters = new WeakMap<WsClient, Reader[]>();

function connect(path: string): WsClient {
  const ws = new WsClient(`${baseUrl}${path}`);
  inbox.set(ws, []);
  waiters.set(ws, []);
  ws.on("message", (d) => {
    const msg = JSON.parse(d.toString()) as Record<string, unknown>;
    const queued = waiters.get(ws)!;
    const pending = queued.shift();
    if (pending) pending(msg);
    else inbox.get(ws)!.push(msg);
  });
  return ws;
}

function nextMessage(ws: WsClient): Promise<Record<string, unknown>> {
  const buffered = inbox.get(ws)!.shift();
  if (buffered) return Promise.resolve(buffered);
  return new Promise((resolve, reject) => {
    waiters.get(ws)!.push(resolve);
    ws.once("error", reject);
  });
}

function waitClose(ws: WsClient): Promise<number> {
  return new Promise((resolve) => ws.once("close", (code) => resolve(code)));
}

describe("startWsServer", () => {
  it("closes 4401 when the token is invalid", async () => {
    // #given an agent owned by user_1 but a garbage token
    findUnique.mockResolvedValue({ userId: "user_1", status: "starting" });
    const ws = connect("/v1/agents/agent_abc/deploy?token=garbage");

    // #then the upgrade is rejected with the auth close code
    const code = await waitClose(ws);
    expect(code).toBe(4401);
  });

  it("closes 4404 when the agent does not exist", async () => {
    // #given a valid token but no row
    findUnique.mockResolvedValue(null);
    const token = mintToken("agent_abc", "user_1", 60);
    const ws = connect(`/v1/agents/agent_abc/deploy?token=${token}`);

    // #then it closes not-found
    const code = await waitClose(ws);
    expect(code).toBe(4404);
  });

  it("closes 4403 when the token user does not own the agent", async () => {
    // #given the row is owned by user_2 but the token is for user_1
    findUnique.mockResolvedValue({ userId: "user_2", status: "starting" });
    const token = mintToken("agent_abc", "user_1", 60);
    const ws = connect(`/v1/agents/agent_abc/deploy?token=${token}`);

    // #then ownership mismatch closes 4403
    const code = await waitClose(ws);
    expect(code).toBe(4403);
  });

  it("sends hello with the DB status, then backfills the step ring", async () => {
    // #given an in-flight deploy with two steps already emitted
    findUnique.mockResolvedValue({ userId: "user_1", status: "starting" });
    emitStep("agent_abc", "allocating_ports", "ok");
    emitStep("agent_abc", "starting", "started");
    const token = mintToken("agent_abc", "user_1", 60);
    const ws = connect(`/v1/agents/agent_abc/deploy?token=${token}`);

    // #then the first frame is hello carrying the DB status
    const hello = await nextMessage(ws);
    expect(hello).toMatchObject({ type: "hello", agentId: "agent_abc", status: "starting" });
    // #and the two backfilled steps replay in order
    const s1 = await nextMessage(ws);
    const s2 = await nextMessage(ws);
    expect([s1.step, s2.step]).toEqual(["allocating_ports", "starting"]);
    ws.close();
  });

  it("forwards a live frame emitted after connect", async () => {
    // #given a connected owner socket (drain hello)
    findUnique.mockResolvedValue({ userId: "user_1", status: "starting" });
    const token = mintToken("agent_abc", "user_1", 60);
    const ws = connect(`/v1/agents/agent_abc/deploy?token=${token}`);
    await nextMessage(ws); // hello

    // #when the worker emits a ready frame
    const got = nextMessage(ws);
    emitReady("agent_abc", "https://h/agent-abc");

    // #then the client receives it verbatim
    expect(await got).toMatchObject({ type: "ready", url: "https://h/agent-abc" });
    ws.close();
  });

  it("on a terminal backfilled status, sends done and closes 1000", async () => {
    // #given the deploy already failed before the client connected
    findUnique.mockResolvedValue({ userId: "user_1", status: "failed" });
    const token = mintToken("agent_abc", "user_1", 60);
    const ws = connect(`/v1/agents/agent_abc/deploy?token=${token}`);

    // #then after hello it sends done and closes cleanly
    await nextMessage(ws); // hello
    const done = await nextMessage(ws);
    expect(done).toMatchObject({ type: "done", status: "failed" });
    expect(await waitClose(ws)).toBe(1000);
  });
});
