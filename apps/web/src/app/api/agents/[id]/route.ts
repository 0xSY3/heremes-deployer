import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  errorMessage: true,
  hostUrl: true,
  llmProvider: true,
  personalityId: true,
  createdAt: true,
  startedAt: true,
} as const;

async function ownedOr404(userId: string, id: string) {
  // Owner-scoped lookup: a non-owner gets `null` → 404, so the route never
  // reveals that another user's agent exists (no 403 existence leak).
  return prisma.agent.findFirst({ where: { id, userId }, select: DETAIL_SELECT });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const agent = await ownedOr404(user.id, id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const agent = await ownedOr404(user.id, id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Does a live container exist? Only the worker may tear that down (it owns the
  // Docker socket — single-writer rule), so we mark `deleting` and let
  // drainDeletes sweep the container/route/ports, then delete the row.
  const live = await prisma.agent.findUnique({
    where: { id },
    select: { containerId: true },
  });

  if (live?.containerId) {
    await prisma.agent.update({
      where: { id },
      data: { status: "deleting", stoppedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  // No container (never started, already stopped, or the split Vercel/no-worker
  // topology): nothing to tear down, so delete the row now instead of leaving it
  // wedged at `deleting` forever. AgentLog cascades (schema onDelete: Cascade);
  // PortAllocation + AgentMetric have no FK, so purge them explicitly to avoid
  // leaking the port source-of-truth rows.
  await prisma.$transaction([
    prisma.portAllocation.deleteMany({ where: { agentId: id } }),
    prisma.agentMetric.deleteMany({ where: { agentId: id } }),
    prisma.agent.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
