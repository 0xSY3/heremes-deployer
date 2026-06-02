import { CHANNELS, LLM_PROVIDERS, type Channel, type LlmProvider } from "../src/types";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

export interface ProvisionArgs {
  tenantId: string;
  channel: Channel;
  llmProvider: LlmProvider;
  llmKey: string;
  channelToken?: string;
  dryRun: boolean;
  local: boolean;
}

export function parseProvisionArgs(argv: string[]): ProvisionArgs {
  const tenantId = flag(argv, "tenant");
  if (!tenantId) throw new Error("--tenant is required");
  const channel = (flag(argv, "channel") ?? "web") as Channel;
  if (!CHANNELS.includes(channel)) throw new Error(`invalid --channel: ${channel}`);
  const llmProvider = (flag(argv, "llm-provider") ?? "openrouter") as LlmProvider;
  if (!LLM_PROVIDERS.includes(llmProvider)) throw new Error(`invalid --llm-provider: ${llmProvider}`);
  const llmKey = flag(argv, "llm-key");
  if (!llmKey) throw new Error("--llm-key is required");
  const channelToken = flag(argv, "channel-token");
  return {
    tenantId,
    channel,
    llmProvider,
    llmKey,
    ...(channelToken ? { channelToken } : {}),
    dryRun: argv.includes("--dry-run"),
    local: argv.includes("--local"),
  };
}

export interface TeardownArgs {
  tenantId: string;
  deleteData: boolean;
  local: boolean;
}

export function parseTeardownArgs(argv: string[]): TeardownArgs {
  const tenantId = flag(argv, "tenant");
  if (!tenantId) throw new Error("--tenant is required");
  return {
    tenantId,
    deleteData: argv.includes("--delete-data"),
    local: argv.includes("--local"),
  };
}
