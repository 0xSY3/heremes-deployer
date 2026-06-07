import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the systemd unit's ExecStart path
  // (.next/standalone/apps/web/server.js). Required for the bare-metal deploy.
  output: "standalone",
  // Transpile the workspace packages that ship raw .ts source (no build step).
  transpilePackages: ["@hermes/provisioner", "@hermes/deployer-worker"],
  // pnpm monorepo: deps are hoisted to the repo root, so point Turbopack's root
  // there or it can't resolve `next`/workspace packages (esp. on Vercel's
  // sandboxed build). Two levels up from apps/web.
  turbopack: {
    root: join(__dirname, "..", ".."),
  },
};

export default nextConfig;
