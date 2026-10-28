import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // `server-only` is a build-time guard for Next; tests run outside Next.
      "server-only": path.resolve(import.meta.dirname, "tests/support/server-only-shim.ts"),
    },
  },
});
