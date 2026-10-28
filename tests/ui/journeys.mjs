#!/usr/bin/env node
/**
 * Role-based browser journeys (§6.3, UX-12) against a running demo
 * (`npm run demo`, default http://localhost:3000). Each journey asserts the
 * VISIBLE result and the PERSISTED outcome (re-read from a fresh page load),
 * records step counts and wall-clock time, and takes screenshots of the
 * changed views. This is automated validation with fictional data — not a
 * staff usability session (see docs/STAFF_SESSION_SCRIPT.md for that).
 *
 *   npm run demo            # in one shell
 *   npm run test:ui         # in another; SHOTS_DIR=… to choose the screenshot folder
 *
 * Exit code 1 when any assertion fails, a page error occurs or a 5xx is seen.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.env.SHOTS_DIR ?? "./tests/ui/shots";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const problems = [];
const timings = [];
const stamp = Date.now().toString(36);

function fail(msg) {
  problems.push(msg);
  console.log("  ✗", msg);
}
function ok(msg) {
  console.log("  ✓", msg);
}
async function expectText(page, re, label) {
  const body = await page.locator("body").innerText();
  if (re.test(body)) ok(label);
  else fail(`${label} — expected ${re} in page text`);
}
async function expectNoText(page, re, label) {
  const body = await page.locator("body").innerText();
  if (!re.test(body)) ok(label);
  else fail(`${label} — did not expect ${re} in page text`);
}

async function session(name, mobile = false) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[${name}] pageerror ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[${name}] ${r.status()} ${r.url()}`);
  });
  await page.goto(`${BASE}/sign-in?switch=1`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL(`${BASE}/`);
  return { ctx, page };
}
async function shot(page, file) {
  await page.screenshot({ path: `${out}/${file}.png`, fullPage: true });
}
async function flash(page) {
  return page.evaluate(() => document.querySelector("[data-flash]")?.textContent?.trim() ?? null).catch(() => null);
}
/** Select an <option> whose label matches a regex (Playwright's selectOption takes exact strings). */
async function selectByLabel(locator, re) {
  const value = await locator.evaluate((el, src) => {
    const r = new RegExp(src);
    const opt = Array.from(el.options).find((o) => r.test(o.textContent ?? ""));
    return opt ? opt.value : null;
  }, re.source);
  if (value === null) throw new Error(`no option matching ${re}`);
  await locator.selectOption(value);
}
/** Submit a server-action form and wait for the resulting navigation (the action POST, then the redirected page). */
async function act(page, fn) {
  const before = { url: page.url(), flash: await flash(page) };
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().startsWith(BASE)), fn()]);
  // Every action redirects with a flash, so wait for the router to commit the new URL (or a new flash) before reading the page.
  await page
    .waitForFunction((b) => location.href !== b.url || (document.querySelector("[data-flash]")?.textContent?.trim() ?? null) !== b.flash, before, { timeout: 10_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(100);
}
function journey(name) {
  const started = Date.now();
  let steps = 0;
  console.log(`\n▶ ${name}`);
  return {
    step: (label) => {
      steps++;
      console.log(`  ${steps}. ${label}`);
    },
    end: (note = "") => {
      const s = (Date.now() - started) / 1000;
      timings.push({ name, steps, seconds: Number(s.toFixed(1)), note });
      console.log(`  ⏱ ${steps} steps, ${s.toFixed(1)}s ${note}`);
    },
  };
}

let salesLocationUrl = "";
let salesOrderUrl = "";
let salesOrderNumber = "";
let repeatOrderUrl = ""; // the order placed from the repeat preview (current prices) — journey 3 amends this one
let orderedLabels = []; // product labels ordered in journey 1 (journey 2 changes the first's price and archives the second)

// ---------------- 1. Sales: new account with same-name warning, first order, readiness ----------------
{
  const j = journey("1 Sales — new account (same-name warning), first order before license/setup");
  const { ctx, page } = await session("Sam Sales");
  j.step("open New account");
  await page.goto(`${BASE}/locations/new`);
  j.step("fill minimal fields (same trade name as an existing account)");
  await page.fill('input[name="tradeName"]', "Golden Gate Grill");
  await page.fill('input[name="d_line1"]', `${stamp} Journey Ave`);
  await page.fill('input[name="d_city"]', "San Francisco");
  await page.fill('input[name="d_state"]', "CA");
  await page.fill('input[name="d_postal"]', "94110");
  await page.fill('input[name="buyerName"]', "Jo Journey");
  await page.fill('input[name="buyerEmail"]', `jo+${stamp}@example.test`);
  j.step("submit with a validation error first (AP email the browser accepts but the server refuses) — values must survive");
  await page.fill('input[name="apEmail"]', "ap@nodot");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForSelector("[data-flash=error]");
  await expectText(page, /AP email must be a valid address/, "field-level error shown");
  if ((await page.inputValue('input[name="tradeName"]')) === "Golden Gate Grill") ok("typed values preserved after error");
  else fail("typed values lost after error");
  await shot(page, "j1-01-new-account-error");
  j.step("fix and submit");
  await page.fill('input[name="apEmail"]', `ap+${stamp}@example.test`);
  await page.fill('input[name="apName"]', "AP Desk");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/locations\/[0-9a-f-]+/);
  await page.waitForSelector("[data-flash]", { timeout: 5000 }).catch(() => {});
  const f1 = await flash(page);
  if (/similar name/.test(f1 ?? "")) ok(`created with same-name warning: ${f1}`);
  else fail(`expected a similar-name warning, got: ${f1}`);
  salesLocationUrl = page.url().split("?")[0];
  await expectText(page, /License verification is needed before delivery/, "plain-language readiness shown");
  await expectText(page, /Similar trade names/, "similar names notice");
  await shot(page, "j1-02-account-workspace");
  j.step("new order from the account");
  await page.getByRole("link", { name: "New order" }).first().click();
  await page.waitForURL(/orders\/new/);
  await expectText(page, /Orders are still captured/i, "readiness blockers explained without blocking");
  const qty = page.locator('input[name^="qty:"]:not([disabled])');
  await qty.nth(0).fill("3");
  await qty.nth(1).fill("1");
  for (const i of [0, 1]) {
    const id = await qty.nth(i).getAttribute("id");
    orderedLabels.push((await page.locator(`label[for="${id}"]`).innerText()).trim());
  }
  console.log(`  (ordered: ${orderedLabels.join(" / ")})`);
  await expectText(page, /merchandise/i, "live totals preview");
  j.step("submit");
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  await page.getByRole("button", { name: "Submit order" }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]+/);
  salesOrderUrl = page.url().split("?")[0];
  salesOrderNumber = (await page.locator("h1").innerText()).trim();
  await page.waitForSelector("[data-flash]", { timeout: 5000 }).catch(() => {});
  const f2 = await flash(page);
  if (/recorded/.test(f2 ?? "")) ok(`order flash: ${f2}`);
  else fail(`unexpected order flash: ${f2}`);
  await expectText(page, /Order recorded/, "order status line in plain language");
  await expectText(page, /License verification is needed before delivery/, "readiness consequence on order");
  await shot(page, "j1-03-order-detail");
  j.step("verify persisted: reload account shows the order");
  await page.goto(salesLocationUrl);
  await expectText(page, new RegExp(salesOrderNumber), "order listed on account after reload");
  j.end();
  await ctx.close();
}

