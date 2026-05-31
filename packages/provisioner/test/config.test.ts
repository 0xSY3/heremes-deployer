import { expect, test } from "vitest";
import { loadConfig } from "../src/config";

const valid = {
  AWS_REGION: "us-east-1",
  ECS_CLUSTER: "hermes",
  SUBNET_IDS: "subnet-a,subnet-b",
  EFS_FILESYSTEM_ID: "fs-123",
  ALB_LISTENER_ARN: "arn:aws:elasticloadbalancing:us-east-1:1:listener/app/x/y/z",
  ALB_VPC_ID: "vpc-1",
  VPC_CIDR: "10.0.0.0/16",
  CERT_DOMAIN: "agents.example.com",
  EXECUTION_ROLE_ARN: "arn:aws:iam::1:role/exec",
  TASK_ROLE_ARN: "arn:aws:iam::1:role/task",
  HERMES_IMAGE: "nousresearch/hermes-agent:v2026.5.29.2",
};

test("loadConfig parses a full valid env", () => {
  const cfg = loadConfig(valid);
  expect(cfg.subnetIds).toEqual(["subnet-a", "subnet-b"]);
  expect(cfg.region).toBe("us-east-1");
});

test("loadConfig throws listing all missing keys", () => {
  expect(() => loadConfig({})).toThrowError(/AWS_REGION/);
});
