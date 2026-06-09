"use client";

import { useEffect, useState } from "react";

export function LogsModal({
  agentId,
  name,
  onClose,
}: {
  agentId: string;
  name: string;
  onClose: () => void;
}) {
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-[72vh] w-[min(920px,96vw)] flex-col rounded-2xl border border-panel-edge bg-panel p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between border-b border-panel-edge pb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-muted">
            <span className="text-muted-2">Logs</span>
            <span className="text-muted-2">/</span>
            <span className="font-mono text-xs normal-case tracking-normal text-accent-bright">{name}</span>
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg border border-panel-edge px-3 py-1.5 text-sm font-medium text-muted transition hover:border-panel-edge-2 hover:text-parchment"
          >
            Close
          </button>
        </div>
        <pre className="mt-4 flex-1 overflow-auto whitespace-pre-wrap rounded-lg border border-panel-edge bg-ink p-4 font-mono text-xs leading-relaxed text-muted">
          {logs}
        </pre>
      </div>
    </div>
  );
}
