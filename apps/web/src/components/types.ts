// Client-side view of an agent (secrets already stripped by the API).
export interface AgentView {
  tenantId: string;
  name: string;
  url: string;
  status: string;
  channel: string;
  personalityId?: string;
  createdAt: string;
}
