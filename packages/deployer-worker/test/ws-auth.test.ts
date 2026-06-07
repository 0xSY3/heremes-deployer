import { describe, it, expect, beforeAll } from "vitest";

// The secret must exist before src/config.ts (imported transitively by ws-auth) loads.
// config.ts also requires HERMES_IMAGE at load — stub it so the real config imports.
beforeAll(() => {
  process.env.DEPLOYER_WS_SECRET = "test-secret-please-change";
  process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";
});

const load = async () => import("../src/ws-auth.js");

describe("ws-auth", () => {
  it("round-trips a valid token for the same agent", async () => {
    // #given a freshly minted token
    const { mintToken, verifyToken } = await load();
    const token = mintToken("agent_abc", "user_1", 60);

    // #when verifying it against the same agentId
    const result = verifyToken(token, "agent_abc");

    // #then it resolves to the bound userId
    expect(result).toEqual({ ok: true, userId: "user_1" });
  });

  it("rejects an expired token", async () => {
    // #given a token that expired one second ago
    const { mintToken, verifyToken } = await load();
    const token = mintToken("agent_abc", "user_1", -1);

    // #when verifying it
    const result = verifyToken(token, "agent_abc");

    // #then it is rejected as expired
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token minted for a different agent", async () => {
    // #given a token minted for agent_abc
    const { mintToken, verifyToken } = await load();
    const token = mintToken("agent_abc", "user_1", 60);

    // #when verifying it against agent_xyz
    const result = verifyToken(token, "agent_xyz");

    // #then the agent mismatch is caught (signature is over the agentId)
    expect(result).toEqual({ ok: false, reason: "agent_mismatch" });
  });

  it("rejects a tampered signature", async () => {
    // #given a valid token with its last char flipped
    const { mintToken, verifyToken } = await load();
    const token = mintToken("agent_abc", "user_1", 60);
    const flipped = token.slice(0, -1) + (token.at(-1) === "A" ? "B" : "A");

    // #when verifying the tampered token
    const result = verifyToken(flipped, "agent_abc");

    // #then it fails signature verification
    expect(result.ok).toBe(false);
  });

  it("rejects a structurally malformed token", async () => {
    // #given garbage with no dot-separated parts
    const { verifyToken } = await load();

    // #when verifying it
    const result = verifyToken("not-a-token", "agent_abc");

    // #then it is rejected as malformed
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
