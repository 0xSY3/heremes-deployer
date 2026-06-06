import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AgentRecord } from "./types";

export interface StoredAgent extends AgentRecord {
  userId: string;
  name: string;
  channel: string;
}

function rowToAgent(r: Record<string, unknown>): StoredAgent {
  return {
    tenantId: r.tenant_id as string,
    userId: r.user_id as string,
    name: r.name as string,
    url: r.url as string,
    status: r.status as StoredAgent["status"],
    channel: r.channel as string,
    ...(r.task_arn != null ? { taskArn: r.task_arn as string } : {}),
    ...(r.api_port != null ? { apiPort: r.api_port as number } : {}),
    ...(r.dashboard_port != null ? { dashboardPort: r.dashboard_port as number } : {}),
    ...(r.secret_arn != null ? { secretArn: r.secret_arn as string } : {}),
    ...(r.access_point_id != null ? { accessPointId: r.access_point_id as string } : {}),
    ...(r.security_group_id != null ? { securityGroupId: r.security_group_id as string } : {}),
    ...(r.personality_id != null ? { personalityId: r.personality_id as string } : {}),
    createdAt: r.created_at as string,
  };
}

function agentToRow(a: StoredAgent): Record<string, unknown> {
  return {
    tenant_id: a.tenantId,
    user_id: a.userId,
    name: a.name,
    url: a.url,
    status: a.status,
    channel: a.channel,
    task_arn: a.taskArn ?? null,
    api_port: a.apiPort ?? null,
    dashboard_port: a.dashboardPort ?? null,
    secret_arn: a.secretArn ?? null,
    access_point_id: a.accessPointId ?? null,
    security_group_id: a.securityGroupId ?? null,
    personality_id: a.personalityId ?? null,
    created_at: a.createdAt,
  };
}

// Uses the SERVICE key (server-side only) — RLS is bypassed; ownership is enforced by the caller via user_id filters.
export class SupabaseAgentStore {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
  }

  async get(tenantId: string): Promise<StoredAgent | undefined> {
    const { data, error } = await this.db.from("agents").select("*").eq("tenant_id", tenantId).maybeSingle();
    if (error) throw new Error(`supabase get failed: ${error.message}`);
    return data ? rowToAgent(data) : undefined;
  }

  async getOwned(userId: string, tenantId: string): Promise<StoredAgent | undefined> {
    const { data, error } = await this.db
      .from("agents").select("*").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`supabase getOwned failed: ${error.message}`);
    return data ? rowToAgent(data) : undefined;
  }

  async listForUser(userId: string): Promise<StoredAgent[]> {
    const { data, error } = await this.db
      .from("agents").select("*").eq("user_id", userId).order("created_at", { ascending: false });
    if (error) throw new Error(`supabase listForUser failed: ${error.message}`);
    return (data ?? []).map(rowToAgent);
  }

  async put(agent: StoredAgent): Promise<void> {
    const { error } = await this.db.from("agents").upsert(agentToRow(agent), { onConflict: "tenant_id" });
    if (error) throw new Error(`supabase put failed: ${error.message}`);
  }

  async delete(tenantId: string): Promise<void> {
    const { error } = await this.db.from("agents").delete().eq("tenant_id", tenantId);
    if (error) throw new Error(`supabase delete failed: ${error.message}`);
  }
}

export function supabaseStoreFromEnv(env: Record<string, string | undefined> = process.env): SupabaseAgentStore {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required for the Supabase store");
  return new SupabaseAgentStore(url, key);
}
