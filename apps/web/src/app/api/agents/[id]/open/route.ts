import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mintWsToken } from "@/lib/ws-token";

// crypto (HMAC) needs the Node runtime, not edge.
export const runtime = "nodejs";

// Mirrors GATE_OPEN_PATH in the worker's dashboard-gate.ts — the wire contract
// for the owner-token → cookie exchange the worker serves on each agent host.
const GATE_OPEN_PATH = "/__hermes_gate";

// Short-lived: the token only has to survive the redirect to the agent host,
// where the worker swaps it for a longer-lived cookie.
const OPEN_TOKEN_TTL_SEC = 300;

// Owner-only entry point to a private dashboard. Verifies the caller owns the
// agent, mints a token bound to this agent, and 302s to the agent host's gate
// (which sets the access cookie). The dashboard URL itself is never directly
// linkable — opening it without a fresh owner token is blocked by Caddy.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const agent = await prisma.agent.findFirst({
    where: { id, userId: user.id },
    select: { id: true, hostUrl: true, status: true },
  });
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!agent.hostUrl) {
    return NextResponse.json({ error: "agent has no dashboard yet" }, { status: 409 });
  }

  const token = mintWsToken(agent.id, user.id, OPEN_TOKEN_TTL_SEC);
  const target = new URL(GATE_OPEN_PATH, agent.hostUrl);
  target.searchParams.set("token", token);
  return NextResponse.redirect(target.toString(), { status: 302 });
}
