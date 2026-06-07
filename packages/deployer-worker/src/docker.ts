// dockerode wrapper. Exposes only the calls the worker uses so we don't leak
// the whole Docker API surface.
//
// Hermes differences from zynd: no bind mounts, no env-file read, fixed image +
// ["gateway","run"], two published ports. runContainer + waitForHealth live in
// the next slice; the helpers below are ported verbatim (the demux frame parser
// and the terminal-state inspect are load-bearing for the crash watcher and the
// Postgres 22021 NUL-byte gotcha).

import Docker from "dockerode";

import { config, API_PORT, DASHBOARD_PORT } from "./config";

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

export interface RunContainerOpts {
  agentId: string;
  /** Fixed Hermes gateway image (config.hermesImage). No per-agent build. */
  image: string;
  /**
   * Fully-resolved container environment (secret already decrypted in memory by
   * the caller). Flattened to dockerode's "K=V"[] Env. SECURITY: never logged,
   * never echoed into an error.
   */
  env: Record<string, string>;
  /** Host port bound to the container's API port (8642). */
  apiPort: number;
  /** Host port bound to the container's dashboard port (9119). */
  dashboardPort: number;
}

/**
 * Create and start the Hermes gateway container for an agent. Returns the
 * container id. The caller owns error cleanup (remove container + release both
 * ports) if a downstream step fails — runContainer does not clean up on failure.
 *
 * SECURITY: the Env array carries the agent's LLM key and API_SERVER_KEY. Never
 * surface Env or argv in a log line or thrown error — only the daemon's own
 * message. Both ports bind to 127.0.0.1 only; nothing but Caddy can reach them.
 */
export async function runContainer(opts: RunContainerOpts): Promise<string> {
  const env: string[] = [];
  for (const [k, v] of Object.entries(opts.env)) {
    env.push(`${k}=${v}`);
  }

  // Count only — never the values (secret-safe logging).
  console.log(
    `[docker] createContainer agent=${opts.agentId} image=${opts.image} ` +
      `apiPort=${opts.apiPort} dashboardPort=${opts.dashboardPort} ` +
      `mem=${config.containerMemoryMb}MB cpuMillis=${config.containerCpuMillis} ` +
      `envVars=${env.length}`,
  );

  const container = await docker.createContainer({
    name: `hermes-${opts.agentId}`,
    Image: opts.image,
    // Headless: the interactive CLI EOFs in a non-TTY container, so always
    // "gateway run".
    Cmd: ["gateway", "run"],
    Env: env,
    ExposedPorts: {
      [`${API_PORT}/tcp`]: {},
      [`${DASHBOARD_PORT}/tcp`]: {},
    },
    HostConfig: {
      PortBindings: {
        [`${API_PORT}/tcp`]: [
          { HostIp: "127.0.0.1", HostPort: String(opts.apiPort) },
        ],
        [`${DASHBOARD_PORT}/tcp`]: [
          { HostIp: "127.0.0.1", HostPort: String(opts.dashboardPort) },
        ],
      },
      RestartPolicy: { Name: "unless-stopped" },
      Memory: config.containerMemoryMb * 1024 * 1024,
      NanoCpus: config.containerCpuMillis * 1_000_000,
      ReadonlyRootfs: true,
      // Read-only rootfs needs a writable /tmp for the gateway's scratch.
      // exec is allowed; size counts against the container memory limit.
      Tmpfs: { "/tmp": `rw,exec,size=${config.containerTmpfsMb}m` },
      // Block privilege escalation (setuid binaries can't gain capabilities).
      SecurityOpt: ["no-new-privileges"],
    },
    // Crash watcher filters die/oom events by this label.
    Labels: { "hermes.agent": opts.agentId },
  });

  await container.start();
  console.log(
    `[docker] started agent=${opts.agentId} container=${container.id.slice(0, 12)}`,
  );
  return container.id;
}

/**
 * Poll the freshly started container's API /health until it returns 200 or the
 * boot timeout elapses. Hermes has no entrypoint install step to wait on, so
 * this is the single readiness gate before the agent is marked running.
 * Loopback only — the port is bound to 127.0.0.1.
 */
export async function waitForHealth(apiPort: number): Promise<void> {
  const url = `http://127.0.0.1:${apiPort}/health`;
  const deadline = Date.now() + config.bootHealthTimeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(config.bootHealthIntervalMs * 2),
      });
      if (res.status === 200) return;
    } catch {
      // Connection refused / timeout while the gateway is still booting — retry.
    }
    await new Promise((r) => setTimeout(r, config.bootHealthIntervalMs));
  }

  throw new Error(`Container /health on port ${apiPort} did not return 200 within boot timeout`);
}
