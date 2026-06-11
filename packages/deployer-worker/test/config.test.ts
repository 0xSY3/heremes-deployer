import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// config.ts validates at module load (hermesImage required, port-range guard),
// so each case re-imports fresh under a stubbed env rather than importing once
// at the top — a top-level import with a bad env would abort the whole file.
function freshEnv(overrides: Record<string, string>): void {
  vi.resetModules();
  vi.unstubAllEnvs();
  // Minimum viable env: HERMES_IMAGE is the only required key.
  vi.stubEnv("HERMES_IMAGE", "ghcr.io/acme/hermes:latest");
  for (const [k, v] of Object.entries(overrides)) vi.stubEnv(k, v);
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config defaults", () => {
  it("exposes Hermes-shaped defaults when only HERMES_IMAGE is set", async () => {
    freshEnv({});
    const { config, API_PORT, DASHBOARD_PORT } = await import("../src/config");

    expect(config.hermesImage).toBe("ghcr.io/acme/hermes:latest");
    expect(config.dataRoot).toBe("/var/lib/hermes-deployer");
    expect(config.ageIdentityPath).toBe("/var/lib/hermes-deployer/master.age");
    expect(config.caddyAdminUrl).toBe("http://127.0.0.1:2019");
    expect(config.caddyServerName).toBe("srv0");
    expect(config.dockerSocket).toBe("/var/run/docker.sock");
    expect(config.portMin).toBe(13000);
    expect(config.portMax).toBe(14000);
    expect(config.defaultModel).toBe("deepseek/deepseek-v4-flash");
    expect(config.wsPort).toBe(7071);
    expect(config.skipCaddy).toBe(false);
    expect(config.keepCrashedContainers).toBe(false);

    // The two container ports are fixed constants, not env-tunable.
    expect(API_PORT).toBe(8642);
    expect(DASHBOARD_PORT).toBe(9119);
  });

  it("derives ageIdentityPath from a custom dataRoot", async () => {
    freshEnv({ DEPLOYER_DATA_ROOT: "/data/hermes" });
    const { config } = await import("../src/config");
    expect(config.dataRoot).toBe("/data/hermes");
    expect(config.ageIdentityPath).toBe("/data/hermes/master.age");
  });

  it("honors an explicit AGE_IDENTITY_PATH over the derived default", async () => {
    freshEnv({ DEPLOYER_DATA_ROOT: "/data/hermes", AGE_IDENTITY_PATH: "/keys/id.age" });
    const { config } = await import("../src/config");
    expect(config.ageIdentityPath).toBe("/keys/id.age");
  });

  it("parses boolean escape hatches case-insensitively", async () => {
    freshEnv({ DEPLOYER_SKIP_CADDY: "TRUE", DEPLOYER_KEEP_CRASHED_CONTAINERS: "true" });
    const { config } = await import("../src/config");
    expect(config.skipCaddy).toBe(true);
    expect(config.keepCrashedContainers).toBe(true);
  });

  it("resolves the public host from HERMES_DOMAIN (canonical, matches Caddyfile)", async () => {
    // #given the prod env only sets HERMES_DOMAIN
    freshEnv({ HERMES_DOMAIN: "deployer.acme.com" });
    // #when config loads
    const { config } = await import("../src/config");
    // #then the worker builds agent URLs on that host, not the bogus default
    expect(config.wildcardDomain).toBe("deployer.acme.com");
  });

  it("prefers HERMES_DOMAIN over the legacy DEPLOYER_WILDCARD_DOMAIN alias", async () => {
    freshEnv({
      HERMES_DOMAIN: "deployer.acme.com",
      DEPLOYER_WILDCARD_DOMAIN: "legacy.example.com",
    });
    const { config } = await import("../src/config");
    expect(config.wildcardDomain).toBe("deployer.acme.com");
  });

  it("falls back to the legacy alias when HERMES_DOMAIN is unset", async () => {
    freshEnv({ DEPLOYER_WILDCARD_DOMAIN: "legacy.example.com" });
    const { config } = await import("../src/config");
    expect(config.wildcardDomain).toBe("legacy.example.com");
  });

  it("exposes DEPLOYER_PUBLIC_HOST for domainless public deploys (default empty)", async () => {
    freshEnv({ DEPLOYER_PUBLIC_HOST: "100.24.70.231" });
    const { config } = await import("../src/config");
    expect(config.publicHost).toBe("100.24.70.231");
  });

  it("defaults publicHost to empty (true local dev → localhost URLs)", async () => {
    freshEnv({});
    const { config } = await import("../src/config");
    expect(config.publicHost).toBe("");
  });

  it("exposes DEPLOYER_AGENT_SUBDOMAIN_BASE for per-agent subdomain routing", async () => {
    freshEnv({ DEPLOYER_AGENT_SUBDOMAIN_BASE: "100.24.70.231.sslip.io" });
    const { config } = await import("../src/config");
    expect(config.agentSubdomainBase).toBe("100.24.70.231.sslip.io");
  });
});

describe("config boot guards", () => {
  it("throws when HERMES_IMAGE is missing", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // Deliberately do NOT set HERMES_IMAGE.
    vi.stubEnv("HERMES_IMAGE", "");
    await expect(import("../src/config")).rejects.toThrow(/HERMES_IMAGE/);
  });

  it("throws when portMin >= portMax", async () => {
    freshEnv({ DEPLOYER_PORT_MIN: "14000", DEPLOYER_PORT_MAX: "13000" });
    await expect(import("../src/config")).rejects.toThrow(
      /DEPLOYER_PORT_MIN.*must be less than.*DEPLOYER_PORT_MAX/,
    );
  });

  it("throws when portMin equals portMax (boundary)", async () => {
    freshEnv({ DEPLOYER_PORT_MIN: "13500", DEPLOYER_PORT_MAX: "13500" });
    await expect(import("../src/config")).rejects.toThrow(/must be less than/);
  });

  it("throws when a numeric env var is non-numeric", async () => {
    freshEnv({ DEPLOYER_WS_PORT: "not-a-number" });
    await expect(import("../src/config")).rejects.toThrow(/DEPLOYER_WS_PORT must be numeric/);
  });
});
