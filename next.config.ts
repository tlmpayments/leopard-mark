import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (embedded Postgres for DEVELOPMENT DEMO MODE and tests) ships WASM
  // and is loaded from node_modules at runtime only when demo mode is on.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Friendly local URL for the zero-setup demo (dev server only; no effect on production builds).
  allowedDevOrigins: ["fv-ops.test", "*.localhost"],
  // The browser-driven /setup page reads the SQL migrations at runtime; include them in its serverless bundle.
  outputFileTracingIncludes: { "/setup": ["./drizzle/**/*"] },
};

export default nextConfig;
