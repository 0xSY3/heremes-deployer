import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { ConnectTokenRecord } from "./types";

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes — long enough to tap a link

// Atomic temp-file + rename(2) write so a crash can't leave a half-written file.
export class ConnectTokenStore {
  constructor(
    private readonly path: string,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private read(): Record<string, ConnectTokenRecord> {
    if (!existsSync(this.path)) return {};
    const raw = readFileSync(this.path, "utf8");
    if (raw.trim() === "") return {};
    try {
      return JSON.parse(raw) as Record<string, ConnectTokenRecord>;
    } catch {
      // A corrupt token file must not brick the connect flow; tokens are disposable.
      return {};
    }
  }

  private write(data: Record<string, ConnectTokenRecord>): void {
    const tmp = `${this.path}.tmp-${process.pid}-${this.now()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }

  private prune(data: Record<string, ConnectTokenRecord>): Record<string, ConnectTokenRecord> {
    const t = this.now();
    for (const [k, v] of Object.entries(data)) {
      if (v.expiresAt <= t) delete data[k];
    }
    return data;
  }

  // Token is the Telegram start-parameter: must fit its 64-char [A-Za-z0-9_-] limit.
  mint(tenantId: string): ConnectTokenRecord {
    const data = this.prune(this.read());
    const createdAt = this.now();
    const rec: ConnectTokenRecord = {
      token: randomBytes(16).toString("base64url"),
      tenantId,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    data[rec.token] = rec;
    this.write(data);
    return rec;
  }

  // Single-use: deletes the token on consume so it can't be replayed.
  consume(token: string): string | null {
    const data = this.prune(this.read());
    const rec = data[token];
    if (!rec) {
      this.write(data); // persist the prune
      return null;
    }
    delete data[token];
    this.write(data);
    return rec.tenantId;
  }
}
