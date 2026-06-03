import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getAgent } from "@/lib/provisioner";
import { mintConnectLink, telegramConfigured } from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { tenant } = await params;
  const agent = await getAgent(user.id, tenant);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!telegramConfigured()) {
    return NextResponse.json(
      { error: "Telegram isn't configured on the server yet." },
      { status: 503 },
    );
  }

  const link = mintConnectLink(agent.tenantId);
  return NextResponse.json({ url: link.url, expiresAt: link.expiresAt });
}
