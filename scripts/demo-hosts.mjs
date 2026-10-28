#!/usr/bin/env node
/**
 * One-time helper: map fv-ops.test → 127.0.0.1 in /etc/hosts so `npm run demo`
 * can serve http://fv-ops.test. Asks for your macOS/Linux password (sudo);
 * idempotent; touches nothing else. Undo by removing the line from /etc/hosts.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HOST = "fv-ops.test";
const LINE = `127.0.0.1 ${HOST}`;

if (process.platform === "win32") {
  console.log(`Add this line to C:\\Windows\\System32\\drivers\\etc\\hosts as Administrator:\n  ${LINE}`);
  process.exit(0);
}
const hosts = readFileSync("/etc/hosts", "utf8");
if (hosts.split("\n").some((l) => l.trim().split(/\s+/).includes(HOST) && !l.trim().startsWith("#"))) {
  console.log(`${HOST} is already mapped in /etc/hosts. Run: npm run demo`);
  process.exit(0);
}
console.log(`Adding "${LINE}" to /etc/hosts (sudo will ask for your password)…`);
const r = spawnSync("sudo", ["sh", "-c", `printf '\\n# Leopard Mark Ops local demo\\n${LINE}\\n' >> /etc/hosts`], { stdio: "inherit" });
if (r.status !== 0) {
  console.error("Could not update /etc/hosts. You can add the line by hand, or just use http://fv-ops.localhost:3000.");
  process.exit(r.status ?? 1);
}
if (process.platform === "darwin") spawnSync("sudo", ["dscacheutil", "-flushcache"], { stdio: "ignore" });
console.log(`Done. Now run: npm run demo  →  http://${HOST}`);
