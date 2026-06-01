import { expect, test, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  EC2Client,
  CreateSecurityGroupCommand,
  RevokeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupEgressCommand,
  DeleteSecurityGroupCommand,
} from "@aws-sdk/client-ec2";
import { createTenantSg, deleteTenantSg } from "../src/security-group";

const ec2 = mockClient(EC2Client);
beforeEach(() => ec2.reset());

test("createTenantSg revokes default egress then allows only 443+dns+nfs", async () => {
  ec2.on(CreateSecurityGroupCommand).resolves({ GroupId: "sg-1" });
  ec2.on(RevokeSecurityGroupEgressCommand).resolves({});
  ec2.on(AuthorizeSecurityGroupEgressCommand).resolves({});
  const id = await createTenantSg(new EC2Client({}), "vpc-1", "10.0.0.0/16", "alice");
  expect(id).toBe("sg-1");
  expect(ec2.commandCalls(RevokeSecurityGroupEgressCommand).length).toBe(1);
  const auth = ec2.commandCalls(AuthorizeSecurityGroupEgressCommand)[0]!.args[0].input as any;
  const ports = auth.IpPermissions.map((p: any) => p.FromPort);
  expect(ports).toContain(443);
  expect(ports).toContain(53);
  // NFS egress scoped to the in-VPC CIDR, not the internet.
  const nfs = auth.IpPermissions.find((p: any) => p.FromPort === 2049);
  expect(nfs).toBeDefined();
  expect(nfs.IpRanges[0].CidrIp).toBe("10.0.0.0/16");
});

test("deleteTenantSg deletes by id", async () => {
  ec2.on(DeleteSecurityGroupCommand).resolves({});
  await deleteTenantSg(new EC2Client({}), "sg-1");
  expect(ec2.commandCalls(DeleteSecurityGroupCommand)[0]!.args[0].input.GroupId).toBe("sg-1");
});
