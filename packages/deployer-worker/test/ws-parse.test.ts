import { describe, it, expect } from "vitest";

// ws.ts statically imports config, which requires HERMES_IMAGE at load. Stub it
// before importing so the module resolves under a fresh test worker.
process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";

const { parseDeployPath, buildHello } = await import("../src/ws.js");

describe("parseDeployPath", () => {
  it("parses a valid deploy path with token", () => {
    // #given the documented deploy URL
    const out = parseDeployPath("/v1/agents/agent_abc/deploy?token=tok123");

    // #then agentId and token are extracted
    expect(out).toEqual({ agentId: "agent_abc", token: "tok123" });
  });

  it("url-decodes the agentId segment", () => {
    // #given an encoded id
    const out = parseDeployPath("/v1/agents/a%2Fb/deploy?token=t");

    // #then it is decoded
    expect(out?.agentId).toBe("a/b");
  });

  it("returns null when the token is missing", () => {
    // #given no token query param (token is mandatory — open sockets are rejected)
    const out = parseDeployPath("/v1/agents/agent_abc/deploy");

    // #then parse fails
    expect(out).toBeNull();
  });

  it("returns null for the wrong path shape", () => {
    // #given the logs path from the OTHER ws server
    expect(parseDeployPath("/v1/agents/agent_abc/logs?token=t")).toBeNull();
    // #and a too-short path
    expect(parseDeployPath("/v1/agents/deploy?token=t")).toBeNull();
    // #and undefined
    expect(parseDeployPath(undefined)).toBeNull();
  });

  it("returns null when agentId is empty", () => {
    // #given an empty id segment
    expect(parseDeployPath("/v1/agents//deploy?token=t")).toBeNull();
  });
});

describe("buildHello", () => {
  it("shapes the hello frame from a db row", () => {
    // #given the agent's current status from the DB
    const frame = buildHello("agent_abc", "starting");

    // #then it is a type-tagged hello frame
    expect(frame).toEqual({ type: "hello", agentId: "agent_abc", status: "starting" });
  });
});
