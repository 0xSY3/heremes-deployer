import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatLinkStore } from "../src/link-store";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hgw-link-"));
  path = join(dir, "links.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("ChatLinkStore", () => {
  it("stores and retrieves a link by chat id", () => {
    const store = new ChatLinkStore(path);
    store.put({ chatId: 42, tenantId: "t1", linkedAt: "2026-06-04T00:00:00Z" });
    expect(store.get(42)?.tenantId).toBe("t1");
    expect(store.get(99)).toBeUndefined();
  });

  it("deletes and reports whether something was removed", () => {
    const store = new ChatLinkStore(path);
    store.put({ chatId: 7, tenantId: "t2", linkedAt: "x" });
    expect(store.delete(7)).toBe(true);
    expect(store.delete(7)).toBe(false);
    expect(store.get(7)).toBeUndefined();
  });

  it("finds all chats linked to a tenant", () => {
    const store = new ChatLinkStore(path);
    store.put({ chatId: 1, tenantId: "shared", linkedAt: "x" });
    store.put({ chatId: 2, tenantId: "shared", linkedAt: "x" });
    store.put({ chatId: 3, tenantId: "other", linkedAt: "x" });
    expect(store.findByTenant("shared").map((l) => l.chatId).sort()).toEqual([1, 2]);
  });
});
