// DB-backed per-agent secret store. Replaces the age/disk design (secrets.ts)
// for the split web/worker deployment: the Vercel API (writer) and the worker
// (reader) live on different machines, so a shared disk + the `age` binary is
// not an option. Both already share Postgres, so the encrypted secret rides on
// the Agent row instead.
//
// Crypto: AES-256-GCM via Node's built-in crypto (no external binary). The key
// comes from SECRET_ENC_KEY (32 bytes, base64). Each write uses a fresh random
// 12-byte IV; the stored blob is base64(iv ‖ authTag ‖ ciphertext). GCM's auth
// tag detects tampering on read.

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

import { prisma } from "./db";

const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM auth tag length
const KEY_BYTES = 32; // AES-256

// Resolve and validate the encryption key at call time (not module load) so an
// unrelated import of this module doesn't crash a process that never encrypts.
function encryptionKey(): Buffer {
  const raw = process.env.SECRET_ENC_KEY;
  if (!raw) {
    throw new Error(
      "SECRET_ENC_KEY is not set — required to encrypt agent secrets. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `SECRET_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}); ` +
        "it should be base64 of 32 random bytes.",
    );
  }
  return key;
}

// base64( iv ‖ authTag ‖ ciphertext ). Self-contained: the IV and tag travel
// with the ciphertext so readSecret needs only the key.
function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// 24 random bytes -> 48 hex chars. Used as API_SERVER_KEY in the per-agent
// secret; rotated only by recreating the agent.
export function generateApiKey(): string {
  return randomBytes(24).toString("hex");
}

// Encrypt the agent's secret env ({API_SERVER_KEY, <LLM key>}) and persist the
// ciphertext to Agent.secretBlob. The raw key never lands in plaintext on the
// row. Returns a stable ref string for Agent.secretRef (back-compat: callers
// store it, but the worker reads the blob, not the ref).
export async function writeSecret(
  agentId: string,
  payload: Record<string, string>,
): Promise<string> {
  const blob = encrypt(JSON.stringify(payload));
  await prisma.agent.update({
    where: { id: agentId },
    data: { secretBlob: blob },
  });
  return `db:${agentId}`;
}

// Load + decrypt the agent's secret blob. Used at the `starting` transition;
// the result is injected as container Env and never re-persisted.
export async function readSecret(
  agentId: string,
): Promise<Record<string, string>> {
  const row = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { secretBlob: true },
  });
  if (!row?.secretBlob) {
    throw new Error(`agent ${agentId} has no secretBlob — cannot start`);
  }
  return JSON.parse(decrypt(row.secretBlob)) as Record<string, string>;
}

// Clear the secret on teardown. Idempotent: updating an already-null blob (or a
// row the cascade may have removed) is a no-op we swallow.
export async function deleteSecret(agentId: string): Promise<void> {
  await prisma.agent
    .update({ where: { id: agentId }, data: { secretBlob: null } })
    .catch(() => undefined);
}
