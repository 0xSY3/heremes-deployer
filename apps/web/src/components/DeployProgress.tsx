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

type IconProps = { className?: string };
const sv = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// Per-step glyphs so each row reads at a glance, not just a number.
const STEP_ICONS: Record<DeployStep, (p: IconProps) => React.ReactElement> = {
  queued: (p) => (
    <svg {...sv} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
  ),
  allocating_ports: (p) => (
    <svg {...sv} {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  starting: (p) => (
    <svg {...sv} {...p}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></svg>
  ),
  health_checking: (p) => (
    <svg {...sv} {...p}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
  ),
  registering_route: (p) => (
    <svg {...sv} {...p}><circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" /></svg>
  ),
  running: (p) => (
    <svg {...sv} {...p}><path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" /></svg>
  ),
};

function CheckIcon({ className }: IconProps) {
  return <svg {...sv} className={className}><path d="M20 6 9 17l-5-5" /></svg>;
}
function FailIcon({ className }: IconProps) {
  return <svg {...sv} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>;
}
function Spinner({ className }: IconProps) {
  return (
    <svg {...sv} className={className} style={{ animation: "spin 0.8s linear infinite" }}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
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
  const done = DEPLOY_STEPS.filter((s) => state.steps[s] === "ok").length;
  const pct = Math.round((done / DEPLOY_STEPS.length) * 100);

  return (
    <div className="rise relative w-[min(480px,94vw)] overflow-hidden border-2 border-foreground bg-background p-6">
      <div className="relative border-b border-panel-edge pb-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl uppercase tracking-wide text-foreground">
            Deploying Hermes
          </h2>
          {!state.terminal && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground opacity-70" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-foreground" />
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-2">
          {failed ? "Deployment halted." : state.status === "running" ? "Your agent is live." : "Provisioning your private agent…"}
        </p>

        {/* progress bar */}
        <div className="mt-4 h-1 w-full overflow-hidden bg-foreground/20">
          <div
            className={`h-full transition-all duration-500 ${failed ? "bg-red" : "bg-foreground"}`}
            style={{ width: `${failed ? 100 : pct}%` }}
          />
        </div>
      </div>

      <ul className="relative mt-5 space-y-2">
        {DEPLOY_STEPS.map((step, i) => {
          const st = state.steps[step];
          const active = st === "started";
          const Glyph = STEP_ICONS[step];
          return (
            <li
              key={step}
              className={`flex items-center gap-3 border px-3.5 py-3 text-sm transition-all duration-300 font-mono ${
                st === "ok"
                  ? "border-panel-edge text-foreground"
                  : st === "failed"
                    ? "border-red/30 text-red"
                    : active
                      ? "border-foreground text-foreground font-bold"
                      : "border-panel-edge bg-transparent text-muted-2 opacity-50"
              }`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              {/* status badge */}
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center border ${
                  st === "ok"
                    ? "border-foreground bg-transparent text-foreground"
                    : st === "failed"
                      ? "border-red text-red"
                      : active
                        ? "border-foreground bg-foreground/10 text-foreground"
                        : "border-panel-edge bg-transparent text-muted-2"
                }`}
              >
                {st === "ok" ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : st === "failed" ? (
                  <FailIcon className="h-3.5 w-3.5" />
                ) : active ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <Glyph className="h-3.5 w-3.5 opacity-60" />
                )}
              </span>
              <span className="flex-1 font-medium">{STEP_LABELS[step]}</span>
              {st === "ok" && <span className="text-[11px] font-medium uppercase tracking-wider text-foreground">done</span>}
              {active && <span className="text-[11px] font-medium uppercase tracking-wider text-foreground">working</span>}
            </li>
          );
        })}
      </ul>

      {state.status === "running" && state.url && (
        <a
          href={state.url}
          target="_blank"
          rel="noreferrer"
          className="group relative mt-6 inline-flex h-12 w-full items-center justify-center gap-2 border border-foreground bg-foreground font-mono text-sm font-bold uppercase tracking-widest text-white transition hover:bg-transparent hover:text-foreground"
        >
          Open dashboard
          <svg {...sv} className="h-4 w-4 transition-transform group-hover:translate-x-1"><path d="M7 17 17 7M7 7h10v10" /></svg>
        </a>
      )}

      {failed && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-red/30 bg-red/10 px-3.5 py-3 text-sm text-red">
          <FailIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Deploy {state.status}. {state.error ?? "Check logs and try again."}</span>
        </p>
      )}

        <button
          onClick={() => onDone(state.status, state.url)}
          className="mt-4 h-11 w-full border border-foreground font-mono text-sm font-bold uppercase tracking-widest text-foreground transition hover:bg-foreground hover:text-white"
        >
          Close
        </button>
    </div>
  );
}
