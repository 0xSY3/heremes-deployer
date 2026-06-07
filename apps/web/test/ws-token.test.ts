import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.DEPLOYER_WS_SECRET = "shared-secret-web-worker-000000000000";
  process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest"; // worker config fail-fasts without it
});

describe("mintWsToken (web side)", () => {
  it("produces a token the worker's verifier accepts", async () => {
    const { mintWsToken } = await import("../src/lib/ws-token.js");
    const { verifyToken } = await import(
      "../../../packages/deployer-worker/src/ws-auth.js"
    );

    const token = mintWsToken("agent_xyz", "user_9", 60);
    const result = verifyToken(token, "agent_xyz");

    expect(result).toEqual({ ok: true, userId: "user_9" });
  });
});
