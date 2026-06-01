import { expect, test, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  EFSClient,
  CreateAccessPointCommand,
  DeleteAccessPointCommand,
} from "@aws-sdk/client-efs";
import { createAccessPoint, deleteAccessPoint } from "../src/efs";

const efs = mockClient(EFSClient);
beforeEach(() => efs.reset());

test("createAccessPoint requests tenant path with uid/gid 10000", async () => {
  efs.on(CreateAccessPointCommand).resolves({ AccessPointId: "fsap-1" });
  const id = await createAccessPoint(new EFSClient({}), "fs-1", "alice");
  expect(id).toBe("fsap-1");
  const call = efs.commandCalls(CreateAccessPointCommand)[0]!.args[0].input as any;
  expect(call.FileSystemId).toBe("fs-1");
  expect(call.RootDirectory.Path).toBe("/tenants/alice");
  expect(call.RootDirectory.CreationInfo.OwnerUid).toBe(10000);
  expect(call.RootDirectory.CreationInfo.OwnerGid).toBe(10000);
  expect(call.PosixUser.Uid).toBe(10000);
});

test("deleteAccessPoint issues delete with id", async () => {
  efs.on(DeleteAccessPointCommand).resolves({});
  await deleteAccessPoint(new EFSClient({}), "fsap-1");
  const call = efs.commandCalls(DeleteAccessPointCommand)[0]!.args[0].input as any;
  expect(call.AccessPointId).toBe("fsap-1");
});