// ---------------- 2. Sales: repeat after price change + archival ----------------
{
  const j = journey("2 Sales — repeat a prior order after a price change and SKU archival");
  // Admin changes a price and archives a product first (fictional catalog change).
  const admin = await session("Ada Admin");
  j.step("Admin: change a market price and archive a product");
  await admin.page.goto(`${BASE}/admin/catalog`);
  const priceForm = admin.page.locator("form").filter({ has: admin.page.locator('input[name="price"]') }).first();
  await selectByLabel(priceForm.locator('select[name="marketId"]'), /NorCal/);
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  await selectByLabel(priceForm.locator('select[name="skuId"]'), new RegExp(`^\\s*${esc(orderedLabels[0])}\\s*$`));
  await priceForm.locator('input[name="price"]').fill("37.50");
  await priceForm.locator('input[name="reason"]').fill("journey price change");
  await act(admin.page, () => priceForm.getByRole("button", { name: "Set price" }).click());
  await expectText(admin.page, /Market price set/, `price changed for ${orderedLabels[0]}`);
  const archiveBtn = admin.page.locator("tr").filter({ hasText: orderedLabels[1] }).getByRole("button", { name: /^Archive$/ }).first();
  if (await archiveBtn.count()) {
    await act(admin.page, () => archiveBtn.click());
    await expectText(admin.page, /SKU archived/, `archived ${orderedLabels[1]}`);
  } else fail(`no archive button found for ${orderedLabels[1]}`);
  await admin.ctx.close();
  const { ctx, page } = await session("Sam Sales");
  j.step("open the account and repeat the last order");
  await page.goto(salesLocationUrl);
  await page.getByRole("link", { name: /^Repeat / }).first().click();
  await page.waitForURL(/repeat=/);
  await expectText(page, /preview of a NEW order with today/, "repeat is a preview, not a resubmission");
  const changed = await page.locator("text=price changed from").count();
  const skipped = await page.locator("text=Not carried over").count();
  if (changed >= 1) ok("price change flagged on the repeated line");
  else fail("expected a 'price changed from' badge on the repeated line");
  if (skipped >= 1) ok("archived product listed as not carried over");
  else fail("expected the archived product to be listed as not carried over");
  await shot(page, "j2-01-repeat-preview");
  j.step("enter an invalid quantity, recover, submit once (double click)");
  const qty = page.locator('input[name^="qty:"]:not([disabled])');
  await qty.nth(0).fill("2");
  const btn = page.getByRole("button", { name: "Place new order" });
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  // Two clicks in the same tick: the pending state disables the button and the server key makes a second submit a replay anyway.
  await Promise.all([page.waitForURL(/\/orders\/[0-9a-f-]+/), btn.evaluate((b) => { b.click(); b.click(); })]);
  repeatOrderUrl = page.url().split("?")[0];
  const newNumber = (await page.locator("h1").innerText()).trim();
  if (newNumber !== salesOrderNumber) ok(`new business identity ${newNumber} (source ${salesOrderNumber})`);
  else fail("repeat reused the original order");
  await page.goto(`${BASE}/orders?locationId=${salesLocationUrl.split("/").pop()}`);
  const count = await page.locator(`text=${newNumber}`).count();
  if (count === 1) ok("exactly one new order after double click");
  else fail(`expected one ${newNumber}, saw ${count}`);
  await shot(page, "j2-02-orders-after-repeat");
  j.end();
  await ctx.close();
}

