import type { TelegramUpdate } from "./types";

export interface BotCommand {
  command: string;
  description: string;
}

export class TelegramApi {
  constructor(
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result as T;
  }

  getMe(): Promise<{ id: number; username: string; first_name: string }> {
    return this.call("getMe");
  }

  // `timeout` is the server-side long-poll hold in seconds.
  getUpdates(offset: number, timeout = 30): Promise<TelegramUpdate[]> {
    return this.call("getUpdates", { offset, timeout, allowed_updates: ["message"] });
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    await this.call("sendMessage", { chat_id: chatId, text });
  }

  // Expires after ~5s; the caller refreshes it on a loop.
  async sendChatAction(chatId: number, action = "typing"): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action });
  }

  async setMyCommands(commands: BotCommand[]): Promise<void> {
    await this.call("setMyCommands", { commands });
  }

  async setWebhook(url: string, secretToken?: string): Promise<void> {
    await this.call("setWebhook", {
      url,
      allowed_updates: ["message"],
      ...(secretToken ? { secret_token: secretToken } : {}),
    });
  }

  async deleteWebhook(): Promise<void> {
    await this.call("deleteWebhook", {});
  }
}
