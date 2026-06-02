import { expect, test } from "vitest";
import { buildProvisionDeps, buildTeardownDeps } from "../src/clients";
import type { Config } from "../src/config";

const cfg = {
  region: "us-east-1", cluster: "hermes", subnetIds: ["subnet-a"],
  efsFilesystemId: "fs-1", albListenerArn: "a", albVpcId: "vpc-1",
  vpcCidr: "10.0.0.0/16",
  certDomain: "agents.example.com", executionRoleArn: "e", taskRoleArn: "t",
  hermesImage: "img",
} satisfies Config;

test("buildProvisionDeps wires every ProvisionDeps method", () => {
  const deps = buildProvisionDeps(cfg);
  for (const key of [
    "createAccessPoint", "deleteAccessPoint", "createSecret", "deleteSecret",
    "createTenantSg", "deleteTenantSg", "registerTaskDef", "deregisterTaskDef",
    "runTask", "waitForHealthy", "resolveTaskIp", "stopTask",
    "createTargetGroup", "registerIp", "addHostRule", "waitTargetHealthy",
    "removeAlbWiring", "rulePriority",
  ]) {
    expect(typeof (deps as any)[key]).toBe("function");
  }
});

test("rulePriority is deterministic and in ALB's 1-50000 range", () => {
  const deps = buildProvisionDeps(cfg);
  const a = deps.rulePriority("alice");
  const b = deps.rulePriority("alice");
  expect(a).toBe(b);
  expect(a).toBeGreaterThanOrEqual(1);
  expect(a).toBeLessThanOrEqual(50000);
});

test("buildTeardownDeps wires every TeardownDeps method", () => {
  const deps = buildTeardownDeps(cfg);
  for (const key of [
    "removeAlbWiring", "stopTask", "deregisterTaskDef", "deleteTenantSg",
    "deleteSecret", "deleteAccessPoint", "resolveTaskIp",
  ]) {
    expect(typeof (deps as any)[key]).toBe("function");
  }
});