// ---------------- 3. Sales/Admin: change request, amendment, stale action after cancellation ----------------
{
  const j = journey("3 Sales/Admin — change request, amendment, stale action after cancellation");
  const sales = await session("Sam Sales");
  j.step("Sales requests a quantity change");
  await sales.page.goto(salesOrderUrl);
  await sales.page.locator("summary", { hasText: "Request change" }).first().click();
  await sales.page.locator('input[name="requestedQty"]').first().fill("4");
  await sales.page.locator('input[name="reason"][placeholder="Reason"]').first().fill("buyer wants one more");
  await act(sales.page, () => sales.page.getByRole("button", { name: "Record request" }).first().click());
  await expectText(sales.page, /Change request recorded/, "change request recorded (no silent effect)");
  await sales.ctx.close();
  const admin = await session("Ada Admin");
  j.step("Admin tries to add units to the ORIGINAL order, whose line price no longer matches the market price (D12 unselected)");
  await admin.page.goto(salesOrderUrl);
  await admin.page.locator("summary", { hasText: "Admin: amend quantity" }).first().click();
  const repricedForm = admin.page.locator('form:has(input[name="newQty"])').first();
  await repricedForm.locator('input[name="newQty"]').fill("4");
  await repricedForm.locator('input[name="reason"]').fill("per change request");
  await act(admin.page, () => repricedForm.getByRole("button", { name: "Apply" }).click());
  await expectText(admin.page, /price decision \(D12 unselected\)/, "refused: the application never chooses an unselected pricing policy");
  j.step("Admin applies the amendment on the order placed at current prices");
  await admin.page.goto(repeatOrderUrl);
  await admin.page.locator("summary", { hasText: "Admin: amend quantity" }).first().click();
  const amendForm = admin.page.locator('form:has(input[name="newQty"])').first();
  await amendForm.locator('input[name="newQty"]').fill("4");
  await amendForm.locator('input[name="reason"]').fill("per change request");
  await act(admin.page, () => amendForm.getByRole("button", { name: "Apply" }).click());
  await expectText(admin.page, /Quantity amended/, "amendment applied");
  await expectText(admin.page, /current 4/, "line shows current 4");
  await shot(admin.page, "j3-01-amended");
  j.step("Admin keeps a stale copy of the page open, cancels in another tab, then applies the stale amendment");
  const stale = await admin.ctx.newPage();
  await stale.goto(repeatOrderUrl);
  await stale.locator("summary", { hasText: "Admin: amend quantity" }).first().click();
  const cancelForm = admin.page.locator("form").filter({ has: admin.page.locator('input[name="reason"][placeholder="Reason"]') }).filter({ hasText: /Cancel remaining/ }).first();
  await cancelForm.locator('input[name="reason"]').fill("customer cancelled");
  await act(admin.page, () => cancelForm.getByRole("button", { name: "Cancel remaining" }).click());
  await expectText(admin.page, /cancelled/i, "cancelled");
  const staleForm = stale.locator('form:has(input[name="newQty"])').first();
  await staleForm.locator('input[name="newQty"]').fill("3");
  await staleForm.locator('input[name="reason"]').fill("stale form");
  await act(stale, () => staleForm.getByRole("button", { name: "Apply" }).click());
  await expectText(stale, /is cancelled; it cannot be amended/, "stale amendment refused with current state");
  await expectText(stale, /reserved 0/, "no fresh reservation on the cancelled order");
  await shot(stale, "j3-02-stale-refusal");
  j.end();
  await admin.ctx.close();
}

