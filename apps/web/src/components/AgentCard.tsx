"use client";

import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { LogsModal } from "./LogsModal";
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
  const [logsOpen, setLogsOpen] = useState(false);
  const running = agent.status === "running";
  const stopped = agent.status === "stopped";

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
    <div
      className={`group relative flex min-h-56 flex-col justify-between overflow-hidden rounded-2xl border border-panel-edge bg-panel/80 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/45 ${
        running ? "glow-live" : ""
      }`}
    >
      {/* Accent top hairline lights up on hover, like the zynd cards. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-accent/0 to-transparent transition group-hover:via-accent/60" />

      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display truncate text-lg leading-tight text-parchment">
              {agent.name}
            </h3>
            <p className="mt-1 truncate font-mono text-xs text-muted">{agent.slug}</p>
          </div>
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-base text-accent-bright"
            title="Hermes agent"
          >
            ⚕
          </span>
        </div>

        <div className="mt-3">
          <StatusBadge status={agent.status} />
        </div>

        {running && agent.hostUrl && (
          <a
            href={agent.hostUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 block truncate rounded-lg border border-panel-edge bg-ink-2 px-3 py-2 font-mono text-xs text-accent-bright transition hover:border-accent/45"
          >
            {agent.hostUrl}
          </a>
        )}
        {stopped && (
          <p className="mt-4 rounded-lg border border-panel-edge bg-ink-2 px-3 py-2 text-sm text-muted">
            {WORKER_ENABLED ? "Stopped. Start it again to chat." : "Stopped."}
          </p>
        )}
        {!WORKER_ENABLED && (running || stopped) && (
          <p className="mt-3 rounded-lg border border-amber/25 bg-amber/10 px-3 py-2 text-xs leading-5 text-amber">
            Lifecycle controls need a running deployer-worker. Provisioning is unavailable here.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-panel-edge pt-4">
        {running && agent.hostUrl && (
          <a
            href={agent.hostUrl}
            target="_blank"
            rel="noreferrer"
            className="group/open inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-accent/30 transition hover:bg-accent-dim"
          >
            Open
            <span className="transition-transform group-hover/open:translate-x-0.5">↗</span>
          </a>
        )}
        {WORKER_ENABLED && stopped && (
          <ActionButton label="Start" busyLabel="starting…" active={busy === "start"} disabled={!!busy} onClick={() => control("start")} primary />
        )}
        {WORKER_ENABLED && running && (
          <>
            <ActionButton label="Restart" busyLabel="restarting…" active={busy === "restart"} disabled={!!busy} onClick={() => control("restart")} />
            <ActionButton label="Stop" busyLabel="stopping…" active={busy === "stop"} disabled={!!busy} onClick={() => control("stop")} />
          </>
        )}
        {(running || stopped) && (
          <button
            onClick={() => setLogsOpen(true)}
            className="rounded-lg border border-panel-edge-2 bg-panel-2 px-3 py-2 text-xs font-medium text-parchment transition-colors hover:border-accent/50 hover:text-accent-bright"
          >
            Logs
          </button>
        )}
        <button
          onClick={() => onDelete(agent.id)}
          disabled={deleting || !!busy}
          title="Delete this agent"
          className="ml-auto rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-xs font-medium text-red/90 transition-colors hover:border-red/60 hover:bg-red/15 hover:text-red disabled:opacity-40"
        >
          {deleting ? "deleting…" : "Delete"}
        </button>
      </div>

      {logsOpen && <LogsModal agentId={agent.id} name={agent.name} onClose={() => setLogsOpen(false)} />}
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
    ? "rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-accent/30 transition hover:bg-accent-dim disabled:opacity-40"
    : "rounded-lg border border-panel-edge-2 bg-panel-2 px-3 py-2 text-xs font-medium text-parchment transition-colors hover:border-accent/50 hover:text-accent-bright disabled:opacity-40";
  return (
    <button onClick={onClick} disabled={disabled} className={cls}>
      {active ? busyLabel : label}
    </button>
  );
}
