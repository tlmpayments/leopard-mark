import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (embedded Postgres for DEVELOPMENT DEMO MODE and tests) ships WASM
  // and is loaded from node_modules at runtime only when demo mode is on.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Friendly local URL for the zero-setup demo (dev server only; no effect on production builds).
  allowedDevOrigins: ["fv-ops.test", "*.localhost"],
  // The browser-driven /setup page reads the SQL migrations at runtime; include them in its serverless bundle.
  // The PDF renderer reads the document typefaces (Rubik, Merriweather) from the @fontsource packages at runtime,
  // and documents are rendered from many routes (confirmation, delivery, the document routes), so every route
  // carries the font files.
  outputFileTracingIncludes: {
    "/setup": ["./drizzle/**/*"],
    "/*": ["./node_modules/@fontsource/rubik/files/rubik-latin-*-normal.woff", "./node_modules/@fontsource/rubik/files/rubik-latin-400-italic.woff", "./node_modules/@fontsource/merriweather/files/merriweather-latin-*-normal.woff"],
  },
  experimental: {
    // The in-app TLM Master File import (docs/SHIPMENTS_SPEC.md §9) uploads the workbook through a server action;
    // the export is a few hundred KB today, so 8 MB leaves room for it to grow plus the multipart overhead.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