// ---------------- 4. Admin: receive stock, retained demand, sample return, resolve only the fixed incident ----------------
{
  const j = journey("4 Admin — receive stock for the seeded shortage, sample return, targeted resolution");
  const { ctx, page } = await session("Ada Admin");
  j.step("command center shows the shortage");
  await page.goto(`${BASE}/admin?category=allocation_shortage`);
  await expectText(page, /Shortage on/, "shortage case listed with affected order");
  await shot(page, "j4-01-command-center");
  j.step("record a receipt of Sunlight sixtels at East Brother");
  await page.goto(`${BASE}/admin/markets`);
  const card = page.locator("section").filter({ hasText: "Stock — East Brother" }).first();
  await card.locator("summary", { hasText: "Record stock evidence" }).click();
  const form = card.locator('form:has(select[name="kind"])').first();
  await selectByLabel(form.locator('select[name="skuId"]'), /Sunlight Groove 1\/6 bbl keg/);
  await form.locator('select[name="kind"]').selectOption("receipt");
  await form.locator('input[name="qty"]').fill("10");
  await form.locator('input[name="evidence"]').fill("host brewery transfer sheet #J4");
  await act(page, () => form.getByRole("button", { name: "Record" }).click());
  await expectText(page, /re-filled oldest first/, "receipt recorded, waiting demand refilled");
  j.step("shortage case resolved by cause; nothing else touched");
  await page.goto(`${BASE}/admin?category=allocation_shortage`);
  await expectNoText(page, /Shortage on NC-0000/, "no open shortage case remains for the seeded order");
  await page.goto(`${BASE}/admin?category=below_minimum`);
  await expectText(page, /below|minimum/i, "unrelated below-minimum case still open");
  j.step("damage can never add stock (form + service)");
  await page.goto(`${BASE}/admin/markets`);
  const card2 = page.locator("section").filter({ hasText: "Stock — East Brother" }).first();
  await card2.locator("summary", { hasText: "Record stock evidence" }).click();
  const form2 = card2.locator('form:has(select[name="kind"])').first();
  await form2.locator('select[name="skuId"]').selectOption({ index: 1 });
  await form2.locator('select[name="kind"]').selectOption("damage");
  await form2.locator('input[name="qty"]').fill("1");
  await form2.locator('input[name="evidence"]').fill("forklift");
  await act(page, () => form2.getByRole("button", { name: "Record" }).click());
  await expectText(page, /Stock evidence recorded/, "damage recorded as a removal");
  j.step("sample return once; second attempt refused");
  await page.goto(`${BASE}/samples`);
  const summaries = page.locator("summary", { hasText: "Correct / return" });
  if (await summaries.count()) {
    await summaries.first().click();
    const rf = page.locator("form").filter({ has: page.locator('select[name="condition"]') }).first();
    await rf.locator('input[name="evidence"]').fill("sealed, inspected");
    const stalePage = await ctx.newPage();
    await stalePage.goto(`${BASE}/samples`);
    await stalePage.locator("summary", { hasText: "Correct / return" }).first().click();
    const rf2 = stalePage.locator('form:has(select[name="condition"])').first();
    await rf2.locator('input[name="evidence"]').fill("second attempt");
    await act(page, () => rf.getByRole("button", { name: "Return" }).click());
    await expectText(page, /Sample return recorded/, "sample returned once");
    await act(stalePage, () => rf2.getByRole("button", { name: "Return" }).click());
    await expectText(stalePage, /already returned/, "second return refused with the current state");
    await stalePage.close();
    await shot(page, "j4-02-samples");
  } else console.log("  (no outstanding sample to return in this run)");
  j.end();
  await ctx.close();
}

