import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";

export interface SecretRef {
  name: string;
  valueFrom: string;
}

export interface CreatedSecret {
  arn: string;
  refs: SecretRef[];
}

export async function createSecret(
  client: SecretsManagerClient,
  tenantId: string,
  payload: Record<string, string>,
): Promise<CreatedSecret> {
  const out = await client.send(
    new CreateSecretCommand({
      Name: `hermes/${tenantId}`,
      SecretString: JSON.stringify(payload),
      Tags: [{ Key: "tenant", Value: tenantId }],
    }),
  );
  if (!out.ARN) throw new Error("Secret creation returned no ARN");
  // ECS secret valueFrom for a JSON key: <secretArn>:<jsonKey>::
  const refs = Object.keys(payload).map((name) => ({
    name,
    valueFrom: `${out.ARN}:${name}::`,
  }));
  return { arn: out.ARN, refs };
}

export async function deleteSecret(client: SecretsManagerClient, arn: string): Promise<void> {
  await client.send(
    new DeleteSecretCommand({ SecretId: arn, ForceDeleteWithoutRecovery: true }),
  );
}
