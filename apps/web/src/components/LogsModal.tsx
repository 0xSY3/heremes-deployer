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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="rise flex h-[70vh] w-[min(820px,94vw)] flex-col rounded-xl border border-panel-edge bg-ink-2 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between pb-3">
          <h3 className="font-display text-lg text-parchment">
            Logs — <span className="text-gold">{name}</span>
          </h3>
          <button onClick={onClose} className="text-xs uppercase tracking-wider text-muted hover:text-parchment">
            Close
          </button>
        </div>
        <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded border border-panel-edge bg-ink p-4 font-mono text-[11px] leading-relaxed text-muted">
          {logs}
        </pre>
      </div>
    </div>
  );
}
