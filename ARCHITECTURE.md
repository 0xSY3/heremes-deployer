# Architecture

Hermes Deployer gives every user their own isolated Hermes agent with one click.
A dashboard creates an agent, a provisioner boots a real container for it, and an
optional Telegram gateway lets users chat with their agent from a phone.

## Big picture

```
   Browser
      │
      ▼
┌─────────────┐     create / control / logs     ┌──────────────────┐
│  apps/web   │ ──────────────────────────────► │   provisioner     │
│ (dashboard) │                                  │  (boot engine)    │
└─────────────┘                                  └──────────────────┘
      │                                                   │
      │ owns records                          local │     │ aws
      ▼                                              ▼     ▼
┌─────────────┐                           Docker container   ECS Fargate task
│ agent store │                           (localhost:port)   (Firecracker VM)
│ json/supa/  │                                  │                  │
│ dynamo      │                                  └────── one Hermes agent ──────┘
└─────────────┘                                                ▲
                                                               │ ask
                                                  ┌────────────────────────┐
                                                  │ telegram-gateway       │
                                                  │ (Telegram ⇄ agent)     │
                                                  └────────────────────────┘
```

Three pieces, one swappable seam: **the same provisioning flow runs a local
Docker container or an AWS Fargate task** depending on `HERMES_RUNTIME`.

## The pieces

### `apps/web` — dashboard (Next.js)

The user-facing app. Google login (Auth.js v5), then a dashboard to create,
open, control (start/stop/restart), inspect logs, and connect Telegram for each
agent. It never talks to AWS or Docker directly — it calls the provisioner and
records what it owns in the agent store.

Key files:
- `src/lib/provisioner.ts` — the seam. Picks local vs AWS deps and calls the
  shared `provisionAgent` / `teardownAgent` flow.
- `src/lib/store.ts` — picks the agent-store backend (see below).
- `src/app/api/agents/**` — REST routes the dashboard calls.

### `packages/provisioner` — boot engine

The core. One function, `provisionAgent`, runs the same ordered steps for any
runtime; the runtime only swaps the dependency implementations passed in:

1. Isolated storage (EFS access point on AWS).
2. Secret for the LLM key (Secrets Manager on AWS — only ARNs leave the box).
3. Per-tenant egress-locked security group.
4. Task definition + run the task / container.
5. Wait for `/health`, resolve the address, wire routing (ALB on AWS).

Every step that creates a resource registers an undo, so any failure rolls back
in reverse order — no orphaned resources, no leaked secrets.

- `src/provision.ts` / `src/teardown.ts` — the runtime-agnostic flow.
- `src/local/` — Docker implementation of the deps (used by the web app's
  local mode and the CLI).
- `src/alb.ts`, `src/efs.ts`, `src/secrets.ts`, `src/security-group.ts`,
  `src/taskdef.ts`, `src/run.ts` — the AWS implementations.
- `bin/provision.ts` / `bin/teardown.ts` — CLI entry points.

### `packages/telegram-gateway` — Telegram bridge

An always-on service. A user runs `/connect <token>` in Telegram, the gateway
links that chat to their agent, then relays every message to the agent's HTTP
API and streams the reply back (with a live "typing…" indicator while the agent
works). It resolves the agent's address per runtime (local container port vs AWS
task IP) and fetches the agent's API key at request time, never caching it.

## The swappable seam

| Concern        | Local                          | AWS                              |
|----------------|--------------------------------|----------------------------------|
| Selector       | default                        | `HERMES_RUNTIME=aws`             |
| Compute        | Docker container               | ECS Fargate task (Firecracker)   |
| Address        | `localhost:<port>`             | task public IP / ALB host        |
| Secret store   | env / local                    | AWS Secrets Manager              |
| Agent store    | JSON file → Supabase           | DynamoDB                         |

The agent store backend is chosen at runtime: **DynamoDB** when `HERMES_RUNTIME=aws`,
else **Supabase** if its URL+key are set, else a **local JSON file** for dev.

## Isolation model

Each agent is treated as hostile and gets its own boundary:

- **Compute**: one Firecracker microVM per Fargate task (or one container locally).
- **Network**: a per-tenant security group locked to outbound 443 + DNS only.
- **Storage**: an isolated EFS access point per tenant.
- **Secrets**: the LLM key lives in Secrets Manager; only its ARN is stored
  locally, and it is scrubbed from any error surfaced to a client.

## Request flow: creating an agent

1. User clicks **Create Agent**, names it, pastes an LLM key.
2. `apps/web` calls `provisionAgent` with the runtime's deps.
3. The provisioner runs the 5 steps above, rolling back on any failure.
4. On success it returns the agent's URL; the web app records ownership.
5. The user opens the agent, or runs `/connect` in Telegram to chat from a phone.

## Running it

See [README.md](README.md) for the local one-click quick start and the AWS
provisioning commands.