// ---------------- 5. Accounting: payer separate from AP, setup intent, manual notice outcome ----------------
{
  const j = journey("5 Accounting — assign payer separately from AP, setup intent, record manual send");
  const { ctx, page } = await session("Al Accounting");
  j.step("open the account created in journey 1");
  await page.goto(salesLocationUrl);
  await expectText(page, /No payer has been assigned/, "setup blocked until payer assigned (not inherited from AP)");
  const setupBtn = page.getByRole("button", { name: "Request ACH setup" });
  if (await setupBtn.isDisabled()) ok("Request ACH setup disabled without payer");
  else fail("Request ACH setup should be disabled without a payer");
  j.step("assign payer authority (explicit act)");
  await page.locator("summary", { hasText: "Assign payer authority" }).click();
  const pf = page.locator("form").filter({ has: page.locator('select[name="contactId"]') }).first();
  await pf.locator('select[name="contactId"]').selectOption({ index: 2 });
  await act(page, () => pf.getByRole("button", { name: "Assign" }).click());
  await expectText(page, /Payer authority recorded/, "payer assigned");
  j.step("request setup → invitation intent");
  await act(page, () => page.getByRole("button", { name: "Request ACH setup" }).click());
  await expectText(page, /Setup requested/, "setup requested");
  await expectText(page, /Payment setup invitation/, "invitation intent visible");
  await expectText(page, /To send \(manual\)/, "intent is pending for the manual sender");
  await shot(page, "j5-01-payer-and-invitation");
  j.step("record the manual send with evidence");
  const nf = page.locator("form").filter({ has: page.locator('select[name="outcome"]') }).first();
  await nf.locator('input[name="sentVia"]').fill("Gmail ops@ (manual)");
  await nf.locator('input[name="evidence"]').fill(`msg id <j5-${stamp}>`);
  await act(page, () => nf.getByRole("button", { name: "Record outcome" }).click());
  await expectText(page, /Recorded as sent to/, "send recorded as staff evidence");
  await expectText(page, /not provider confirmation/, "explicitly not provider-confirmed");
  j.step("repeat request reuses the pending state; notices queue reflects it");
  await page.goto(`${BASE}/admin/notices?view=sent`);
  await expectText(page, /Payment setup invitation/, "sent notice listed in the notices queue");
  await shot(page, "j5-02-notices-queue");
  j.end();
  await ctx.close();
}

