import type { AgentRecord } from "./types";

export interface TeardownDeps {
  removeAlbWiring: (refs: { listenerRuleArn: string; targetGroupArn: string; ip: string }) => Promise<void>;
  stopTask: (taskArn: string) => Promise<void>;
  deregisterTaskDef: (arn: string) => Promise<void>;
  deleteTenantSg: (id: string) => Promise<void>;
  deleteSecret: (arn: string) => Promise<void>;
  deleteAccessPoint: (id: string) => Promise<void>;
  resolveTaskIp: (taskArn: string) => Promise<string>;
}

export async function teardownAgent(
  record: AgentRecord,
  deps: TeardownDeps,
  opts: { deleteData: boolean },
): Promise<void> {
  if (record.listenerRuleArn && record.targetGroupArn && record.taskArn) {
    // Best-effort IP resolve; deregister tolerates a stale IP and the target-group delete is the real cleanup.
    let ip = "0.0.0.0";
    try {
      ip = await deps.resolveTaskIp(record.taskArn);
    } catch {
      // task already stopped; proceed with target-group teardown
    }
    await deps.removeAlbWiring({
      listenerRuleArn: record.listenerRuleArn,
      targetGroupArn: record.targetGroupArn,
      ip,
    });
  }
  if (record.taskArn) await deps.stopTask(record.taskArn);
  if (record.taskDefArn) await deps.deregisterTaskDef(record.taskDefArn);
  if (record.securityGroupId) await deps.deleteTenantSg(record.securityGroupId);
  if (record.secretArn) await deps.deleteSecret(record.secretArn);
  if (opts.deleteData && record.accessPointId) {
    await deps.deleteAccessPoint(record.accessPointId);
  }
}
