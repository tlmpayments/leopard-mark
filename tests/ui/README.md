# Role browser journeys (Playwright)

`tests/ui/journeys.mjs` runs the nine role-based journeys of the hardening brief (§6.3), plus a tenth for the
email + PIN sign-in, against a running local demo. Each journey asserts the **visible result** (flash messages, page text) and the **persisted
outcome** (re-read after a fresh page load), takes full-page screenshots of the changed views, and records
step counts and wall-clock time. This is automated validation with fictional data — it is not a staff
usability session (see `docs/STAFF_SESSION_SCRIPT.md` for that).

```bash
npm run demo                         # shell 1: zero-setup demo (embedded database, fictional data)
npm run test:ui                      # shell 2: journeys 1–11; exits 1 on any failed assertion, page error or 5xx
SHOTS_DIR=/tmp/shots npm run test:ui # choose where screenshots + timings.json land (default tests/ui/shots/, git-ignored)
```

`playwright` is a pinned devDependency; its Chromium is installed with `npx playwright install chromium`
(CI does this). Set `CHROMIUM_PATH` to use another Chromium binary. `BASE_URL` overrides `http://localhost:3000`.

The journeys build on one another (journey 1 creates the account that journeys 2, 3, 5 and 9 use), so run the
whole file. The seeded data is consumed by journey 4 (the shortage receipt) and journey 7 (offboarding), so a
second run needs `npm run demo:reset` first.

| # | Journey | Key assertions |
|---|---|---|
| 1 | Sales — new account (same-name warning), first order before license/setup | field error keeps typed values; warning-only duplicate name; readiness explained; order status line; order listed after reload |
| 2 | Sales — repeat after a price change and SKU archival | price-changed badge and "not carried over" notice; new order number; exactly one order after a double click |
| 3 | Sales/Admin — change request, amendment, stale action after cancellation | change request has no silent effect; D12 refusal on a repriced line; amendment applied on the order at current prices; stale amendment refused; no reservation on a cancelled order |
| 4 | Admin — receive stock, sample return, targeted resolution | receipt refills waiting demand oldest-first; only the fixed shortage case resolves; damage records a removal; second sample return refused |
| 5 | Accounting — payer separate from AP, setup intent, manual send | setup blocked until payer assigned; invitation intent pending for the manual sender; outcome recorded as staff evidence, not provider confirmation |
| 6 | Owner — typed decision selection, market override, withdrawal | matrix by market; NC-only future override leaves MA on the global basis; single withdrawal keeps the rest; history retained |
| 7 | Owner/Admin — disable mid-session, offboard, reuse the email | open session refused on next request; retired identity; new person with only the assigned grant |
| 8 | Driver/Service — honest empty state, no leak | accounts/orders/search refused; product search works; menu lists only permitted destinations |
| 9 | Mobile — Owner frequent tasks and every destination | bottom bar + More menu; skip link and visible focus; searchable account picker distinguishes same-name accounts; sign-out |
| 11 | Setup page | state card shows migrations/Owner; an action without the setup token is refused |
| 10 | Sign-in — email + PIN | wrong PIN refused generically with the email kept; correct PIN signs in with internal authority only; Admin-set temporary PIN → old PIN refused → forced *Choose your PIN* → weak PIN refused → normal use |

## Go-live path on a production build (`tests/ui/production-setup.mjs`)

Runs the exact first-run sequence of a fresh deployment against an **empty** real Postgres: `/setup` →
wrong token refused → migrations applied → first Owner provisioned with a temporary PIN → sign-in → forced
*Choose your PIN* → Owner home → Employees & access; then checks that the production build shows no demo
banner and no fixture sign-in. CI runs it on every push; locally:

```bash
createdb fv_golive && npm run build
DATABASE_URL=postgres://…/fv_golive FV_ENV=production SESSION_SECRET=<16+ chars> CRON_SECRET=<16+ chars> PORT=3100 npm run start
BASE_URL=http://localhost:3100 SETUP_TOKEN=<the CRON_SECRET> npm run test:ui:golive
```
