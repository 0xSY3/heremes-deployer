import { describe, it, expect } from "vitest";

process.env.DEPLOYER_WS_SECRET = "test-secret-disabled-0000000000000000";
process.env.DEPLOYER_WS_PORT = "0";
process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";

const { startWsServer } = await import("../src/ws.js");

describe("startWsServer disabled", () => {
  it("returns null without binding when wsPort is 0", async () => {
    // #given DEPLOYER_WS_PORT=0
    // #when starting the server
    const handle = await startWsServer();

    // #then it is a no-op
    expect(handle).toBeNull();
  });
});
