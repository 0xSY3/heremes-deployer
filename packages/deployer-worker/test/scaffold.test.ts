import { describe, it, expect } from "vitest";

// Temporary sentinel: proves vitest + tsx + ESM resolution work in this
// package before any real source exists. Deleted once config.test.ts lands.
describe("scaffold", () => {
  it("runs vitest in this package", () => {
    expect(1 + 1).toBe(2);
  });
});
