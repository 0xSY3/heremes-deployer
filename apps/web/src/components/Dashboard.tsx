"use client";

import { useEffect, useRef, useState } from "react";
import { AgentCard } from "./AgentCard";
import { BrandMark } from "./BrandMark";
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
  const [actionError, setActionError] = useState<string | null>(null);
  const atLimit = agents.length >= maxAgents;
  const runningCount = agents.filter((agent) => agent.status === "running").length;
  const activeCount = agents.filter((agent) =>
    ["queued", "allocating_ports", "starting", "health_checking", "registering_route"].includes(agent.status),
  ).length;

  // Ref lets the stable polling interval read the latest list without being a
  // dependency, which would re-subscribe every render.
  const agentsRef = useRef(agents);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  // Poll live status while any agent exists, catching both provisioning→running
  // and later crashes; interval stays stable by reading the freshest list via ref.
  // GET /api/agents/[id] returns { agent: { id, name, slug, status, hostUrl, ... } };
  // merge the live status/hostUrl into the card's existing AgentView.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      const current = agentsRef.current;
      if (current.length === 0) return;
      const updated = await Promise.all(
        current.map(async (a) => {
          try {
            const res = await fetch(`/api/agents/${a.id}`);
            if (!res.ok) return a;
            const { agent } = (await res.json()) as {
              agent: { status: string; hostUrl: string | null };
            };
            return { ...a, status: agent.status, hostUrl: agent.hostUrl };
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
  // Prisma-shaped AgentView rows ({id, name, slug, status, hostUrl, ...}); map
  // straight through to the cards.
  async function refreshAgents() {
    const res = await fetch("/api/agents");
    if (!res.ok) return;
    const { agents: rows } = (await res.json()) as {
      agents: Array<{
        id: string;
        name: string;
        slug: string;
        status: string;
        hostUrl: string | null;
        personalityId?: string;
        createdAt: string;
      }>;
    };
    setAgents(
      rows.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        status: a.status,
        hostUrl: a.hostUrl,
        ...(a.personalityId ? { personalityId: a.personalityId } : {}),
        createdAt: a.createdAt,
      })),
    );
  }

  function onAgentUpdate(updated: AgentView) {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function onDelete(id: string) {
    setDeleting(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(data.error ?? "Could not clean up that agent.");
        return;
      }
      // Remove the card immediately — the worker drains the `deleting` row and
      // deletes it, so the next full refresh won't bring it back. (The per-agent
      // status poll only updates existing cards, never re-adds a filtered one.)
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="relative z-10 flex h-screen w-full flex-col overflow-hidden bg-ink text-parchment">
      {/* Subtle ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-accent/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-6 lg:px-8 relative z-10">
        <nav className="flex items-center justify-between mb-8 shrink-0">
          <BrandMark sublabel="by Zynd" />
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 pr-4 border-r border-panel-edge">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white">
                {userName.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-sm font-medium text-white/80">{userName}</span>
            </div>
            <SignOutButton />
          </div>
        </nav>

        {/* Main Content Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Header & Metrics row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 mb-8 shrink-0">
            <div>
              <h1 className="font-display text-4xl uppercase tracking-wider text-white">Hermes Deployer</h1>
              <p className="text-sm text-muted-2 mt-1">Manage your private AI agents and deployments.</p>
            </div>
            
            <div className="flex items-center gap-6 rounded-lg border border-white/5 bg-white/5 px-5 py-2.5">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green" />
                <span className="text-sm font-medium text-white">{runningCount} <span className="text-muted-2">Active</span></span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-accent-bright" />
                <span className="text-sm font-medium text-white">{activeCount} <span className="text-muted-2">Transit</span></span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-white/20" />
                <span className="text-sm font-medium text-white">{agents.length}/{maxAgents} <span className="text-muted-2">Slots</span></span>
              </div>
            </div>
          </div>

          {actionError && (
            <div className="mb-6 shrink-0 inline-flex items-center gap-3 rounded-full bg-red/10 border border-red/20 px-4 py-2 text-sm text-red font-medium">
              {actionError}
            </div>
          )}

          {/* Agents List Area */}
          <div className="flex-1 flex flex-col min-h-0 pb-8">
            {agents.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center rounded-2xl border border-panel-edge border-dashed bg-panel-2/20">
                <h3 className="font-display text-2xl uppercase tracking-wide text-white mb-2">No Deployments Found</h3>
                <p className="max-w-sm text-sm text-muted-2 mb-8">
                  Connect your API keys to spin up a secure, containerized Hermes agent instantly.
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="inline-flex h-12 items-center justify-center gap-3 rounded-full bg-white px-8 text-sm font-bold text-ink transition-all hover:bg-gray hover:scale-[1.02]"
                >
                  Start First Deployment
                </button>
              </div>
            ) : (
              <div className="flex flex-col h-full gap-4">
                <div className="flex items-center justify-between mb-2 shrink-0">
                  <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-muted-2">Your Fleet</h2>
                  {!atLimit && (
                    <button
                      onClick={() => setModalOpen(true)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-panel-2 border border-panel-edge px-5 text-xs font-bold text-white transition-all hover:bg-panel"
                    >
                      + Deploy New
                    </button>
                  )}
                </div>
                <div className="flex flex-col flex-1 min-h-0 mt-4">
                  {agents.map((a) => (
                    <AgentCard key={a.id} agent={a} onDelete={onDelete} onUpdate={onAgentUpdate} deleting={deleting === a.id} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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