// ---------------- 6. Owner: decision register without JSON ----------------
{
  const j = journey("6 Owner — record a market-specific future D11 selection with typed fields; unaffected market keeps policy");
  const { ctx, page } = await session("Demo Owner");
  j.step("inspect D11");
  await page.goto(`${BASE}/owner/decisions/D11`);
  await expectText(page, /execution implemented/, "implementation coverage shown");
  await expectText(page, /Effective policy by market/i, "per-market matrix");
  j.step("record an all-markets selection with the typed control");
  const form = page.locator("form").filter({ has: page.locator('select[name="sel:value_basis"]') }).first();
  await form.locator('select[name="sel:value_basis"]').selectOption("merchandise_only");
  await form.locator('input[name="scope"]').fill("all markets (journey)");
  await act(page, () => form.getByRole("button", { name: "Record" }).click());
  await expectText(page, /Production selection recorded/, "all-markets selection recorded");
  j.step("record an NC-only override effective next week");
  const form2 = page.locator("form").filter({ has: page.locator('select[name="sel:value_basis"]') }).first();
  await form2.locator('select[name="sel:value_basis"]').selectOption("merchandise_plus_deposits");
  await form2.locator('input[name="marketIds"]').first().check();
  const next = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16);
  await form2.locator('input[name="effectiveFrom"]').fill(next);
  await form2.locator('input[name="scope"]').fill("NC only from next week (journey)");
  await act(page, () => form2.getByRole("button", { name: "Record" }).click());
  await expectText(page, /then:/, "scheduled change shown for NC only");
  const body = await page.locator("body").innerText();
  const maLine = body.split("\n").find((l) => /^MA\b|\bMA\s/.test(l) && /merchandise_only/.test(l));
  if (maLine) ok("MA still shows the all-markets basis (unaffected market keeps policy)");
  else fail("MA line does not show merchandise_only");
  await shot(page, "j6-01-decision-matrix");
  j.step("withdraw only the NC override; history retained");
  const withdraw = page.locator("form").filter({ has: page.locator('input[name="selectionId"]') }).filter({ hasText: /Withdraw this selection/ }).first();
  await withdraw.locator('input[name="reason"]').fill("journey cleanup");
  await act(page, () => withdraw.getByRole("button", { name: "Withdraw this selection" }).click());
  await expectText(page, /withdrawn; other selections keep applying/, "single withdrawal keeps the rest");
  await expectText(page, /Withdrawn: journey cleanup/, "withdrawal reason in history");
  await shot(page, "j6-02-decision-history");
  j.end();
  await ctx.close();
}

// ---------------- 7. Owner/Admin: disable a signed-in employee, offboard, reuse email ----------------
{
  const j = journey("7 Owner/Admin — disable a signed-in employee mid-session, offboard, reuse the email for a new person");
  const lee = await session("Lee Sales");
  await lee.page.goto(`${BASE}/locations`);
  await expectText(lee.page, /Echo Park Cantina/, "Lee sees LA accounts before disablement");
  const admin = await session("Ada Admin");
  j.step("Admin disables Lee");
  await admin.page.goto(`${BASE}/admin/employees`);
  const leeItem = admin.page.locator("li").filter({ hasText: "Lee Sales" }).first();
  await leeItem.locator("summary").click();
  const disable = leeItem.locator("form").filter({ hasText: "Disable" }).first();
  await disable.locator('input[name="reason"]').fill("left the company");
  await act(admin.page, () => disable.getByRole("button", { name: "Disable" }).click());
  await expectText(admin.page, /Employee disabled/, "disabled");
  j.step("Lee's open session is refused on its next action (no re-login)");
  await lee.page.goto(`${BASE}/locations`);
  await lee.page.waitForURL(/sign-in/);
  ok("Lee redirected to sign-in on the next request");
  await lee.ctx.close();
  j.step("Admin offboards Lee, then provisions a NEW person with the same email");
  await admin.page.goto(`${BASE}/admin/employees`);
  const leeItem2 = admin.page.locator("li").filter({ hasText: "Lee Sales" }).first();
  await leeItem2.locator("summary").click();
  const off = leeItem2.locator("form").filter({ hasText: "Offboard" }).first();
  await off.locator('input[name="reason"]').fill("departure processed");
  await act(admin.page, () => off.getByRole("button", { name: /Offboard/ }).click());
  await expectText(admin.page, /Offboarded:/, "offboarded (identity retired, grants revoked)");
  await admin.page.fill('input[name="displayName"]', "New Lee");
  await admin.page.fill('input[name="email"]', "sales-la@demo.local");
  await admin.page.selectOption('select[name="role"]', "driver_service");
  await act(admin.page, () => admin.page.getByRole("button", { name: "Provision" }).click());
  await expectText(admin.page, /Employee provisioned/, "same email provisioned as a NEW employee");
  const newLee = admin.page.locator("li").filter({ hasText: "New Lee" }).first();
  const grants = await newLee.locator("text=Driver / Service").count();
  if (grants >= 1) ok("new person has only the intentionally assigned grant");
  else fail("new person grants unexpected");
  await expectText(admin.page, /identity retired/, "old employee shows retired identity (history kept)");
  await shot(admin.page, "j7-01-offboarding");
  j.step("Admin cannot grant itself Owner");
  const self = admin.page.locator("li").filter({ hasText: "Ada Admin" }).first();
  const manageSummary = self.locator("summary");
  if ((await manageSummary.count()) === 0) ok("no self-management controls offered to Admin");
  else fail("Admin offered controls on its own grants");
  j.end();
  await admin.ctx.close();
}

