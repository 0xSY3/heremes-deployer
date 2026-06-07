// Thin wrapper around the `age` binary for encrypting per-agent secrets at
// rest. We shell out rather than binding a JS age library so the format
// stays interoperable with the stock `age` CLI operators already know.
//
// Requires `age` and `age-keygen` on PATH. See infra/install.sh.

import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

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
