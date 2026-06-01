import { expect, test, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { createSecret, deleteSecret } from "../src/secrets";

const sm = mockClient(SecretsManagerClient);
beforeEach(() => sm.reset());

test("createSecret stores payload and returns per-key ARN refs", async () => {
  sm.on(CreateSecretCommand).resolves({
    ARN: "arn:aws:secretsmanager:us-east-1:1:secret:hermes/alice-AbCdEf",
  });
  const result = await createSecret(new SecretsManagerClient({}), "alice", {
    API_SERVER_KEY: "k",
    OPENROUTER_API_KEY: "sk-or-x",
  });
  expect(result.arn).toContain("hermes/alice");
  const refs = Object.fromEntries(result.refs.map((r) => [r.name, r.valueFrom]));
  expect(refs.OPENROUTER_API_KEY).toBe(`${result.arn}:OPENROUTER_API_KEY::`);
  const body = JSON.parse(sm.commandCalls(CreateSecretCommand)[0]!.args[0].input.SecretString!);
  expect(body.API_SERVER_KEY).toBe("k");
});

test("deleteSecret forces immediate deletion", async () => {
  sm.on(DeleteSecretCommand).resolves({});
  await deleteSecret(new SecretsManagerClient({}), "arn:secret");
  const call = sm.commandCalls(DeleteSecretCommand)[0]!.args[0].input;
  expect(call.ForceDeleteWithoutRecovery).toBe(true);
});
