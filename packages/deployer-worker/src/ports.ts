// Host-port allocator. PortAllocation is the source of truth so concurrent
// workers never hand out the same port. Concurrency safety comes solely from
// the UNIQUE primary key on PortAllocation.port: a losing racer's create()
// throws, which we treat as "taken, try next" — there is no transaction.
//
// Hermes twist: PortAllocation.agentId is NOT unique. Each agent takes TWO
// ports (API 8642 + dashboard 9119 host bindings), so allocatePort is called
// twice per agent and releasePort clears both rows by agentId.

import { config } from "./config";
import { prisma } from "./db";

export async function allocatePort(agentId: string): Promise<number> {
  const taken = new Set(
    (await prisma.portAllocation.findMany({ select: { port: true } })).map((r) => r.port),
  );

  for (let port = config.portMin; port <= config.portMax; port++) {
    if (taken.has(port)) continue;
    try {
      await prisma.portAllocation.create({ data: { port, agentId } });
      return port;
    } catch {
      // Another worker inserted this port between our findMany and create
      // (unique-key violation). Don't inspect the error — any create failure
      // here means "port no longer free"; advance to the next candidate.
      continue;
    }
  }

  throw new Error(`No free ports in range ${config.portMin}-${config.portMax}`);
}

export async function releasePort(agentId: string): Promise<void> {
  // deleteMany (not delete) because an agent owns two rows (api + dashboard);
  // idempotent — swallow errors so a release during teardown never throws.
  await prisma.portAllocation.deleteMany({ where: { agentId } }).catch(() => undefined);
}
