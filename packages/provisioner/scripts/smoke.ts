// Hits real AWS — needs AWS creds, a populated .env, and SMOKE_LLM_KEY.
import { loadConfig } from "../src/config";
import { buildProvisionDeps, buildTeardownDeps } from "../src/clients";
import { provisionAgent } from "../src/provision";
import { teardownAgent } from "../src/teardown";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const llmKey = process.env.SMOKE_LLM_KEY;
  if (!llmKey) throw new Error("SMOKE_LLM_KEY env var required for smoke test");
  const tenantId = `smoke-${process.env.SMOKE_TAG ?? "test"}`;

  const record = await provisionAgent(
    cfg,
    { tenantId, channel: "web", llmProvider: "openrouter", llmKey },
    buildProvisionDeps(cfg),
  );
  console.log(`Provisioned: ${record.url}`);

  try {
    const res = await fetch(`${record.url}/health`);
    console.log(`GET /health → ${res.status}`);
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    console.log("✅ Health check passed.");
  } finally {
    console.log("Tearing down…");
    await teardownAgent(record, buildTeardownDeps(cfg), { deleteData: true });
    console.log("✅ Teardown complete. No resources should remain.");
  }
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
