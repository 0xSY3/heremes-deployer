import {
  EFSClient,
  CreateAccessPointCommand,
  DeleteAccessPointCommand,
} from "@aws-sdk/client-efs";

const HERMES_UID = 10000;

export async function createAccessPoint(
  client: EFSClient,
  filesystemId: string,
  tenantId: string,
): Promise<string> {
  const out = await client.send(
    new CreateAccessPointCommand({
      FileSystemId: filesystemId,
      Tags: [{ Key: "tenant", Value: tenantId }],
      RootDirectory: {
        Path: `/tenants/${tenantId}`,
        CreationInfo: {
          OwnerUid: HERMES_UID,
          OwnerGid: HERMES_UID,
          Permissions: "0755",
        },
      },
      PosixUser: { Uid: HERMES_UID, Gid: HERMES_UID },
    }),
  );
  if (!out.AccessPointId) throw new Error("EFS access point creation returned no id");
  return out.AccessPointId;
}

export async function deleteAccessPoint(client: EFSClient, accessPointId: string): Promise<void> {
  await client.send(new DeleteAccessPointCommand({ AccessPointId: accessPointId }));
}
