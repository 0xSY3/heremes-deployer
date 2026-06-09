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
  const failedCount = agents.filter((agent) =>
    ["failed", "crashed", "unhealthy"].includes(agent.status),
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
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, status: "stopped", hostUrl: null } : a,
        ),
      );
    } finally {
      setDeleting(null);
    }
  }

  return (
    <main className="relative z-10 min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="rise flex flex-wrap items-center justify-between gap-4 rounded-xl border border-panel-edge bg-ink-2/70 px-5 py-3.5 backdrop-blur">
          <BrandMark sublabel="Hermes Deployer" />
          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-2 text-sm text-muted sm:flex">
              <span className="grid h-7 w-7 place-items-center rounded-full border border-panel-edge-2 bg-panel text-xs font-semibold text-accent-bright">
                {userName.slice(0, 1).toUpperCase()}
              </span>
              {userName}
            </span>
            <SignOutButton />
          </div>
        </nav>

        <section
          className="rise relative mt-6 overflow-hidden rounded-2xl border border-panel-edge bg-panel/70 backdrop-blur"
          style={{ animationDelay: "60ms" }}
        >
          <div className="grid gap-0 lg:grid-cols-[1.45fr_1fr]">
            <div className="p-6 sm:p-9 lg:p-11">
              <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent-bright">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-bright opacity-60" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-bright" />
                </span>
                One-click deployer
              </span>

              <h1 className="font-display display-fill mt-6 max-w-2xl text-5xl sm:text-[3.75rem]">
                Launch private Hermes agents from one clean control room
              </h1>

              <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted">
                Paste a provider key, start an isolated container, follow live deployment progress,
                and open the running dashboard without touching the server.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  onClick={() => setModalOpen(true)}
                  disabled={atLimit}
                  title={atLimit ? `Limit reached (${maxAgents} per account)` : undefined}
                  className="group inline-flex h-12 items-center gap-2 rounded-lg bg-accent px-6 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Deploy Hermes
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
                <SlotsMeter used={agents.length} max={maxAgents} />
              </div>

              {atLimit && agents.length > 0 && (
                <p className="mt-4 text-sm text-amber">
                  Limit reached. Clean up or stop an agent before creating another.
                </p>
              )}
              {actionError && <p className="mt-4 text-sm text-red">{actionError}</p>}
            </div>

            <aside className="border-t border-panel-edge bg-ink-2/50 p-6 sm:p-7 lg:border-l lg:border-t-0">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">
                Fleet status
              </p>
              <div className="flex flex-col gap-3">
                <Metric label="Running" value={runningCount} tone="green" detail="Ready to open" />
                <Metric label="Deploying" value={activeCount} tone="accent" detail="In progress" />
                <Metric label="Attention" value={failedCount} tone="red" detail="Needs review" />
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl uppercase tracking-wide text-parchment">Agents</h2>
              <p className="mt-1 text-sm text-muted">
                {agents.length === 0 ? "No deployments yet" : "Current deployments and controls"}
              </p>
            </div>
          </div>

          {agents.length === 0 ? (
            <div
              className="rise grid overflow-hidden rounded-2xl border border-panel-edge bg-panel/60 backdrop-blur lg:grid-cols-[1fr_1.1fr]"
              style={{ animationDelay: "120ms" }}
            >
              <div className="p-6 sm:p-9">
                <div className="grid h-12 w-12 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-2xl text-accent-bright">
                  ⚕
                </div>
                <h3 className="font-display mt-6 text-3xl uppercase tracking-wide text-parchment">
                  Deploy your first Hermes agent
                </h3>
                <p className="mt-3 max-w-lg text-sm leading-6 text-muted">
                  The deploy form is pre-filled with a valid agent name. Add your OpenRouter or
                  Anthropic key and the worker handles ports, secrets, container boot, health checks,
                  routes, and logs.
                </p>
                <button
                  onClick={() => setModalOpen(true)}
                  className="group mt-7 inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dim"
                >
                  Start deployment
                  <span className="transition-transform group-hover:translate-x-0.5">→</span>
                </button>
              </div>

              <div className="border-t border-panel-edge bg-ink-2/40 p-6 sm:p-7 lg:border-l lg:border-t-0">
                <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">
                  What the worker handles
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <FlowRow label="Queue" value="instant" />
                  <FlowRow label="Secrets" value="encrypted" />
                  <FlowRow label="Container" value="isolated" />
                  <FlowRow label="Dashboard" value="live URL" />
                  <FlowRow label="Health" value="checked" />
                  <FlowRow label="Logs" value="streamed" />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {agents.map((a, i) => (
                <div key={a.id} className="rise" style={{ animationDelay: `${i * 50}ms` }}>
                  <AgentCard
                    agent={a}
                    onDelete={onDelete}
                    onUpdate={onAgentUpdate}
                    deleting={deleting === a.id}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
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

function SlotsMeter({ used, max }: { used: number; max: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-5 rounded-full ${i < used ? "bg-accent-bright" : "bg-panel-edge-2"}`}
          />
        ))}
      </div>
      <span className="text-sm text-muted">
        {used}/{max} slots
      </span>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
  detail,
}: {
  label: string;
  value: number;
  tone: "green" | "accent" | "red";
  detail: string;
}) {
  const toneClass =
    tone === "green" ? "text-green" : tone === "red" ? "text-red" : "text-accent-bright";
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-panel-edge bg-panel-2/60 px-4 py-3.5 transition hover:border-panel-edge-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</p>
        <p className="mt-0.5 text-xs text-muted-2">{detail}</p>
      </div>
      <p className={`font-display text-3xl leading-none ${toneClass}`}>{value}</p>
    </div>
  );
}

function FlowRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-panel-edge bg-panel-2/50 px-4 py-3">
      <span className="text-sm font-medium text-parchment">{label}</span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-bright">
        {value}
      </span>
    </div>
  );
}
