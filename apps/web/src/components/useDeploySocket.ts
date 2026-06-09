"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  DEPLOY_STEPS,
  initialDeployState,
  reduceFrame,
  type DeployState,
  type DeployStep,
  type Frame,
} from "@/lib/deploy-frames";

// Builds ws(s)://<host>:<wsPort>/v1/agents/<id>/deploy?token=<t>. The WS port is
// the worker's DEPLOYER_WS_PORT surfaced to the client via NEXT_PUBLIC_WS_URL
// (e.g. wss://deployer.example.com:7072). When unset (single-host TLS via Caddy
// terminating the WS too), fall back to same-origin ws upgrade on the path.
function deployUrl(agentId: string, token: string): string {
  const base = process.env.NEXT_PUBLIC_WS_URL;
  if (base) return `${base}/v1/agents/${agentId}/deploy?token=${encodeURIComponent(token)}`;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/v1/agents/${agentId}/deploy?token=${encodeURIComponent(token)}`;
}

const POLL_MS = 1500;

export function useDeploySocket(agentId: string, wsToken: string): DeployState {
  const [state, dispatch] = useReducer(reduceFrame, undefined, initialDeployState);
  const [, force] = useState(0);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;

    function startPolling() {
      if (pollTimer || closed) return;
      // Socket fallback: poll the row status until terminal so the view still
      // advances if the WS drops (spec §2 — "falling back to the row status").
      // The deploy steps are an ordered prefix of the status values, so we can
      // synthesize step frames from the polled status: every step before the
      // current one is `ok`, the current one is `started`. This animates the
      // checklist on the polling path too (cross-origin WSS from Vercel to the
      // worker is unreliable, so polling is the common case in prod).
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/agents/${agentId}`);
          if (!res.ok) return;
          const { agent } = await res.json();
          const status = agent.status as string;

          const idx = DEPLOY_STEPS.indexOf(status as DeployStep);
          if (idx >= 0) {
            for (let i = 0; i < idx; i++) {
              dispatch({ type: "step", step: DEPLOY_STEPS[i], state: "ok" } as Frame);
            }
            dispatch({ type: "step", step: DEPLOY_STEPS[idx], state: "started" } as Frame);
          }
          dispatch({ type: "hello", status } as Frame);

          if (["failed", "stopped", "crashed", "running"].includes(status)) {
            if (status === "running") {
              // Mark every step ok so the checklist reads complete.
              for (const s of DEPLOY_STEPS) {
                dispatch({ type: "step", step: s, state: "ok" } as Frame);
              }
            }
            if (agent.hostUrl) dispatch({ type: "ready", url: agent.hostUrl } as Frame);
            dispatch({ type: "done", status } as Frame);
            if (pollTimer) clearInterval(pollTimer);
          }
        } catch {
          // keep polling; transient network error
        }
      }, POLL_MS);
    }

    // Always poll: it drives the checklist animation on its own and is the
    // reliable path in prod (cross-origin WSS from the Vercel frontend to the
    // worker often never connects, with no error event — so we can't wait for
    // ws.onerror to start polling). The WS, when it does connect, simply
    // delivers the same frames a beat sooner; reduceFrame is order-tolerant.
    startPolling();

    try {
      ws = new WebSocket(deployUrl(agentId, wsToken));
      ws.onmessage = (ev) => {
        try {
          dispatch(JSON.parse(ev.data) as Frame);
          force((n) => n + 1);
        } catch {
          // ignore non-JSON
        }
      };
    } catch {
      // polling already running
    }

    return () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      ws?.close();
    };
  }, [agentId, wsToken]);

  return state;
}
