// Worker WebSocket server for the live deploy view (spec §2).
//
// Path:  /v1/agents/<agentId>/deploy?token=<short-lived owner token>
// Frames (JSON, type-tagged): hello | step | log | ready | done | error
//
// Independent of Next.js for the same reason as the zynd logs server: App
// Router route handlers can't upgrade a request to a WebSocket. Differs from
// zynd's open logs socket in two ways (spec §5): the upgrade is gated on an
// owner token, and on connect we backfill the step ring + DB status so a
// reconnect mid-deploy lands on the right checklist step.

import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import { prisma } from "./db.js";
import { config } from "./config.js";
import { verifyToken } from "./ws-auth.js";
import { subscribe, snapshotSteps, type Frame } from "./events.js";

// The deploy socket sends the events.ts Frame union plus a `hello` handshake
// frame that only the WS layer emits.
export type DeployFrame = Frame | { type: "hello"; agentId: string; status: string };

const PING_MS = 25_000;

// Terminal statuses end a deploy session: the worker sends `done` and closes.
// `running` is the success terminal but stays OPEN (logs keep streaming) — it
// is deliberately NOT in this set.
const TERMINAL_STATUSES = ["failed", "stopped", "crashed"] as const;

export interface DeployPath {
  agentId: string;
  token: string;
}

export function parseDeployPath(url: string | undefined): DeployPath | null {
  if (!url) return null;
  const u = new URL(url, "http://placeholder");
  // Expect exactly /v1/agents/<agentId>/deploy
  const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 4) return null;
  if (parts[0] !== "v1" || parts[1] !== "agents" || parts[3] !== "deploy") return null;
  const agentId = decodeURIComponent(parts[2] ?? "");
  if (!agentId) return null;
  const token = u.searchParams.get("token");
  if (!token) return null;
  return { agentId, token };
}

export function buildHello(agentId: string, status: string): DeployFrame {
  return { type: "hello", agentId, status };
}

// Placeholder kept so bin/main.ts keeps compiling between this commit and the
// next; the real token-gated server (Task 88) replaces this whole block.
export function startWsServer(): Promise<null> {
  return Promise.resolve(null);
}
