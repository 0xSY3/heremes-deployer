import { expect, test } from "vitest";
import { CHANNELS, LLM_PROVIDERS } from "../src/types";

test("channel and provider enums expose expected members", () => {
  expect(CHANNELS).toEqual(["web", "telegram", "discord"]);
  expect(LLM_PROVIDERS).toEqual(["openrouter", "anthropic"]);
});
