// Thin wrapper around the `age` binary for encrypting per-agent secrets at
// rest. We shell out rather than binding a JS age library so the format
// stays interoperable with the stock `age` CLI operators already know.
//
// Requires `age` and `age-keygen` on PATH. See infra/install.sh.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { getPersonality } from "@hermes/provisioner/presets";

import { config as cfg } from "./config.js";

interface AgeResult {
  stdout: Buffer;
  stderr: string;
  code: number;
}

function runAge(args: string[], stdin: Buffer | string): Promise<AgeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("age", args, { stdio: ["pipe", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ stdout: Buffer.concat(chunks), stderr, code: code ?? 1 }),
    );

    child.stdin.end(stdin);
  });
}

// Cheap probe so tests can skip the suite when age isn't installed.
export function ageAvailable(): boolean {
  return (
    spawnSync("age", ["--version"]).status === 0 &&
    spawnSync("age-keygen", ["--version"]).status === 0
  );
}

// Read the master age identity (private) and derive the recipient line
// (public) so we don't have to keep both on disk.
export async function readIdentity(
  identityPath: string = cfg.ageIdentityPath,
): Promise<{ identity: string; recipient: string }> {
  const raw = await readFile(identityPath, "utf8");
  const lines = raw.split(/\r?\n/);
  // age-keygen emits "AGE-SECRET-KEY-..." for the identity and a
  // "# public key: age1..." comment for the recipient.
  const identityLine = lines.find((l) => l.startsWith("AGE-SECRET-KEY-"));
  const recipientLine = lines
    .find((l) => l.startsWith("# public key:"))
    ?.replace("# public key:", "")
    .trim();

  if (!identityLine || !recipientLine) {
    throw new Error(
      `Age identity at ${identityPath} is malformed; regenerate with \`age-keygen -o <path>\``,
    );
  }
  return { identity: identityLine, recipient: recipientLine };
}

export async function encryptToFile(
  data: Buffer,
  outPath: string,
  identityPath: string = cfg.ageIdentityPath,
): Promise<void> {
  const { recipient } = await readIdentity(identityPath);
  const { stderr, code } = await runAge(
    ["--encrypt", "--recipient", recipient, "--output", outPath],
    data,
  );
  if (code !== 0) {
    // Never surface argv/recipient — only daemon stderr (spec §5).
    throw new Error(`age encrypt failed (${code}): ${stderr}`);
  }
}

export async function decryptFile(
  inPath: string,
  identityPath: string = cfg.ageIdentityPath,
): Promise<Buffer> {
  // SECURITY: pass the identity as a FILE (--identity <path>), never on
  // argv. argv is world-readable via /proc/<pid>/cmdline, so an inline
  // secret key would leak to any local process.
  const encrypted = await readFile(inPath);
  const { stdout, stderr, code } = await runAge(
    ["--decrypt", "--identity", identityPath],
    encrypted,
  );
  if (code !== 0) {
    throw new Error(`age decrypt failed (${code}): ${stderr}`);
  }
  return stdout;
}

interface SecretFileOpts {
  dataRoot?: string;
  identityPath?: string;
}

// <dataRoot>/secrets/<agentId>.age — the path stored as Agent.secretRef.
function secretPath(agentId: string, dataRoot: string = cfg.dataRoot): string {
  return join(dataRoot, "secrets", `${agentId}.age`);
}

// age-encrypt the agent's secret env ({API_SERVER_KEY, <LLM key>}) JSON to
// disk and return the path. The plaintext never hits disk — only the
// ciphertext file is written (spec §5).
export async function writeSecret(
  agentId: string,
  payload: Record<string, string>,
  opts: SecretFileOpts = {},
): Promise<string> {
  const dataRoot = opts.dataRoot ?? cfg.dataRoot;
  const out = secretPath(agentId, dataRoot);
  await mkdir(join(dataRoot, "secrets"), { recursive: true });
  await encryptToFile(
    Buffer.from(JSON.stringify(payload), "utf8"),
    out,
    opts.identityPath ?? cfg.ageIdentityPath,
  );
  return out;
}

