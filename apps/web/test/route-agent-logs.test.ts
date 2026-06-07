import { describe, it, expect, vi, beforeEach } from "vitest";

// The route imports @/lib/db → @hermes/deployer-worker/db → worker config, which
// fail-fasts on missing env. Stub the required vars before that module loads.
process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";
process.env.DEPLOYER_WS_SECRET = "test-secret-0000000000000000000000000";

const getCurrentUser = vi.fn();
vi.mock("../src/lib/auth.js", () => ({ getCurrentUser: () => getCurrentUser() }));

const findFirst = vi.fn();
const findMany = vi.fn();
vi.mock("../src/lib/db.js", () => ({
  prisma: {
    agent: {
      findFirst: (...a: unknown[]) => findFirst(...a),
    },
    agentLog: {
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}));

const logs = await import("../src/app/api/agents/[id]/logs/route.js");

beforeEach(() => {
  getCurrentUser.mockReset();
  findFirst.mockReset();
  findMany.mockReset();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/agents/[id]/logs", () => {
  it("404s when the agent is not owned (no existence leak)", async () => {
    // #given the owner-scoped lookup returns nothing
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue(null);
    // #when fetching logs for someone else's id
    const res = await logs.GET(new Request("http://x"), params("agent_other"));
    // #then 404, not 403, and the logs table is never queried
    expect(res.status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "agent_other", userId: "u1" } }),
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns the joined log text oldest-first when owned", async () => {
    // #given ownership passes and the log query returns newest-first rows
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue({ id: "agent_1" });
    findMany.mockResolvedValue([{ text: "line 3" }, { text: "line 2" }, { text: "line 1" }]);
    // #when reading logs for an owned agent
    const res = await logs.GET(new Request("http://x"), params("agent_1"));
    // #then 200 with the rows reversed into natural reading order
    expect(res.status).toBe(200);
    expect((await res.json()).logs).toBe("line 1\nline 2\nline 3");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentId: "agent_1" } }),
    );
  });
});
