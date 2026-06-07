import { describe, it, expect } from "vitest";
import { initialDeployState, reduceFrame, DEPLOY_STEPS } from "../src/lib/deploy-frames.js";

describe("reduceFrame", () => {
  it("sets status from a hello frame", () => {
    // #given the initial state
    const next = reduceFrame(initialDeployState(), { type: "hello", agentId: "a", status: "starting" });
    // #then status reflects the hello
    expect(next.status).toBe("starting");
  });

  it("records step state transitions in canonical order", () => {
    // #given two step frames
    let s = initialDeployState();
    s = reduceFrame(s, { type: "step", step: "allocating_ports", state: "ok", at: 1 });
    s = reduceFrame(s, { type: "step", step: "starting", state: "started", at: 2 });
    // #then each step carries its latest state
    expect(s.steps.allocating_ports).toBe("ok");
    expect(s.steps.starting).toBe("started");
    // #and the canonical order is exposed for the checklist
    expect(DEPLOY_STEPS[0]).toBe("queued");
    expect(DEPLOY_STEPS).toContain("running");
  });

  it("captures the ready url", () => {
    const s = reduceFrame(initialDeployState(), { type: "ready", url: "https://h/agent-abc" });
    expect(s.url).toBe("https://h/agent-abc");
  });

  it("marks terminal + done status from a done frame", () => {
    const s = reduceFrame(initialDeployState(), { type: "done", status: "failed" });
    expect(s.terminal).toBe(true);
    expect(s.status).toBe("failed");
  });

  it("ignores unknown frame types without throwing", () => {
    const before = initialDeployState();
    const after = reduceFrame(before, { type: "log", lineNo: 1, text: "x", stream: "stdout", ts: "t" });
    // #then log frames don't change step/status state (logs render separately)
    expect(after.status).toBe(before.status);
    expect(after.steps).toEqual(before.steps);
  });
});
