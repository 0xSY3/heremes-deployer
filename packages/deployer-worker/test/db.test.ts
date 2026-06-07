import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Stub the generated Prisma client: db.ts only needs `new PrismaClient(...)`,
// not a real DB. Each instance is tagged so we can assert singleton identity
// and how many times the constructor ran.
let ctorCalls = 0;
vi.mock("@prisma/client", () => {
  class PrismaClient {
    readonly tag: number;
    constructor(public readonly opts: unknown) {
      ctorCalls += 1;
      this.tag = ctorCalls;
    }
  }
  return { PrismaClient };
});

const HERMES_GLOBAL_KEY = "__hermesDeployerPrisma";

beforeEach(() => {
  ctorCalls = 0;
  vi.resetModules();
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[HERMES_GLOBAL_KEY];
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (globalThis as Record<string, unknown>)[HERMES_GLOBAL_KEY];
});

describe("prisma singleton", () => {
  it("constructs exactly one client per module load", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { prisma } = await import("../src/db");
    expect(prisma).toBeDefined();
    expect(ctorCalls).toBe(1);
  });

  it("caches the instance on globalThis when NODE_ENV !== production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { prisma } = await import("../src/db");
    expect((globalThis as Record<string, unknown>)[HERMES_GLOBAL_KEY]).toBe(prisma);
  });

  it("reuses the cached global instead of reconstructing on re-import (dev HMR)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const first = (await import("../src/db")).prisma;
    vi.resetModules(); // simulate an HMR module reload
    const second = (await import("../src/db")).prisma;
    expect(second).toBe(first);
    expect(ctorCalls).toBe(1); // constructed once, reused thereafter
  });

  it("does NOT cache on globalThis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await import("../src/db");
    expect((globalThis as Record<string, unknown>)[HERMES_GLOBAL_KEY]).toBeUndefined();
  });
});
