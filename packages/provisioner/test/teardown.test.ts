import { expect, test, vi } from "vitest";
import { teardownAgent, type TeardownDeps } from "../src/teardown";
import type { AgentRecord } from "../src/types";

const record: AgentRecord = {
  tenantId: "alice",
  url: "https://alice.agents.example.com",
  status: "running",
  taskArn: "arn:task:1",
  taskDefArn: "arn:td:1",
  accessPointId: "fsap-1",
  secretArn: "arn:sec",
  securityGroupId: "sg-1",
  targetGroupArn: "arn:tg:1",
  listenerRuleArn: "arn:rule:1",
  createdAt: "t",
};

function deps(): TeardownDeps {
  return {
    removeAlbWiring: vi.fn().mockResolvedValue(undefined),
    stopTask: vi.fn().mockResolvedValue(undefined),
    deregisterTaskDef: vi.fn().mockResolvedValue(undefined),
    deleteTenantSg: vi.fn().mockResolvedValue(undefined),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
    deleteAccessPoint: vi.fn().mockResolvedValue(undefined),
    resolveTaskIp: vi.fn().mockResolvedValue("10.0.0.5"),
  };
}

test("teardownAgent removes all resources, keeping data by default", async () => {
  const d = deps();
  await teardownAgent(record, d, { deleteData: false });
  expect(d.removeAlbWiring).toHaveBeenCalled();
  expect(d.stopTask).toHaveBeenCalledWith("arn:task:1");
  expect(d.deregisterTaskDef).toHaveBeenCalledWith("arn:td:1");
  expect(d.deleteTenantSg).toHaveBeenCalledWith("sg-1");
  expect(d.deleteSecret).toHaveBeenCalledWith("arn:sec");
  expect(d.deleteAccessPoint).not.toHaveBeenCalled();
});

test("teardownAgent deletes the EFS access point when deleteData=true", async () => {
  const d = deps();
  await teardownAgent(record, d, { deleteData: true });
  expect(d.deleteAccessPoint).toHaveBeenCalledWith("fsap-1");
});
