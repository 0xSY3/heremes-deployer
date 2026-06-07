# Architecture

Hermes Deployer gives every user their own private Hermes agent with one click.
You name an agent and paste an LLM key; the system boots a real Docker container
for it on a single server and shows you the deploy happening live, step by step.

## The big idea in one picture

```text
   Browser
      │
      │  1. create agent (name + LLM key)
      ▼
┌──────────────────┐      writes a "queued" row       ┌──────────────────────┐
│   apps/web       │ ───────────────────────────────► │      Postgres        │
│  (Next.js UI +   │                                  │  (the single source  │
│   API routes)    │ ◄─── live deploy steps (WS) ──┐  │     of truth)        │
└──────────────────┘                               │  └──────────────────────┘
      ▲                                             │            ▲
      │  2. open the live deploy view               │            │ reads the row,
      │     over a WebSocket                         │            │ drives it forward
      │                                             │            │
      │                                  ┌──────────────────────────────────┐
      └──────────────────────────────── │   packages/deployer-worker       │
                                         │   (long-lived background worker) │
                                         └──────────────────────────────────┘
                                                       │  docker run
                                                       ▼
                                              ┌──────────────────┐
                                              │  Hermes container │
                                              │  (one per agent)  │
                                              └──────────────────┘
                                                       ▲
                                                       │ routes /<slug> to it
                                              ┌──────────────────┐
                                              │      Caddy        │
                                              └──────────────────┘
```

Everything runs on **one server (a VPS)**. No AWS, no Fargate.

## The two halves, and the one rule between them

There are two programs. They never step on each other because of one rule:

> **The web app only writes "what I want" to the database. The worker is the
> only thing that actually touches Docker.**

This is the **single-writer rule**. It's what keeps the system simple and safe.

### `apps/web` — the website (Next.js)

What the user sees and clicks. It does three things:

1. **Shows your agents** — reads them straight from Postgres.
2. **Creates an agent** — when you click Create, it:
   - encrypts your LLM key to a file on disk (so the raw key never sits in the
     database),
   - inserts one row in Postgres with `status = "queued"`,
   - hands the browser a short-lived token and switches to the live deploy view.
3. **Controls an agent** — start / stop / restart / delete just flip the row's
   status (e.g. `stopped`). It never runs a container itself.

That's it. The web app is "intent only." It can't break a container because it
never holds one.

### `packages/deployer-worker` — the engine (a background Node process)

The actual work. It runs forever (a systemd service) and loops once a second:

- **See a `queued` row?** Claim it and *drive* it (see the deploy steps below).
- **See a `stopped` row?** Tear its container down and clean up.

It also runs a few always-on watchers:

- **crash watcher** — notices when a container dies and records why.
- **health loop** — pings each agent's `/health`; marks it `unhealthy` if it
  stops answering, `running` again if it recovers.
- **metrics + retention** — samples CPU/memory and prunes old logs.
- **WebSocket server** — pushes the live deploy steps to the browser.

## Deploying an agent: the step machine

When the worker drives a queued agent, it walks these steps in order. After each
step it **writes the new status to Postgres first, then tells the browser** —
so the database is always the truth, and a page refresh mid-deploy never loses
your place.

```text
queued
  → allocating_ports      grab two free host ports (one for the API, one for the dashboard)
  → starting              docker run the Hermes image with the agent's env (key decrypted in memory)
  → health_checking       poll the container's /health until it answers 200
  → registering_route     tell Caddy to route /<slug> to this container
  → running               done — the dashboard URL is live
```

If anything fails, it goes to **`failed`** and everything created so far is torn
down in reverse (container → route → ports). Later, the container can also become
`crashed` (it exited) or `unhealthy` (alive but not answering).

## The headline feature: live deploy over WebSocket

Old way: click create, stare at a fixed "~30 seconds…" spinner, hope.

New way: the browser opens **one WebSocket** to the worker and watches the real
steps tick by — `allocating_ports ✓ → starting … → health_checking ✓ → … →
running`, then an **Open dashboard →** link. If the socket drops, the browser
falls back to polling the row status, so it always finishes.

The socket is **locked to you**: the web app mints a short-lived signed token
for the agent's owner, and the worker refuses any socket without a valid token
(wrong owner → rejected, expired → rejected). If the signing secret is missing
or weak, the worker refuses *every* socket — it fails closed, never open.

## One agent = one container

Each agent gets its own hardened Docker container from a single fixed Hermes
image (no per-agent build). The container:

- runs **two ports**: an API (`8642`) for `/health` + the agent API, and a
  dashboard (`9119`) for the web chat UI,
- is bound to **`127.0.0.1` only** — nothing is exposed to the public internet
  directly; the only way in is through Caddy,
- runs **read-only** with small writable scratch areas (`/tmp`, `/run`), a memory
  and CPU cap, and `no-new-privileges`.

Caddy sits in front and routes `your-domain.com/<slug>` to the right container,
terminating TLS once for everything.

## Where things live

```text
your-domain.com/                      → the web app (apps/web)
your-domain.com/<slug>/...            → that agent's dashboard container
your-domain.com/v1/agents/<id>/deploy → the live deploy WebSocket (worker)
```

## Secrets

The only secret per agent is the LLM key (plus a generated API key). On create,
the web app encrypts `{ API_SERVER_KEY, <your LLM key> }` with **age** to
`<data-root>/secrets/<id>.age`. The database stores only the *path* to that file,
never the key. At `starting`, the worker decrypts it in memory, injects it as the
container's environment, and never writes it back to disk or into any log or error
message.

## What's stored

Postgres holds four tables:

| Table | What it is |
|---|---|
| `Agent` | one row per agent — owner, name, slug, status, ports, etc. |
| `AgentLog` | the agent's container log lines |
| `AgentMetric` | CPU/memory samples over time |
| `PortAllocation` | which host ports are taken (two rows per agent) |

## The pieces, by folder

| Folder | What it is |
|---|---|
| `apps/web` | the Next.js website — UI + API routes (intent only) |
| `packages/deployer-worker` | the background worker — the engine that runs Docker, Caddy, and the WebSocket |
| `infra` | how to set up a fresh server: `install.sh`, the Caddy config, systemd units, `.env.example` |
| `packages/provisioner` | the **old** AWS-Fargate provisioner — kept for reference, not used by the new system |

## Running it

See [README.md](README.md) for local dev and [infra/install.sh](infra/install.sh)
for the one-shot server setup (installs Docker, Postgres, Caddy, age, Node; pulls
the Hermes image; installs the two systemd services).
