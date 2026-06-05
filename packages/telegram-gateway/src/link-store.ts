import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import type { ChatLink } from "./types";

// Atomic temp-file + rename(2) write, matching the provisioner's AgentStore.
export class ChatLinkStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, ChatLink> {
    if (!existsSync(this.path)) return {};
    const raw = readFileSync(this.path, "utf8");
    if (raw.trim() === "") return {};
    try {
      return JSON.parse(raw) as Record<string, ChatLink>;
    } catch {
      return {};
    }
  }

  private write(data: Record<string, ChatLink>): void {
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }

  get(chatId: number): ChatLink | undefined {
    return this.read()[String(chatId)];
  }

  put(link: ChatLink): void {
    const data = this.read();
    data[String(link.chatId)] = link;
    this.write(data);
  }

  delete(chatId: number): boolean {
    const data = this.read();
    if (!(String(chatId) in data)) return false;
    delete data[String(chatId)];
    this.write(data);
    return true;
  }

  findByTenant(tenantId: string): ChatLink[] {
    return Object.values(this.read()).filter((l) => l.tenantId === tenantId);
  }
}
