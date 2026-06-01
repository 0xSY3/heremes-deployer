import { expect, test, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  RegisterTargetsCommand,
  CreateRuleCommand,
  DescribeTargetHealthCommand,
  DeleteRuleCommand,
  DeregisterTargetsCommand,
  DeleteTargetGroupCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { createTargetGroup, registerIp, addHostRule, waitTargetHealthy, removeAlbWiring } from "../src/alb";

const elb = mockClient(ElasticLoadBalancingV2Client);
beforeEach(() => elb.reset());

test("createTargetGroup uses ip target type on port 8642 with /health", async () => {
  elb.on(CreateTargetGroupCommand).resolves({
    TargetGroups: [{ TargetGroupArn: "arn:tg:1" }],
  });
  const arn = await createTargetGroup(new ElasticLoadBalancingV2Client({}), "vpc-1", "alice");
  expect(arn).toBe("arn:tg:1");
  const input = elb.commandCalls(CreateTargetGroupCommand)[0]!.args[0].input as any;
  expect(input.TargetType).toBe("ip");
  expect(input.Port).toBe(8642);
  expect(input.HealthCheckPath).toBe("/health");
});

test("registerIp registers the task ip on port 8642", async () => {
  elb.on(RegisterTargetsCommand).resolves({});
  await registerIp(new ElasticLoadBalancingV2Client({}), "arn:tg:1", "10.0.0.5");
  const input = elb.commandCalls(RegisterTargetsCommand)[0]!.args[0].input as any;
  expect(input.Targets[0].Id).toBe("10.0.0.5");
  expect(input.Targets[0].Port).toBe(8642);
});

test("addHostRule routes the tenant subdomain to the target group", async () => {
  elb.on(CreateRuleCommand).resolves({ Rules: [{ RuleArn: "arn:rule:1" }] });
  const arn = await addHostRule(
    new ElasticLoadBalancingV2Client({}),
    "arn:listener",
    "arn:tg:1",
    "alice.agents.example.com",
    37,
  );
  expect(arn).toBe("arn:rule:1");
  const input = elb.commandCalls(CreateRuleCommand)[0]!.args[0].input as any;
  expect(input.Conditions[0].Values[0]).toBe("alice.agents.example.com");
  expect(input.Priority).toBe(37);
});

test("waitTargetHealthy resolves when target healthy", async () => {
  elb
    .on(DescribeTargetHealthCommand)
    .resolvesOnce({ TargetHealthDescriptions: [{ TargetHealth: { State: "initial" } }] })
    .resolves({ TargetHealthDescriptions: [{ TargetHealth: { State: "healthy" } }] });
  await waitTargetHealthy(new ElasticLoadBalancingV2Client({}), "arn:tg:1", "10.0.0.5", { intervalMs: 1, timeoutMs: 1000 });
  expect(elb.commandCalls(DescribeTargetHealthCommand).length).toBeGreaterThanOrEqual(2);
});

test("waitTargetHealthy tolerates a transient unused state then goes healthy", async () => {
  elb
    .on(DescribeTargetHealthCommand)
    .resolvesOnce({ TargetHealthDescriptions: [{ TargetHealth: { State: "unused" } }] })
    .resolves({ TargetHealthDescriptions: [{ TargetHealth: { State: "healthy" } }] });
  await waitTargetHealthy(new ElasticLoadBalancingV2Client({}), "arn:tg:1", "10.0.0.5", { intervalMs: 1, timeoutMs: 1000 });
  expect(elb.commandCalls(DescribeTargetHealthCommand).length).toBeGreaterThanOrEqual(2);
});

test("waitTargetHealthy throws when unused persists across polls", async () => {
  elb.on(DescribeTargetHealthCommand).resolves({
    TargetHealthDescriptions: [{ TargetHealth: { State: "unused" } }],
  });
  await expect(
    waitTargetHealthy(new ElasticLoadBalancingV2Client({}), "arn:tg:1", "10.0.0.5", { intervalMs: 1, timeoutMs: 1000 }),
  ).rejects.toThrow(/persistently unused/);
});

test("removeAlbWiring deletes rule, deregisters target, deletes group", async () => {
  elb.on(DeleteRuleCommand).resolves({});
  elb.on(DeregisterTargetsCommand).resolves({});
  elb.on(DeleteTargetGroupCommand).resolves({});
  await removeAlbWiring(new ElasticLoadBalancingV2Client({}), {
    listenerRuleArn: "arn:rule:1",
    targetGroupArn: "arn:tg:1",
    ip: "10.0.0.5",
  });
  expect(elb.commandCalls(DeleteRuleCommand).length).toBe(1);
  expect(elb.commandCalls(DeleteTargetGroupCommand).length).toBe(1);
});
