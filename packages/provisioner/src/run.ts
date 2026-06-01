import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
  StopTaskCommand,
} from "@aws-sdk/client-ecs";
import {
  EC2Client,
  DescribeNetworkInterfacesCommand,
} from "@aws-sdk/client-ec2";
import type { Config } from "./config";

export async function runTask(
  client: ECSClient,
  cfg: Config,
  taskDefArn: string,
  securityGroupId: string,
  // ENABLED for the no-ALB public-IP mode; DISABLED for ALB mode (private subnets).
  assignPublicIp: "ENABLED" | "DISABLED" = "DISABLED",
): Promise<string> {
  const out = await client.send(
    new RunTaskCommand({
      cluster: cfg.cluster,
      taskDefinition: taskDefArn,
      launchType: "FARGATE",
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: cfg.subnetIds,
          securityGroups: [securityGroupId],
          assignPublicIp,
        },
      },
    }),
  );
  const arn = out.tasks?.[0]?.taskArn;
  if (!arn) throw new Error(`RunTask returned no task: ${JSON.stringify(out.failures)}`);
  return arn;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForHealthy(
  client: ECSClient,
  cluster: string,
  taskArn: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const out = await client.send(
      new DescribeTasksCommand({ cluster, tasks: [taskArn] }),
    );
    const task = out.tasks?.[0];
    if (task?.lastStatus === "STOPPED") {
      throw new Error(`Task stopped before healthy: ${task.stoppedReason ?? "unknown"}`);
    }
    const healthy =
      task?.lastStatus === "RUNNING" &&
      task.containers?.every((c) => c.healthStatus === "HEALTHY");
    if (healthy) return;
    await sleep(intervalMs);
  }
  throw new Error(`Task ${taskArn} did not become healthy within ${timeoutMs}ms`);
}

export async function resolveTaskIp(
  ecs: ECSClient,
  ec2: EC2Client,
  cluster: string,
  taskArn: string,
): Promise<string> {
  const out = await ecs.send(new DescribeTasksCommand({ cluster, tasks: [taskArn] }));
  const eniId = out.tasks?.[0]?.attachments
    ?.find((a) => a.type === "ElasticNetworkInterface")
    ?.details?.find((d) => d.name === "networkInterfaceId")?.value;
  if (!eniId) throw new Error("Task has no ENI attachment");
  const eni = await ec2.send(
    new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
  );
  const ip = eni.NetworkInterfaces?.[0]?.PrivateIpAddress;
  if (!ip) throw new Error("ENI has no private IP");
  return ip;
}

export async function resolveTaskPublicIp(
  ecs: ECSClient,
  ec2: EC2Client,
  cluster: string,
  taskArn: string,
): Promise<string> {
  const out = await ecs.send(new DescribeTasksCommand({ cluster, tasks: [taskArn] }));
  const eniId = out.tasks?.[0]?.attachments
    ?.find((a) => a.type === "ElasticNetworkInterface")
    ?.details?.find((d) => d.name === "networkInterfaceId")?.value;
  if (!eniId) throw new Error("Task has no ENI attachment");
  const eni = await ec2.send(
    new DescribeNetworkInterfacesCommand({ NetworkInterfaceIds: [eniId] }),
  );
  const publicIp = eni.NetworkInterfaces?.[0]?.Association?.PublicIp;
  if (!publicIp) {
    throw new Error(
      "Task ENI has no public IP — ensure it runs in a public subnet with assignPublicIp=ENABLED",
    );
  }
  return publicIp;
}

export async function stopTask(client: ECSClient, cluster: string, taskArn: string): Promise<void> {
  await client.send(new StopTaskCommand({ cluster, task: taskArn, reason: "teardown" }));
}
