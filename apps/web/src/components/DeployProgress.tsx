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
  if (stepState === "failed") return "!";
  return "";
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
    <div className="rise w-[min(480px,94vw)] rounded-2xl border border-panel-edge bg-panel p-6 shadow-2xl shadow-black/60">
      <div className="border-b border-panel-edge pb-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl uppercase tracking-wide text-parchment">
            Deploying Hermes
          </h2>
          {!state.terminal && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-bright opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-bright" />
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">Live progress from the worker.</p>
      </div>

      <ul className="mt-5 space-y-2.5">
        {DEPLOY_STEPS.map((step) => {
          const st = state.steps[step];
          const active = st === "started";
          return (
            <li
              key={step}
              className={`flex items-center gap-3 rounded-lg border px-3 py-3 text-sm ${
                st === "ok"
                  ? "border-green/25 bg-green/10 text-parchment"
                  : st === "failed"
                    ? "border-red/30 bg-red/10 text-red"
                    : active
                      ? "border-accent/35 bg-accent/10 text-accent-bright"
                      : "border-panel-edge bg-ink-2 text-muted"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${
                  st === "ok"
                    ? "border-green/40 bg-green/20 text-green"
                    : st === "failed"
                      ? "border-red/40 bg-red/20 text-red"
                      : active
                        ? "breathe border-accent/45 bg-accent/25 text-accent-bright"
                        : "border-panel-edge text-muted-2"
                }`}
              >
                {mark(st)}
              </span>
              <span>{STEP_LABELS[step]}</span>
            </li>
          );
        })}
      </ul>

      {state.status === "running" && state.url && (
        <a
          href={state.url}
          className="group mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dim"
        >
          Open dashboard
          <span className="transition-transform group-hover:translate-x-0.5">↗</span>
        </a>
      )}

      {failed && (
        <p className="mt-4 rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-sm text-red">
          Deploy {state.status}. {state.error ?? "Check logs and try again."}
        </p>
      )}

      {state.terminal && (
        <button
          onClick={() => onDone(state.status, state.url)}
          className="mt-5 h-10 w-full rounded-lg border border-panel-edge text-sm font-medium text-muted transition hover:border-panel-edge-2 hover:text-parchment"
        >
          Close
        </button>
      )}
    </div>
  );
}
