import { describe, it, expect, beforeAll, vi } from "vitest";

// The secret must exist before src/config.ts (imported transitively by ws-auth) loads.
// config.ts also requires HERMES_IMAGE at load — stub it so the real config imports.
beforeAll(() => {
  process.env.DEPLOYER_WS_SECRET = "test-secret-please-change-00000000000";
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

// A weak/empty DEPLOYER_WS_SECRET must NOT silently enable auth (an attacker
// can compute HMAC(payload, "") locally and forge a token). config.wsSecret is
// frozen at module load, so we mock the config module with a short secret to
// prove ws-auth fails closed regardless of token validity.
describe("ws-auth fail-closed on a weak secret", () => {
  it("verify rejects and mint throws when the secret is shorter than 32 chars", async () => {
    // #given a config whose wsSecret is too short to be usable
    vi.resetModules();
    vi.doMock("../src/config.js", () => ({ config: { wsSecret: "short" } }));
    const { mintToken, verifyToken } = await import("../src/ws-auth.js");

    // #then verify fails closed for any token (no bypass)...
    expect(verifyToken("anything.atall", "agent_abc")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    // ...and mint refuses to issue a token under the weak secret
    expect(() => mintToken("agent_abc", "user_1", 60)).toThrow(/DEPLOYER_WS_SECRET/);

    vi.doUnmock("../src/config.js");
    vi.resetModules();
  });
});
