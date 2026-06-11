import { describe, it, expect, vi } from "vitest";

// dashboard-gate → ws-auth → config; config fails fast without HERMES_IMAGE,
// and token signing needs a usable (>=32 char) DEPLOYER_WS_SECRET.
vi.hoisted(() => {
  process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";
  process.env.DEPLOYER_WS_SECRET ??= "x".repeat(40);
});

import { mintToken } from "../src/ws-auth.js";
import {
  GATE_COOKIE_NAME,
  handleGateOpen,
  handleGateCheck,
} from "../src/dashboard-gate.js";

const AGENT = "agent-abc";
const OTHER = "agent-xyz";
const USER = "user-1";

function cookieFromSetCookie(setCookie: string | undefined): string {
  // "hermes_gate=<val>; Path=/; ..." → "hermes_gate=<val>"
  return (setCookie ?? "").split(";")[0] ?? "";
}

describe("handleGateOpen", () => {
  it("sets a host-only access cookie and 302s home for a valid owner token", () => {
    // #given a token minted for this agent
    const token = mintToken(AGENT, USER, 300);

    // #when the gate is hit
    const r = handleGateOpen({ token, agentId: AGENT });

    // #then it redirects to / and sets the gate cookie with hardening flags,
    // and NO Domain attribute (host-only — never shared across subdomains)
    expect(r.status).toBe(302);
    expect(r.headers.Location).toBe("/");
    const sc = r.headers["Set-Cookie"];
    expect(sc).toContain(`${GATE_COOKIE_NAME}=`);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("Secure");
    expect(sc).toContain("SameSite=Lax");
    expect(sc).not.toContain("Domain=");
  });

  it("401s when the token was minted for a different agent", () => {
    // #given a token for OTHER replayed on AGENT's gate
    const token = mintToken(OTHER, USER, 300);

    // #then the agent-bound signature check rejects it
    expect(handleGateOpen({ token, agentId: AGENT }).status).toBe(401);
  });

  it("400s when no token is present", () => {
    expect(handleGateOpen({ token: null, agentId: AGENT }).status).toBe(400);
  });
});

describe("handleGateCheck", () => {
  it("204s when the cookie is a valid token for this agent", () => {
    // #given the cookie the gate would have set
    const open = handleGateOpen({ token: mintToken(AGENT, USER, 300), agentId: AGENT });
    const cookieHeader = cookieFromSetCookie(open.headers["Set-Cookie"]);

    // #then forward_auth authorizes the proxy
    expect(handleGateCheck({ cookieHeader, agentId: AGENT }).status).toBe(204);
  });

  it("401s when the cookie was minted for a different agent", () => {
    // #given AGENT's valid cookie presented on OTHER's check
    const open = handleGateOpen({ token: mintToken(AGENT, USER, 300), agentId: AGENT });
    const cookieHeader = cookieFromSetCookie(open.headers["Set-Cookie"]);

    expect(handleGateCheck({ cookieHeader, agentId: OTHER }).status).toBe(401);
  });

  it("401s when there is no cookie", () => {
    expect(handleGateCheck({ cookieHeader: undefined, agentId: AGENT }).status).toBe(401);
  });

  it("401s on a tampered cookie value", () => {
    const open = handleGateOpen({ token: mintToken(AGENT, USER, 300), agentId: AGENT });
    const tampered = cookieFromSetCookie(open.headers["Set-Cookie"]) + "garbage";
    expect(handleGateCheck({ cookieHeader: tampered, agentId: AGENT }).status).toBe(401);
  });
});
