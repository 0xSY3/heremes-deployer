import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const schema = readFileSync(
  fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url)),
  "utf8",
);

// Extracts the body between `model <Name> {` and its closing brace at column 0.
// Anchored to a line-start brace so a nested `{}` (e.g. attributes) can't end it early.
function modelBody(name: string): string {
  const re = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "m");
  const m = schema.match(re);
  if (!m || m[1] === undefined) throw new Error(`model ${name} not found`);
  return m[1];
}

describe("prisma schema", () => {
  it("declares a postgres datasource and prisma-client generator", () => {
    expect(schema).toMatch(/provider\s*=\s*"postgresql"/);
    expect(schema).toMatch(/url\s*=\s*env\("DATABASE_URL"\)/);
    expect(schema).toMatch(/generator client/);
  });

  it("defines all four models", () => {
    for (const name of ["Agent", "AgentLog", "AgentMetric", "PortAllocation"]) {
      expect(schema).toMatch(new RegExp(`model ${name} \\{`));
    }
  });

  it("Agent carries multi-user + two-port + secretRef fields", () => {
    const body = modelBody("Agent");
    expect(body).toMatch(/userId\s+String/);
    expect(body).toMatch(/slug\s+String\s+@unique/);
    expect(body).toMatch(/tenantId\s+String\s+@unique/);
    expect(body).toMatch(/llmProvider\s+String/);
    expect(body).toMatch(/secretRef\s+String/);
    expect(body).toMatch(/personalityId\s+String\?/);
    expect(body).toMatch(/apiPort\s+Int\?/);
    expect(body).toMatch(/dashboardPort\s+Int\?/);
    expect(body).toMatch(/@@index\(\[userId\]\)/);
    expect(body).toMatch(/@@index\(\[status\]\)/);
    expect(body).toMatch(/@@index\(\[createdAt\]\)/);
  });

  it("AgentLog uses a BigInt id and Text body, cascades on agent delete", () => {
    const body = modelBody("AgentLog");
    expect(body).toMatch(/id\s+BigInt\s+@id\s+@default\(autoincrement\(\)\)/);
    expect(body).toMatch(/text\s+String\s+@db\.Text/);
    expect(body).toMatch(/onDelete:\s*Cascade/);
    expect(body).toMatch(/@@index\(\[agentId, lineNo\]\)/);
  });

  it("AgentMetric records mem + cpu samples", () => {
    const body = modelBody("AgentMetric");
    expect(body).toMatch(/memUsedMb\s+Int/);
    expect(body).toMatch(/memLimitMb\s+Int/);
    expect(body).toMatch(/cpuPct\s+Float/);
    expect(body).toMatch(/@@index\(\[agentId, sampledAt\]\)/);
  });

  it("PortAllocation keys on port and is NOT unique on agentId (two rows per agent)", () => {
    const body = modelBody("PortAllocation");
    expect(body).toMatch(/port\s+Int\s+@id/);
    // Invariant: api + dashboard => two PortAllocation rows share one agentId,
    // so agentId must never be @unique. Guard against a regression that would
    // make a second allocation collide.
    expect(body).not.toMatch(/agentId\s+String\s+@unique/);
    expect(body).toMatch(/@@index\(\[agentId\]\)/);
  });
});
