import { loadGatewayConfig } from "../src/config";
import { TelegramApi } from "../src/telegram-api";

try {
  process.loadEnvFile();
} catch {
  /* no .env */
}

async function main(): Promise<void> {
  const cfg = await loadGatewayConfig();
  const api = new TelegramApi(cfg.botToken);
  const action = process.argv[2];

  if (action === "delete") {
    await api.deleteWebhook();
    console.log("Webhook deleted — the bot will use long polling.");
    return;
  }

  if (!cfg.webhookUrl) {
    console.error("Set TELEGRAM_WEBHOOK_URL in .env before running set-webhook.");
    process.exit(1);
  }
  await api.setWebhook(cfg.webhookUrl, cfg.webhookSecret);
  console.log(`Webhook set to ${cfg.webhookUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
