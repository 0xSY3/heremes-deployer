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
  buildAgentConfigYaml,
  buildAgentEnv,
  decryptFile,
  deleteSecret,
  encryptToFile,
  readIdentity,
  readSecret,
  writeSecret,
} from "../src/secrets.js";

describe("buildAgentEnv (cloudflare)", () => {
  it("maps cloudflare provider to CLOUDFLARE_API_KEY", () => {
    // #given a secret holding a Cloudflare token
    const secret = { API_SERVER_KEY: "k-server", CLOUDFLARE_API_KEY: "cfut-x" };

    // #when building the env
    const env = buildAgentEnv({ secret, llmProvider: "cloudflare" });

    // #then the token is injected under the name the seeded config's key_env reads
    expect(env.CLOUDFLARE_API_KEY).toBe("cfut-x");
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("pins HERMES_MODEL to the cloudflare default, not the openrouter default", () => {
    // #given a cloudflare agent
    const secret = { API_SERVER_KEY: "k-server", CLOUDFLARE_API_KEY: "cfut-x" };

    // #when building the env
    const env = buildAgentEnv({ secret, llmProvider: "cloudflare" });

    // #then TUI sessions (which honor HERMES_MODEL) get a @cf/ model the
    // Workers AI endpoint can serve — a partner-prefixed id would 402
    expect(env.HERMES_MODEL).toBe("@cf/openai/gpt-oss-120b");
  });

  it("omits HERMES_MODEL for anthropic (image default is already an Anthropic id)", () => {
    // #given an anthropic agent
    const secret = { API_SERVER_KEY: "k-server", ANTHROPIC_API_KEY: "sk-ant-y" };

    // #when building the env
    const env = buildAgentEnv({ secret, llmProvider: "anthropic" });

    // #then no cross-provider model id is injected
    expect(env.HERMES_MODEL).toBeUndefined();
  });
});

describe("buildAgentConfigYaml", () => {
  it("builds a cloudflare provider block with the account-scoped endpoint", () => {
    // #given a cloudflare secret with the account id
    const yaml = buildAgentConfigYaml({
      llmProvider: "cloudflare",
      secret: { CLOUDFLARE_API_KEY: "cfut-x", CF_ACCOUNT_ID: "a".repeat(32) },
    });

    // #then the seed pins provider, model, endpoint, and env-var key source
    expect(yaml).toContain("provider: cloudflare");
    expect(yaml).toContain(
      `base_url: "https://api.cloudflare.com/client/v4/accounts/${"a".repeat(32)}/ai/v1"`,
    );
    expect(yaml).toContain("key_env: CLOUDFLARE_API_KEY");
    expect(yaml).toContain('default: "@cf/openai/gpt-oss-120b"');
  });

  it("throws for cloudflare when CF_ACCOUNT_ID is missing", () => {
    // #then the deploy fails loudly instead of building a broken endpoint URL
    expect(() =>
      buildAgentConfigYaml({ llmProvider: "cloudflare", secret: { CLOUDFLARE_API_KEY: "x" } }),
    ).toThrow(/CF_ACCOUNT_ID/);
  });

  it("pins the default model for openrouter so DEPLOYER_DEFAULT_MODEL takes effect", () => {
    // #when building the openrouter seed
    const yaml = buildAgentConfigYaml({ llmProvider: "openrouter", secret: {} });

    // #then model.default carries the worker's configured default
    expect(yaml).toContain('default: "deepseek/deepseek-v4-flash"');
    expect(yaml).toContain('base_url: "https://openrouter.ai/api/v1"');
  });

  it("returns null for anthropic (image auto-detects the key)", () => {
    // #then no seed is written for anthropic agents
    expect(buildAgentConfigYaml({ llmProvider: "anthropic", secret: {} })).toBeNull();
  });
});

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
    expect(env.GATEWAY_ALLOW_ALL_USERS).toBe("true");
    // Pinned (not random, not equal to the API key which would leak via the
    // injected page) so the dashboard WS token survives a restart.
    expect(env.HERMES_DASHBOARD_SESSION_TOKEN).toMatch(/^[a-f0-9]{64}$/);
    expect(env.HERMES_DASHBOARD_SESSION_TOKEN).not.toBe("k-server");
    expect(env.HERMES_UID).toBe("10000");
    expect(env.HERMES_GID).toBe("10000");
    expect(env.HERMES_DASHBOARD).toBe("1");
    expect(env.HERMES_DASHBOARD_HOST).toBe("0.0.0.0");
    expect(env.HERMES_DASHBOARD_TUI).toBe("1");
    expect(env.HERMES_DASHBOARD_INSECURE).toBe("1");
    expect(env.HERMES_MODEL).toBe("deepseek/deepseek-v4-flash");
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
    expect(env.HERMES_MODEL).toBe("deepseek/deepseek-v4-flash");
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
