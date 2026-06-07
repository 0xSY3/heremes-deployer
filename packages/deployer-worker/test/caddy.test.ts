import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.HERMES_IMAGE ??= "ghcr.io/test/hermes:latest";
});

import { ensureServer } from "../src/caddy.js";

// cfg defaults used by the source under test.
const ADMIN = "http://127.0.0.1:2019";
const SERVER = "srv0";

type Handler = (init: RequestInit | undefined) => {
  ok: boolean;
  status: number;
  body: unknown;
};

interface Call {
  path: string;
  method: string;
  init: RequestInit | undefined;
}

let calls: Call[];
let routes: Map<string, Handler>;

function mockResponse(r: { ok: boolean; status: number; body: unknown }): Response {
  return {
    ok: r.ok,
    status: r.status,
    json: async () => r.body,
    text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  routes = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.startsWith(ADMIN) ? url.slice(ADMIN.length) : url;
      const method = init?.method ?? "GET";
      calls.push({ path, method, init });
      const key = `${method} ${path}`;
      const handler = routes.get(key);
      if (!handler) {
        return mockResponse({ ok: false, status: 404, body: "no route" });
      }
      return mockResponse(handler(init));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureServer", () => {
  it("early-returns when the server already has a routes array", async () => {
    routes.set(`GET /config/apps/http/servers/${SERVER}`, () => ({
      ok: true,
      status: 200,
      body: { listen: [":443"], routes: [] },
    }));
    await ensureServer();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`/config/apps/http/servers/${SERVER}`);
    expect(calls.some((c) => c.path === "/load")).toBe(false);
  });

  it("pins the Origin header to the admin URL on every request", async () => {
    routes.set(`GET /config/apps/http/servers/${SERVER}`, () => ({
      ok: true,
      status: 200,
      body: { routes: [] },
    }));
    await ensureServer();
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Origin).toBe(ADMIN);
  });

  it("bootstraps via POST /load when the server has no routes array", async () => {
    // probe returns "no routes" first, then "has routes" after /load
    let probeCount = 0;
    routes.set(`GET /config/apps/http/servers/${SERVER}`, () => {
      probeCount += 1;
      return probeCount === 1
        ? { ok: true, status: 200, body: { listen: [":443"] } }
        : { ok: true, status: 200, body: { listen: [":443"], routes: [] } };
    });
    routes.set("GET /config/", () => ({ ok: true, status: 200, body: {} }));
    routes.set("POST /load", () => ({ ok: true, status: 200, body: "" }));

    await ensureServer();

    const load = calls.find((c) => c.path === "/load");
    expect(load).toBeDefined();
    expect(load!.method).toBe("POST");
    const merged = JSON.parse(load!.init!.body as string);
    expect(Array.isArray(merged.apps.http.servers[SERVER].routes)).toBe(true);
  });
});
