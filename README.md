# Hermes Deployer

One-click deploy of a personal Hermes agent. Each user gets their own isolated
agent — a real container, locked-down network, isolated storage. The same flow
runs locally on Docker or on AWS Fargate behind one swappable seam.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together.

## Monorepo

- `apps/web` — Next.js dashboard. Create / open / control agents, view logs,
  connect Telegram. Local-only (Docker), no AWS needed.
- `packages/provisioner` — the provisioning engine (local Docker + AWS Fargate).
- `packages/telegram-gateway` — always-on bridge between Telegram and an agent.

## Quick start (local one-click)

```bash
pnpm install
pnpm dev            # → http://127.0.0.1:3100
# open it, click "Create Agent", name it, paste any sk-or-... key, Create.
# ~30s later a real hermes-agent container is running. Click Open.
```

Docker must be running. The LLM key can be a placeholder for a boot test; use a
real OpenRouter/Anthropic key to actually chat.

## Provisioner (AWS)

Provisions one isolated Hermes agent per tenant on AWS ECS Fargate.

### Prerequisites (shared infra you provide)

VPC + private subnets, EFS filesystem, shared ALB with HTTPS listener and a
wildcard cert `*.agents.<domain>`, ECS cluster, IAM execution + task roles, and
VPC endpoints (or NAT) so tasks reach ECR / Secrets / LLM APIs over 443. EFS
mount targets must be reachable from tenant subnets on NFS port 2049 — `VPC_CIDR`
scopes the provisioner's 2049 egress rule to in-VPC mount targets.

```bash
cd packages/provisioner
cp .env.example .env   # fill in your infra IDs
```

### Local mode (no AWS)

Run the full flow against a real Hermes container on your machine, then switch to
AWS with the same code by dropping `--local`. Requires Docker.

```bash
pnpm provision --tenant alice --channel web --llm-key sk-or-... --local
# → ✅ Agent live: http://localhost:18462
pnpm teardown --tenant alice --local
```

### Usage (AWS)

```bash
pnpm provision --tenant alice --channel web --llm-provider openrouter --llm-key sk-or-...
pnpm provision --tenant alice --llm-key sk-or-... --dry-run    # preview, no AWS calls
pnpm teardown --tenant alice                                   # keeps EFS data
pnpm teardown --tenant alice --delete-data                     # also deletes data
```

### Live smoke test

```bash
SMOKE_LLM_KEY=sk-or-... SMOKE_TAG=run1 pnpm smoke
```

## Tests

```bash
pnpm test        # all packages (mocked AWS SDK)
pnpm typecheck
```

## Security model

Every agent is treated as hostile: Firecracker microVM per task, per-tenant
egress-locked security group (443 + DNS only), isolated EFS access point, and
secrets in Secrets Manager (only ARNs stored locally). See
[ARCHITECTURE.md](ARCHITECTURE.md#isolation-model).
