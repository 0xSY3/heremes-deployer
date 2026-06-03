import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAgent, removeAgent, controlAgent, AgentNotFoundError } from "@/lib/provisioner";

export const runtime = "nodejs";

const ACTIONS = ["start", "stop", "restart"] as const;
type Action = (typeof ACTIONS)[number];

export async function PATCH(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tenant } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (!body.action || !ACTIONS.includes(body.action as Action)) {
    return NextResponse.json({ error: "action must be start, stop, or restart" }, { status: 400 });
  }
  try {
    const agent = await controlAgent(user.id, tenant, body.action as Action);
    return NextResponse.json({ agent });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    console.error(`agent ${body.action} failed:`, err);
    return NextResponse.json({ error: `Could not ${body.action} the agent.` }, { status: 500 });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tenant } = await params;
  const agent = await getAgent(user.id, tenant);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tenant } = await params;
  try {
    await removeAgent(user.id, tenant);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Distinguish 404 (not owned/missing) from 500 (teardown failed, record kept):
    // collapsing both to 404 hides orphaned containers behind "not found".
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    console.error("agent teardown failed:", err);
    return NextResponse.json(
      { error: "Teardown failed. The agent may still be running; check Docker and retry." },
      { status: 500 },
    );
  }
}
