import { join } from "node:path";
import { z } from "zod";

export interface GatewayConfig {
  botToken: string;
  botUsername: string;
  connectTokensPath: string;
  chatLinksPath: string;
  storePath: string;
  model: string;
  mode: "polling" | "webhook";
  webhookUrl?: string;
  webhookSecret?: string;
}

const schema = z.object({
  // ARN variant fetches the token at runtime so it never sits in the ECS task def.
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_TOKEN_SECRET_ARN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().min(1, "TELEGRAM_BOT_USERNAME is required"),
  HERMES_CONNECT_TOKENS_PATH: z.string().optional(),
  HERMES_CHAT_LINKS_PATH: z.string().optional(),
  HERMES_STORE_PATH: z.string().optional(),
  HERMES_GATEWAY_MODEL: z.string().optional(),
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).optional(),
  TELEGRAM_WEBHOOK_URL: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
});

async function resolveBotToken(env: ReturnType<typeof schema.parse>): Promise<string> {
  if (env.TELEGRAM_BOT_TOKEN) return env.TELEGRAM_BOT_TOKEN;
  if (env.TELEGRAM_BOT_TOKEN_SECRET_ARN) {
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({ region: process.env.AWS_REGION ?? "us-east-1" });
    const out = await sm.send(new GetSecretValueCommand({ SecretId: env.TELEGRAM_BOT_TOKEN_SECRET_ARN }));
    if (out.SecretString) return out.SecretString;
  }
  throw new Error("Set TELEGRAM_BOT_TOKEN or TELEGRAM_BOT_TOKEN_SECRET_ARN");
}

// Default file paths point at the repo root, matching how apps/web locates the
// shared .agent-store.json.
export async function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): Promise<GatewayConfig> {
  const e = schema.parse(env);
  const root = (p: string): string => join(process.cwd(), "..", "..", p);
  return {
    botToken: await resolveBotToken(e),
    botUsername: e.TELEGRAM_BOT_USERNAME.replace(/^@/, ""),
    connectTokensPath: e.HERMES_CONNECT_TOKENS_PATH ?? root(".telegram-connect-tokens.json"),
    chatLinksPath: e.HERMES_CHAT_LINKS_PATH ?? root(".telegram-chat-links.json"),
    storePath: e.HERMES_STORE_PATH ?? root(".agent-store.json"),
    model: e.HERMES_GATEWAY_MODEL ?? "hermes",
    mode: e.TELEGRAM_MODE ?? "polling",
    ...(e.TELEGRAM_WEBHOOK_URL ? { webhookUrl: e.TELEGRAM_WEBHOOK_URL } : {}),
    ...(e.TELEGRAM_WEBHOOK_SECRET ? { webhookSecret: e.TELEGRAM_WEBHOOK_SECRET } : {}),
  };
}
