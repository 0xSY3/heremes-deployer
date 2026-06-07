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
  decryptFile,
  encryptToFile,
  readIdentity,
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
