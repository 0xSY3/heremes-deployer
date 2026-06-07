// Short-lived owner tokens for the deploy WebSocket (spec §5, decision 2).
//
// Token format:  b64url(payload) "." b64url(HMAC_SHA256(payload, secret))
//   payload = `${agentId}.${exp}.${userId}`   (exp = unix seconds)
//
// The signature covers agentId, so a token minted for one agent cannot be
// replayed against another. exp bounds the blast radius of a leaked token.
// Verification uses timingSafeEqual to avoid leaking the MAC byte-by-byte.

import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "agent_mismatch" };

// SECURITY: a missing or weak HMAC secret is fail-OPEN — an empty/guessable key
// lets anyone forge a valid token (they can compute HMAC(payload, "") locally)
// and open another user's deploy socket. We refuse to mint or verify unless the
// secret is present and long enough to resist brute force. 32 bytes matches the
// 256-bit HMAC-SHA256 block; shorter is treated as unconfigured.
const MIN_SECRET_LEN = 32;

function secretUsable(): boolean {
  return config.wsSecret.length >= MIN_SECRET_LEN;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", config.wsSecret).update(payload).digest("base64url");
}

export function mintToken(agentId: string, userId: string, ttlSec: number): string {
  // Fail closed at the source: a worker/API with no real secret must not hand
  // out tokens that would later "verify" against the same empty key.
  if (!secretUsable()) {
    throw new Error(
      `Refusing to mint a deploy-WS token: DEPLOYER_WS_SECRET is unset or shorter than ${MIN_SECRET_LEN} chars`,
    );
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  // agentId/userId carry no dots in cuid/Google-sub ids; the payload parser
  // splits on the FIRST two dots, so a userId with dots would still round-trip.
  const payload = `${agentId}.${exp}.${userId}`;
  return `${b64url(payload)}.${sign(payload)}`;
}

export function verifyToken(token: string, expectedAgentId: string): VerifyResult {
  // SECURITY: fail closed when the secret is unusable. Without this, an empty
  // key would make every forged token verify (auth bypass of the deploy socket).
  if (!secretUsable()) return { ok: false, reason: "bad_signature" };

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };

  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "malformed" };
  }

  // payload = agentId "." exp "." userId  — split on first two dots only.
  const firstDot = payload.indexOf(".");
  const secondDot = payload.indexOf(".", firstDot + 1);
  if (firstDot <= 0 || secondDot <= firstDot) return { ok: false, reason: "malformed" };

  const agentId = payload.slice(0, firstDot);
  const expRaw = payload.slice(firstDot + 1, secondDot);
  const userId = payload.slice(secondDot + 1);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !userId) return { ok: false, reason: "malformed" };

  // Constant-time signature check before any other decision so a forged token
  // can't probe the expiry/agent branches.
  const expectedSig = Buffer.from(sign(payload), "utf8");
  const gotSig = Buffer.from(sigB64, "utf8");
  if (expectedSig.length !== gotSig.length || !timingSafeEqual(expectedSig, gotSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, reason: "expired" };
  if (agentId !== expectedAgentId) return { ok: false, reason: "agent_mismatch" };

  return { ok: true, userId };
}
