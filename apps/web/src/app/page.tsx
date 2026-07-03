import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ownerWhere, healStale } from "@/lib/ownership";
import { MAX_AGENTS_PER_USER } from "@/lib/limits";
import { Dashboard } from "@/components/Dashboard";
import type { AgentView } from "@/components/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await prisma.agent.findMany({
    where: ownerWhere(user),
    orderBy: { createdAt: "desc" },
    select: { id: true, userId: true, name: true, slug: true, status: true, hostUrl: true, personalityId: true, createdAt: true },
  });
  await healStale(user, rows);
  const agents: AgentView[] = rows.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    status: a.status,
    hostUrl: a.hostUrl,
    ...(a.personalityId ? { personalityId: a.personalityId } : {}),
    createdAt: a.createdAt.toISOString(),
  }));

  return <Dashboard initialAgents={agents} userName={user.name} maxAgents={MAX_AGENTS_PER_USER} />;
}
