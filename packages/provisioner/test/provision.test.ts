import { expect, test, vi } from "vitest";
import { provisionAgent, type ProvisionDeps } from "../src/provision";
import type { Config } from "../src/config";

const cfg = {
  region: "us-east-1", cluster: "hermes", subnetIds: ["subnet-a"],
  efsFilesystemId: "fs-1", albListenerArn: "arn:listener", albVpcId: "vpc-1",
  vpcCidr: "10.0.0.0/16",
  certDomain: "agents.example.com", executionRoleArn: "e", taskRoleArn: "t",
  hermesImage: "img",
} satisfies Config;

function happyDeps(overrides: Partial<ProvisionDeps> = {}): ProvisionDeps {
  return {
    createAccessPoint: vi.fn().mockResolvedValue("fsap-1"),
    deleteAccessPoint: vi.fn().mockResolvedValue(undefined),
    createSecret: vi.fn().mockResolvedValue({ arn: "arn:sec", refs: [{ name: "OPENROUTER_API_KEY", valueFrom: "v" }] }),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
    createTenantSg: vi.fn().mockResolvedValue("sg-1"),
    deleteTenantSg: vi.fn().mockResolvedValue(undefined),
    registerTaskDef: vi.fn().mockResolvedValue("arn:td:1"),
    deregisterTaskDef: vi.fn().mockResolvedValue(undefined),
    runTask: vi.fn().mockResolvedValue("arn:task:1"),
    waitForHealthy: vi.fn().mockResolvedValue(undefined),
    resolveTaskIp: vi.fn().mockResolvedValue("10.0.0.5"),
    stopTask: vi.fn().mockResolvedValue(undefined),
    createTargetGroup: vi.fn().mockResolvedValue("arn:tg:1"),
    registerIp: vi.fn().mockResolvedValue(undefined),
    addHostRule: vi.fn().mockResolvedValue("arn:rule:1"),
    waitTargetHealthy: vi.fn().mockResolvedValue(undefined),
    removeAlbWiring: vi.fn().mockResolvedValue(undefined),
    rulePriority: vi.fn().mockReturnValue(42),
    ...overrides,
  };
}

const input = {
  tenantId: "alice", channel: "web" as const,
  llmProvider: "openrouter" as const, llmKey: "sk-or-x",
};

test("provisionAgent returns a running record with the tenant url", async () => {
  const deps = happyDeps();
  const rec = await provisionAgent(cfg, input, deps);
  expect(rec.status).toBe("running");
  expect(rec.url).toBe("https://alice.agents.example.com");
  expect(rec.taskArn).toBe("arn:task:1");
});

test("provisionAgent rolls back created resources when health wait fails", async () => {
  const deps = happyDeps({
    waitForHealthy: vi.fn().mockRejectedValue(new Error("never healthy")),
  });
  await expect(provisionAgent(cfg, input, deps)).rejects.toThrow(/never healthy/);
  expect(deps.stopTask).toHaveBeenCalled();
  expect(deps.deregisterTaskDef).toHaveBeenCalled();
  expect(deps.deleteTenantSg).toHaveBeenCalled();
  expect(deps.deleteSecret).toHaveBeenCalled();
  expect(deps.deleteAccessPoint).toHaveBeenCalled();
  // ALB wiring never happened, so it must NOT be torn down.
  expect(deps.removeAlbWiring).not.toHaveBeenCalled();
});
