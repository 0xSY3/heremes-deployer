import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Map the `@/*` path alias (tsconfig paths) to ./src so route modules that
// import `@/lib/*` resolve to the SAME module id the tests mock via
// `../src/lib/*.js` — otherwise vi.mock() can't intercept the route's imports.
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
