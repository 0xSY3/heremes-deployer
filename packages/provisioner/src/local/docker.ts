import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";

const run = promisify(execFile);

// Bind port 0 to grab a free port; small TOCTOU window before docker run, caught by PortUnavailableError.
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not determine a free port")));
      }
    });
  });
}

export async function allocatePorts(count: number): Promise<number[]> {
  const ports: number[] = [];
  for (let i = 0; i < count; i++) {
    // Sequential so each bind sees the prior ones still held by the OS, keeping values distinct.
    ports.push(await findFreePort());
  }
  return ports;
}

// Carries no argv, so it is safe to surface (unlike runContainer errors).
export class PortUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortUnavailableError";
  }
}

export async function containerIsRunning(nameOrId: string): Promise<boolean> {
  try {
    const { stdout } = await run("docker", [
      "inspect", "-f", "{{.State.Running}}", nameOrId,
    ]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

// First-run pull streams ~3GB of progress to stderr; default 1MB buffer would trip ERR_CHILD_PROCESS_STDIO_MAXBUFFER.
const DOCKER_MAX_BUFFER = 64 * 1024 * 1024;

// Carries no argv, so it is safe to surface verbatim (unlike a docker run failure that can embed the LLM key).
export class DockerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerUnavailableError";
  }
}

// docker version hits the daemon, distinguishing "not installed" (ENOENT) from "daemon down" (exit 1).
export async function assertDockerAvailable(): Promise<void> {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch (e) {
    const err = e as { code?: string; stderr?: string };
    if (err.code === "ENOENT") {
      throw new DockerUnavailableError(
        "Docker CLI not found on PATH. Install Docker Desktop and ensure `docker` is available.",
      );
    }
    // stderr is the daemon hint, never argv.
    const stderr = err.stderr?.trim();
    throw new DockerUnavailableError(
      `Cannot reach the Docker daemon. Is Docker running?${stderr ? ` (${stderr})` : ""}`,
    );
  }
}

export interface PortMapping {
  hostPort: number;
  containerPort: number;
}

export interface RunContainerInput {
  name: string;
  image: string;
  ports: PortMapping[];
  env: Record<string, string>;
  command: string[];
}

// Uses execFile (argv array, no shell) so tenant ids and tokens can't inject shell syntax.
export async function runContainer(input: RunContainerInput): Promise<string> {
  const args = ["run", "-d", "--name", input.name];
  for (const p of input.ports) {
    args.push("-p", `${p.hostPort}:${p.containerPort}`);
  }
  for (const [k, v] of Object.entries(input.env)) {
    args.push("-e", `${k}=${v}`);
  }
  args.push(input.image, ...input.command);
  try {
    const { stdout } = await run("docker", args, { maxBuffer: DOCKER_MAX_BUFFER });
    return stdout.trim();
  } catch (e) {
    // SECURITY: execFile argv embeds the LLM key — re-throw with only daemon stderr, never the command line.
    const stderr = (e as { stderr?: string }).stderr?.trim();
    // Matches a lost port race so the caller gets a distinct, secret-free error.
    if (stderr && /port is already allocated|address already in use|bind for .* failed/i.test(stderr)) {
      throw new PortUnavailableError(
        `A required host port is already in use. Stop whatever holds it and retry. (${stderr})`,
      );
    }
    throw new Error(
      `docker run failed for container "${input.name}"${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

// Matches the daemon's "container gone" message — treated as teardown success so real failures still propagate.
const NO_SUCH_CONTAINER = /no such container/i;

function isNoSuchContainer(e: unknown): boolean {
  const stderr = (e as { stderr?: string }).stderr ?? "";
  const message = e instanceof Error ? e.message : "";
  return NO_SUCH_CONTAINER.test(stderr) || NO_SUCH_CONTAINER.test(message);
}

// Only argument is the container name (no secrets), so surfacing stderr is safe here.
function rethrowDockerError(op: string, nameOrId: string, e: unknown): never {
  const stderr = (e as { stderr?: string }).stderr?.trim();
  throw new Error(`docker ${op} failed for container "${nameOrId}"${stderr ? `: ${stderr}` : ""}`);
}

export async function stopContainer(nameOrId: string): Promise<void> {
  try {
    await run("docker", ["stop", nameOrId]);
  } catch (e) {
    if (isNoSuchContainer(e)) return;
    rethrowDockerError("stop", nameOrId, e);
  }
}

export async function removeContainer(nameOrId: string): Promise<void> {
  try {
    await run("docker", ["rm", "-f", nameOrId]);
  } catch (e) {
    if (isNoSuchContainer(e)) return;
    rethrowDockerError("rm", nameOrId, e);
  }
}

export async function startContainer(nameOrId: string): Promise<void> {
  try {
    await run("docker", ["start", nameOrId]);
  } catch (e) {
    if (isNoSuchContainer(e)) throw new Error(`container "${nameOrId}" no longer exists`);
    rethrowDockerError("start", nameOrId, e);
  }
}

export async function restartContainer(nameOrId: string): Promise<void> {
  try {
    await run("docker", ["restart", nameOrId]);
  } catch (e) {
    if (isNoSuchContainer(e)) throw new Error(`container "${nameOrId}" no longer exists`);
    rethrowDockerError("restart", nameOrId, e);
  }
}

// Logs hold agent output but not the LLM key (env-only, never stdout), so surfacing them is safe.
export async function containerLogs(nameOrId: string, tail = 200): Promise<string> {
  try {
    const { stdout, stderr } = await run(
      "docker",
      ["logs", "--tail", String(tail), nameOrId],
      { maxBuffer: DOCKER_MAX_BUFFER },
    );
    return [stdout, stderr].filter(Boolean).join("\n").trim();
  } catch (e) {
    if (isNoSuchContainer(e)) return "(container no longer exists)";
    const stderr = (e as { stderr?: string }).stderr?.trim();
    return `(could not read logs${stderr ? `: ${stderr}` : ""})`;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitContainerHealthy(
  hostPort: number,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  let lastErr = "no attempt";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${hostPort}/health`);
      if (res.status === 200) return;
      lastErr = `status ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(intervalMs);
  }
  throw new Error(`Container on port ${hostPort} not healthy within ${timeoutMs}ms (last: ${lastErr})`);
}
