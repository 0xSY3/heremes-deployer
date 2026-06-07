"use client";

import { useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { LogsModal } from "./LogsModal";
import type { AgentView } from "./types";

type Action = "start" | "stop" | "restart";

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
        onUpdate({ ...agent, status: data.agent.status });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`group relative flex flex-col justify-between rounded-lg border border-panel-edge bg-panel p-5 transition-all duration-300 hover:border-gold-dim ${
        running ? "glow-green" : ""
      }`}
    >
      <div>
        <div className="flex items-start justify-between">
          <h3 className="font-display text-xl leading-tight text-parchment">{agent.name}</h3>
          <span className="text-muted" title="Hermes agent">⚕</span>
        </div>
        <div className="mt-3">
          <StatusBadge status={agent.status} />
        </div>
        {running && agent.hostUrl && (
          <a
            href={agent.hostUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block truncate text-xs text-gold hover:underline"
          >
            {agent.hostUrl}
          </a>
        )}
        {stopped && (
          <p className="mt-3 text-[11px] text-muted">Stopped. Start it again to chat.</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {running && agent.hostUrl && (
          <a
            href={agent.hostUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-gold-dim px-3 py-1 text-xs uppercase tracking-wider text-gold transition-colors hover:bg-gold hover:text-ink"
          >
            Open ↗
          </a>
        )}
        {stopped && (
          <ActionButton label="Start" busyLabel="starting…" active={busy === "start"} disabled={!!busy} onClick={() => control("start")} />
        )}
        {running && (
          <>
            <ActionButton label="Restart" busyLabel="restarting…" active={busy === "restart"} disabled={!!busy} onClick={() => control("restart")} />
            <ActionButton label="Stop" busyLabel="stopping…" active={busy === "stop"} disabled={!!busy} onClick={() => control("stop")} />
          </>
        )}
        {(running || stopped) && (
          <button
            onClick={() => setLogsOpen(true)}
            className="rounded border border-panel-edge px-3 py-1 text-xs uppercase tracking-wider text-muted transition-colors hover:border-gold-dim hover:text-gold"
          >
            Logs
          </button>
        )}
        <button
          onClick={() => onDelete(agent.id)}
          disabled={deleting || !!busy}
          className="rounded border border-panel-edge px-3 py-1 text-xs uppercase tracking-wider text-muted transition-colors hover:border-red hover:text-red disabled:opacity-40"
        >
          {deleting ? "removing…" : "Delete"}
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
}: {
  label: string;
  busyLabel: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-panel-edge px-3 py-1 text-xs uppercase tracking-wider text-muted transition-colors hover:border-gold-dim hover:text-gold disabled:opacity-40"
    >
      {active ? busyLabel : label}
    </button>
  );
}
