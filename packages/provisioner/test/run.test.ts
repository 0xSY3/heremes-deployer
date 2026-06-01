import { expect, test, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
} from "@aws-sdk/client-ec2";
import { runTask, waitForHealthy, resolveTaskIp, resolveTaskPublicIp, stopTask } from "../src/run";
import type { Config } from "../src/config";

const ecs = mockClient(ECSClient);
const ec2 = mockClient(EC2Client);
beforeEach(() => {
  ecs.reset();
  ec2.reset();
});

const cfg = {
  region: "us-east-1", cluster: "hermes", subnetIds: ["subnet-a"],
  efsFilesystemId: "fs-1", albListenerArn: "a", albVpcId: "vpc-1",
  vpcCidr: "10.0.0.0/16",
  certDomain: "agents.example.com", executionRoleArn: "e", taskRoleArn: "t",
  hermesImage: "img",
} satisfies Config;

test("runTask launches Fargate task in the tenant SG and returns arn", async () => {
  ecs.on(RunTaskCommand).resolves({ tasks: [{ taskArn: "arn:task:1" }] });
  const arn = await runTask(new ECSClient({}), cfg, "arn:td:1", "sg-1");
  expect(arn).toBe("arn:task:1");
  const input = ecs.commandCalls(RunTaskCommand)[0]!.args[0].input as any;
  expect(input.launchType).toBe("FARGATE");
  expect(input.networkConfiguration.awsvpcConfiguration.securityGroups).toEqual(["sg-1"]);
});

test("waitForHealthy polls until container HEALTHY", async () => {
  ecs
    .on(DescribeTasksCommand)
    .resolvesOnce({ tasks: [{ lastStatus: "PENDING", containers: [{ healthStatus: "UNKNOWN" }] }] })
    .resolves({ tasks: [{ lastStatus: "RUNNING", containers: [{ healthStatus: "HEALTHY" }] }] });
  await waitForHealthy(new ECSClient({}), "hermes", "arn:task:1", { intervalMs: 1, timeoutMs: 1000 });
  expect(ecs.commandCalls(DescribeTasksCommand).length).toBeGreaterThanOrEqual(2);
});

test("waitForHealthy throws if task STOPPED", async () => {
  ecs.on(DescribeTasksCommand).resolves({
    tasks: [{ lastStatus: "STOPPED", stoppedReason: "boom", containers: [] }],
  });
  await expect(
    waitForHealthy(new ECSClient({}), "hermes", "arn:task:1", { intervalMs: 1, timeoutMs: 1000 }),
  ).rejects.toThrow(/boom/);
});

test("resolveTaskIp follows ENI attachment to a private IP", async () => {
  ecs.on(DescribeTasksCommand).resolves({
    tasks: [{ attachments: [{ type: "ElasticNetworkInterface", details: [{ name: "networkInterfaceId", value: "eni-1" }] }] }],
  });
  ec2.on(DescribeNetworkInterfacesCommand).resolves({
    NetworkInterfaces: [{ PrivateIpAddress: "10.0.0.5" }],
  });
  const ip = await resolveTaskIp(new ECSClient({}), new EC2Client({}), "hermes", "arn:task:1");
  expect(ip).toBe("10.0.0.5");
});

test("stopTask stops by arn", async () => {
  ecs.on(StopTaskCommand).resolves({});
  await stopTask(new ECSClient({}), "hermes", "arn:task:1");
  expect(ecs.commandCalls(StopTaskCommand)[0]!.args[0].input.task).toBe("arn:task:1");
});

test("runTask with ENABLED assigns a public IP (MVP mode)", async () => {
  ecs.on(RunTaskCommand).resolves({ tasks: [{ taskArn: "arn:task:2" }] });
  await runTask(new ECSClient({}), cfg, "arn:td:1", "sg-1", "ENABLED");
  const input = ecs.commandCalls(RunTaskCommand)[0]!.args[0].input as any;
  expect(input.networkConfiguration.awsvpcConfiguration.assignPublicIp).toBe("ENABLED");
});

test("resolveTaskPublicIp returns the ENI's public IP", async () => {
  ecs.on(DescribeTasksCommand).resolves({
    tasks: [{ attachments: [{ type: "ElasticNetworkInterface", details: [{ name: "networkInterfaceId", value: "eni-2" }] }] }],
  });
  ec2.on(DescribeNetworkInterfacesCommand).resolves({
    NetworkInterfaces: [{ Association: { PublicIp: "54.1.2.3" } }],
  });
  const ip = await resolveTaskPublicIp(new ECSClient({}), new EC2Client({}), "hermes", "arn:task:2");
  expect(ip).toBe("54.1.2.3");
});

test("resolveTaskPublicIp throws clearly when no public IP (private subnet)", async () => {
  ecs.on(DescribeTasksCommand).resolves({
    tasks: [{ attachments: [{ type: "ElasticNetworkInterface", details: [{ name: "networkInterfaceId", value: "eni-3" }] }] }],
  });
  ec2.on(DescribeNetworkInterfacesCommand).resolves({ NetworkInterfaces: [{ PrivateIpAddress: "10.0.0.9" }] });
  await expect(
    resolveTaskPublicIp(new ECSClient({}), new EC2Client({}), "hermes", "arn:task:3"),
  ).rejects.toThrow(/public subnet/i);
});
