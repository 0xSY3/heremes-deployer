import { afterEach, expect, test, vi } from "vitest";

import {
  subscribe,
  emitStep,
  emitLog,
  emitReady,
  emitDone,
  snapshotSteps,
  clearSteps,
  type Frame,
} from "../src/events";

afterEach(() => {
  vi.restoreAllMocks();
});

test("subscribe receives a step frame for its agentId only", () => {
  // #given two subscribers on different agents
  const aFrames: Frame[] = [];
  const bFrames: Frame[] = [];
  const unsubA = subscribe("agent-a", (f) => aFrames.push(f));
  const unsubB = subscribe("agent-b", (f) => bFrames.push(f));

  // #when a step is emitted for agent-a
  emitStep("agent-a", "starting", "ok");

  // #then only agent-a's subscriber sees it
  expect(aFrames).toEqual([
    { type: "step", step: "starting", state: "ok", at: (aFrames[0] as { at?: string }).at },
  ]);
  expect(aFrames[0]?.type).toBe("step");
  expect(typeof (aFrames[0] as { at: string }).at).toBe("string");
  expect(bFrames).toEqual([]);

  unsubA();
  unsubB();
});

test("multiple subscribers on the same agent all receive the frame", () => {
  // #given two subscribers on the same agent
  const got: number[] = [];
  const unsub1 = subscribe("dup", () => got.push(1));
  const unsub2 = subscribe("dup", () => got.push(2));

  // #when a frame is emitted
  emitLog("dup", { lineNo: 1, text: "hi", stream: "stdout", ts: "t" });

  // #then both fire
  expect(got.sort()).toEqual([1, 2]);
  unsub1();
  unsub2();
});

test("unsubscribe stops delivery and prunes the empty agent set", () => {
  // #given a subscriber that then unsubscribes
  const frames: Frame[] = [];
  const unsub = subscribe("gone", (f) => frames.push(f));
  unsub();

  // #when a frame is emitted after unsub
  emitReady("gone", "https://x/y");

  // #then nothing is delivered (no throw on an empty/pruned set)
  expect(frames).toEqual([]);
});

test("emitDone delivers a terminal frame with the status", () => {
  // #given a subscriber
  const frames: Frame[] = [];
  const unsub = subscribe("term", (f) => frames.push(f));

  // #when done is emitted
  emitDone("term", "failed");

  // #then a done frame with status arrives
  expect(frames).toEqual([{ type: "done", status: "failed" }]);
  unsub();
});

test("a throwing subscriber does not block other subscribers", () => {
  // #given one bad subscriber and one good one
  const good: Frame[] = [];
  const unsubBad = subscribe("mixed", () => {
    throw new Error("boom");
  });
  const unsubGood = subscribe("mixed", (f) => good.push(f));

  // #when a frame is emitted
  emitStep("mixed", "running", "ok");

  // #then the good subscriber still receives it
  expect(good.length).toBe(1);
  unsubBad();
  unsubGood();
});

test("snapshotSteps replays prior step/ready frames for a late subscriber", () => {
  // #given two steps and a ready emitted before anyone subscribed
  clearSteps("late");
  emitStep("late", "allocating_ports", "ok");
  emitStep("late", "starting", "started");
  emitReady("late", "https://host/late");

  // #then a late subscriber can be primed with the full ordered history
  const snap = snapshotSteps("late");
  expect(snap.map((f) => f.type)).toEqual(["step", "step", "ready"]);
  expect((snap[0] as { step: string }).step).toBe("allocating_ports");

  // #and emitDone clears the history (terminal)
  emitDone("late", "running");
  expect(snapshotSteps("late")).toEqual([]);
});
