import { describe, it, expect } from "vitest";
import { createAgentSchema } from "../src/lib/validation.js";

describe("createAgentSchema", () => {
  it("accepts a valid openrouter body", () => {
    const out = createAgentSchema.safeParse({
      name: "my-agent",
      llmProvider: "openrouter",
      llmKey: "sk-or-abcdefghijklmnop",
    });
    expect(out.success).toBe(true);
  });
  it("rejects an unknown provider", () => {
    const out = createAgentSchema.safeParse({
      name: "x",
      llmProvider: "openai",
      llmKey: "sk-or-abcdefghijklmnop",
    });
    expect(out.success).toBe(false);
  });
  it("rejects a too-short key", () => {
    const out = createAgentSchema.safeParse({
      name: "x",
      llmProvider: "anthropic",
      llmKey: "sk-ant-1",
    });
    expect(out.success).toBe(false);
  });
  it("accepts an optional personalityId", () => {
    const out = createAgentSchema.safeParse({
      name: "x",
      llmProvider: "anthropic",
      llmKey: "sk-ant-abcdefghijklmnop",
      personalityId: "stoic",
    });
    expect(out.success).toBe(true);
  });
});
