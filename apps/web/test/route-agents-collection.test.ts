import { describe, it, expect, vi, beforeEach } from "vitest";

// The route transitively imports the worker config (via the secrets shim),
// which fails fast at load when HERMES_IMAGE is unset.
process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";
// mintWsToken -> worker mintToken refuses secrets < 32 chars (fail-closed on
// weak HMAC key), so the route's token mint needs a >= 32-char secret here.
process.env.DEPLOYER_WS_SECRET = "route-secret-0000000000000000000000";

const getCurrentUser = vi.fn();
vi.mock("../src/lib/auth.js", () => ({ getCurrentUser: () => getCurrentUser() }));

const create = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
vi.mock("../src/lib/db.js", () => ({
  prisma: {
    agent: {
      create: (...a: unknown[]) => create(...a),
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

const writeSecret = vi.fn();
vi.mock("../src/lib/secrets.js", () => ({
  writeSecret: (...a: unknown[]) => writeSecret(...a),
  generateApiKey: () => "deadbeef",
}));

const { GET, POST } = await import("../src/app/api/agents/route.js");

beforeEach(() => {
  getCurrentUser.mockReset();
  create.mockReset();
  findMany.mockReset();
  update.mockReset().mockResolvedValue({});
  writeSecret.mockReset();
});

function post(body: unknown): Request {
  return new Request("http://x/api/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agents", () => {
  it("401s when not signed in", async () => {
    // #given no session
    getCurrentUser.mockResolvedValue(null);
    // #when posting
    const res = await POST(post({ name: "a", llmProvider: "openrouter", llmKey: "sk-or-xxxxxxxxxxxxxx" }));
    // #then unauthorized
    expect(res.status).toBe(401);
  });

  it("400s on an invalid body", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1", name: "A" });
    const res = await POST(post({ name: "BAD CAPS", llmProvider: "openrouter", llmKey: "sk-or-xxxxxxxxxxxxxx" }));
    expect(res.status).toBe(400);
  });

  it("queues an agent and returns id/slug/status/wsToken", async () => {
    // #given a signed-in user and a successful secret write + insert
    getCurrentUser.mockResolvedValue({ id: "u1", name: "A" });
    writeSecret.mockResolvedValue("/data/secrets/agent_1.age");
    create.mockResolvedValue({ id: "agent_1", slug: "my-agent-abc123", status: "queued" });

    // #when posting a valid body
    const res = await POST(
      post({ name: "my-agent", llmProvider: "openrouter", llmKey: "sk-or-abcdefghijklmnop" }),
    );
    const json = await res.json();

    // #then it returns 201 with the queued row + a deploy token
    expect(res.status).toBe(201);
    expect(json).toMatchObject({ id: "agent_1", status: "queued" });
    expect(typeof json.wsToken).toBe("string");
    // #and the secret was written before the row insert (no plaintext key in the row)
    expect(writeSecret).toHaveBeenCalledTimes(1);
    const insertArg = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(insertArg.data.status).toBe("queued");
    expect(insertArg.data.userId).toBe("u1");
    expect(insertArg.data.llmProvider).toBe("openrouter");
    // #and the secretRef is filled by the post-insert update (read from update arg)
    const updateArg = update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(updateArg.data.secretRef).toBe("/data/secrets/agent_1.age");
    // #and the raw key is never persisted on the row
    expect(JSON.stringify(insertArg.data)).not.toContain("sk-or-abcdefghijklmnop");
  });
});

describe("GET /api/agents", () => {
  it("lists only the session user's agents", async () => {
    // #given a user with one agent
    getCurrentUser.mockResolvedValue({ id: "u1", name: "A" });
    findMany.mockResolvedValue([{ id: "agent_1", slug: "s", status: "running" }]);

    // #when listing
    const res = await GET();
    const json = await res.json();

    // #then the query is scoped to the user and the row is returned
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } }),
    );
    expect(json.agents).toHaveLength(1);
  });
});
