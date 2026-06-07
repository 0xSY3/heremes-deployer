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

  // Intent write only — the worker sweeps the container, route, and ports.
  // The API never touches the Docker socket (single-writer rule, spec §1).
  await prisma.agent.update({
    where: { id },
    data: { status: "stopped", stoppedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
