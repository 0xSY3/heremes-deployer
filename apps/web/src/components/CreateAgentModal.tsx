"use client";

import { useState } from "react";
import { BrandMark } from "./BrandMark";
import { DeployProgress } from "./DeployProgress";

type Provider = "openrouter" | "anthropic";

function defaultAgentName(): string {
  return `hermes-${Math.floor(1000 + Math.random() * 9000)}`;
}

const INPUT =
  "mt-2 h-11 w-full rounded-lg border border-panel-edge bg-ink-2 px-3 text-sm text-parchment outline-none transition placeholder:text-muted-2 focus:border-accent focus:ring-2 focus:ring-accent/20";

export function CreateAgentModal({
  onClose,
  onFinished,
}: {
  onClose: () => void;
  onFinished: () => void;
}) {
  const [name, setName] = useState(defaultAgentName);
  const [llmProvider, setLlmProvider] = useState<Provider>("openrouter");
  const [llmKey, setLlmKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deploy, setDeploy] = useState<{ id: string; wsToken: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, llmProvider, llmKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "something went wrong");
        return;
      }
      // Hand off to the live deploy view instead of a fixed loader.
      setDeploy({ id: data.id, wsToken: data.wsToken });
    } catch {
      setError("network error");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 backdrop-blur-md"
      onClick={deploy ? undefined : onClose}
    >
      <div onClick={(e) => e.stopPropagation()}>
        {deploy ? (
          <DeployProgress
            agentId={deploy.id}
            wsToken={deploy.wsToken}
            onDone={() => {
              onFinished();
            }}
          />
        ) : (
          <form
            onSubmit={submit}
            className="rise w-[min(500px,94vw)] rounded-2xl border border-panel-edge bg-panel p-6 shadow-2xl shadow-black/60"
          >
            <div className="flex items-start justify-between gap-3 border-b border-panel-edge pb-5">
              <div>
                <BrandMark sublabel="Deploy Hermes" size="sm" />
                <p className="mt-3 text-sm text-muted">
                  Launch a private web chat and Telegram agent.
                </p>
              </div>
            </div>

            <label className="mt-5 block text-sm font-medium text-parchment">Agent name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="hermes-1001"
              className={INPUT}
            />
            <p className="mt-2 text-xs text-muted-2">
              Lowercase letters, numbers, and hyphens. A default is ready for fast deploys.
            </p>

            <label className="mt-5 block text-sm font-medium text-parchment">Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => setLlmProvider(e.target.value as Provider)}
              className={INPUT}
            >
              <option value="openrouter">OpenRouter</option>
              <option value="anthropic">Anthropic</option>
            </select>

            <label className="mt-5 block text-sm font-medium text-parchment">LLM API key</label>
            <input
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder={llmProvider === "anthropic" ? "sk-ant-..." : "sk-or-..."}
              type="password"
              className={INPUT}
            />
            <p className="mt-2 text-xs text-muted-2">
              Your {llmProvider === "anthropic" ? "Anthropic" : "OpenRouter"} key. Lives only in your
              agent&apos;s container.
            </p>

            {error && (
              <p className="mt-4 rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
                {error}
              </p>
            )}

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-panel-edge pt-5">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="h-10 rounded-lg border border-panel-edge px-4 text-sm font-medium text-muted transition hover:border-panel-edge-2 hover:text-parchment disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="group inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dim disabled:opacity-50"
              >
                {pending ? "Creating…" : "Deploy Hermes"}
                {!pending && <span className="transition-transform group-hover:translate-x-0.5">→</span>}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
