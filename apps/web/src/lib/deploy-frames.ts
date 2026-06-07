// Pure reducer for the deploy WebSocket frames (spec §2). Kept DOM-free so it's
// unit-tested without a socket; the hook (useDeploySocket) is the thin shell.

export const DEPLOY_STEPS = [
  "queued",
  "allocating_ports",
  "starting",
  "health_checking",
  "registering_route",
  "running",
] as const;

export type DeployStep = (typeof DEPLOY_STEPS)[number];
export type StepState = "started" | "ok" | "failed";

const TERMINAL = new Set(["failed", "stopped", "crashed"]);

export interface DeployState {
  status: string;
  steps: Partial<Record<DeployStep, StepState>>;
  url: string | null;
  terminal: boolean;
  error: string | null;
}

export function initialDeployState(): DeployState {
  return { status: "queued", steps: {}, url: null, terminal: false, error: null };
}

export interface Frame {
  type: string;
  [k: string]: unknown;
}

export function reduceFrame(state: DeployState, frame: Frame): DeployState {
  switch (frame.type) {
    case "hello":
      return { ...state, status: String(frame.status ?? state.status) };
    case "step": {
      const step = frame.step as DeployStep;
      const stepState = frame.state as StepState;
      return { ...state, steps: { ...state.steps, [step]: stepState }, status: step };
    }
    case "ready":
      return { ...state, url: typeof frame.url === "string" ? frame.url : state.url };
    case "done": {
      const status = String(frame.status ?? state.status);
      return { ...state, status, terminal: TERMINAL.has(status) || status === "running" };
    }
    case "error":
      return { ...state, error: typeof frame.message === "string" ? frame.message : "error" };
    default:
      // log frames and anything unknown don't affect the checklist.
      return state;
  }
}