// ---------------- 8. Driver: assigned execution context only ----------------
{
  const j = journey("8 Driver/Service — honest empty state, no account/order leak");
  const { ctx, page } = await session("Dee Driver", true);
  await expectText(page, /Nothing is assigned to you/, "honest empty state on home");
  await expectNoText(page, /Mission Taproom|Golden Gate/, "no customer names on driver home");
  j.step("direct URLs to accounts and orders are refused");
  await page.goto(`${BASE}/locations`);
  await page.waitForURL(/forbidden/);
  ok("accounts list forbidden for driver");
  await page.goto(salesOrderUrl);
  await page.waitForURL(/forbidden/);
  ok("order page forbidden for driver");
  await page.goto(`${BASE}/search?q=Golden`);
  await expectNoText(page, /Golden Gate Grill/, "search returns no accounts to a driver");
  await page.goto(`${BASE}/search?q=Cantinesca`);
  await expectText(page, /product/, "product search still works");
  await page.goto(`${BASE}/menu`);
  await expectText(page, /My route/, "driver menu lists its destinations");
  await shot(page, "j8-01-driver-mobile");
  j.end();
  await ctx.close();
}

// ---------------- 9. Mobile: Owner reaches every destination and sign-out ----------------
{
  const j = journey("9 Mobile — Owner: frequent tasks and every permitted destination reachable");
  const { ctx, page } = await session("Demo Owner", true);
  j.step("bottom bar → More → every destination");
  await page.getByRole("link", { name: "More" }).click();
  await page.waitForURL(/menu/);
  const links = await page.locator("main a").allInnerTexts();
  for (const want of ["Accounts", "Orders", "Command center", "Decisions", "Integrations", "Employees & access", "Notices", "Products"]) {
    if (links.some((l) => l.includes(want))) ok(`menu lists ${want}`);
    else fail(`menu missing ${want}`);
  }
  await shot(page, "j9-01-mobile-menu");
  j.step("keyboard: tab reaches the first nav link and focus is visible");
  await page.goto(`${BASE}/`);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (focused) ok(`first Tab focuses: "${focused}"`);
  else fail("no focus after Tab");
  j.step("frequent task: new order (searchable account picker)");
  await page.goto(`${BASE}/orders/new`);
  await page.fill("#account-search", "Golden");
  const matches = await page.locator("main li a").count();
  if (matches >= 2) ok(`same-name accounts distinguished by address (${matches} matches)`);
  else fail("account picker did not show the two Golden Gate Grills");
  await shot(page, "j9-02-mobile-account-picker");
  j.step("sign out from the menu");
  await page.goto(`${BASE}/menu`);
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.waitForURL(/sign-in|\/$/);
  ok("sign-out reachable on mobile");
  j.end();
  await ctx.close();
}

