import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { agentLogs, AgentNotFoundError } from "@/lib/provisioner";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { tenant } = await params;
  try {
    const logs = await agentLogs(user.id, tenant);
    return NextResponse.json({ logs });
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    console.error("agent logs failed:", err);
    return NextResponse.json({ error: "Could not read logs." }, { status: 500 });
  }
}
