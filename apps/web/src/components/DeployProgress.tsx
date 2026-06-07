"use client";

import { useDeploySocket } from "./useDeploySocket";
import { DEPLOY_STEPS, type DeployStep } from "@/lib/deploy-frames";

const STEP_LABELS: Record<DeployStep, string> = {
  queued: "Queued",
  allocating_ports: "Allocating ports",
  starting: "Starting container",
  health_checking: "Health check",
  registering_route: "Registering route",
  running: "Live",
};

function mark(stepState: string | undefined): string {
  if (stepState === "ok") return "✓";
  if (stepState === "failed") return "✗";
  if (stepState === "started") return "…";
  return "·";
}

export function DeployProgress({
  agentId,
  wsToken,
  onDone,
}: {
  agentId: string;
  wsToken: string;
  onDone: (status: string, url: string | null) => void;
}) {
  const state = useDeploySocket(agentId, wsToken);
  const failed = state.terminal && state.status !== "running";

  return (
    <div className="rise w-[min(420px,92vw)] rounded-xl border border-panel-edge bg-ink-2 p-7 shadow-2xl">
      <h2 className="font-display text-2xl text-parchment">Deploying your agent</h2>
      <p className="mt-1 text-xs text-muted">Live progress — no need to refresh.</p>

      <ul className="mt-6 space-y-2">
        {DEPLOY_STEPS.map((step) => {
          const st = state.steps[step];
          const active = st === "started";
          return (
            <li
              key={step}
              className={`flex items-center gap-3 text-sm ${
                st === "ok"
                  ? "text-parchment"
                  : st === "failed"
                    ? "text-red"
                    : active
                      ? "text-gold"
                      : "text-muted"
              }`}
            >
              <span className="w-4 text-center font-mono">{mark(st)}</span>
              <span>{STEP_LABELS[step]}</span>
            </li>
          );
        })}
      </ul>

      {state.status === "running" && state.url && (
        <a
          href={state.url}
          className="mt-6 block rounded bg-gold px-4 py-2 text-center text-xs font-bold uppercase tracking-wider text-ink hover:opacity-90"
        >
          Open dashboard →
        </a>
      )}

      {failed && (
        <p className="mt-4 text-xs text-red">
          ⚠ Deploy {state.status}. {state.error ?? "Check logs and try again."}
        </p>
      )}

      {state.terminal && (
        <button
          onClick={() => onDone(state.status, state.url)}
          className="mt-6 w-full text-xs uppercase tracking-wider text-muted hover:text-parchment"
        >
          Close
        </button>
      )}
    </div>
  );
}
