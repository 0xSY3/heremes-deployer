import { expect, test } from "vitest";
import { parseProvisionArgs } from "../bin/args";

test("parseProvisionArgs reads tenant/channel/provider/key and dry-run", () => {
  const a = parseProvisionArgs([
    "--tenant", "alice", "--channel", "telegram",
    "--llm-provider", "anthropic", "--llm-key", "sk-ant",
    "--channel-token", "123:abc", "--dry-run",
  ]);
  expect(a.tenantId).toBe("alice");
  expect(a.channel).toBe("telegram");
  expect(a.llmProvider).toBe("anthropic");
  expect(a.channelToken).toBe("123:abc");
  expect(a.dryRun).toBe(true);
});

test("parseProvisionArgs sets local from --local flag", () => {
  const a = parseProvisionArgs(["--tenant", "a", "--llm-key", "k", "--local"]);
  expect(a.local).toBe(true);
  const b = parseProvisionArgs(["--tenant", "a", "--llm-key", "k"]);
  expect(b.local).toBe(false);
});

test("parseProvisionArgs throws on missing required tenant", () => {
  expect(() => parseProvisionArgs(["--channel", "web"])).toThrow(/tenant/);
});

test("parseProvisionArgs rejects an unknown channel", () => {
  expect(() =>
    parseProvisionArgs(["--tenant", "a", "--channel", "carrierpigeon", "--llm-key", "k"]),
  ).toThrow(/channel/);
});
