import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "../src/lib/slug.js";

describe("slugify", () => {
  it("lowercases, collapses spaces/underscores, and strips punctuation", () => {
    expect(slugify("My  Cool_Agent!!")).toBe("my-cool-agent");
  });
  it("trims leading/trailing hyphens", () => {
    expect(slugify("--hi--")).toBe("hi");
  });
  it("truncates to 36 chars", () => {
    const long = "a".repeat(50);
    expect(slugify(long)).toHaveLength(36);
  });
});

describe("uniqueSlug", () => {
  it("appends a 6-hex random suffix to the base", () => {
    const slug = uniqueSlug("my-agent");
    expect(slug).toMatch(/^my-agent-[0-9a-f]{6}$/);
  });
  it("produces a different suffix each call", () => {
    const a = uniqueSlug("dup");
    const b = uniqueSlug("dup");
    expect(a).not.toBe(b);
  });
  it("caps the combined slug at 50 chars", () => {
    const slug = uniqueSlug("x".repeat(80));
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});
