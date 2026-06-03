import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAgents } from "@/lib/provisioner";
import { MAX_AGENTS_PER_USER } from "@/lib/limits";
import { Dashboard } from "@/components/Dashboard";
import type { AgentView } from "@/components/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Live status reconciled (a crashed container shows "stopped", not "running").
  const agents: AgentView[] = (await listAgents(user.id)).map((a) => ({
    tenantId: a.tenantId,
    name: a.name,
    url: a.url,
    status: a.status,
    channel: a.channel,
    ...(a.personalityId ? { personalityId: a.personalityId } : {}),
    createdAt: a.createdAt,
  }));

  return <Dashboard initialAgents={agents} userName={user.name} maxAgents={MAX_AGENTS_PER_USER} />;
}
