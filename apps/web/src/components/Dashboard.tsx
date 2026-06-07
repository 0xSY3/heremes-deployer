"use client";

import { useEffect, useRef, useState } from "react";
import { AgentCard } from "./AgentCard";
import { CreateAgentModal } from "./CreateAgentModal";
import { SignOutButton } from "./SignOutButton";
import type { AgentView } from "./types";

export function Dashboard({
  initialAgents,
  userName,
  maxAgents,
}: {
  initialAgents: AgentView[];
  userName: string;
  maxAgents: number;
}) {
  const [agents, setAgents] = useState<AgentView[]>(initialAgents);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const atLimit = agents.length >= maxAgents;

  // Ref lets the stable polling interval read the latest list without being a
  // dependency, which would re-subscribe every render.
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  // Poll live status while any agent exists, catching both provisioning→running
  // and later crashes; interval stays stable by reading the freshest list via ref.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      const current = agentsRef.current;
      if (current.length === 0) return;
      const updated = await Promise.all(
        current.map(async (a) => {
          try {
            const res = await fetch(`/api/agents/${a.tenantId}`);
            if (!res.ok) return a;
            const data = await res.json();
            return data.agent as AgentView;
          } catch {
            return a;
          }
        }),
      );
      if (!cancelled) setAgents(updated);
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // The modal hands off to the live deploy view and signals completion with no
  // payload, so refresh the list from the API. GET /api/agents returns the
  // Prisma shape ({id, slug, hostUrl, ...}); map it to the AgentView the cards
  // render (id→tenantId, hostUrl→url) so page.tsx/AgentCard stay unchanged.
  async function refreshAgents() {
    const res = await fetch("/api/agents");
    if (!res.ok) return;
    const { agents: rows } = (await res.json()) as {
      agents: Array<{
        id: string;
        name: string;
        status: string;
        hostUrl: string | null;
        personalityId: string | null;
        createdAt: string;
      }>;
    };
    setAgents(
      rows.map((a) => ({
        tenantId: a.id,
        name: a.name,
        url: a.hostUrl ?? "",
        status: a.status,
        channel: "web",
        ...(a.personalityId ? { personalityId: a.personalityId } : {}),
        createdAt: a.createdAt,
      })),
    );
  }

  function onAgentUpdate(updated: AgentView) {
    setAgents((prev) => prev.map((a) => (a.tenantId === updated.tenantId ? updated : a)));
  }

  async function onDelete(tenantId: string) {
    setDeleting(tenantId);
    try {
      await fetch(`/api/agents/${tenantId}`, { method: "DELETE" });
      setAgents((prev) => prev.filter((a) => a.tenantId !== tenantId));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="relative z-10 mx-auto max-w-5xl px-6 py-12">
      <header className="rise flex items-end justify-between border-b border-panel-edge pb-6">
        <div>
          <div className="flex items-center gap-2 text-gold">
            <span className="text-2xl">⚕</span>
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-gold-dim">Hermes</span>
          </div>
          <h1 className="mt-3 font-display text-4xl text-parchment">Your agents</h1>
          <div className="mt-1 flex items-center gap-3">
            <p className="text-sm text-muted">Signed in as {userName}</p>
            <span className="text-panel-edge">·</span>
            <SignOutButton />
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={atLimit}
          title={atLimit ? `Limit reached (${maxAgents} per account)` : undefined}
          className="rounded bg-gold px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Create Agent
        </button>
      </header>

      {atLimit && agents.length > 0 && (
        <p className="rise mt-4 text-xs text-muted">
          You&apos;ve reached your free limit of {maxAgents} agent{maxAgents === 1 ? "" : "s"}. Delete one to create another.
        </p>
      )}

      {agents.length === 0 ? (
        <div className="rise mt-24 flex flex-col items-center text-center" style={{ animationDelay: "80ms" }}>
          <div className="font-display text-6xl text-panel-edge">⚕</div>
          <h2 className="mt-6 font-display text-2xl text-parchment">No agents yet</h2>
          <p className="mt-2 max-w-sm text-sm text-muted">
            One click and a private Hermes agent boots in its own container — running in about 30 seconds.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-8 rounded bg-gold px-6 py-3 text-xs font-bold uppercase tracking-wider text-ink transition-opacity hover:opacity-90"
          >
            Create your first agent →
          </button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((a, i) => (
            <div key={a.tenantId} className="rise" style={{ animationDelay: `${i * 50}ms` }}>
              <AgentCard
                agent={a}
                onDelete={onDelete}
                onUpdate={onAgentUpdate}
                deleting={deleting === a.tenantId}
              />
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <CreateAgentModal
          onClose={() => setModalOpen(false)}
          onFinished={() => {
            setModalOpen(false);
            void refreshAgents();
          }}
        />
      )}
    </main>
  );
}
