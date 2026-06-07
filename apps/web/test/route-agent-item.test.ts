import { describe, it, expect, vi, beforeEach } from "vitest";

const getCurrentUser = vi.fn();
vi.mock("../src/lib/auth.js", () => ({ getCurrentUser: () => getCurrentUser() }));

const findFirst = vi.fn();
const update = vi.fn();
vi.mock("../src/lib/db.js", () => ({
  prisma: {
    agent: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

const item = await import("../src/app/api/agents/[id]/route.js");
const control = await import("../src/app/api/agents/[id]/control/route.js");

beforeEach(() => {
  getCurrentUser.mockReset();
  findFirst.mockReset();
  update.mockReset();
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/agents/[id]", () => {
  it("404s when the agent is not owned (no existence leak)", async () => {
    // #given the owner-scoped lookup returns nothing
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue(null);
    // #when fetching someone else's id
    const res = await item.GET(new Request("http://x"), params("agent_other"));
    // #then 404, not 403
    expect(res.status).toBe(404);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "agent_other", userId: "u1" } }),
    );
  });

  it("returns the agent detail when owned", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue({ id: "agent_1", status: "running", slug: "s" });
    const res = await item.GET(new Request("http://x"), params("agent_1"));
    expect(res.status).toBe(200);
    expect((await res.json()).agent.id).toBe("agent_1");
  });
});

describe("DELETE /api/agents/[id]", () => {
  it("marks the agent stopped (worker sweeps)", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    update.mockResolvedValue({ count: 1 });
    findFirst.mockResolvedValue({ id: "agent_1" }); // ownership pre-check

    const res = await item.DELETE(new Request("http://x", { method: "DELETE" }), params("agent_1"));

    expect(res.status).toBe(200);
    // #then status set to stopped, scoped by owner
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "agent_1" },
        data: expect.objectContaining({ status: "stopped" }),
      }),
    );
  });

  it("404s deleting an unowned agent", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue(null);
    const res = await item.DELETE(new Request("http://x", { method: "DELETE" }), params("nope"));
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("POST /api/agents/[id]/control", () => {
  it("rejects an unknown action with 400", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue({ id: "agent_1", status: "running" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ action: "nuke" }) });
    const res = await control.POST(req, params("agent_1"));
    expect(res.status).toBe(400);
  });

  it("writes a restart intent status the worker will act on", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    findFirst.mockResolvedValue({ id: "agent_1", status: "running" });
    update.mockResolvedValue({ id: "agent_1", status: "queued" });
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ action: "restart" }) });
    const res = await control.POST(req, params("agent_1"));
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "agent_1" }, data: { status: "queued" } }),
    );
  });
});
