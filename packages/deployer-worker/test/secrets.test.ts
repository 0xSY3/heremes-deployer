import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// secrets.ts imports the real config module, which fails fast at load if
// HERMES_IMAGE is unset. Stub it before the static import is evaluated.
vi.hoisted(() => {
  process.env.HERMES_IMAGE ??= "ghcr.io/acme/hermes:test";
});

import {
  ageAvailable,
  buildAgentEnv,
  decryptFile,
  deleteSecret,
  encryptToFile,
  readIdentity,
  readSecret,
  writeSecret,
} from "../src/secrets.js";

// age/age-keygen are provisioned by infra/install.sh. On a dev box without
// them the round-trip can't run, so skip rather than fail the suite.
const hasAge = ageAvailable();
const d = hasAge ? describe : describe.skip;

let tmp: string;
let identityPath: string;

beforeAll(async () => {
  if (!hasAge) return;
  tmp = await mkdtemp(join(tmpdir(), "hermes-secrets-"));
  identityPath = join(tmp, "master.age");
  const gen = spawnSync("age-keygen", ["-o", identityPath], { encoding: "utf8" });
  if (gen.status !== 0) {
    throw new Error(`age-keygen failed: ${gen.stderr}`);
  }
});

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

d("age primitives", () => {
  it("derives a recipient from the identity file", async () => {
    const { identity, recipient } = await readIdentity(identityPath);
    expect(identity.startsWith("AGE-SECRET-KEY-")).toBe(true);
    expect(recipient.startsWith("age1")).toBe(true);
  });

  it("encrypts a buffer to a file then decrypts it back", async () => {
    const plaintext = Buffer.from("super-secret-value", "utf8");
    const out = join(tmp, "blob.age");
    await encryptToFile(plaintext, out, identityPath);
    const onDisk = await readFile(out, "utf8");
    const back = await decryptFile(out, identityPath);
    expect(onDisk.startsWith("age-encryption.org/v1")).toBe(true);
    expect(onDisk).not.toContain("super-secret-value");
    expect(back.toString("utf8")).toBe("super-secret-value");
  });

  it("throws a scrubbed error on a malformed identity file", async () => {
    const bad = join(tmp, "bad.age");
    await writeFile(bad, "not an identity\n", "utf8");
    await expect(readIdentity(bad)).rejects.toThrow(/malformed/);
  });
});

d("per-agent secret file", () => {
  const agentId = "agent_abc123";
  const payload = {
    API_SERVER_KEY: "deadbeefdeadbeefdeadbeef",
    OPENROUTER_API_KEY: "sk-or-v1-topsecret",
  };

  it("writeSecret -> readSecret round-trips the payload", async () => {
    const path = await writeSecret(agentId, payload, { dataRoot: tmp, identityPath });
    const back = await readSecret(agentId, { dataRoot: tmp, identityPath });
    expect(path).toBe(join(tmp, "secrets", `${agentId}.age`));
    expect(back).toEqual(payload);
  });

  it("never writes the plaintext key to the .age file", async () => {
    const path = await writeSecret(agentId, payload, { dataRoot: tmp, identityPath });
    const onDisk = await readFile(path, "utf8");
    expect(onDisk.startsWith("age-encryption.org/v1")).toBe(true);
    expect(onDisk).not.toContain("sk-or-v1-topsecret");
    expect(onDisk).not.toContain("deadbeefdeadbeefdeadbeef");
  });

  it("deleteSecret removes the file and is idempotent on ENOENT", async () => {
    await writeSecret(agentId, payload, { dataRoot: tmp, identityPath });
    await deleteSecret(agentId, { dataRoot: tmp });
    await expect(readSecret(agentId, { dataRoot: tmp, identityPath })).rejects.toThrow();
    await expect(deleteSecret(agentId, { dataRoot: tmp })).resolves.toBeUndefined();
  });
});

describe("buildAgentEnv", () => {
  const base = {
    API_SERVER_KEY: "k-server",
  };

  it("maps openrouter provider to OPENROUTER_API_KEY", () => {
    const secret = { ...base, OPENROUTER_API_KEY: "sk-or-x" };
    const env = buildAgentEnv({ secret, llmProvider: "openrouter" });
    expect(env.OPENROUTER_API_KEY).toBe("sk-or-x");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.API_SERVER_KEY).toBe("k-server");
    expect(env.API_SERVER_ENABLED).toBe("true");
    expect(env.API_SERVER_HOST).toBe("0.0.0.0");
    expect(env.HERMES_UID).toBe("10000");
    expect(env.HERMES_DASHBOARD).toBe("1");
    expect(env.HERMES_DASHBOARD_HOST).toBe("0.0.0.0");
    expect(env.HERMES_DASHBOARD_TUI).toBe("1");
    expect(env.HERMES_DASHBOARD_INSECURE).toBe("1");
    expect(env.HERMES_MODEL).toBe("google/gemini-2.5-flash");
    expect(env.HERMES_EPHEMERAL_SYSTEM_PROMPT).toBeUndefined();
  });

  it("maps anthropic provider to ANTHROPIC_API_KEY", () => {
    const secret = { ...base, ANTHROPIC_API_KEY: "sk-ant-y" };
    const env = buildAgentEnv({ secret, llmProvider: "anthropic" });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-y");
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("injects personality system prompt and lets a preset model override the default", () => {
    const secret = { ...base, OPENROUTER_API_KEY: "sk-or-x" };
    const env = buildAgentEnv({
      secret,
      llmProvider: "openrouter",
      personalityId: "coding",
    });
    expect(env.HERMES_EPHEMERAL_SYSTEM_PROMPT).toContain("senior software engineer");
    expect(env.HERMES_MODEL).toBe("google/gemini-2.5-flash");
  });

  it("ignores an unknown personalityId (no prompt injected)", () => {
    const secret = { ...base, OPENROUTER_API_KEY: "sk-or-x" };
    const env = buildAgentEnv({
      secret,
      llmProvider: "openrouter",
      personalityId: "does-not-exist",
    });
    expect(env.HERMES_EPHEMERAL_SYSTEM_PROMPT).toBeUndefined();
  });

  it("throws if the secret is missing the provider key", () => {
    expect(() =>
      buildAgentEnv({
        secret: { ...base, OPENROUTER_API_KEY: "sk-or-x" },
        llmProvider: "anthropic",
      }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });
});
