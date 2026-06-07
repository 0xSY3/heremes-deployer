// Thin wrapper around the `age` binary for encrypting per-agent secrets at
// rest. We shell out rather than binding a JS age library so the format
// stays interoperable with the stock `age` CLI operators already know.
//
// Requires `age` and `age-keygen` on PATH. See infra/install.sh.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

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
