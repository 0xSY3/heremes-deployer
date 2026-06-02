import { loadConfig } from "../src/config";
import { buildTeardownDeps } from "../src/clients";
import { buildLocalTeardownDeps } from "../src/local/local-deps";
import { teardownAgent } from "../src/teardown";
import { AgentStore } from "../src/store";
import { parseTeardownArgs } from "./args";

async function main(): Promise<void> {
  const args = parseTeardownArgs(process.argv.slice(2));
  const local = args.local || process.env.LOCAL === "1";
  const store = new AgentStore(".agent-store.json");
  const record = store.get(args.tenantId);
  if (!record) throw new Error(`No stored agent for tenant "${args.tenantId}"`);

  const deps = local
    ? buildLocalTeardownDeps(args.tenantId)
    : buildTeardownDeps(loadConfig());

  console.log(`Tearing down agent for "${args.tenantId}" (${local ? "local docker" : "aws fargate"}, deleteData=${args.deleteData})…`);
  await teardownAgent(record, deps, { deleteData: args.deleteData });
  store.delete(args.tenantId);
  console.log("✅ Teardown complete.");
}

main().catch((err) => {
  console.error("❌ Teardown failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
