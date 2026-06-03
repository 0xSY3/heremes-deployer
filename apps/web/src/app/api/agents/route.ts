import { NextResponse } from "next/server";
import { DockerUnavailableError, PortUnavailableError } from "@hermes/provisioner";
import { getCurrentUser } from "@/lib/auth";
import { createAgentSchema } from "@/lib/validation";
import { createAgent, listAgents } from "@/lib/provisioner";
import { listForUser, getOwned, putOwned, deleteOwned, type OwnedAgent } from "@/lib/store";
import { MAX_AGENTS_PER_USER } from "@/lib/limits";
import { withLock } from "@/lib/mutex";

// Local provisioning spawns Docker via child_process — requires the Node runtime.
export const runtime = "nodejs";

// Defensively strip the LLM key before returning, even though records never hold it.
function safe(a: OwnedAgent): Omit<OwnedAgent, "llmKey"> {
  const clone: Record<string, unknown> = { ...a };
  delete clone.llmKey;
  return clone as Omit<OwnedAgent, "llmKey">;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const agents = await listAgents(user.id);
  return NextResponse.json({ agents: agents.map(safe) });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createAgentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid input" },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const tenantId = `${user.id}-${body.name}`;

  // Per-user lock makes cap-check + placeholder write one critical section, so
  // concurrent POSTs can't both pass the cap, and in-flight agents count toward it.
  const reservation = await withLock(`create:${user.id}`, async () => {
    if (await getOwned(user.id, tenantId)) return { error: "an agent with that name already exists", status: 409 as const };
    if ((await listForUser(user.id)).length >= MAX_AGENTS_PER_USER) {
      return { error: `agent limit reached (${MAX_AGENTS_PER_USER} per account)`, status: 409 as const };
    }
    await putOwned({
      tenantId, userId: user.id, name: body.name, channel: "web",
      url: "", status: "provisioning", createdAt: new Date().toISOString(),
    });
    return { ok: true as const };
  });
  if ("error" in reservation) {
    return NextResponse.json({ error: reservation.error }, { status: reservation.status });
  }

  try {
    const agent = await createAgent(user.id, body);
    return NextResponse.json({ agent: safe(agent) }, { status: 201 });
  } catch (err) {
    // Free the reserved slot so a retry isn't blocked by a dead placeholder.
    await deleteOwned(tenantId);

    // Preflight error carries no argv/secret, so its message is safe to surface.
    if (err instanceof DockerUnavailableError) {
      console.error("agent provision blocked:", err.message);
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    // Carries only a port hint (no argv/secret), so safe to surface.
    if (err instanceof PortUnavailableError) {
      console.error("agent provision port conflict:", err.message);
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    // Never echo raw errors: a failed docker run can carry the user's LLM key.
    console.error("agent provision failed:", err);
    return NextResponse.json(
      { error: "Provisioning failed. Check that Docker is running and try again." },
      { status: 500 },
    );
  }
}
