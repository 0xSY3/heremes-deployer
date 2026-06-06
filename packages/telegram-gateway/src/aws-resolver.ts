import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { AgentResolver } from "./agent-resolver";
import type { AgentEndpoint } from "./types";

interface AgentLookup {
  get(tenantId: string): Promise<{ status: string; url: string; secretArn?: string } | undefined>;
}

// Stored URL is the dashboard (:9119); the API we relay to is :8642 on the same host.
export class AwsAgentResolver implements AgentResolver {
  private readonly sm: SecretsManagerClient;

  constructor(
    private readonly store: AgentLookup,
    region: string,
  ) {
    this.sm = new SecretsManagerClient({ region });
  }

  async resolve(tenantId: string): Promise<AgentEndpoint | null> {
    const rec = await this.store.get(tenantId);
    if (!rec || rec.status !== "running" || !rec.secretArn) return null;

    const host = hostFromUrl(rec.url);
    if (!host) return null;

    const apiKey = await this.readSecretKey(rec.secretArn, "API_SERVER_KEY");
    if (!apiKey) return null;

    return { baseUrl: `http://${host}:8642`, apiKey };
  }

  // The secret is a JSON blob { API_SERVER_KEY, OPENROUTER_API_KEY, ... }.
  private async readSecretKey(secretArn: string, key: string): Promise<string | null> {
    try {
      const out = await this.sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
      if (!out.SecretString) return null;
      const parsed = JSON.parse(out.SecretString) as Record<string, string>;
      return parsed[key] ?? null;
    } catch {
      return null;
    }
  }
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
