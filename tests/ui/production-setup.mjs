#!/usr/bin/env node
/**
 * Go-live path on a PRODUCTION build against an EMPTY real Postgres — the
 * same sequence a fresh Vercel + Neon deployment takes:
 *   /setup → apply migrations (token) → provision the first Owner (token)
 *   → /sign-in with the temporary PIN → forced "Choose your PIN" → home.
 *
 *   createdb fv_golive && npm run build
 *   DATABASE_URL=postgres://…/fv_golive FV_ENV=production SESSION_SECRET=… CRON_SECRET=… PORT=3100 npm run start   # shell 1
 *   BASE_URL=http://localhost:3100 SETUP_TOKEN=<the CRON_SECRET> node tests/ui/production-setup.mjs              # shell 2
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const TOKEN = process.env.SETUP_TOKEN;
if (!TOKEN) throw new Error("SETUP_TOKEN (= the server's CRON_SECRET) is required");
const EMAIL = process.env.OWNER_EMAIL ?? "owner@example.test";
const TEMP_PIN = "482157";
const REAL_PIN = "907315";
const problems = [];
const ok = (m) => console.log("  ✓", m);
const fail = (m) => {
  problems.push(m);
  console.log("  ✗", m);
};
const text = async (page) => page.locator("body").innerText();

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const page = await browser.newPage();
page.on("pageerror", (e) => problems.push(`pageerror ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`);
});

console.log("▶ 1. /setup on an empty database");
await page.goto(`${BASE}/setup`);
if (/none applied yet/.test(await text(page))) ok("state: no migrations applied");
else fail("expected 'none applied yet'");
if (/not provisioned/.test(await text(page))) ok("state: no Owner");
else fail("expected 'not provisioned'");

console.log("▶ 2. wrong token refused; right token applies every migration");
await page.fill("#migrate-token", "wrong-token-wrong-token");
await page.getByRole("button", { name: /Apply/ }).click();
await page.waitForSelector("[data-flash=error]", { timeout: 20000 });
if (/Setup token not accepted/.test(await text(page))) ok("wrong token refused");
else fail("wrong token not refused");
await page.fill("#migrate-token", TOKEN);
await page.getByRole("button", { name: /Apply/ }).click();
await page.waitForURL(/setup\?ok=/, { timeout: 60000 });
await page.waitForSelector("[data-flash]", { timeout: 20000 });
if (/migration\(s\) applied/.test(await text(page))) ok("migrations applied with the token");
else fail("migrations not applied");
if (/all \d+ applied/.test(await text(page))) ok("state: all migrations applied");
else fail("state did not update");

console.log("▶ 3. first Owner with a temporary PIN; second attempt refused");
await page.fill("#owner-token", TOKEN);
await page.fill('input[name="email"]', EMAIL);
await page.fill('input[name="name"]', "Go-live Owner");
await page.fill('input[name="pin"]', TEMP_PIN);
await page.fill('input[name="pinAgain"]', TEMP_PIN);
await Promise.all([page.waitForURL(/setup\?ok=Owner/, { timeout: 20000 }), page.getByRole("button", { name: "Provision the first Owner" }).click()]);
await page.waitForSelector("[data-flash]", { timeout: 20000 });
if (new RegExp(`Owner ${EMAIL} provisioned`).test(await text(page))) ok("Owner provisioned");
else fail("Owner not provisioned");
if (/Provision the first Owner/.test(await text(page))) fail("first-Owner form still offered after an Owner exists");
else ok("first-Owner form gone; setup complete");

console.log("▶ 4. sign in with the temporary PIN → forced change → home");
await page.goto(`${BASE}/sign-in`);
await page.fill("#signin-email", EMAIL);
await page.fill("#signin-pin", TEMP_PIN);
await Promise.all([page.waitForURL(/account\/pin/), page.getByRole("button", { name: "Sign in" }).click()]);
ok("temporary PIN signs in and lands on Choose your PIN");
await page.goto(`${BASE}/orders`);
await page.waitForURL(/account\/pin/);
ok("business pages redirect back until a PIN is chosen");
await page.fill('input[name="currentPin"]', TEMP_PIN);
await page.fill('input[name="newPin"]', REAL_PIN);
await page.fill('input[name="confirmPin"]', REAL_PIN);
await Promise.all([page.waitForURL(/\/\?ok=/), page.getByRole("button", { name: /Save PIN/ }).click()]);
if (/PIN changed/.test(await text(page))) ok("own PIN chosen; Owner home shown");
else fail("PIN change did not land on home");
if (/Owner/.test(await text(page))) ok("signed in as Owner");
await page.goto(`${BASE}/admin/employees`);
if (new RegExp(EMAIL).test(await text(page))) ok("Employees & access reachable; Owner listed with PIN set");
else fail("Employees page missing the Owner");
await page.goto(`${BASE}/sign-in?reason=session`);
await page.goto(`${BASE}/api/auth/sign-out`).catch(() => {});

console.log("▶ 5. production guards: no demo banner, no fixture sign-in");
await page.goto(`${BASE}/sign-in`);
const t = await text(page);
if (!/DEVELOPMENT DEMO MODE/.test(t)) ok("no demo banner on a production build");
else fail("demo banner shown on a production build");
if (!/Switch demo user|Dev fixture sign-in/.test(t)) ok("no fixture sign-in on a production build");
else fail("fixture sign-in offered on a production build");

await browser.close();
console.log(problems.length ? `\nPROBLEMS:\n  ${problems.join("\n  ")}` : "\nPROBLEMS: none");
process.exit(problems.length ? 1 : 0);
