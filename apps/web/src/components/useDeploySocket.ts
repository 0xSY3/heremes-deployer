"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  initialDeployState,
  reduceFrame,
  type DeployState,
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

const POLL_MS = 3000;

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
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/agents/${agentId}`);
          if (!res.ok) return;
          const { agent } = await res.json();
          dispatch({ type: "hello", status: agent.status } as Frame);
          if (["failed", "stopped", "crashed", "running"].includes(agent.status)) {
            if (agent.hostUrl) dispatch({ type: "ready", url: agent.hostUrl } as Frame);
            dispatch({ type: "done", status: agent.status } as Frame);
            if (pollTimer) clearInterval(pollTimer);
          }
        } catch {
          // keep polling; transient network error
        }
      }, POLL_MS);
    }

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
      ws.onerror = () => startPolling();
      ws.onclose = () => {
        if (!stateRef.current.terminal) startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      ws?.close();
    };
  }, [agentId, wsToken]);

  return state;
}