// Decrypt the per-agent secret file and parse it back to the env record.
// Used at the `starting` transition; the result is injected as container
// Env and never persisted.
export async function readSecret(
  agentId: string,
  opts: SecretFileOpts = {},
): Promise<Record<string, string>> {
  const dataRoot = opts.dataRoot ?? cfg.dataRoot;
  const buf = await decryptFile(
    secretPath(agentId, dataRoot),
    opts.identityPath ?? cfg.ageIdentityPath,
  );
  return JSON.parse(buf.toString("utf8")) as Record<string, string>;
}

// Remove the secret file on agent teardown. ENOENT is swallowed so cleanup
// is idempotent (the reverse-order rollback in §5 may run it twice).
export async function deleteSecret(
  agentId: string,
  opts: Pick<SecretFileOpts, "dataRoot"> = {},
): Promise<void> {
  const dataRoot = opts.dataRoot ?? cfg.dataRoot;
  await rm(secretPath(agentId, dataRoot), { force: true });
}

export type LlmProvider = "openrouter" | "anthropic";

// Provider -> the env var the Hermes image reads its LLM key from.
// anthropic uses the native ANTHROPIC_API_KEY; everything else routes
// through OpenRouter (spec §4).
function providerKeyName(provider: LlmProvider): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
}

export interface BuildAgentEnvOpts {
  secret: Record<string, string>;
  llmProvider: LlmProvider;
  personalityId?: string;
}

// Personality presets boot the same image with a different system prompt
// (and optionally a model override) injected purely via env.
function personalityEnv(personalityId: string | undefined): Record<string, string> {
  const preset = personalityId ? getPersonality(personalityId) : undefined;
  if (!preset) return {};
  const env: Record<string, string> = {
    HERMES_EPHEMERAL_SYSTEM_PROMPT: preset.systemPrompt,
  };
  if (preset.model) env.HERMES_MODEL = preset.model;
  return env;
}

// Assemble the full container Env for one agent: API server key + the
// provider's LLM key (both from the decrypted secret), the fixed
// API/dashboard flags, the default model, and optional personality env.
// Pure function — no Docker, no encryption — so the lifecycle can call it
// right after readSecret() at the `starting` transition (spec §4/§5).
export function buildAgentEnv(opts: BuildAgentEnvOpts): Record<string, string> {
  const keyName = providerKeyName(opts.llmProvider);
  const llmKey = opts.secret[keyName];
  if (!llmKey) {
    // Scrubbed: name the missing env var, never echo the secret contents.
    throw new Error(`secret is missing ${keyName} for provider ${opts.llmProvider}`);
  }

  const apiServerKey = opts.secret.API_SERVER_KEY;
  if (!apiServerKey) {
    throw new Error("secret is missing API_SERVER_KEY");
  }

  return {
    API_SERVER_KEY: apiServerKey,
    [keyName]: llmKey,
    API_SERVER_ENABLED: "true",
    API_SERVER_HOST: "0.0.0.0",
    HERMES_UID: "10000",
    // Pin a model that works with any OpenRouter key; the image default
    // (minimax) 404s without a data-policy toggle.
    HERMES_MODEL: cfg.defaultModel,
    HERMES_DASHBOARD: "1",
    // Bind to all interfaces inside the container so the published
    // loopback port is reachable; the host binding stays 127.0.0.1.
    HERMES_DASHBOARD_HOST: "0.0.0.0",
    HERMES_DASHBOARD_TUI: "1",
    // Dashboard's own OAuth is skipped; auth is enforced at Caddy (§5).
    HERMES_DASHBOARD_INSECURE: "1",
    // Spread last so a preset model override wins over the default.
    ...personalityEnv(opts.personalityId),
  };
}
