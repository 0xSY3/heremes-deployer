import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. The worker is long-lived, but `tsx watch` (worker:dev)
// reloads modules on change, so we stash the instance on globalThis to avoid
// opening a fresh connection pool on every reload. Production never caches —
// the process loads the module exactly once.

const HERMES_GLOBAL_KEY = "__hermesDeployerPrisma";

declare global {
  // eslint-disable-next-line no-var
  var __hermesDeployerPrisma: PrismaClient | undefined;
}

const cached = (globalThis as { __hermesDeployerPrisma?: PrismaClient })
  .__hermesDeployerPrisma;

export const prisma =
  cached ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  (globalThis as { __hermesDeployerPrisma?: PrismaClient }).__hermesDeployerPrisma =
    prisma;
}

void HERMES_GLOBAL_KEY;
