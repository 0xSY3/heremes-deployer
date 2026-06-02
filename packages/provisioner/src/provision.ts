import { randomBytes } from "node:crypto";
import type { Config } from "./config";
import type { ProvisionInput, AgentRecord } from "./types";
import type { SecretRef } from "./secrets";

export interface ProvisionDeps {
  createAccessPoint: (fsId: string, tenantId: string) => Promise<string>;
  deleteAccessPoint: (id: string) => Promise<void>;
  createSecret: (tenantId: string, payload: Record<string, string>) => Promise<{ arn: string; refs: SecretRef[] }>;
  deleteSecret: (arn: string) => Promise<void>;
  createTenantSg: (vpcId: string, tenantId: string) => Promise<string>;
  deleteTenantSg: (id: string) => Promise<void>;
  registerTaskDef: (tenantId: string, input: { accessPointId: string; secretRefs: SecretRef[] }) => Promise<string>;
  deregisterTaskDef: (arn: string) => Promise<void>;
  runTask: (taskDefArn: string, sgId: string) => Promise<string>;
  waitForHealthy: (taskArn: string) => Promise<void>;
  resolveTaskIp: (taskArn: string) => Promise<string>;
  stopTask: (taskArn: string) => Promise<void>;
  createTargetGroup: (vpcId: string, tenantId: string) => Promise<string>;
  registerIp: (tgArn: string, ip: string) => Promise<void>;
  addHostRule: (listenerArn: string, tgArn: string, host: string, priority: number) => Promise<string>;
  waitTargetHealthy: (tgArn: string, ip: string) => Promise<void>;
  removeAlbWiring: (refs: { listenerRuleArn: string; targetGroupArn: string; ip: string }) => Promise<void>;
  rulePriority: (tenantId: string) => number;
  // Optional URL override; unset on the ALB path (uses the ALB host), set by the local/public paths.
  buildUrl?: (tenantId: string, ip: string) => string;
}

function llmEnvName(provider: ProvisionInput["llmProvider"]): string {
  return provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENROUTER_API_KEY";
}

export async function provisionAgent(
  cfg: Config,
  input: ProvisionInput,
  deps: ProvisionDeps,
): Promise<AgentRecord> {
  const host = `${input.tenantId}.${cfg.certDomain}`;
  // Track created resources for reverse-order rollback on any failure.
  const rollback: Array<() => Promise<void>> = [];
  const undo = async () => {
    for (const fn of rollback.reverse()) {
      try {
        await fn();
      } catch {
        // best-effort cleanup; surface the original error, not cleanup noise
      }
    }
  };

  try {
    const accessPointId = await deps.createAccessPoint(cfg.efsFilesystemId, input.tenantId);
    rollback.push(() => deps.deleteAccessPoint(accessPointId));

    const secretPayload: Record<string, string> = {
      API_SERVER_KEY: randomBytes(24).toString("hex"),
      [llmEnvName(input.llmProvider)]: input.llmKey,
    };
    if (input.channelToken && input.channel === "telegram") {
      secretPayload.TELEGRAM_BOT_TOKEN = input.channelToken;
    }
    const secret = await deps.createSecret(input.tenantId, secretPayload);
    rollback.push(() => deps.deleteSecret(secret.arn));

    const sgId = await deps.createTenantSg(cfg.albVpcId, input.tenantId);
    rollback.push(() => deps.deleteTenantSg(sgId));

    const taskDefArn = await deps.registerTaskDef(input.tenantId, {
      accessPointId,
      secretRefs: secret.refs,
    });
    rollback.push(() => deps.deregisterTaskDef(taskDefArn));

    const taskArn = await deps.runTask(taskDefArn, sgId);
    rollback.push(() => deps.stopTask(taskArn));

    await deps.waitForHealthy(taskArn);
    const ip = await deps.resolveTaskIp(taskArn);

    const targetGroupArn = await deps.createTargetGroup(cfg.albVpcId, input.tenantId);
    const listenerRuleArn = await deps.addHostRule(
      cfg.albListenerArn,
      targetGroupArn,
      host,
      deps.rulePriority(input.tenantId),
    );
    await deps.registerIp(targetGroupArn, ip);
    rollback.push(() => deps.removeAlbWiring({ listenerRuleArn, targetGroupArn, ip }));

    await deps.waitTargetHealthy(targetGroupArn, ip);

    return {
      tenantId: input.tenantId,
      url: deps.buildUrl ? deps.buildUrl(input.tenantId, ip) : `https://${host}`,
      status: "running",
      taskArn,
      taskDefArn,
      accessPointId,
      secretArn: secret.arn,
      securityGroupId: sgId,
      targetGroupArn,
      listenerRuleArn,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    await undo();
    throw err;
  }
}
