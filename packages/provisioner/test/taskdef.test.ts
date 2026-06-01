import { expect, test, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  DeregisterTaskDefinitionCommand,
} from "@aws-sdk/client-ecs";
import { registerTaskDef, deregisterTaskDef } from "../src/taskdef";
import type { Config } from "../src/config";

const ecs = mockClient(ECSClient);
beforeEach(() => ecs.reset());

const cfg = {
  region: "us-east-1",
  cluster: "hermes",
  subnetIds: ["subnet-a"],
  efsFilesystemId: "fs-1",
  albListenerArn: "arn:listener",
  albVpcId: "vpc-1",
  vpcCidr: "10.0.0.0/16",
  certDomain: "agents.example.com",
  executionRoleArn: "arn:exec",
  taskRoleArn: "arn:task",
  hermesImage: "nousresearch/hermes-agent:v2026.5.29.2",
} satisfies Config;

test("registerTaskDef encodes the verified Hermes runtime contract", async () => {
  ecs.on(RegisterTaskDefinitionCommand).resolves({
    taskDefinition: { taskDefinitionArn: "arn:td:1" },
  });
  const arn = await registerTaskDef(new ECSClient({}), cfg, "alice", {
    accessPointId: "fsap-1",
    secretRefs: [
      { name: "API_SERVER_KEY", valueFrom: "arn:s:API_SERVER_KEY::" },
      { name: "OPENROUTER_API_KEY", valueFrom: "arn:s:OPENROUTER_API_KEY::" },
    ],
  });
  expect(arn).toBe("arn:td:1");

  const input = ecs.commandCalls(RegisterTaskDefinitionCommand)[0]!.args[0].input as any;
  const c = input.containerDefinitions[0];
  expect(c.command).toEqual(["gateway", "run"]);
  const ports = c.portMappings.map((p: any) => p.containerPort);
  expect(ports).toContain(8642);
  expect(ports).toContain(9119);
  expect(c.mountPoints[0].containerPath).toBe("/opt/data");
  const env = Object.fromEntries(c.environment.map((e: any) => [e.name, e.value]));
  expect(env.API_SERVER_ENABLED).toBe("true");
  // Must bind 0.0.0.0 or the port is unreachable from outside the container.
  expect(env.HERMES_DASHBOARD).toBe("1");
  expect(env.HERMES_DASHBOARD_HOST).toBe("0.0.0.0");
  expect(env.API_SERVER_HOST).toBe("0.0.0.0");
  // Setting bootstrap-state races a second gateway starter and kills the dashboard on Fargate.
  expect(env.HERMES_GATEWAY_BOOTSTRAP_STATE).toBeUndefined();
  expect(env.HERMES_UID).toBe("10000");
  expect(c.healthCheck.command.join(" ")).toContain("8642/health");
  expect(c.healthCheck.startPeriod).toBe(60);
  expect(c.readonlyRootFilesystem).toBeUndefined();
  expect(c.user).toBeUndefined();
  expect(input.volumes[0].efsVolumeConfiguration.authorizationConfig.accessPointId).toBe("fsap-1");
  expect(input.volumes[0].efsVolumeConfiguration.transitEncryption).toBe("ENABLED");
  const secretNames = c.secrets.map((s: any) => s.name);
  expect(secretNames).toContain("OPENROUTER_API_KEY");
});

test("deregisterTaskDef calls deregister with arn", async () => {
  ecs.on(DeregisterTaskDefinitionCommand).resolves({});
  await deregisterTaskDef(new ECSClient({}), "arn:td:1");
  expect(ecs.commandCalls(DeregisterTaskDefinitionCommand)[0]!.args[0].input.taskDefinition).toBe("arn:td:1");
});
