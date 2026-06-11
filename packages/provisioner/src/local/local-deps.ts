import type { Config } from "../config";
import type { ProvisionDeps } from "../provision";
import type { TeardownDeps } from "../teardown";
import { getPersonality } from "../presets";
import {
  assertDockerAvailable, allocatePorts, runContainer, stopContainer,
  removeContainer, waitContainerHealthy,
} from "./docker";

function personalityEnv(personalityId: string | undefined): Record<string, string> {
  const preset = personalityId ? getPersonality(personalityId) : undefined;
  if (!preset) return {};
  const env: Record<string, string> = {
    HERMES_EPHEMERAL_SYSTEM_PROMPT: preset.systemPrompt,
  };
  if (preset.model) env.HERMES_MODEL = preset.model;
  return env;
}

const HERMES_PORT = 8642;
const DASHBOARD_PORT = 9119;
// Overrides the image default (minimax), which 404s without an OpenRouter data-policy toggle.
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

// Headless gateway, not the default interactive CLI, which EOFs in a non-TTY container.
const GATEWAY_COMMAND = ["gateway", "run"];

function containerName(tenantId: string): string {
  return `hermes-${tenantId}`;
}

export interface LocalPorts {
  apiPort: number;
  dashboardPort: number;
}

interface LocalState {
  secretEnv: Record<string, string>;
  ports?: LocalPorts;
}

export interface LocalProvisionDeps extends ProvisionDeps {
  // Defined only after runTask succeeds.
  resolvedPorts(): LocalPorts | undefined;
}

// AWS resources (volume, secret store, SG, ALB) are faked in-memory; only the running container is real.
export function buildLocalProvisionDeps(
  cfg: Config,
  tenantId: string,
  personalityId?: string,
): LocalProvisionDeps {
  const state: LocalState = { secretEnv: {} };
  const name = containerName(tenantId);
  const presetEnv = personalityEnv(personalityId);

  return {
    createAccessPoint: async () => "local-accesspoint",
    deleteAccessPoint: async () => undefined,
    createSecret: async (_t, payload) => {
      state.secretEnv = payload;
      return { arn: "local-secret", refs: Object.keys(payload).map((n) => ({ name: n, valueFrom: n })) };
    },
    deleteSecret: async () => undefined,
    createTenantSg: async () => "local-sg",
    deleteTenantSg: async () => undefined,
    registerTaskDef: async () => "local-taskdef",
    deregisterTaskDef: async () => undefined,
    runTask: async () => {
      await assertDockerAvailable();
      await removeContainer(name);
      const [apiPort, dashboardPort] = await allocatePorts(2);
      state.ports = { apiPort: apiPort!, dashboardPort: dashboardPort! };
      const id = await runContainer({
        name,
        image: cfg.hermesImage,
        ports: [
          { hostPort: apiPort!, containerPort: HERMES_PORT },
          { hostPort: dashboardPort!, containerPort: DASHBOARD_PORT },
        ],
        env: {
          ...state.secretEnv,
          API_SERVER_ENABLED: "true",
          API_SERVER_HOST: "0.0.0.0",
          // No HERMES_GATEWAY_BOOTSTRAP_STATE: it races a second gateway starter against `gateway run` and kills the dashboard.
          HERMES_UID: "10000",
          // Pin a model that works with any OpenRouter key; the image default (minimax) 404s without a data-policy toggle.
          HERMES_MODEL: DEFAULT_MODEL,
          // INSECURE skips dashboard OAuth — acceptable locally, revisit for the public/AWS path.
          HERMES_DASHBOARD: "1",
          // Bind to all interfaces, not localhost, so the published port is reachable.
          HERMES_DASHBOARD_HOST: "0.0.0.0",
          HERMES_DASHBOARD_INSECURE: "1",
          // Enables the embedded Chat tab; without it the dashboard has no chat input.
          HERMES_DASHBOARD_TUI: "1",
          // Spread last so a preset model override wins.
          ...presetEnv,
        },
        command: GATEWAY_COMMAND,
      });
      return id;
    },
    waitForHealthy: async () => {
      // Image already pulled in runTask; only the gateway's ~20-45s boot remains, so 5 min is generous slack.
      if (!state.ports) throw new Error("waitForHealthy called before runTask allocated ports");
      await waitContainerHealthy(state.ports.apiPort, { timeoutMs: 5 * 60 * 1000 });
    },
    resolveTaskIp: async () => "localhost",
    stopTask: async () => {
      // Stop AND remove: a bare stop orphans the named container since a failed provision persists no record for teardown.
      await stopContainer(name);
      await removeContainer(name);
    },
    createTargetGroup: async () => "local-tg",
    registerIp: async () => undefined,
    addHostRule: async () => "local-rule",
    waitTargetHealthy: async () => undefined,
    removeAlbWiring: async () => undefined,
    rulePriority: () => 1,
    // Open link points at the dashboard, not the API-only port.
    buildUrl: () => `http://localhost:${state.ports?.dashboardPort ?? 0}`,
    resolvedPorts: () => state.ports,
  };
}

export function buildLocalTeardownDeps(tenantId: string): TeardownDeps {
  const name = containerName(tenantId);
  return {
    removeAlbWiring: async () => undefined,
    stopTask: async () => {
      await stopContainer(name);
      await removeContainer(name);
    },
    deregisterTaskDef: async () => undefined,
    deleteTenantSg: async () => undefined,
    deleteSecret: async () => undefined,
    deleteAccessPoint: async () => undefined,
    resolveTaskIp: async () => "localhost",
  };
}
