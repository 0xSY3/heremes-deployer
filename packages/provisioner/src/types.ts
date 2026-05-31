export const CHANNELS = ["web", "telegram", "discord"] as const;
export type Channel = (typeof CHANNELS)[number];

export const LLM_PROVIDERS = ["openrouter", "anthropic"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface ProvisionInput {
  tenantId: string;
  channel: Channel;
  llmProvider: LlmProvider;
  llmKey: string;
  channelToken?: string;
  personalityId?: string;
}

export interface AgentRecord {
  tenantId: string;
  url: string;
  status: "provisioning" | "running" | "failed" | "stopped";
  taskArn?: string;
  taskDefArn?: string;
  accessPointId?: string;
  secretArn?: string;
  securityGroupId?: string;
  targetGroupArn?: string;
  listenerRuleArn?: string;
  // Local Docker path only: resolved host ports, persisted (not re-derived) so teardown/liveness/URL hit the real ports.
  apiPort?: number;
  dashboardPort?: number;
  personalityId?: string;
  createdAt: string;
}
