import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConnectTokenStore } from "../src/connect-tokens";
import { isValidStartParam } from "../src/links";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hgw-tok-"));
  path = join(dir, "tokens.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ConnectTokenStore", () => {
  it("mints a Telegram-safe token bound to a tenant", () => {
    const store = new ConnectTokenStore(path);
    const rec = store.mint("user-1-support");
    expect(rec.tenantId).toBe("user-1-support");
    expect(isValidStartParam(rec.token)).toBe(true);
    expect(rec.token.length).toBeLessThanOrEqual(64);
  });

  it("consumes a token exactly once (single-use)", () => {
    const store = new ConnectTokenStore(path);
    const { token } = store.mint("tenant-a");
    expect(store.consume(token)).toBe("tenant-a");
    expect(store.consume(token)).toBeNull();
  });

  it("returns null for unknown tokens", () => {
    const store = new ConnectTokenStore(path);
    expect(store.consume("nope")).toBeNull();
  });

  it("expires tokens after the TTL", () => {
    let now = 1_000_000;
    const store = new ConnectTokenStore(path, 1000, () => now);
    const { token } = store.mint("tenant-b");
    now += 1001; // past TTL
    expect(store.consume(token)).toBeNull();
  });
});
