import { join } from "node:path";
import { ConnectTokenStore, buildConnectLink } from "@hermes/telegram-gateway/connect";

// Repo-root default (dev server runs from apps/web); the gateway reads the same file.
const TOKENS_PATH =
  process.env.HERMES_CONNECT_TOKENS_PATH ??
  join(process.cwd(), "..", "..", ".telegram-connect-tokens.json");

const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");

const store = new ConnectTokenStore(TOKENS_PATH);

export function telegramConfigured(): boolean {
  return BOT_USERNAME.length > 0;
}

export interface ConnectLink {
  url: string;
  expiresAt: number;
}

export function mintConnectLink(tenantId: string): ConnectLink {
  if (!telegramConfigured()) throw new Error("TELEGRAM_BOT_USERNAME is not configured");
  const rec = store.mint(tenantId);
  return { url: buildConnectLink(BOT_USERNAME, rec.token), expiresAt: rec.expiresAt };
}
