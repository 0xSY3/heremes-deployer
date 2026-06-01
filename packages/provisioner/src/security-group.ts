import {
  EC2Client,
  CreateSecurityGroupCommand,
  RevokeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupEgressCommand,
  AuthorizeSecurityGroupIngressCommand,
  DeleteSecurityGroupCommand,
} from "@aws-sdk/client-ec2";

const HERMES_API_PORT = 8642;
const HERMES_DASHBOARD_PORT = 9119;

// Hostile-tenant egress lockdown: deny-all, allow only HTTPS, DNS, and in-VPC NFS so a compromised agent can't spam/scan/mine.
export async function createTenantSg(
  client: EC2Client,
  vpcId: string,
  vpcCidr: string,
  tenantId: string,
): Promise<string> {
  const created = await client.send(
    new CreateSecurityGroupCommand({
      GroupName: `hermes-${tenantId}-${Date.now()}`,
      Description: `Egress-locked SG for Hermes tenant ${tenantId}`,
      VpcId: vpcId,
      TagSpecifications: [
        { ResourceType: "security-group", Tags: [{ Key: "tenant", Value: tenantId }] },
      ],
    }),
  );
  const groupId = created.GroupId;
  if (!groupId) throw new Error("Security group creation returned no id");

  // Remove AWS's implicit allow-all-egress rule.
  await client.send(
    new RevokeSecurityGroupEgressCommand({
      GroupId: groupId,
      IpPermissions: [
        { IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
      ],
    }),
  );

  await client.send(
    new AuthorizeSecurityGroupEgressCommand({
      GroupId: groupId,
      IpPermissions: [
        { IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        { IpProtocol: "udp", FromPort: 53, ToPort: 53, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        { IpProtocol: "tcp", FromPort: 53, ToPort: 53, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        // EFS mounts on NFS/2049 (even with transit encryption), not 443; scoped to VPC CIDR so 2049 stays blocked to the internet.
        { IpProtocol: "tcp", FromPort: 2049, ToPort: 2049, IpRanges: [{ CidrIp: vpcCidr }] },
      ],
    }),
  );

  return groupId;
}

// Public-IP variant: same egress lockdown plus inbound 8642/9119 from 0.0.0.0/0 (no ALB). API is protected by API_SERVER_KEY, dashboard by nothing — testing only, not public launch.
export async function createPublicTenantSg(
  client: EC2Client,
  vpcId: string,
  vpcCidr: string,
  tenantId: string,
): Promise<string> {
  const groupId = await createTenantSg(client, vpcId, vpcCidr, tenantId);
  await client.send(
    new AuthorizeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [
        { IpProtocol: "tcp", FromPort: HERMES_API_PORT, ToPort: HERMES_API_PORT, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
        { IpProtocol: "tcp", FromPort: HERMES_DASHBOARD_PORT, ToPort: HERMES_DASHBOARD_PORT, IpRanges: [{ CidrIp: "0.0.0.0/0" }] },
      ],
    }),
  );
  return groupId;
}

export async function deleteTenantSg(client: EC2Client, groupId: string): Promise<void> {
  await client.send(new DeleteSecurityGroupCommand({ GroupId: groupId }));
}
