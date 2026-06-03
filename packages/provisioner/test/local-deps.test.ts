import { expect, test } from "vitest";
import { buildLocalProvisionDeps, buildLocalTeardownDeps } from "../src/local/local-deps";
import { loadLocalConfig } from "../src/config";

const cfg = loadLocalConfig({ HERMES_IMAGE: "nousresearch/hermes-agent:test" });

test("buildLocalProvisionDeps wires every ProvisionDeps method", () => {
  const deps = buildLocalProvisionDeps(cfg, "alice");
  for (const key of [
    "createAccessPoint", "deleteAccessPoint", "createSecret", "deleteSecret",
    "createTenantSg", "deleteTenantSg", "registerTaskDef", "deregisterTaskDef",
    "runTask", "waitForHealthy", "resolveTaskIp", "stopTask",
    "createTargetGroup", "registerIp", "addHostRule", "waitTargetHealthy",
    "removeAlbWiring", "rulePriority", "buildUrl", "resolvedPorts",
  ]) {
    expect(typeof (deps as any)[key]).toBe("function");
  }
});

test("resolvedPorts is undefined and buildUrl has no port before runTask allocates", () => {
  const deps = buildLocalProvisionDeps(cfg, "alice");
  expect(deps.resolvedPorts()).toBeUndefined();
  expect(deps.buildUrl!("alice", "localhost")).toBe("http://localhost:0");
});

test("local createSecret captures payload and returns name-keyed refs", async () => {
  const deps = buildLocalProvisionDeps(cfg, "alice");
  const result = await deps.createSecret("alice", { OPENROUTER_API_KEY: "k", API_SERVER_KEY: "s" });
  expect(result.arn).toBe("local-secret");
  expect(result.refs.map((r) => r.name).sort()).toEqual(["API_SERVER_KEY", "OPENROUTER_API_KEY"]);
});

test("buildLocalTeardownDeps wires every TeardownDeps method", () => {
  const deps = buildLocalTeardownDeps("alice");
  for (const key of [
    "removeAlbWiring", "stopTask", "deregisterTaskDef", "deleteTenantSg",
    "deleteSecret", "deleteAccessPoint", "resolveTaskIp",
  ]) {
    expect(typeof (deps as any)[key]).toBe("function");
  }
});
