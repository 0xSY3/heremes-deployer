import { z } from "zod";

const schema = z.object({
  AWS_REGION: z.string().min(1),
  ECS_CLUSTER: z.string().min(1),
  SUBNET_IDS: z.string().min(1),
  EFS_FILESYSTEM_ID: z.string().min(1),
  // ALB-only field; default empty so loadConfig succeeds without an ALB on the public-IP path.
  ALB_LISTENER_ARN: z.string().default(""),
  ALB_VPC_ID: z.string().min(1),
  VPC_CIDR: z.string().min(1),
  CERT_DOMAIN: z.string().default("localhost"),
  EXECUTION_ROLE_ARN: z.string().min(1),
  TASK_ROLE_ARN: z.string().min(1),
  HERMES_IMAGE: z.string().min(1),
});

export interface Config {
  region: string;
  cluster: string;
  subnetIds: string[];
  efsFilesystemId: string;
  albListenerArn: string;
  albVpcId: string;
  vpcCidr: string;
  certDomain: string;
  executionRoleArn: string;
  taskRoleArn: string;
  hermesImage: string;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid/missing config: ${keys}`);
  }
  const e = parsed.data;
  return {
    region: e.AWS_REGION,
    cluster: e.ECS_CLUSTER,
    subnetIds: e.SUBNET_IDS.split(",").map((s) => s.trim()).filter(Boolean),
    efsFilesystemId: e.EFS_FILESYSTEM_ID,
    albListenerArn: e.ALB_LISTENER_ARN,
    albVpcId: e.ALB_VPC_ID,
    vpcCidr: e.VPC_CIDR,
    certDomain: e.CERT_DOMAIN,
    executionRoleArn: e.EXECUTION_ROLE_ARN,
    taskRoleArn: e.TASK_ROLE_ARN,
    hermesImage: e.HERMES_IMAGE,
  };
}

const DEFAULT_LOCAL_IMAGE = "nousresearch/hermes-agent:latest";

// Sentinels for the AWS fields so the shared provisionAgent path runs unchanged; local deps never read them.
export function loadLocalConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    region: "local",
    cluster: "local",
    subnetIds: ["local"],
    efsFilesystemId: "local",
    albListenerArn: "local",
    albVpcId: "local",
    vpcCidr: "127.0.0.0/8",
    certDomain: "localhost",
    executionRoleArn: "local",
    taskRoleArn: "local",
    hermesImage: env.HERMES_IMAGE ?? DEFAULT_LOCAL_IMAGE,
  };
}
