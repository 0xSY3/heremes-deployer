"use client";

import { useState, useEffect } from "react";
import { StatusBadge } from "./StatusBadge";
import type { AgentView } from "./types";

type Action = "start" | "stop" | "restart";

// start/stop/restart only do anything when a deployer-worker is draining the
// shared queue (it owns Docker). On the Vercel-only topology there is no worker,
// so these would silently no-op — gate them behind an explicit flag and tell the
// user instead of showing dead buttons. Set NEXT_PUBLIC_WORKER_ENABLED=true once
// a worker is running against the same database.
const WORKER_ENABLED = process.env.NEXT_PUBLIC_WORKER_ENABLED === "true";

export function AgentCard({
  agent,
  onDelete,
  onUpdate,
  deleting,
}: {
  agent: AgentView;
  onDelete: (id: string) => void;
  onUpdate: (agent: AgentView) => void;
  deleting: boolean;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const running = agent.status === "running";
  const stopped = agent.status === "stopped";
  const unhealthy = agent.status === "unhealthy";

  async function control(action: Action) {
    setBusy(action);
    try {
      const res = await fetch(`/api/agents/${agent.id}/control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = (await res.json()) as { agent: { id: string; status: string } };
        onUpdate({
          ...agent,
          status: data.agent.status,
          ...(data.agent.status === "stopped" ? { hostUrl: null } : {}),
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex w-full h-full flex-col gap-6 py-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6 shrink-0">
        <div>
          <div className="flex items-center gap-4">
            <h3 className="font-display text-4xl tracking-tight text-foreground uppercase">
              {agent.name}
            </h3>
            <StatusBadge status={agent.status} />
          </div>
          <p className="mt-2 font-mono text-sm text-muted-2">ID: {agent.slug}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {WORKER_ENABLED && stopped && (
            <ActionButton label="Start" busyLabel="starting…" active={busy === "start"} disabled={!!busy} onClick={() => control("start")} primary />
          )}
          {WORKER_ENABLED && running && (
            <>
              <ActionButton label="Restart" busyLabel="restarting…" active={busy === "restart"} disabled={!!busy} onClick={() => control("restart")} />
              <ActionButton label="Stop" busyLabel="stopping…" active={busy === "stop"} disabled={!!busy} onClick={() => control("stop")} />
            </>
          )}
          
          <button
            onClick={() => onDelete(agent.id)}
            disabled={deleting || !!busy}
            title="Delete this agent"
            className="border border-red text-red px-4 py-2 font-mono text-xs uppercase tracking-widest transition hover:bg-red hover:text-white disabled:opacity-40"
          >
            {deleting ? "deleting…" : "Delete"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-3 shrink-0">
        {running && agent.hostUrl && (
          <div className="flex items-center gap-4 border border-foreground p-4">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-2 mb-1">Live Dashboard URL</p>
              <a href={agent.hostUrl} target="_blank" rel="noreferrer" className="block truncate font-mono text-sm text-foreground transition hover:text-accent-bright">
                {agent.hostUrl}
              </a>
            </div>
            <a
              href={agent.hostUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 border border-foreground px-5 py-2 text-xs font-mono font-bold uppercase text-foreground transition hover:bg-foreground hover:text-white"
            >
              Open ↗
            </a>
          </div>
        )}

        {stopped && (
          <div className="border border-foreground p-4">
            <p className="text-sm font-mono text-muted">
              {WORKER_ENABLED ? "Agent is stopped. Start it again to access the dashboard." : "Agent is stopped."}
            </p>
          </div>
        )}

        {unhealthy && (
          <div className="border border-red p-4">
            <p className="text-sm font-mono text-red">
              Agent health check failed or the container crashed. Please check the logs for details.
            </p>
          </div>
        )}

        {!WORKER_ENABLED && (running || stopped || unhealthy) && (
          <div className="border border-amber p-4">
            <p className="text-sm font-mono text-amber">
              Lifecycle controls need a running deployer-worker. Provisioning is unavailable here.
            </p>
          </div>
        )}
      </div>

      {(running || stopped || unhealthy) && (
        <TerminalLogs agentId={agent.id} />
      )}
    </div>
  );
}

function TerminalLogs({ agentId }: { agentId: string }) {
  const [logs, setLogs] = useState<string>("loading…");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/agents/${agentId}/logs`);
        const data = await res.json();
        if (!cancelled) setLogs(res.ok ? data.logs || "(no output yet)" : data.error || "could not read logs");
      } catch {
        if (!cancelled) setLogs("(network error reading logs)");
      }
    }
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [agentId]);

  return (
    <div className="mt-2 flex-1 border border-foreground overflow-hidden relative min-h-0 bg-transparent">
      <div className="flex items-center gap-2 mb-2 absolute top-4 left-4 z-10 pointer-events-none">
        <div className="h-2 w-2 rounded-full bg-foreground" />
        <div className="h-2 w-2 rounded-full bg-foreground/50" />
        <div className="h-2 w-2 rounded-full bg-foreground/20" />
        <span className="ml-2 text-[10px] font-mono tracking-widest uppercase text-muted-2">Terminal</span>
      </div>
      <pre className="absolute inset-0 pt-12 px-4 pb-4 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground scrollbar-hide">
        {logs}
      </pre>
    </div>
  );
}

function ActionButton({
  label,
  busyLabel,
  active,
  disabled,
  onClick,
  primary = false,
}: {
  label: string;
  busyLabel: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  const cls = primary
    ? "border border-foreground bg-foreground px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest text-white transition hover:bg-transparent hover:text-foreground disabled:opacity-40"
    : "border border-foreground bg-transparent px-4 py-2 text-xs font-mono font-bold uppercase tracking-widest text-foreground transition hover:bg-foreground hover:text-white disabled:opacity-40";
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {active ? busyLabel : label}
    </button>
  );
}
