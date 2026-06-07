// Placeholder for the deploy WebSocket server. The full implementation
// (token-gated upgrade, step/log fan-out, keepalive) lands in a later task;
// bin/main.ts imports startWsServer at boot, so this stub exists to keep the
// package typechecking and lets the worker run with the WS server disabled.
export function startWsServer(): void {
  // no-op until the WS task replaces this module
}
