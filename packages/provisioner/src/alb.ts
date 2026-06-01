import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  RegisterTargetsCommand,
  CreateRuleCommand,
  DescribeTargetHealthCommand,
  DeleteRuleCommand,
  DeregisterTargetsCommand,
  DeleteTargetGroupCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

const HERMES_PORT = 8642;

// Target group name max length is 32 chars.
function tgName(tenantId: string): string {
  return `hermes-${tenantId}`.slice(0, 32);
}

export async function createTargetGroup(
  client: ElasticLoadBalancingV2Client,
  vpcId: string,
  tenantId: string,
): Promise<string> {
  const out = await client.send(
    new CreateTargetGroupCommand({
      Name: tgName(tenantId),
      Protocol: "HTTP",
      Port: HERMES_PORT,
      VpcId: vpcId,
      TargetType: "ip",
      HealthCheckProtocol: "HTTP",
      HealthCheckPath: "/health",
      HealthCheckPort: String(HERMES_PORT),
      Matcher: { HttpCode: "200" },
    }),
  );
  const arn = out.TargetGroups?.[0]?.TargetGroupArn;
  if (!arn) throw new Error("Target group creation returned no ARN");
  return arn;
}

export async function registerIp(
  client: ElasticLoadBalancingV2Client,
  targetGroupArn: string,
  ip: string,
): Promise<void> {
  await client.send(
    new RegisterTargetsCommand({
      TargetGroupArn: targetGroupArn,
      Targets: [{ Id: ip, Port: HERMES_PORT }],
    }),
  );
}

export async function addHostRule(
  client: ElasticLoadBalancingV2Client,
  listenerArn: string,
  targetGroupArn: string,
  host: string,
  priority: number,
): Promise<string> {
  const out = await client.send(
    new CreateRuleCommand({
      ListenerArn: listenerArn,
      Priority: priority,
      Conditions: [{ Field: "host-header", Values: [host] }],
      Actions: [{ Type: "forward", TargetGroupArn: targetGroupArn }],
    }),
  );
  const arn = out.Rules?.[0]?.RuleArn;
  if (!arn) throw new Error("Listener rule creation returned no ARN");
  return arn;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitTargetHealthy(
  client: ElasticLoadBalancingV2Client,
  targetGroupArn: string,
  ip: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const intervalMs = opts.intervalMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 1000;
  const deadline = Date.now() + timeoutMs;
  // unused/unavailable appear transiently during registration; only terminal after persisting across consecutive polls.
  const TERMINAL_AFTER = 3;
  let badStreak = 0;
  while (Date.now() < deadline) {
    const out = await client.send(
      new DescribeTargetHealthCommand({
        TargetGroupArn: targetGroupArn,
        Targets: [{ Id: ip, Port: HERMES_PORT }],
      }),
    );
    const state = out.TargetHealthDescriptions?.[0]?.TargetHealth?.State;
    if (state === "healthy") return;
    if (state === "unused" || state === "unavailable") {
      if (++badStreak >= TERMINAL_AFTER) {
        throw new Error(`Target persistently ${state} after ${badStreak} polls`);
      }
    } else {
      badStreak = 0;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Target ${ip} did not become healthy within ${timeoutMs}ms`);
}

export interface AlbWiringRefs {
  listenerRuleArn: string;
  targetGroupArn: string;
  ip: string;
}

export async function removeAlbWiring(
  client: ElasticLoadBalancingV2Client,
  refs: AlbWiringRefs,
): Promise<void> {
  await client.send(new DeleteRuleCommand({ RuleArn: refs.listenerRuleArn }));
  await client.send(
    new DeregisterTargetsCommand({
      TargetGroupArn: refs.targetGroupArn,
      Targets: [{ Id: refs.ip, Port: HERMES_PORT }],
    }),
  );
  await client.send(new DeleteTargetGroupCommand({ TargetGroupArn: refs.targetGroupArn }));
}
