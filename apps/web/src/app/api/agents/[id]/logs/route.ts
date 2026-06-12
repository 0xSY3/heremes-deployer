import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  // Owner check first — 404 (not 403) so we don't leak which ids exist.
  const agent = await prisma.agent.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Last 500 lines, oldest-first for natural reading order.
  const rows = await prisma.agentLog.findMany({
    where: { agentId: id },
    orderBy: { lineNo: "desc" },
    take: 500,
    select: { lineNo: true, text: true, stream: true, ts: true },
  });
  const entries = rows.reverse().map((r) => ({
    lineNo: r.lineNo,
    text: r.text,
    stream: r.stream,
    ts: r.ts.toISOString(),
  }));
  const logs = entries.map((r) => r.text).join("\n");
  return NextResponse.json({ entries, logs });
}
