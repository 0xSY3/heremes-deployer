import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand, QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AgentRecord } from "./types";

export interface StoredAgent extends AgentRecord {
  userId: string;
  name: string;
  channel: string;
}

export const DYNAMO_TABLE = "hermes-agents";
const USER_INDEX = "userId-index";

export class DynamoAgentStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly table: string;

  constructor(region: string, table: string = DYNAMO_TABLE) {
    // removeUndefinedValues: optional fields (apiPort, taskArn, …) are undefined for some runtimes and DynamoDB rejects undefined.
    this.doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.table = table;
  }

  async get(tenantId: string): Promise<StoredAgent | undefined> {
    const out = await this.doc.send(new GetCommand({ TableName: this.table, Key: { tenantId } }));
    return out.Item ? (out.Item as StoredAgent) : undefined;
  }

  async getOwned(userId: string, tenantId: string): Promise<StoredAgent | undefined> {
    const rec = await this.get(tenantId);
    return rec && rec.userId === userId ? rec : undefined;
  }

  async listForUser(userId: string): Promise<StoredAgent[]> {
    const out = await this.doc.send(new QueryCommand({
      TableName: this.table,
      IndexName: USER_INDEX,
      KeyConditionExpression: "userId = :u",
      ExpressionAttributeValues: { ":u": userId },
    }));
    return (out.Items ?? []) as StoredAgent[];
  }

  async put(agent: StoredAgent): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: agent }));
  }

  async delete(tenantId: string): Promise<void> {
    await this.doc.send(new DeleteCommand({ TableName: this.table, Key: { tenantId } }));
  }
}

export function dynamoStoreFromEnv(env: Record<string, string | undefined> = process.env): DynamoAgentStore {
  return new DynamoAgentStore(env.AWS_REGION ?? "us-east-1");
}
