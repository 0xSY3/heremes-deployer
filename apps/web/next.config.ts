import type { NextConfig } from "next";
import { join } from "node:path";

const nextConfig: NextConfig = {
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