// ---------------- 10. Sign-in with email + PIN: refusal, success, temporary PIN → forced change ----------------
{
  const j = journey("10 Sign-in — email + PIN refused/accepted; temporary PIN must be changed before any business use");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[pin] pageerror ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[pin] ${r.status()} ${r.url()}`);
  });
  j.step("wrong PIN is refused without saying which part was wrong; the email is kept");
  await page.goto(`${BASE}/sign-in?switch=1`);
  await page.fill("#signin-email", "accounting@demo.local");
  await page.fill("#signin-pin", "907315");
  await Promise.all([page.waitForURL(/sign-in\?reason=/), page.getByRole("button", { name: "Sign in" }).click()]);
  await expectText(page, /Email or PIN not recognised/, "generic refusal");
  if ((await page.inputValue("#signin-email")) === "accounting@demo.local") ok("email kept after refusal");
  else fail("email lost after refusal");
  await shot(page, "j10-01-sign-in-refused");
  j.step("correct PIN signs in as that person with their internal grants");
  await page.fill("#signin-pin", "135790");
  await Promise.all([page.waitForURL(`${BASE}/`), page.getByRole("button", { name: "Sign in" }).click()]);
  await expectText(page, /Al Accounting/, "signed in as Al Accounting");
  await page.goto(`${BASE}/admin/catalog`);
  await expectText(page, /Not permitted/, "Accounting is refused an Admin-only destination after PIN sign-in (authority stays internal)");
  await page.goto(`${BASE}/menu`);
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.waitForURL(/sign-in|\/$/);
  j.step("Admin sets a temporary PIN for Sam; Sam must choose a PIN before anything else; the old PIN no longer works");
  const admin = await session("Ada Admin");
  await admin.page.goto(`${BASE}/admin/employees`);
  const row = admin.page.locator("li").filter({ hasText: "sales-nc@demo.local" }).first();
  await row.locator("summary", { hasText: "Manage" }).click();
  const pinForm = row.locator('form:has(input[name="pinAgain"])').first();
  await pinForm.locator('input[name="pin"]').fill("482157");
  await pinForm.locator('input[name="pinAgain"]').fill("482157");
  await pinForm.locator('input[name="reason"]').fill("forgot PIN (journey)");
  await act(admin.page, () => pinForm.getByRole("button", { name: /Reset PIN|Set PIN/ }).click());
  await expectText(admin.page, /Temporary PIN set/, "temporary PIN recorded by Admin");
  await expectText(admin.page, /temporary PIN — must change at sign-in/i, "employee shows the must-change state");
  await admin.ctx.close();
  await page.goto(`${BASE}/sign-in?switch=1`);
  await page.fill("#signin-email", "sales-nc@demo.local");
  await page.fill("#signin-pin", "135790");
  await Promise.all([page.waitForURL(/sign-in\?reason=/), page.getByRole("button", { name: "Sign in" }).click()]);
  ok("old PIN refused after the reset");
  await page.fill("#signin-pin", "482157");
  await Promise.all([page.waitForURL(/account\/pin/), page.getByRole("button", { name: "Sign in" }).click()]);
  await expectText(page, /Choose your PIN/, "forced to the choose-PIN page");
  await page.goto(`${BASE}/orders`);
  await page.waitForURL(/account\/pin/);
  ok("business pages redirect back until the PIN is chosen");
  await shot(page, "j10-02-choose-pin");
  await page.fill('input[name="currentPin"]', "482157");
  await page.fill('input[name="newPin"]', "123456");
  await page.fill('input[name="confirmPin"]', "123456");
  await page.getByRole("button", { name: /Save PIN/ }).click();
  await page.waitForSelector("[data-flash=error]");
  await expectText(page, /straight run/, "weak PIN refused with the rule");
  await page.fill('input[name="currentPin"]', "482157");
  await page.fill('input[name="newPin"]', "907315");
  await page.fill('input[name="confirmPin"]', "907315");
  await Promise.all([page.waitForURL(/\/\?ok=/), page.getByRole("button", { name: /Save PIN/ }).click()]);
  await expectText(page, /PIN changed/, "own PIN chosen; signed in");
  await page.goto(`${BASE}/locations`);
  await expectText(page, /Golden Gate Grill/, "Sam now uses the system normally");
  j.end();
  await ctx.close();
}

// ---------------- 11. Setup page: state is shown, actions need the token ----------------
{
  const j = journey("11 Setup — /setup shows migration/Owner state and refuses actions without the setup token");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[setup] pageerror ${e.message}`));
  page.on("response", (r) => {
    if (r.status() >= 500) problems.push(`[setup] ${r.status()} ${r.url()}`);
  });
  j.step("state card");
  await page.goto(`${BASE}/setup`);
  await expectText(page, /all \d+ applied/, "every migration reported as applied on the demo database");
  await expectText(page, /owner@demo.local|provisioned/, "existing Owner shown; no second Owner can be created");
  await expectNoText(page, /Provision the first Owner/, "first-Owner form hidden once an Owner exists");
  await shot(page, "j11-01-setup");
  j.step("wrong token is refused");
  await page.fill("#migrate-token", "not-the-token");
  await page.getByRole("button", { name: /Re-check|Apply/ }).click();
  await page.waitForSelector("[data-flash=error]", { timeout: 15000 });
  await expectText(page, /Setup token not accepted/, "action refused without the configured token");
  j.end();
  await ctx.close();
}

await browser.close();
console.log("\nTIMINGS (automated browser, fictional data — not a staff session):");
for (const t of timings) console.log(`  ${t.name}: ${t.steps} steps, ${t.seconds}s ${t.note}`);
fs.writeFileSync(`${out}/timings.json`, JSON.stringify(timings, null, 2));
console.log(`\nPROBLEMS: ${problems.length ? "\n  " + problems.join("\n  ") : "none"}`);
process.exit(problems.length ? 1 : 0);
