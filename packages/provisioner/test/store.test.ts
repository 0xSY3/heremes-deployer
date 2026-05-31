import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentStore } from "../src/store";
import type { AgentRecord } from "../src/types";

let dir: string;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

function rec(id: string): AgentRecord {
  return { tenantId: id, url: `https://${id}.x`, status: "running", createdAt: "t" };
}

test("put then get round-trips a record", () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  const store = new AgentStore(join(dir, "s.json"));
  store.put(rec("alice"));
  expect(store.get("alice")?.url).toBe("https://alice.x");
});

test("get returns undefined for unknown tenant", () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  const store = new AgentStore(join(dir, "s.json"));
  expect(store.get("nobody")).toBeUndefined();
});

test("all returns every stored record", () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  const store = new AgentStore(join(dir, "s.json"));
  store.put(rec("a"));
  store.put(rec("b"));
  expect(store.all().map((r) => r.tenantId).sort()).toEqual(["a", "b"]);
});

test("delete removes a record", () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  const store = new AgentStore(join(dir, "s.json"));
  store.put(rec("bob"));
  store.delete("bob");
  expect(store.get("bob")).toBeUndefined();
});

test("corrupt JSON does not brick reads; recovers to empty + backs up bad file", () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  const path = join(dir, "s.json");
  writeFileSync(path, "{ this is not valid json ");
  const store = new AgentStore(path);
  expect(store.all()).toEqual([]);
  store.put(rec("carol"));
  expect(store.get("carol")?.tenantId).toBe("carol");
  // Corrupt file is preserved alongside, not silently destroyed.
  const backups = readdirSync(dir).filter((f) => f.includes(".corrupt-"));
  expect(backups.length).toBe(1);
});

test("empty store file reads as empty, not a parse error", () => {
  dir = mkdtempSync(join(tmpdir(), "store-"));
  const path = join(dir, "s.json");
  writeFileSync(path, "");
  expect(new AgentStore(path).all()).toEqual([]);
});
