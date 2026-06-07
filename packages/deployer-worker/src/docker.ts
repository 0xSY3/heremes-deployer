// dockerode wrapper. Exposes only the calls the worker uses so we don't leak
// the whole Docker API surface.
//
// Hermes differences from zynd: no bind mounts, no env-file read, fixed image +
// ["gateway","run"], two published ports. runContainer + waitForHealth live in
// the next slice; the helpers below are ported verbatim (the demux frame parser
// and the terminal-state inspect are load-bearing for the crash watcher and the
// Postgres 22021 NUL-byte gotcha).

import Docker from "dockerode";

import { config } from "./config";

export const docker = new Docker({ socketPath: config.dockerSocket });

export async function stopAndRemove(containerId: string): Promise<void> {
  const c = docker.getContainer(containerId);
  try {
    await c.stop({ t: 5 });
  } catch {
    // already stopped — fine
  }
  try {
    await c.remove({ force: true });
  } catch {
    // already gone — fine
  }
}

export async function inspectExitCode(containerId: string): Promise<number | null> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    return info.State.ExitCode ?? null;
  } catch {
    return null;
  }
}

export interface ContainerTerminalState {
  exitCode: number | null;
  oomKilled: boolean;
  error: string;
  startedAt: string;
  finishedAt: string;
  memoryLimitMb: number | null;
}

export async function inspectTerminalState(
  containerId: string,
): Promise<ContainerTerminalState | null> {
  try {
    const info = await docker.getContainer(containerId).inspect();
    const mem = info.HostConfig?.Memory ?? 0;
    return {
      exitCode: info.State.ExitCode ?? null,
      oomKilled: Boolean(info.State.OOMKilled),
      error: info.State.Error ?? "",
      startedAt: info.State.StartedAt ?? "",
      finishedAt: info.State.FinishedAt ?? "",
      memoryLimitMb: mem ? Math.round(mem / 1024 / 1024) : null,
    };
  } catch (e) {
    console.error(`[docker] inspectTerminalState ${containerId.slice(0, 12)} failed:`, e);
    return null;
  }
}

/**
 * Dockerode's non-TTY `logs()` returns the raw multiplexed stream format:
 * repeated frames of [stream_type(1), 0x00, 0x00, 0x00, size(4 BE), payload...].
 * The three 0x00 bytes in every frame header aren't legal in a Postgres text
 * column (error 22021), and the size bytes on their own tend to produce
 * garbled output even when they don't trip the encoding check. Strip the
 * headers and concatenate just the payloads.
 */
function demuxBuffer(buf: Buffer): string {
  let out = "";
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    i += 8;
    if (i + size > buf.length) break;
    out += buf.slice(i, i + size).toString("utf8");
    i += size;
  }
  return out;
}

/**
 * Read the last N lines from a container as a single UTF-8 string.
 * Used by the crash watcher to grab a tail when a container dies.
 */
export async function tailLogs(containerId: string, lines = 200): Promise<string> {
  try {
    const stream = await docker.getContainer(containerId).logs({
      stdout: true,
      stderr: true,
      tail: lines,
      timestamps: false,
    });
    // In non-follow mode dockerode resolves to a Buffer of the raw multiplexed
    // stream; demux it before returning text.
    const buf = Buffer.isBuffer(stream)
      ? (stream as Buffer)
      : Buffer.from(stream as unknown as string);
    return demuxBuffer(buf);
  } catch {
    return "";
  }
}
