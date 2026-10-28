#!/usr/bin/env node
/**
 * DEVELOPMENT DEMO MODE launcher — zero setup, one command.
 *
 *   npm run demo            start the app in demo mode and print the URL to open
 *   npm run demo:reset      delete the embedded database (.fv-demo/) — reseeded on next start
 *   npm run demo:hosts      (one-time, asks for your macOS password) map fv-ops.test → 127.0.0.1
 *
 * What it does:
 *   1. Runs `next dev` with FV_DEMO=true: embedded PGlite database, seeded demo
 *      data, auto-signed in as the demo Owner, DEV_AUTH_BYPASS=true. No Google,
 *      Neon, Stripe or other provider credentials. Demo mode cannot be enabled
 *      under a production build or on Vercel (see src/lib/env.ts).
 *   2. Picks the friendliest local URL that works on this machine without
 *      elevated configuration:
 *        - http://fv-ops.test           when fv-ops.test resolves (hosts entry or Herd/dnsmasq)
 *                                        and port 80 is free: a tiny local reverse proxy forwards it
 *        - http://fv-ops.test:3000      when it resolves but port 80 is taken
 *        - http://fv-ops.localhost:3000 otherwise (Chrome/Firefox resolve *.localhost with no setup)
 *      http://localhost:3000 always works too (every browser, incl. Safari).
 */
import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import { existsSync, rmSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const root = process.cwd();
const dataDir = path.join(root, ".fv-demo");
const appPort = Number(process.env.PORT ?? 3000);
const friendlyHost = "fv-ops.test";
const args = process.argv.slice(2);

if (args.includes("--reset")) {
  if (existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    console.log("[demo] Removed .fv-demo/ — the demo database will be recreated and reseeded on next start.");
  } else {
    console.log("[demo] Nothing to reset.");
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 1. Decide the friendly URL (never requires sudo; degrades gracefully)
// ---------------------------------------------------------------------------
async function resolvesLocally(host) {
  try {
    const { address } = await dns.lookup(host);
    return address === "127.0.0.1" || address === "::1";
  } catch {
    return false;
  }
}

async function tryListen(port) {
  return new Promise((resolve) => {
    const server = createProxy();
    server.once("error", () => resolve(null));
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function createProxy() {
  const target = { host: "127.0.0.1", port: appPort };
  const forwardHeaders = (h) => ({ ...h, "x-forwarded-host": friendlyHost, "x-forwarded-proto": "http", "x-forwarded-port": "80" });
  const server = http.createServer((req, res) => {
    const upstream = http.request({ ...target, method: req.method, path: req.url, headers: forwardHeaders(req.headers) }, (up) => {
      const headers = { ...up.headers };
      // Any absolute redirect to the app's own port comes back on the friendly URL.
      if (typeof headers.location === "string") {
        headers.location = headers.location.replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${appPort}`), `http://${friendlyHost}`);
      }
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    });
    upstream.on("error", () => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("Demo app is not ready yet — refresh in a moment.");
    });
    req.pipe(upstream);
  });
  // WebSocket upgrade (Next.js hot reload)
  server.on("upgrade", (req, socket, head) => {
    const upstream = http.request({ ...target, method: req.method, path: req.url, headers: forwardHeaders(req.headers) });
    upstream.on("upgrade", (up, upSocket, upHead) => {
      const lines = [`HTTP/1.1 101 Switching Protocols`];
      for (const [k, v] of Object.entries(up.headers)) lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
      socket.write(lines.join("\r\n") + "\r\n\r\n");
      if (upHead.length) socket.write(upHead);
      if (head.length) upSocket.write(head);
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      upSocket.on("error", () => socket.destroy());
      socket.on("error", () => upSocket.destroy());
    });
    upstream.on("error", () => socket.destroy());
    upstream.end();
  });
  return server;
}

const friendlyResolves = await resolvesLocally(friendlyHost);
let url = `http://fv-ops.localhost:${appPort}`;
let note = `fv-ops.test is not mapped on this machine. Chrome/Firefox open the URL above with no setup; Safari: use http://localhost:${appPort}.\n      To get http://fv-ops.test (one-time, asks for your password): npm run demo:hosts`;
let proxy = null;
if (friendlyResolves) {
  // A previous demo may still be releasing :80 — retry briefly before falling back.
  for (let attempt = 0; attempt < 5 && !proxy; attempt++) {
    proxy = await tryListen(80);
    if (!proxy) await new Promise((r) => setTimeout(r, 600));
  }
  if (proxy) {
    url = `http://${friendlyHost}`;
    note = `fv-ops.test → local proxy on :80 → app on :${appPort}.`;
  } else {
    url = `http://${friendlyHost}:${appPort}`;
    note = `Port 80 is in use by another service (Herd/Apache/nginx?), so the app is served directly on :${appPort}.`;
  }
}

// ---------------------------------------------------------------------------
// 2. Start the app in demo mode
// ---------------------------------------------------------------------------
const env = {
  ...process.env,
  FV_DEMO: "true",
  FV_ENV: "development",
  DEV_AUTH_BYPASS: "true",
  NODE_ENV: "development",
  APP_BASE_URL: url,
};
delete env.DATABASE_URL; // demo mode never touches a real database (FV_DEMO=true wins even if .env sets one)

const nextBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "next.cmd" : "next");
const child = spawn(nextBin, ["dev", "-p", String(appPort)], { stdio: "inherit", env, shell: process.platform === "win32" });

const banner = () => {
  console.log("");
  console.log("  ┌──────────────────────────────────────────────────────────────────────┐");
  console.log("  │  DEVELOPMENT DEMO MODE                                               │");
  console.log("  │  embedded PGlite database (.fv-demo/), seeded demo data,             │");
  console.log("  │  auto-signed in as the demo Owner. No Google / Neon / Stripe / APIs. │");
  console.log("  └──────────────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log(`  ➜  Open:  ${url}`);
  console.log(`     ${note}`);
  console.log(`     Also always available: http://localhost:${appPort}`);
  console.log("");
};
banner();

// Announce again once the app answers (first request compiles + migrates + seeds; can take ~10–20 s).
const started = Date.now();
let announced = false;
const poll = setInterval(() => {
  const req = http.get({ host: "127.0.0.1", port: appPort, path: "/sign-in", timeout: 5000 }, (res) => {
    res.resume();
    if (!announced && res.statusCode && res.statusCode < 500) {
      announced = true;
      clearInterval(poll);
      console.log(`\n  ✔ Demo is ready (${Math.round((Date.now() - started) / 1000)}s). Open ${url}\n`);
    }
  });
  req.on("error", () => undefined);
  req.on("timeout", () => req.destroy());
}, 2000);

const shutdown = () => {
  clearInterval(poll);
  proxy?.close();
  child.kill("SIGTERM");
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", (code) => {
  clearInterval(poll);
  proxy?.close();
  process.exit(code ?? 0);
});
