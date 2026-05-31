import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import type { AgentRecord } from "./types";

type StoreData = Record<string, AgentRecord>;

export class AgentStore {
  constructor(private readonly path: string) {}

  // A corrupt store must not brick every route; recover to empty but preserve the bad file as <path>.corrupt-<ts>.
  private read(): StoreData {
    if (!existsSync(this.path)) return {};
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (e) {
      throw new Error(`agent store unreadable at ${this.path}: ${(e as Error).message}`, { cause: e });
    }
    if (raw.trim() === "") return {};
    try {
      return JSON.parse(raw) as StoreData;
    } catch (e) {
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`agent store corrupt; moved to ${backup}, starting empty:`, (e as Error).message);
      } catch {
        // Can't even move it: still don't brick — the next write overwrites it atomically.
        console.error(`agent store corrupt and un-movable; starting empty:`, (e as Error).message);
      }
      return {};
    }
  }

  // Write to a temp file then rename(2) over the target — atomic on the same FS, so a crash can't leave a half-written store.
  private write(data: StoreData): void {
    const tmp = `${this.path}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.path);
  }

  get(tenantId: string): AgentRecord | undefined {
    return this.read()[tenantId];
  }

  all(): AgentRecord[] {
    return Object.values(this.read());
  }

  put(record: AgentRecord): void {
    const data = this.read();
    data[record.tenantId] = record;
    this.write(data);
  }

  delete(tenantId: string): void {
    const data = this.read();
    delete data[tenantId];
    this.write(data);
  }
}
