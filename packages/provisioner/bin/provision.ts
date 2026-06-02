import { loadConfig, loadLocalConfig } from "../src/config";
import { buildProvisionDeps } from "../src/clients";
import { buildLocalProvisionDeps } from "../src/local/local-deps";
import { provisionAgent } from "../src/provision";
import { AgentStore } from "../src/store";
import { parseProvisionArgs } from "./args";
import type { ProvisionInput } from "../src/types";

async function main(): Promise<void> {
  const args = parseProvisionArgs(process.argv.slice(2));
  const local = args.local || process.env.LOCAL === "1";
  const cfg = local ? loadLocalConfig() : loadConfig();
  const input: ProvisionInput = {
    tenantId: args.tenantId,
    channel: args.channel,
    llmProvider: args.llmProvider,
    llmKey: args.llmKey,
    ...(args.channelToken ? { channelToken: args.channelToken } : {}),
  };

  if (args.dryRun) {
    console.log("[dry-run] would provision with:", {
      tenant: input.tenantId,
      channel: input.channel,
      provider: input.llmProvider,
      mode: local ? "local-docker" : "aws-fargate",
      url: local
        ? "http://localhost:<derived-port>"
        : `https://${input.tenantId}.${cfg.certDomain}`,
    });
    return;
  }

  const deps = local
    ? buildLocalProvisionDeps(cfg, input.tenantId)
    : buildProvisionDeps(cfg);

  console.log(`Provisioning agent for "${input.tenantId}" (${local ? "local docker" : "aws fargate"})…`);
  const record = await provisionAgent(cfg, input, deps);
  new AgentStore(".agent-store.json").put(record);
  console.log(`✅ Agent live: ${record.url}`);
}

main().catch((err) => {
  console.error("❌ Provision failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
