// The worker package owns the Prisma schema + generated client. apps/web
// reads/writes the SAME Agent table (single-writer model: the API writes
// intent rows; the worker drives Docker). Re-export its singleton so there
// is exactly one client and one connection pool.
export { prisma } from "@hermes/deployer-worker/db";
