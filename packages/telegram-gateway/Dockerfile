# Telegram gateway — always-on AWS Fargate service. Long-polls Telegram and
# relays messages to each user's Hermes agent. Build from the REPO ROOT:
#   docker build -f packages/telegram-gateway/Dockerfile -t hermes-gateway .
FROM node:24-slim

RUN corepack enable

WORKDIR /app

# Copy the workspace manifests first for layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/provisioner/package.json packages/provisioner/
COPY packages/telegram-gateway/package.json packages/telegram-gateway/

# Install only what the gateway + its provisioner dep need. pnpm 10 blocks
# package build scripts by default and turns ignored builds into a non-zero
# exit; allow esbuild (tsx's native dep) explicitly.
ENV PNPM_CONFIG_ONLY_BUILT_DEPENDENCIES=esbuild
RUN pnpm install --filter @hermes/telegram-gateway... --frozen-lockfile \
 && pnpm approve-builds esbuild 2>/dev/null || pnpm rebuild esbuild 2>/dev/null || true

# Copy the source the gateway actually uses (provisioner is imported via the
# workspace package: its supabase store + types).
COPY packages/provisioner packages/provisioner
COPY packages/telegram-gateway packages/telegram-gateway

WORKDIR /app/packages/telegram-gateway

# Long-polls outbound; no inbound ports. ECS keeps desiredCount=1 alive.
CMD ["pnpm", "gateway"]
