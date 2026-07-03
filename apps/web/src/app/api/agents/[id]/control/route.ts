import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ownerWhere, healOwnership } from "@/lib/ownership";

export const runtime = "nodejs";

const ACTIONS = ["start", "stop", "restart"] as const;
type Action = (typeof ACTIONS)[number];

// Map a control action to the intent status the worker drains. start/restart
// re-enter the deploy queue; stop marks the row for sweep. The worker is the
// single writer that actually moves the container — the API only sets intent.
const ACTION_TO_STATUS: Record<Action, string> = {
  start: "queued",
  restart: "queued",
  stop: "stopped",
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (!body.action || !ACTIONS.includes(body.action as Action)) {
    return NextResponse.json({ error: "action must be start, stop, or restart" }, { status: 400 });
  }

  const agent = await prisma.agent.findFirst({
    where: { id, ...ownerWhere(user) },
    select: { id: true, userId: true },
  });
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (agent.userId !== user.id) await healOwnership(user, agent.id);

  const action = body.action as Action;
  const updated = await prisma.agent.update({
    where: { id },
    data: { status: ACTION_TO_STATUS[action] },
    select: { id: true, status: true },
  });
  return NextResponse.json({ agent: updated });
}
