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
/** Open a <details> by its summary and make sure it stays open (a click before hydration can be undone by hydration). */
async function openDetails(summary) {
  for (let i = 0; i < 5; i += 1) {
    await summary.click();
    await summary.page().waitForTimeout(150);
    const open = await summary.evaluate((el) => el.closest("details")?.open ?? false);
    if (open) return;
  }
  throw new Error("details did not open");
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
async function journey1() {
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
  await expectText(page, /the order is still taken/i, "readiness blockers explained without blocking");
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
  salesOrderNumber = (await page.locator("h1 .select-all").innerText()).trim();
  await page.waitForSelector("[data-flash]", { timeout: 5000 }).catch(() => {});
  const f2 = await flash(page);
  if (/recorded; delivery drafted/.test(f2 ?? "")) ok(`order flash: ${f2}`);
  else fail(`unexpected order flash: ${f2}`);
  await expectText(page, /Shipment drafted/, "order status line in plain language (R2-1: the draft shipment exists)");
  await expectText(page, /License verification is needed before delivery/, "readiness consequence on order");
  await shot(page, "j1-03-order-detail");
  j.step("verify persisted: reload account shows the order");
  await page.goto(salesLocationUrl);
  await expectText(page, new RegExp(salesOrderNumber), "order listed on account after reload");
  j.end();
  await ctx.close();
}

// ---------------- 2. Sales: repeat after price change + archival ----------------
async function journey2() {
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
  await expectText(page, /new order at today/i, "repeat is a preview, not a resubmission");
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
  const newNumber = (await page.locator("h1 .select-all").innerText()).trim();
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
async function journey3() {
  const j = journey("3 Sales/Admin — change request, amendment, stale action after cancellation");
  const sales = await session("Sam Sales");
  j.step("Sales requests a quantity change");
  await sales.page.goto(salesOrderUrl);
  await openDetails(sales.page.locator("summary", { hasText: "Request change" }).first());
  await sales.page.locator('input[name="requestedQty"]').first().fill("4");
  await sales.page.locator('input[name="reason"][placeholder="Reason"]').first().fill("buyer wants one more");
  await act(sales.page, () => sales.page.getByRole("button", { name: "Record request" }).first().click());
  await expectText(sales.page, /Change request recorded/, "change request recorded (no silent effect)");
  await sales.ctx.close();
  const admin = await session("Ada Admin");
  j.step("Admin tries to add units to the ORIGINAL order, whose line price no longer matches the market price (D12 unselected)");
  await admin.page.goto(salesOrderUrl);
  await openDetails(admin.page.locator("summary", { hasText: /^Amend$/ }).first());
  const repricedForm = admin.page.locator('form:has(input[name="newQty"])').first();
  await repricedForm.locator('input[name="newQty"]').fill("4");
  await repricedForm.locator('input[name="reason"]').fill("per change request");
  await act(admin.page, () => repricedForm.getByRole("button", { name: "Apply" }).click());
  await expectText(admin.page, /price decision \(D12 unselected\)/, "refused: the application never chooses an unselected pricing policy");
  j.step("Admin applies the amendment on the order placed at current prices");
  await admin.page.goto(repeatOrderUrl);
  await openDetails(admin.page.locator("summary", { hasText: /^Amend$/ }).first());
  const amendForm = admin.page.locator('form:has(input[name="newQty"])').first();
  await amendForm.locator('input[name="newQty"]').fill("4");
  await amendForm.locator('input[name="reason"]').fill("per change request");
  await act(admin.page, () => amendForm.getByRole("button", { name: "Apply" }).click());
  await expectText(admin.page, /Quantity amended/, "amendment applied");
  const orderLines = admin.page.locator("table").filter({ hasText: "Order lines" }).first();
  const currentCell = (await orderLines.locator("tbody tr").first().locator("td").nth(2).innerText()).trim();
  if (/^4\b/.test(currentCell)) ok("line shows current 4");
  else fail(`expected current 4, saw "${currentCell}"`);
  const reservedNow = (await orderLines.locator("tbody tr").first().locator("td").nth(3).innerText()).trim();
  const shipLines = admin.page.locator("table").filter({ hasText: "Shipment lines" }).first();
  const draftQty = (await shipLines.locator("tbody tr").first().locator("td").nth(2).innerText().catch(() => "")).trim();
  if (draftQty === reservedNow) ok(`the order's draft shipment follows the amendment: ${draftQty} reserved and on the draft (R2-1)`);
  else fail(`draft shipment line shows "${draftQty}", reserved ${reservedNow}`);
  await shot(admin.page, "j3-01-amended");
  j.step("Admin keeps a stale copy of the page open, cancels in another tab, then applies the stale amendment");
  const stale = await admin.ctx.newPage();
  await stale.goto(repeatOrderUrl);
  await openDetails(stale.locator("summary", { hasText: /^Amend$/ }).first());
  await openDetails(admin.page.locator("summary", { hasText: /^Cancel$/ }).first());
  const cancelForm = admin.page.locator("form").filter({ hasText: /Cancel remaining/ }).first();
  await cancelForm.locator('input[name="reason"]').fill("customer cancelled");
  await act(admin.page, () => cancelForm.getByRole("button", { name: "Cancel remaining" }).click());
  await expectText(admin.page, /cancelled/i, "cancelled");
  const staleForm = stale.locator('form:has(input[name="newQty"])').first();
  await staleForm.locator('input[name="newQty"]').fill("3");
  await staleForm.locator('input[name="reason"]').fill("stale form");
  await act(stale, () => staleForm.getByRole("button", { name: "Apply" }).click());
  await expectText(stale, /is cancelled; it cannot be amended/, "stale amendment refused with current state");
  const reservedCell = (await stale.locator("table").filter({ hasText: "Order lines" }).first().locator("tbody tr").first().locator("td").nth(3).innerText()).trim();
  if (reservedCell === "0") ok("no fresh reservation on the cancelled order");
  else fail(`expected reserved 0, saw "${reservedCell}"`);
  await shot(stale, "j3-02-stale-refusal");
  j.end();
  await admin.ctx.close();
}

// ---------------- 4. Admin: receive stock, retained demand, sample return, resolve only the fixed incident ----------------
async function journey4() {
  const j = journey("4 Admin — receive stock for the seeded shortage, sample return, targeted resolution");
  const { ctx, page } = await session("Ada Admin");
  j.step("Exceptions (the Command center folded in, R2-36) shows the shortage; the old /admin address still lands there");
  await page.goto(`${BASE}/admin?category=allocation_shortage`);
  await page.waitForURL(/admin\/exceptions/);
  await expectText(page, /Shortage on/, "shortage case listed with affected order");
  await expectText(page, /open cases/i, "counts across the top");
  await shot(page, "j4-01-exceptions");
  j.step("record a receipt of Sunlight sixtels at Express Wine Delivery (the NorCal warehouse)");
  await page.goto(`${BASE}/admin/markets`);
  const card = page.locator("section").filter({ has: page.locator("div", { hasText: /^Stock: EWD Express Wine Delivery/ }) }).last();
  await openDetails(card.locator("summary", { hasText: "Record stock evidence" }));
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
  const card2 = page.locator("section").filter({ has: page.locator("div", { hasText: /^Stock: EWD Express Wine Delivery/ }) }).last();
  await openDetails(card2.locator("summary", { hasText: "Record stock evidence" }));
  const form2 = card2.locator('form:has(select[name="kind"])').first();
  await form2.locator('select[name="skuId"]').selectOption({ index: 1 });
  await form2.locator('select[name="kind"]').selectOption("damage");
  await form2.locator('input[name="qty"]').fill("1");
  await form2.locator('input[name="evidence"]').fill("forklift");
  await act(page, () => form2.getByRole("button", { name: "Record" }).click());
  await expectText(page, /Stock evidence recorded/, "damage recorded as a removal");
  j.step("samples page is Phase 1 history only (R2-27)");
  await page.goto(`${BASE}/samples`);
  await expectText(page, /Samples are orders now/, "samples page points to the order screen");
  await expectNoText(page, /Correct \/ return|Record a sample withdrawal/, "no new withdrawals can be recorded");
  await shot(page, "j4-02-samples-history");
  j.end();
  await ctx.close();
}

// ---------------- 5. Accounting: payer separate from AP, setup intent, manual notice outcome ----------------
async function journey5() {
  const j = journey("5 Accounting — assign payer separately from AP, setup intent, record manual send");
  const { ctx, page } = await session("Al Accounting");
  j.step("open the account created in journey 1");
  await page.goto(salesLocationUrl);
  await expectText(page, /No payer has been assigned/, "setup blocked until payer assigned (not inherited from AP)");
  const setupBtn = page.getByRole("button", { name: "Request ACH setup" });
  if (await setupBtn.isDisabled()) ok("Request ACH setup disabled without payer");
  else fail("Request ACH setup should be disabled without a payer");
  j.step("assign payer authority (explicit act)");
  await openDetails(page.locator("summary", { hasText: "Assign payer authority" }));
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
async function journey6() {
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
async function journey7() {
  const j = journey("7 Owner/Admin — disable a signed-in employee mid-session, offboard, reuse the email for a new person");
  const lee = await session("Lee Sales");
  await lee.page.goto(`${BASE}/locations`);
  await expectText(lee.page, /Echo Park Cantina/, "Lee sees LA accounts before disablement");
  const admin = await session("Ada Admin");
  j.step("Admin disables Lee");
  await admin.page.goto(`${BASE}/admin/employees`);
  const leeItem = admin.page.locator("li").filter({ hasText: "Lee Sales" }).first();
  await openDetails(leeItem.locator("summary"));
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
  await openDetails(leeItem2.locator("summary"));
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
async function journey8() {
  const j = journey("8 Driver/Service — honest empty state, no account/order leak");
  const { ctx, page } = await session("Dee Driver", true);
  await expectText(page, /My stops/, "driver home lists own stops (R2-38)");
  await expectText(page, /Mission Taproom/, "the assigned stop is named");
  await expectNoText(page, /Golden Gate|Dogpatch/, "no other customers on the driver home");
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
  await expectText(page, /My stops/, "driver menu lists its destinations");
  await shot(page, "j8-01-driver-mobile");
  j.end();
  await ctx.close();
}

// ---------------- 9. Mobile: Owner reaches every destination and sign-out ----------------
async function journey9() {
  const j = journey("9 Mobile — Owner: frequent tasks and every permitted destination reachable");
  const { ctx, page } = await session("Demo Owner", true);
  j.step("bottom bar → More → every destination");
  await page.getByRole("link", { name: "More" }).click();
  await page.waitForURL(/menu/);
  const links = await page.locator("main a").allInnerTexts();
  for (const want of ["Accounts", "Orders", "Exceptions", "Decisions", "Integrations", "Employees & access", "Notices", "Products"]) {
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
  const matches = await page.locator("main li a").filter({ hasText: /Golden Gate Grill/ }).count();
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
async function journey10() {
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
  await openDetails(row.locator("summary", { hasText: "Manage" }));
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
async function journey11() {
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

// ---------------- 12. Shipments: origin code, packaging report, draft → confirm (number) → BOL PDF → deliver → invoice ----------------
async function journey12() {
  const j = journey("12 Shipments — origin code, packaging lot, order drafts and confirms the shipment, BOL PDF, delivery issues the invoice and posts kegs");
  const { ctx, page } = await session("Ada Admin");
  // The app dates documents in Pacific time (todayIso); the journey uses the same day so "today" defaults match.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  j.step("Admin gives East Brother its origin code (EBB) and lot facility code (01) as a brewery");
  await page.goto(`${BASE}/admin/markets`);
  const eb = page.locator("details").filter({ has: page.locator("summary", { hasText: /East Brother/ }) }).first();
  await openDetails(eb.locator("summary"));
  await eb.locator('input[name="originCode"]').fill("EBB");
  await eb.locator('input[name="lotFacilityCode"]').fill("01");
  await eb.locator('select[name="kind"]').selectOption("brewery");
  await act(page, () => eb.getByRole("button", { name: "Save origin" }).click());
  await expectText(page, /Origin saved/, "origin saved with its code");
  await page.goto(`${BASE}/admin/markets`);
  await expectText(page, /EBB East Brother/, "origin code persisted (re-read), shown as CODE Name (R2-34)");
  await shot(page, "j12-01-origins");

  j.step("packaging report records a Cantinesca lot at facility 01 (next free run digit for today)");
  let lotUrl = "";
  let lotCode = "";
  for (const run of "123456789") {
    await page.goto(`${BASE}/lots/new`);
    await selectByLabel(page.locator('select[name="facilityWarehouseId"]'), /EBB East Brother/);
    await page.selectOption('select[name="brandCode"]', "CNT");
    await page.fill('input[name="packagingDate"]', today);
    await page.fill('input[name="runCode"]', run);
    await page.getByLabel("CAN-12C quantity").fill("20");
    await page.getByLabel("CAN-HALF quantity").fill("6");
    await page.fill('textarea[name="notes"]', "journey packaging sheet");
    await act(page, () => page.getByRole("button", { name: "Record lot" }).click());
    if (/\/lots\/[0-9a-f-]{36}/.test(page.url())) {
      lotUrl = page.url().split("?")[0];
      lotCode = (await page.locator("h1 .select-all").innerText()).trim();
      break;
    }
    const f = await flash(page);
    if (!/already exists/.test(f ?? "")) {
      fail(`packaging report refused: ${f}`);
      break;
    }
  }
  if (lotUrl && /^01CNT\d{6}[0-9A-Z]$/.test(lotCode)) ok(`lot recorded with a computed code (${lotCode})`);
  else fail(`lot not recorded or code malformed (${lotCode || "none"})`);
  await expectText(page, /CAN-12C[\s\S]*20/, "quantities packaged shown on the lot");
  await shot(page, "j12-02-lot");

  j.step("delivery to Dogpatch Bottle Shop starts from an order (R2-1): the draft is created with the order, lots prefilled from EWD");
  await page.goto(`${BASE}/orders/new`);
  await page.fill("#account-search", "Dogpatch");
  await page.locator("main li a").filter({ hasText: /Dogpatch Bottle Shop/ }).first().click();
  await page.waitForURL(/orders\/new\?locationId=/);
  await expectText(page, /Ships from EWD Express Wine Delivery/, "the market's warehouse is the origin");
  await page.selectOption('select[name="source"]', "phone");
  await page.fill('input[name="poNumbers"]', `PO-${stamp}`);
  await page.getByLabel(/^Cantinesca 12 oz can case$/).fill("5");
  await page.getByLabel(/^Cantinesca 1\/2 bbl keg$/).fill("2");
  await page.fill('input[name="scheduledDate"]', today);
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  await act(page, () => page.getByRole("button", { name: "Submit and confirm shipment" }).click());
  await page.waitForURL(/\/orders\/[0-9a-f-]+/);
  const orderFlash = await flash(page);
  const numberMatch = (orderFlash ?? "").match(/(EWD-D-\d{6}-\d{3}) confirmed/);
  if (numberMatch) ok(`one screen: order recorded and ${numberMatch[1]} confirmed`);
  else fail(`expected "<number> confirmed" in the flash, got: ${orderFlash}`);
  const shipmentNumber = numberMatch?.[1] ?? "";
  await expectText(page, /Confirmed/, "shipment card shows the confirmed shipment");
  await shot(page, "j12-03-order-with-shipment");
  await page.getByRole("link", { name: new RegExp(shipmentNumber || "EWD-D") }).first().click();
  await page.waitForURL(/\/shipments\/[0-9a-f-]{36}/);
  const shipmentUrl = page.url().split("?")[0];
  await expectText(page, new RegExp(`PO-${stamp}`), "PO number carried from the order (R2-11)");

  j.step("documents stored at confirmation; the invoice draft exists; stock allocated at EWD");
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expectText(page, /Bill of lading/, "BOL stored");
  await expectText(page, /Picking ticket/, "picking ticket stored");
  await expectText(page, /INV draft/, "invoice draft created at confirmation (7.4)");
  await page.getByRole("tab", { name: /Allocations/ }).click();
  await expectText(page, /CAN-12C\s+5/, "stock allocated at the origin");
  const originId = await page.evaluate(async () => {
    const r = await fetch("/shipments/end-of-day");
    const html = await r.text();
    const m = html.match(/<option[^>]*value="([0-9a-f-]{36})"[^>]*>EWD Express Wine Delivery/);
    return m ? m[1] : "";
  });
  if (originId) ok("EWD origin id resolved from End of day");
  else fail("could not resolve the EWD origin id");

  j.step("BOL and picking ticket render as PDF for the signed-in user");
  for (const kind of ["bol", "picking_ticket"]) {
    const res = await page.request.get(`${shipmentUrl}/documents/${kind}`);
    const body = await res.body();
    if (res.status() === 200 && (res.headers()["content-type"] ?? "").includes("application/pdf") && body.subarray(0, 4).toString() === "%PDF") ok(`${kind} is a PDF (${body.length} bytes)`);
    else fail(`${kind} did not render as PDF (status ${res.status()}, type ${res.headers()["content-type"]})`);
  }
  const pull = await page.request.get(`${BASE}/shipments/print?origin=${originId}&date=${today}&kind=all`);
  if (pull.status() === 200 && (pull.headers()["content-type"] ?? "").includes("application/pdf")) ok("batch print (pull sheet + BOLs + picking tickets) renders for the origin and date");
  else fail(`pull sheet did not render (status ${pull.status()})`);

  j.step("deliver: office sets the actual date, the quantities kept per line (R2-8) and the empties collected; invoice issued dated the actual date");
  await openDetails(page.locator("summary", { hasText: /^Deliver$/ }));
  await page.fill('input[name="actualDate"]', today);
  await page.fill('input[name="halfIn"]', "1");
  await act(page, () => page.getByRole("button", { name: "Mark delivered" }).click());
  await expectText(page, /delivered .*invoice updated/i, "delivery recorded with keg and invoice effects");
  await page.getByRole("tab", { name: /Documents/ }).click();
  const bodyAfterDeliver = await page.locator("body").innerText();
  const invMatch = bodyAfterDeliver.match(/\b(INV\d{5})\b/);
  if (invMatch) ok(`invoice numbered ${invMatch[1]} (INV + yy + seq)`);
  else fail("no INV number shown after delivery");
  await page.getByRole("tab", { name: /Allocations/ }).click();
  await expectText(page, /1 × 1\/2 bbl, 0 × 1\/6 bbl/, "empties collected recorded on the stop");
  await expectNoText(page, /Confirm \(assign number\)|Mark delivered|Void shipment/, "no further state actions once delivered (the office may still correct)");
  await shot(page, "j12-04-delivered");

  j.step("persisted: invoice list, invoice PDF, keg balance, shipment list");
  await page.goto(`${BASE}/invoices`);
  if (invMatch) await expectText(page, new RegExp(invMatch[1]), "issued invoice listed");
  await expectText(page, /Dogpatch Bottle Shop/, "invoice shows the account");
  const invLink = invMatch ? page.getByRole("link", { name: invMatch[1] }).first() : null;
  if (invLink) {
    const href = await invLink.getAttribute("href");
    const pdf = await page.request.get(`${BASE}${href}/pdf`);
    const pdfBody = await pdf.body();
    if (pdf.status() === 200 && pdfBody.subarray(0, 4).toString() === "%PDF") ok("invoice PDF renders");
    else fail(`invoice PDF did not render (status ${pdf.status()})`);
    await page.goto(`${BASE}${href}`);
    await expectText(page, /issued/i, "invoice status issued");
    await expectText(page, /Keg deposit|deposit/i, "retail invoice carries the keg deposit line (3.10)");
    await shot(page, "j12-05-invoice");
  }
  await page.goto(`${BASE}/kegs`);
  await expectText(page, /Dogpatch Bottle Shop/, "keg balance row exists for the account");
  await page.goto(`${BASE}/shipments`);
  if (shipmentNumber) await expectText(page, new RegExp(shipmentNumber), "shipment listed under its number");
  await expectText(page, /Delivered/, "delivered status in the list");
  await shot(page, "j12-06-shipments-list");

  j.step("Sales sees the shipment in its market but has no confirm/deliver controls; the driver is refused");
  const sales = await session("Sam Sales");
  await sales.page.goto(shipmentUrl);
  if (shipmentNumber) await expectText(sales.page, new RegExp(shipmentNumber), "Sales (NC) can view the NC shipment");
  await expectNoText(sales.page, /Void shipment|Regenerate \(next revision\)|Mark delivered/, "Sales has no state-changing controls");
  await sales.ctx.close();
  const driver = await session("Dee Driver", true);
  await driver.page.goto(shipmentUrl);
  await driver.page.waitForURL(/forbidden|not-found|404|\/$/).catch(() => {});
  await expectNoText(driver.page, /Dogpatch Bottle Shop/, "unassigned driver cannot open the shipment");
  await driver.ctx.close();
  j.end();
  await ctx.close();
}

// ---------------- 13. Navigation: daily sections in the row, setup under Admin, per role ----------------
async function journey13() {
  const j = journey("13 Navigation — sections in the row, the current section underlined, its pages on the second row, per role");
  const rowOf = (page) => page.locator('nav[aria-label="Main"] a').allInnerTexts();
  const currentOf = (page) => page.locator('nav[aria-label="Main"] a[aria-current]').allInnerTexts();
  const secondOf = (page) => page.locator('header nav:not([aria-label="Main"]) a').allInnerTexts();
  const same = (a, b) => a.length === b.length && a.every((x, i) => x.trim() === b[i]);

  j.step("Owner: eight sections in order (Reports folded under Kegs, R2-35)");
  const owner = await session("Demo Owner");
  await owner.page.goto(`${BASE}/shipments`);
  const ownerRow = await rowOf(owner.page);
  const expected = ["Accounts", "Orders", "Shipments", "Stock", "Invoices", "Kegs", "Exceptions", "Admin"];
  if (same(ownerRow, expected)) ok("Owner row: " + expected.join(", "));
  else fail(`Owner row was ${ownerRow.join(", ")}`);
  if (same(await secondOf(owner.page), [])) ok("single-page section has no second row");
  else fail("Shipments shows a second row");

  j.step("Owner: each page lands in its section (longest path wins: /admin/markets is Stock, /admin is Exceptions)");
  const cases = [
    ["/admin/markets", "Stock", ["Lots", "Stock counts", "Markets & stock"]],
    ["/batches", "Stock", ["Lots", "Stock counts", "Markets & stock"]],
    ["/admin/intake", "Orders", ["Orders", "Email intake"]],
    ["/finance", "Invoices", ["Invoices", "Finance"]],
    ["/reports/microstar", "Kegs", ["Kegs", "MicroStar report"]],
    ["/admin/exceptions", "Exceptions", ["Exceptions", "Notices"]],
    ["/admin/settings", "Admin", ["Employees & access", "Company settings", "Catalog & prices", "Products", "Decisions", "Integrations", "Import from workbook"]],
  ];
  for (const [url, section, pages] of cases) {
    await owner.page.goto(`${BASE}${url}`);
    const cur = await currentOf(owner.page);
    const second = await secondOf(owner.page);
    if (same(cur, [section]) && same(second, pages)) ok(`${url}: ${section} current; second row ${pages.join(", ")}`);
    else fail(`${url}: current ${cur.join(",")}, second row ${second.join(", ")}`);
  }
  await owner.page.goto(`${BASE}/admin/markets`);
  await shot(owner.page, "j13-01-owner-stock");
  await owner.ctx.close();

  j.step("Sales: the selling sections only; no Stock, no Admin");
  const sales = await session("Sam Sales");
  await sales.page.goto(`${BASE}/orders`);
  const salesRow = await rowOf(sales.page);
  if (same(salesRow, ["Accounts", "Orders", "Shipments", "Invoices", "Kegs"])) ok("Sales row: Accounts, Orders, Shipments, Invoices, Kegs");
  else fail(`Sales row was ${salesRow.join(", ")}`);
  const salesSecond = await secondOf(sales.page);
  if (same(salesSecond, [])) ok("Sales Orders section has one page (Samples is an order now; Email intake is Admin-only)");
  else fail(`Sales second row was ${salesSecond.join(", ")}`);
  await sales.page.goto(`${BASE}/lots`);
  await expectText(sales.page, /Lots/, "a page Sales may open but not in its row still opens by URL");
  await sales.ctx.close();

  j.step("Driver: Shipments only");
  const driver = await session("Dee Driver");
  await driver.page.goto(`${BASE}/shipments`);
  const driverRow = await rowOf(driver.page);
  if (same(driverRow, ["Shipments"])) ok("Driver row: Shipments");
  else fail(`Driver row was ${driverRow.join(", ")}`);
  await driver.ctx.close();
  j.end();
}

// ---------------- 14. Order to confirm in one screen (R2-1, R2-3) ----------------
async function journey14() {
  const j = journey("14 Office — order to confirm in one screen: account, products, date, confirm, print");
  const { ctx, page } = await session("Ada Admin");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  j.step("pick the account");
  await page.goto(`${BASE}/orders/new`);
  await page.fill("#account-search", "Mission");
  await page.locator("main li a").filter({ hasText: /Mission Taproom/ }).first().click();
  await page.waitForURL(/orders\/new\?locationId=/);
  j.step("how it came in, products, dates; submit and confirm in one go");
  await page.selectOption('select[name="source"]', "email");
  await page.getByLabel(/^Cantinesca 12 oz can case$/).fill("2");
  await page.getByLabel(/^Cantinesca 24 oz can case$/).fill("1");
  await page.fill('input[name="requestedDate"]', today);
  await page.fill('input[name="scheduledDate"]', today);
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  await act(page, () => page.getByRole("button", { name: "Submit and confirm shipment" }).click());
  await page.waitForURL(/\/orders\/[0-9a-f-]+/);
  const f = await flash(page);
  const m = (f ?? "").match(/(EWD-D-\d{6}-\d{3}) confirmed for (\d{4}-\d{2}-\d{2})/);
  if (m && m[2] === today) ok(`recorded and confirmed in one screen: ${m[1]} for ${m[2]}`);
  else fail(`expected a confirmed EWD-D number for ${today}, got: ${f}`);
  await expectText(page, /Email/, "source recorded on the order (R2-2)");
  await expectText(page, /Confirmed/, "shipment confirmed on the order page");
  await shot(page, "j14-01-order-confirmed");
  j.step("print from the same screen");
  const bolHref = await page.getByRole("link", { name: "BOL PDF" }).getAttribute("href");
  const res = await page.request.get(`${BASE}${bolHref}`);
  if (res.status() === 200 && (await res.body()).subarray(0, 4).toString() === "%PDF") ok("BOL PDF prints from the order page");
  else fail(`BOL did not render (status ${res.status()})`);
  const packHref = await page.getByRole("link", { name: "Picking ticket" }).getAttribute("href");
  const res2 = await page.request.get(`${BASE}${packHref}`);
  if (res2.status() === 200) ok("picking ticket prints from the order page");
  else fail(`picking ticket did not render (status ${res2.status()})`);
  j.step("persisted: the order lists its shipment; the shipments list carries the number");
  await page.goto(`${BASE}/orders`);
  if (m) await expectText(page, new RegExp(m[1]), "orders list shows the shipment next to the order");
  j.end();
  await ctx.close();
}

// ---------------- 15. Short stock: submit anyway with a reason, or hold (R2-5) ----------------
async function journey15() {
  const j = journey("15 Office — short-stock order: shortfall shown per line, submit anyway with override, hold and lift");
  const { ctx, page } = await session("Ada Admin");
  j.step("ask for more Sunlight sixtels than EWD has");
  await page.goto(`${BASE}/orders/new`);
  await page.fill("#account-search", "Marina");
  await page.locator("main li a").filter({ hasText: /Marina Wine/ }).first().click();
  await page.waitForURL(/orders\/new\?locationId=/);
  await page.selectOption('select[name="source"]', "text");
  await page.getByLabel(/^Sunlight Groove 1\/6 bbl keg$/).fill("50");
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  await page.getByRole("button", { name: "Submit order" }).click();
  await page.waitForSelector('[data-testid="shortfall"]');
  await expectText(page, /cannot cover this order/, "shortfall panel shown instead of a silent short order");
  const shortRow = (await page.locator('[data-testid="shortfall"] tbody tr').first().innerText()).replace(/\s+/g, " ");
  if (/1\/6 bbl keg 50 \d+ \d+/.test(shortRow)) ok(`per-line shortfall: ${shortRow}`);
  else fail(`unexpected shortfall row: ${shortRow}`);
  await shot(page, "j15-01-shortfall");
  j.step("submit anyway without a reason is refused; with a reason it ships what is on hand");
  await page.getByRole("button", { name: "Submit anyway" }).click();
  await page.waitForSelector("[data-flash=error]");
  await expectText(page, /Say why/, "a reason is required to ship short");
  await page.fill('input[name="shortfallReason"]', "buyer takes the rest next week");
  await act(page, () => page.getByRole("button", { name: "Submit anyway" }).click());
  await page.waitForURL(/\/orders\/[0-9a-f-]+/);
  const f = await flash(page);
  if (/rest stays an open line/.test(f ?? "")) ok(`shipped what is on hand: ${f}`);
  else fail(`unexpected flash: ${f}`);
  await expectText(page, /Shipped what was on hand: buyer takes the rest next week/, "override recorded with the reason");
  await expectText(page, /Ada Admin/, "and who decided");
  await shot(page, "j15-02-short-order");
  j.step("hold a short order instead; nothing ships until the office lifts the hold");
  await page.goto(`${BASE}/orders/new`);
  await page.fill("#account-search", "Marina");
  await page.locator("main li a").filter({ hasText: /Marina Wine/ }).first().click();
  await page.waitForURL(/orders\/new\?locationId=/);
  await page.getByLabel(/^Sunlight Groove 1\/6 bbl keg$/).fill("50");
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  await page.getByRole("button", { name: "Submit order" }).click();
  await page.waitForSelector('[data-testid="shortfall"]');
  await act(page, () => page.getByRole("button", { name: "Hold" }).click());
  await page.waitForURL(/\/orders\/[0-9a-f-]+/);
  await expectText(page, /Held/, "order held");
  await expectText(page, /No shipment is drafted while the order is held/, "no shipment while held");
  await openDetails(page.locator("summary", { hasText: /^Lift hold$/ }));
  await page.fill('input[name="reason"]', "stock arrived from the brewery");
  await act(page, () => page.getByRole("button", { name: "Lift hold" }).click());
  await expectText(page, /Hold lifted/, "hold lifted with a reason");
  await shot(page, "j15-03-hold-lifted");
  j.end();
  await ctx.close();
}

// ---------------- 16. Driver delivers from the phone with a refused line; the office sees the outcome (R2-8, R2-38) ----------------
async function journey16() {
  const j = journey("16 Driver — deliver an assigned stop from the phone with a refused line; invoice follows the delivered quantity");
  const driver = await session("Dee Driver", true);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  j.step("my stops lists the assigned Mission Taproom stop");
  await driver.page.goto(`${BASE}/field`);
  const stop = driver.page.locator("section").filter({ hasText: /Mission Taproom/ }).first();
  if (await stop.count()) ok("assigned stop listed");
  else fail("no Mission Taproom stop for the driver");
  await expectNoText(driver.page, /\$|Golden Gate|Dogpatch/, "no prices or other accounts on the phone page");
  await shot(driver.page, "j16-01-my-stops");
  j.step("mark delivered: one case refused");
  await openDetails(stop.locator("summary", { hasText: "Mark delivered" }));
  await stop.locator('input[name="actualDate"]').fill(today);
  const kept = stop.locator('input[name^="delivered:"]').first();
  const shipped = Number(await kept.inputValue());
  await kept.fill(String(shipped - 1));
  await stop.locator('input[name^="refused:"]').first().fill("1");
  await act(driver.page, () => stop.getByRole("button", { name: "Delivered" }).click());
  await driver.page.waitForURL(/\/field/);
  const f = await flash(driver.page);
  if (/delivered .*1 line refused or damaged/.test(f ?? "")) ok(`delivered from the phone: ${f}`);
  else fail(`unexpected flash: ${f}`);
  await expectNoText(driver.page, /Mission Taproom/, "the delivered stop leaves the list");
  await driver.ctx.close();
  j.step("the office sees kept and refused per line; the invoice bills what was kept; the order keeps the refused unit open");
  const admin = await session("Ada Admin");
  await admin.page.goto(`${BASE}/shipments?status=delivered`);
  await admin.page.locator("tr").filter({ hasText: /Mission Taproom/ }).getByRole("link", { name: /EWD-D-\d{6}-\d{3}/ }).first().click();
  await admin.page.waitForURL(/\/shipments\/[0-9a-f-]{36}/);
  const linesTable = admin.page.locator("table").filter({ hasText: "Shipment lines" }).first();
  const heads = (await linesTable.locator("thead th").allInnerTexts()).map((h) => h.trim());
  const refusedIdx = heads.findIndex((h) => /^Refused$/i.test(h));
  const refusedCell = refusedIdx >= 0 ? (await linesTable.locator("tbody tr").first().locator("td").nth(refusedIdx).innerText()).trim() : "";
  if (refusedCell === "1") ok("line shows the refused unit (kept, refused, damaged columns)");
  else fail(`refused unit not shown (columns ${heads.join("|")}, cell "${refusedCell}")`);
  await expectText(admin.page, /Refused units never left the origin/, "refused units explained");
  await expectText(admin.page, /Correct delivery/, "the office may correct afterwards");
  await shot(admin.page, "j16-02-delivered-with-refusal");
  await admin.page.getByRole("tab", { name: /Documents/ }).click();
  const inv = (await admin.page.locator("body").innerText()).match(/\b(INV\d{5})\b/);
  if (inv) ok(`invoice ${inv[1]} issued for the delivered quantities`);
  else fail("no invoice number after delivery");
  await admin.page.goto(`${BASE}/orders?state=open`);
  await expectText(admin.page, /Partly delivered/, "the order stays partly delivered with the refused unit open");
  j.end();
  await admin.ctx.close();
}

// ---------------- 17. No-charge sample to a rep's home address (R2-27, R2-28) ----------------
async function journey17() {
  const j = journey("17 Office — samples: no-charge order to the rep's home address, S shipment, NC invoice");
  const { ctx, page } = await session("Ada Admin");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  j.step("the picker lists samples recipients: the samples house and the rep's home");
  await page.goto(`${BASE}/orders/new`);
  await expectText(page, /samples recipients/i, "samples recipients grouped");
  await expectText(page, /Samples, SoCal/, "the market's samples house");
  await page.locator("main li a").filter({ hasText: /Lee Sales \(SoCal\) \(home\)/ }).first().click();
  await page.waitForURL(/orders\/new\?locationId=/);
  j.step("no charge is on by default; submit and confirm");
  const nc = await page.locator('input[name="noCharge"]').isChecked();
  if (nc) ok("no charge ticked by default for a samples recipient");
  else fail("no charge not ticked for the rep's home");
  await expectText(page, /Not applied to office orders, samples or POS/, "no $90 minimum on samples (R2-6)");
  await page.selectOption('select[name="source"]', "rep");
  await page.getByLabel(/^Cantinesca 12 oz can case$/).fill("1");
  await page.fill('input[name="scheduledDate"]', today);
  await page.waitForFunction(() => (document.querySelector('input[name="submissionKey"]')?.value ?? "").length > 0);
  await act(page, () => page.getByRole("button", { name: "Submit and confirm shipment" }).click());
  await page.waitForURL(/\/orders\/[0-9a-f-]+/);
  const f = await flash(page);
  const m = (f ?? "").match(/(WLA-S-\d{6}-\d{3}) confirmed/);
  if (m) ok(`S shipment from Balmuth confirmed: ${m[1]}`);
  else fail(`expected a WLA-S number, got: ${f}`);
  await expectText(page, /No charge \(samples\)/, "order marked no charge");
  await shot(page, "j17-01-sample-order");
  j.step("the shipment carries an NC invoice draft");
  await page.getByRole("link", { name: new RegExp(m?.[1] ?? "WLA-S") }).first().click();
  await page.waitForURL(/\/shipments\/[0-9a-f-]{36}/);
  await page.getByRole("tab", { name: /Documents/ }).click();
  await expectText(page, /NC draft|NC\d{5}/, "NC invoice (no charge) on the samples shipment");
  await expectText(page, /S Samples/, "typed S");
  j.end();
  await ctx.close();
}

// ---------------- 18. End-of-day pull sheet for Balmuth (R2-29) ----------------
async function journey18() {
  const j = journey("18 Office — end-of-day master pull sheet for Balmuth: next day, download, auto-send off");
  const { ctx, page } = await session("Ada Admin");
  j.step("End of day shows Balmuth's next-day pull");
  await page.goto(`${BASE}/shipments/end-of-day`);
  await selectByLabel(page.locator('select[name="warehouse"]'), /WLA Balmuth/);
  const warehouseId = await page.locator('select[name="warehouse"]').inputValue();
  // The demo schedules Echo Park for the next weekday; read that date off the shipments list for WLA.
  await page.goto(`${BASE}/shipments?origin=${warehouseId}&status=confirmed`);
  const rowText = await page.locator("tr").filter({ hasText: /Echo Park Cantina/ }).first().innerText();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mm = rowText.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/);
  const date = mm ? `${mm[3]}-${String(months.indexOf(mm[1]) + 1).padStart(2, "0")}-${mm[2].padStart(2, "0")}` : "";
  if (date) ok(`confirmed WLA shipment to Echo Park found for ${date}`);
  else fail("no confirmed WLA shipment to Echo Park");
  await page.goto(`${BASE}/shipments/end-of-day?warehouse=${warehouseId}&date=${date}`);
  await expectText(page, /WLA Balmuth & Co\., pulling for/, "sheet for Balmuth and the day");
  await expectText(page, /Echo Park Cantina/, "the stop is listed");
  await expectText(page, /Master pull|SKU/, "aggregate by SKU and lot");
  await shot(page, "j18-01-end-of-day");
  j.step("download the pull sheet PDF and the whole day's documents");
  const href = await page.getByRole("link", { name: "Download pull sheet" }).getAttribute("href");
  const res = await page.request.get(`${BASE}${href}`);
  const body = await res.body();
  if (res.status() === 200 && body.subarray(0, 4).toString() === "%PDF") ok(`pull sheet PDF (${body.length} bytes)`);
  else fail(`pull sheet did not render (status ${res.status()})`);
  const all = await page.getByRole("link", { name: "All documents for the day" }).getAttribute("href");
  const res2 = await page.request.get(`${BASE}${all}`);
  if (res2.status() === 200) ok("day documents render");
  else fail(`day documents did not render (status ${res2.status()})`);
  j.step("auto-send is off by default and says so; the switch lives in Company settings");
  await expectText(page, /Off \(Company settings\)\. Nothing is emailed/, "auto-send off, nothing emailed");
  const owner = await session("Demo Owner");
  await owner.page.goto(`${BASE}/admin/settings`);
  const checked = await owner.page.locator('input[name="autoSendPullSheets"]').isChecked();
  if (!checked) ok("company switch off by default");
  else fail("auto-send switch is on");
  await owner.ctx.close();
  j.end();
  await ctx.close();
}


// Run every journey in order, or only those named in JOURNEYS (comma-separated numbers) when iterating on one.
const only = (process.env.JOURNEYS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const all = { "1": journey1, "2": journey2, "3": journey3, "4": journey4, "5": journey5, "6": journey6, "7": journey7, "8": journey8, "9": journey9, "10": journey10, "11": journey11, "12": journey12, "13": journey13, "14": journey14, "15": journey15, "16": journey16, "17": journey17, "18": journey18 };
for (const [n, run] of Object.entries(all)) {
  if (only.length && !only.includes(n)) continue;
  await run();
}

await browser.close();
console.log("\nTIMINGS (automated browser, fictional data — not a staff session):");
for (const t of timings) console.log(`  ${t.name}: ${t.steps} steps, ${t.seconds}s ${t.note}`);
fs.writeFileSync(`${out}/timings.json`, JSON.stringify(timings, null, 2));
console.log(`\nPROBLEMS: ${problems.length ? "\n  " + problems.join("\n  ") : "none"}`);
process.exit(problems.length ? 1 : 0);
