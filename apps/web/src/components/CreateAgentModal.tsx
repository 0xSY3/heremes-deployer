"use client";

import { useState } from "react";
import type { AgentView } from "./types";

export function CreateAgentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (agent: AgentView) => void;
}) {
  const [name, setName] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, llmKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "something went wrong");
        return;
      }
      onCreated(data.agent as AgentView);
    } catch {
      setError("network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="rise w-[min(420px,92vw)] rounded-xl border border-panel-edge bg-ink-2 p-7 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <span className="text-3xl text-gold">⚕</span>
          <div>
            <h2 className="font-display text-2xl leading-tight text-parchment">Deploy a Hermes agent</h2>
            <p className="text-xs text-muted">Your own private agent — web chat + Telegram. Free.</p>
          </div>
        </div>

        <label className="mt-6 block text-[11px] uppercase tracking-widest text-muted">Name</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-agent"
          className="mt-1.5 w-full rounded border border-panel-edge bg-panel px-3 py-2 text-sm text-parchment outline-none focus:border-gold"
        />

        <label className="mt-4 block text-[11px] uppercase tracking-widest text-muted">
          LLM API key (BYO)
        </label>
        <input
          value={llmKey}
          onChange={(e) => setLlmKey(e.target.value)}
          placeholder="sk-or-..."
          type="password"
          className="mt-1.5 w-full rounded border border-panel-edge bg-panel px-3 py-2 text-sm text-parchment outline-none focus:border-gold"
        />
        <p className="mt-1 text-[11px] text-muted">
          Your OpenRouter/Anthropic key. Lives only in your agent&apos;s container.
        </p>

        {error && <p className="mt-4 text-xs text-red">⚠ {error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="text-xs uppercase tracking-wider text-muted hover:text-parchment disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-gold px-4 py-2 text-xs font-bold uppercase tracking-wider text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "deploying… (~30s)" : "Deploy →"}
          </button>
        </div>
      </form>
    </div>
  );
}
