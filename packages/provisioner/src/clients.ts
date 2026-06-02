import { createHash } from "node:crypto";
import { ECSClient } from "@aws-sdk/client-ecs";
import { EFSClient } from "@aws-sdk/client-efs";
import { EC2Client } from "@aws-sdk/client-ec2";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import type { Config } from "./config";
import type { ProvisionDeps } from "./provision";
import type { TeardownDeps } from "./teardown";
import { createAccessPoint, deleteAccessPoint } from "./efs";
import { createSecret, deleteSecret } from "./secrets";
import { createTenantSg, createPublicTenantSg, deleteTenantSg } from "./security-group";
import { registerTaskDef, deregisterTaskDef } from "./taskdef";
import { runTask, waitForHealthy, resolveTaskIp, resolveTaskPublicIp, stopTask } from "./run";
import {
  createTargetGroup, registerIp, addHostRule, waitTargetHealthy, removeAlbWiring,
} from "./alb";

const HERMES_DASHBOARD_PORT = 9119;

// ALB needs a unique priority in 1..50000 per listener; a stable hash is collision-resistant and reproducible for teardown.
function rulePriority(tenantId: string): number {
  const h = createHash("sha256").update(tenantId).digest();
  return (h.readUInt32BE(0) % 50000) + 1;
}

export function buildProvisionDeps(cfg: Config): ProvisionDeps {
  const ecs = new ECSClient({ region: cfg.region });
  const efs = new EFSClient({ region: cfg.region });
  const ec2 = new EC2Client({ region: cfg.region });
  const sm = new SecretsManagerClient({ region: cfg.region });
  const elb = new ElasticLoadBalancingV2Client({ region: cfg.region });

  return {
    createAccessPoint: (fsId, tenantId) => createAccessPoint(efs, fsId, tenantId),
    deleteAccessPoint: (id) => deleteAccessPoint(efs, id),
    createSecret: (tenantId, payload) => createSecret(sm, tenantId, payload),
    deleteSecret: (arn) => deleteSecret(sm, arn),
    createTenantSg: (vpcId, tenantId) => createTenantSg(ec2, vpcId, cfg.vpcCidr, tenantId),
    deleteTenantSg: (id) => deleteTenantSg(ec2, id),
    registerTaskDef: (tenantId, input) => registerTaskDef(ecs, cfg, tenantId, input),
    deregisterTaskDef: (arn) => deregisterTaskDef(ecs, arn),
    runTask: (taskDefArn, sgId) => runTask(ecs, cfg, taskDefArn, sgId),
    waitForHealthy: (taskArn) => waitForHealthy(ecs, cfg.cluster, taskArn),
    resolveTaskIp: (taskArn) => resolveTaskIp(ecs, ec2, cfg.cluster, taskArn),
    stopTask: (taskArn) => stopTask(ecs, cfg.cluster, taskArn),
    createTargetGroup: (vpcId, tenantId) => createTargetGroup(elb, vpcId, tenantId),
    registerIp: (tgArn, ip) => registerIp(elb, tgArn, ip),
    addHostRule: (listenerArn, tgArn, host, priority) => addHostRule(elb, listenerArn, tgArn, host, priority),
    waitTargetHealthy: (tgArn, ip) => waitTargetHealthy(elb, tgArn, ip),
    removeAlbWiring: (refs) => removeAlbWiring(elb, refs),
    rulePriority,
  };
}

export function buildTeardownDeps(cfg: Config): TeardownDeps {
  const ecs = new ECSClient({ region: cfg.region });
  const efs = new EFSClient({ region: cfg.region });
  const ec2 = new EC2Client({ region: cfg.region });
  const sm = new SecretsManagerClient({ region: cfg.region });
  const elb = new ElasticLoadBalancingV2Client({ region: cfg.region });

  return {
    removeAlbWiring: (refs) => removeAlbWiring(elb, refs),
    stopTask: (taskArn) => stopTask(ecs, cfg.cluster, taskArn),
    deregisterTaskDef: (arn) => deregisterTaskDef(ecs, arn),
    deleteTenantSg: (id) => deleteTenantSg(ec2, id),
    deleteSecret: (arn) => deleteSecret(sm, arn),
    deleteAccessPoint: (id) => deleteAccessPoint(efs, id),
    resolveTaskIp: (taskArn) => resolveTaskIp(ecs, ec2, cfg.cluster, taskArn),
  };
}

// Public-IP AWS path (no ALB): agent reached directly at http://<publicIp>:9119, ALB deps are no-ops.
export function buildAwsPublicProvisionDeps(cfg: Config): ProvisionDeps {
  const ecs = new ECSClient({ region: cfg.region });
  const efs = new EFSClient({ region: cfg.region });
  const ec2 = new EC2Client({ region: cfg.region });
  const sm = new SecretsManagerClient({ region: cfg.region });

  return {
    createAccessPoint: (fsId, tenantId) => createAccessPoint(efs, fsId, tenantId),
    deleteAccessPoint: (id) => deleteAccessPoint(efs, id),
    createSecret: (tenantId, payload) => createSecret(sm, tenantId, payload),
    deleteSecret: (arn) => deleteSecret(sm, arn),
    createTenantSg: (vpcId, tenantId) => createPublicTenantSg(ec2, vpcId, cfg.vpcCidr, tenantId),
    deleteTenantSg: (id) => deleteTenantSg(ec2, id),
    registerTaskDef: (tenantId, input) => registerTaskDef(ecs, cfg, tenantId, input),
    deregisterTaskDef: (arn) => deregisterTaskDef(ecs, arn),
    runTask: (taskDefArn, sgId) => runTask(ecs, cfg, taskDefArn, sgId, "ENABLED"),
    waitForHealthy: (taskArn) => waitForHealthy(ecs, cfg.cluster, taskArn),
    resolveTaskIp: (taskArn) => resolveTaskPublicIp(ecs, ec2, cfg.cluster, taskArn),
    stopTask: (taskArn) => stopTask(ecs, cfg.cluster, taskArn),
    createTargetGroup: async () => "no-alb",
    registerIp: async () => undefined,
    addHostRule: async () => "no-alb",
    waitTargetHealthy: async () => undefined,
    removeAlbWiring: async () => undefined,
    rulePriority: () => 1,
    buildUrl: (_tenantId, ip) => `http://${ip}:${HERMES_DASHBOARD_PORT}`,
  };
}

export function buildAwsPublicTeardownDeps(cfg: Config): TeardownDeps {
  const ecs = new ECSClient({ region: cfg.region });
  const efs = new EFSClient({ region: cfg.region });
  const ec2 = new EC2Client({ region: cfg.region });
  const sm = new SecretsManagerClient({ region: cfg.region });

  return {
    removeAlbWiring: async () => undefined,
    stopTask: (taskArn) => stopTask(ecs, cfg.cluster, taskArn),
    deregisterTaskDef: (arn) => deregisterTaskDef(ecs, arn),
    deleteTenantSg: (id) => deleteTenantSg(ec2, id),
    deleteSecret: (arn) => deleteSecret(sm, arn),
    deleteAccessPoint: (id) => deleteAccessPoint(efs, id),
    resolveTaskIp: (taskArn) => resolveTaskPublicIp(ecs, ec2, cfg.cluster, taskArn),
  };
}
