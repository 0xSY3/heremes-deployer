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
  onDelete: (tenantId: string) => void;
  onUpdate: (agent: AgentView) => void;
  deleting: boolean;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [tgBusy, setTgBusy] = useState(false);
  const [tgNote, setTgNote] = useState<string | null>(null);
  const running = agent.status === "running";
  const stopped = agent.status === "stopped";

  async function control(action: Action) {
    setBusy(action);
    try {
      const res = await fetch(`/api/agents/${agent.tenantId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdate(data.agent as AgentView);
      }
    } finally {
      setBusy(null);
    }
  }

  async function connectTelegram() {
    setTgBusy(true);
    setTgNote(null);
    try {
      const res = await fetch(`/api/agents/${agent.tenantId}/telegram`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setTgNote(data.error ?? "Could not create a connect link.");
        return;
      }
      window.open(data.url as string, "_blank", "noopener,noreferrer");
      setTgNote("Opened Telegram — tap Start to finish connecting.");
    } catch {
      setTgNote("Network error creating the connect link.");
    } finally {
      setTgBusy(false);
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
        {agent.status === "provisioning" && (
          <p className="mt-3 text-xs text-muted breathe">booting container… (~30s)</p>
        )}
        {running && (
          <>
            <a
              href={agent.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block truncate text-xs text-gold hover:underline"
            >
              {agent.url}
            </a>
            <p className="mt-1 text-[11px] text-muted">
              Open → <span className="text-parchment">Chat</span> tab for web chat, or{" "}
              <span className="text-parchment">Connect Telegram</span> to message it from Telegram.
            </p>
          </>
        )}
        {stopped && (
          <p className="mt-3 text-[11px] text-muted">Stopped. Start it again to chat.</p>
        )}
        {tgNote && <p className="mt-2 text-[11px] text-gold">{tgNote}</p>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {running && (
          <button
            onClick={connectTelegram}
            disabled={tgBusy}
            className="rounded border border-gold-dim px-3 py-1 text-xs uppercase tracking-wider text-gold transition-colors hover:bg-gold hover:text-ink disabled:opacity-50"
          >
            {tgBusy ? "linking…" : "Connect Telegram ✈"}
          </button>
        )}
        {running && (
          <a
            href={agent.url}
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
          onClick={() => onDelete(agent.tenantId)}
          disabled={deleting || !!busy}
          className="rounded border border-panel-edge px-3 py-1 text-xs uppercase tracking-wider text-muted transition-colors hover:border-red hover:text-red disabled:opacity-40"
        >
          {deleting ? "removing…" : "Delete"}
        </button>
      </div>

      {logsOpen && <LogsModal tenantId={agent.tenantId} name={agent.name} onClose={() => setLogsOpen(false)} />}
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
