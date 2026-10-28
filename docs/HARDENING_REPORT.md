# Hardening report — Phase 1 hardening, operating workflows, product refinement

Revision under report: branch **`hardening/phase1`**, built on baseline commit **`884684c`** ("Phase 1
baseline: fv-ops with zero-setup demo mode, 36 tests"). The reviewed archive was that baseline minus the
demo-mode addition (32 tests): every reviewed finding was reconciled against the actual current code before
anything was changed. Commands and results below were run in this workspace on Node 22.22 / npm 10.9 with a
local PostgreSQL 16 for the real-database suites. Dates are 2026-09-17.

## 1. Outcome — what now works, in plain language

* **Sales** creates an account with the minimum, gets a warning (not a block) on a similar name, and places
  or repeats an order in a few taps: same-name accounts are told apart by address in the picker, typed values
  survive an error, the totals preview live, a double click makes one order, and a repeat shows exactly which
  lines changed price or are no longer sold. The order page says in one line what happened ("recorded · some
  units are waiting for stock") and what the account still needs before delivery.
* **Admin** works from one queue: every open case says what happened, who owns it, what to do next, and links
  to the record. Receiving stock refills the oldest waiting order and closes only the shortage that receipt
  fixed. Damage can only remove sellable stock; a short count is recorded as counted and produces one
  discrepancy naming the affected orders. Stale pages cannot amend cancelled orders or resurrect archived
  products. Offboarding retires an identity and frees the email for a new person with only the grants chosen.
* **Accounting** assigns payer authority deliberately (shared AP is never a payer by default), requests setup,
  and completes the manual notice process inside the app — with evidence — instead of a queue that could not
  be finished. Stripe work that cannot run yet *waits* and resumes on its own after a verified connection.
* **Owner** records a decision with typed fields, per-market scope and an effective date, sees the policy
  actually in force per market, and can withdraw one selection without disturbing another market.
  Nothing an Admin can do reaches Owner-only production decisions.
* Permissions hold under direct URLs and mixed roles; drivers see products and an honest empty state, never
  accounts, orders or prices. Dates read in each market's timezone; technical errors show a reference, not
  internals. The local demo, the CI job and the upgrade path all run without any credential.

## 2. Change summary (business behaviour changed, and why)

| Area | Before (baseline `884684c`) | Now | Key source |
|---|---|---|---|
| Authority | Admin could grant itself Owner; provisioning inserted any grant | grant authority enforced in the service per grant; Owner grants Owner-only; no self-edits; market-scoped Admin stays in its markets | `employees/service.ts` `assertGrantAuthority` |
| Environment | `FV_ENV=development` + `DEV_AUTH_BYPASS` re-enabled fixture login under a production build; unknown `FV_ENV` fell back; seed forced `FV_ENV` | deployment refuses fixture/demo unconditionally; unknown env is a configuration error; fixture sessions re-validated; seed checks before any write | `env.ts`, `auth/session.ts`, `demo/seed.ts` |
| Stock | samples checked on-hand not availability; concurrent sample returns double-restored; damage could add stock; released stock skipped waiting demand | one allocation model with deficit, claimed sample transitions, fixed movement semantics, release→refill→reserve under one lock | `allocation/service.ts`, `samples/service.ts` |
| Orders | cancelled orders could gain reservations via stale amendments; intake could become two orders | state locked/validated inside every mutation; intake→order atomic and unique; submission key + payload hash | `orders/service.ts`, `intake/service.ts` |
| Policy | a market override wiped other markets; JSON input barely validated; `not_applicable` bypassed D02 | immutable selections with precedence; typed schema validation; D02-derived applicability; per-market matrix | `policy/*`, `customers/service.ts` |
| Payer | AP contact became payer implicitly | explicit payer assignment with history and shared-payer note, required by every setup path | `payment/service.ts`, `stripe/adapter.ts` |
| Providers | a dummy key made a boundary-only provider "connected"; references ignored mode/account; disconnected jobs marked done | five separate facts; account/mode-bound references; waiting jobs that resume once; claim fencing | `integrations/registry.ts`, `stripe/adapter.ts`, `jobs/queue.ts` |
| Standing | archived lines silently dropped; partial policy accepted | partial generation reported with skipped lines and an owned case; executable-policy validation | `standing/service.ts`, `policy/schema.ts` |
| Identity | disable did not free an email; multi-write identity changes | offboarding retires identity/subject and revokes grants transactionally; sessions on ended identities stop | `employees/service.ts` |
| Notices | intents inserted, no way to finish them; duplicate invitations | full manual workflow with outcomes/evidence/re-issue/dedupe/withdrawal | `notices/service.ts`, `admin/notices/*` |
| Product | see UX-01…12 in §4 | account workspace, work queue, fast orders, plain states, timeline, typed decisions, notices queue, navigation/mobile/a11y, dates/errors, honest demo | `src/app/*`, `src/components/*` |
| Schema | — | migration `0002_hardening` with preflight, CHECKs, partial uniques, new columns | `drizzle/0002_hardening.sql` |

Diff against the baseline: 96 files, +17,172 / −2,030 lines (including the 3,091-line baseline SQL fixture
and the 5,736-line migration snapshot).

## 3. Reconciliation — REV-01 … REV-18 against the current revision

Status legend: **present** = reproduced/confirmed in `884684c` exactly as the review described; nothing was
already fixed and nothing had changed in a way that made a finding not applicable.

| ID | Status in `884684c` | Current file / function | Evidence of the defect (baseline) | Work done | Regression test |
|---|---|---|---|---|---|
| REV-01 | present | `employees/service.ts` `grantRole`, `provisionEmployee` → `assertGrantAuthority` | `grantRole` authorized only `employee.manage`; `owner` accepted with global scope | authority per grant (role escalation + scope), no self-management, Owner grants Owner-only; UI hides nothing that the service does not also refuse | rev-authority › REV-01 / AC01 (2) |
| REV-02 | present | `env.ts` `isDeployment/fixtureMode/appEnv`, `auth/session.ts`, `api/auth/dev/route.ts`, `demo/seed.ts` `assertSeedAllowed`, `scripts/seed-dev.ts` | `appEnv()` let `FV_ENV` override `NODE_ENV`; unknown value → development; `seed:dev` script forced `FV_ENV=development`; seed migrated before its check | deployment classification wins; unknown env → `ConfigurationError`; fixture sessions checked per request; seed checks first and refuses live-like targets; `package.json` no longer forces the env | rev-environment › AC04 (6), AC05; demo-mode (4) |
| REV-03 | present | `allocation/service.ts` `availability`, `applySampleStock`, `surfaceDiscrepancy` | sample path compared against on-hand; available clamped at 0 | samples reserve from unreserved availability; `deficitQty` exposed; short counts recorded as-is with one owned discrepancy | rev-stock-orders › REV-03 / AC06; REV-05 / AC09 (discrepancy) |
| REV-04 | present | `samples/service.ts` `claimTransition` | state read before the transaction; update without predicate | conditional state claim inside the transaction before any stock change; loser gets `StaleStateError` | rev-stock-orders › REV-04; postgres/races › AC07, AC08 |
| REV-05 | present | `allocation/service.ts` `MOVEMENT_SEMANTICS`, `recordStockMovement`; `admin/actions.ts` `stockMovementAction` | signed delta accepted for every kind | direction fixed per kind; damage entered as a positive count; internal kinds refused; invalid input writes nothing | rev-stock-orders › REV-05 / AC09 (2); journey 4 |
| REV-06 | present | `policy/policy.ts` `recordSelection`, `pickEffective`, `withdrawSelection`, `policyMatrix` | overlapping scopes superseded the whole prior row | immutable rows; precedence resolution per market and time; single-row withdrawal | rev-policy-payer-standing › AC13 (2), AC14; journey 6 |
| REV-07 | present | `customers/service.ts` `licenseVerificationRequirement`, `recordLicenseDecision`, `reevaluateLicenseCases`; `readiness/service.ts` | `not_applicable` accepted without a D02 selection and reported as policy-backed | applicability derived from the effective market D02 selection; refusal otherwise; cases re-evaluated on policy change | rev-policy-payer-standing › REV-07 / AC16 |
| REV-08 | present | `payment/service.ts` `authorizedPayer`, `setPayerContact`, `requestPaymentSetup`; `stripe/adapter.ts` `createHostedSetupSession` | payer initialised from AP; setup requested without authority; hosted session did not check | explicit assignment with `payerAssignedAt/By`, shared-payer note, both paths require it; unrelated contacts refused | rev-policy-payer-standing › REV-08 / AC17; journey 5 |
| REV-09 | present | `allocation/service.ts` `releaseLineReservations`, `adjustLineReservation`, `fillUnmetDemand` | release did not refill; new submission took freed stock | release/refill/reserve one operation under the position lock; reductions refill; D14 untouched | rev-stock-orders › REV-09 (2); postgres/races › AC10 |
| REV-10 | present | `orders/service.ts` `adminAmendQuantity`, `cancelUndeliveredDemand`, `requestOrderChange` | amendment never checked order state; archived SKU increase unchecked | order locked `FOR UPDATE`; every transition validated; archived/closed/cancelled refused with the current state | rev-stock-orders › REV-10; postgres/races › AC11; journey 3 |
| REV-11 | present | `authz/actions.ts`; `customers/service.ts` `setWarehouseOverride`, `listLocations`; `orders/service.ts` `listOrders`; `search/service.ts`; `timeline/service.ts`; pages | override authorized only for the customer market; drivers held `location.view`/`order.view`; audit widgets unscoped | both markets authorized; driver removed from those actions; list/search/timeline scoped by role and market; audit detail only with `audit.view` in the record's market | rev-authority › AC02, AC03, AC34; at61-at62 › Five roles; journey 8 |
| REV-12 | present | `integrations/registry.ts` `providerStatuses`, `recordConnectionCheck` | key presence promoted to `connected_test_mode` even for boundary-only | five facts kept apart; boundary-only never connected; failed/stale respected via credential fingerprint | rev-provider-queue-notices › REV-12 / AC19 |
| REV-13 | present | `stripe/adapter.ts` `customerReference`, `verifiedStripeAccount`, `checkStripeConnection`; schema `provider_reference` | lookup by provider/location/object only; uniqueness ignored environment/account | references and uniqueness bound to (provider, environment, account); mismatch fails closed; migration marks pre-existing established rows `stale` until re-verified | rev-provider-queue-notices › REV-13 / AC20; postgres/upgrade (stale marking) |
| REV-14 | present | `jobs/queue.ts` (`waiting`, `resumeWaitingJobs`), `stripe/adapter.ts` handler | handler returned normally → job `done` while nothing happened | `ProviderUnavailableError` → `waiting` with reason; successful check resumes once; no endless retries | rev-provider-queue-notices › REV-14 / AC21 |
| REV-15 | present | `intake/service.ts` `convertIntakeToOrder`, `markIntakeIncomplete`, `rejectIntake` | converted intake could regress and convert again; two commits | one transaction; `order_intake_request_uq`; regress refused; explicit reject | rev-provider-queue-notices › REV-15 / AC23; postgres/races › AC23 |
| REV-16 | present | `standing/service.ts` `d13Executable`, generation; `policy/schema.ts` | archived line dropped silently; `generate_when_held` omission acted as permission; JSON only checked to be an object | `generated_partial` with skipped lines + owned case; typed validation; held/incomplete owned, not defaulted | rev-policy-payer-standing › REV-16 / AC24, AC15 |
| REV-17 | present | `employees/service.ts` `offboardEmployee`, `recordEmailRename`, `resolveGoogleSignIn`, `loadActorForSession` | disabled employee kept the current identity; error message promised a path that did not exist; multi-write transitions | explicit offboarding (identity retired with reason, grants revoked, email freed); transactional rename/binding; sessions on ended identities refused | rev-authority › REV-17 / AC18 (3); at61-at62 (2); journey 7 |
| REV-18 | present | `notices/service.ts`; `admin/notices/*`; `components/notice-actions.tsx` | intents only; no subject link/content/outcome; duplicate invitations | complete manual workflow, dedupe of pending intents, failure/no-recipient cases, re-issue, withdrawal on cancellation | rev-provider-queue-notices › REV-18 / AC27 (2); journey 5 |

The review's 17 diagnostic reproductions (`Review_Reproductions.test.ts`) were not pasted in; each was
re-expressed as the required correct outcome in the `rev-*` files above (the reproduced defect is asserted
*not* to happen, with the correct behaviour asserted instead). Existing tests that encoded superseded
behaviour were corrected and the reason is in the test: `at10-at13` hand-entered a `load` movement through
the generic stock form (now refused as an internal kind, so the test records the loaded physical fact
directly and asserts the refusal); `at01-at04` relied on the AP contact being the payer by inheritance (now
assigns payer authority explicitly, REV-08); `at05-at09` and `review-fixes` called `recordSelection` /
`withdrawProductionSelection` without an actor (now Owner-only with a reason, and the Admin attempt is
asserted to be refused); `review-fixes` matched the old transfer-refusal wording and the old duplicate-identity
message. No assertion was weakened; each was replaced by the required correct outcome.

## 4. Product completion — UX-01 … UX-12

| UX | Status | Screenshots (tests/ui journeys, fictional data) | Limits |
|---|---|---|---|
| UX-01 account workspace | implemented | `j1-02-account-workspace`, `j5-01-payer-and-invitation` | later-phase panels state "none yet" |
| UX-02 command center as work queue | implemented | `j4-01-command-center` | categories for phases 2–4 listed as not built |
| UX-03 fast, recoverable orders | implemented | `j1-03-order-detail`, `j2-01-repeat-preview`, `j2-02-orders-after-repeat`, `j9-02-mobile-account-picker` | requested date remains a request (never a promise) |
| UX-04 plain-language states | implemented | visible on every screenshot; `ux-presentation` tests | — |
| UX-05 activity timeline | implemented | bottom of `j1-02`, `j5-01` | audit detail only for roles with `audit.view` in that market |
| UX-06 automated confirmed follow-through | implemented | `j4-01` (shortage resolved by receipt; below-minimum untouched) | only for confirmed rules; unselected decisions never trigger effects |
| UX-07 decision register without JSON | implemented | `j6-01-decision-matrix`, `j6-02-decision-history` | free-text `notes`; decisions without executable support say so |
| UX-08 manual notices | implemented | `j5-01`, `j5-02-notices-queue` | no sender — recording "sent" is staff evidence |
| UX-09 navigation, search, mobile, a11y | implemented | `j8-01-driver-mobile`, `j9-01-mobile-menu` | driver home is an honest empty state until phase 2 |
| UX-10 dates and errors | implemented | `ux-presentation` tests | zone abbreviations for the US zones in use; others show the IANA name |
| UX-11 honest demo | implemented | banner on every screenshot | demo never connects a provider |
| UX-12 staff journeys | automated journeys implemented; **staff session not held** | `timings.json` | `STAFF_SESSION_SCRIPT.md` is the script for the real session |

Journey timings (automated browser, one run on a fresh demo): 1 — 7 steps 5.5 s · 2 — 3 steps 5.6 s ·
3 — 4 steps 9.0 s · 4 — 5 steps 7.2 s · 5 — 5 steps 5.0 s · 6 — 4 steps 4.1 s · 7 — 4 steps 5.0 s · 8 — 1 step
2.2 s · 9 — 4 steps 2.3 s. These measure machine time between assertions, not human friction.

## 5. Acceptance — AC01 … AC38: commands and results

Commands (all run on the delivered revision):

```
npm run check                                              # typecheck ✓ · lint ✓ (0 problems) · vitest 87 passed, 10 skipped (postgres suite without URL) · next build ✓
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres npm run test:pg   # 10 passed (races 8, upgrade 2)
npm run demo:reset && npm run demo   +   SHOTS_DIR=… npm run test:ui             # 9 journeys, 74 ✓ assertions, 0 ✗, PROBLEMS: none (two consecutive fresh runs)
```

| AC | Result | Where | Notes / why not fully "pass" |
|---|---|---|---|
| AC01 | pass | rev-authority | self-promotion, Owner provisioning, self-edit, Owner revoke by Admin all refused; legitimate management works |
| AC02 | pass | rev-authority, review-fixes | global grant / other-market grant / other-market warehouse refused; mixed-role audit view scoped |
| AC03 | pass + journey 8 | rev-authority | driver: no lists, search or timeline; direct order/account URLs refused in the browser |
| AC04 | pass | rev-environment | six flag combinations incl. the reproduced production-build override and stale fixture cookies |
| AC05 | pass | rev-environment, demo-mode | seed refuses before any write; demo first run / restart / reset exercised by the journeys |
| AC06 | pass | rev-stock-orders | full and partial reservation |
| AC07 | pass (PGlite + real Postgres) | rev-stock-orders, postgres/races | stock ends at 20; one effect |
| AC08 | pass (PGlite + real Postgres) | same | return vs correction; two corrections |
| AC09 | pass + journey 4 | rev-stock-orders | positive/negative/invalid per kind; no partial writes |
| AC10 | pass (PGlite + real Postgres) | rev-stock-orders, postgres/races | B filled before C on cancel and on reduction; concurrent submissions never over-reserve |
| AC11 | pass (PGlite + real Postgres) + journey 3 | rev-stock-orders, postgres/races | cancel / archive / closure / loaded; concurrent amend-vs-cancel |
| AC12 | pass (PGlite + real Postgres) + journey 2 | rev-stock-orders, postgres/races | replay, changed payload refused, new repeat order |
| AC13 | pass + journey 6 | rev-policy-payer-standing | global → NC override keeps MA; overlapping sets deterministic |
| AC14 | pass + journey 6 | same | out-of-order future selection; withdrawal; concurrent edits are independent inserts |
| AC15 | pass | same | empty/malformed/unknown-key refused; test selection ignored in production; unsupported parts named |
| AC16 | pass | same | unselected D02, wrong-market D02, withdrawn exemption |
| AC17 | pass + journey 5 | same | shared AP for two locations, unrelated contact, revoked authority, hosted session path |
| AC18 | pass + journey 7 (fixture identities) | rev-authority, at61-at62 | **not run with real Google accounts** (no OAuth client) — see §9 |
| AC19 | pass | rev-provider-queue-notices | dummy boundary key, untested, failed, stale (fingerprint change) |
| AC20 | pass | same | live key sees no test reference; different account never reuses; same-account rotation keeps |
| AC21 | pass | same | waiting → resumed once after a verified check; no duplicate notice |
| AC22 | pass (PGlite + real Postgres) | same, postgres/races, review-fixes | late old worker ignored; bounded attempts; terminal case |
| AC23 | pass (PGlite + real Postgres) | same, postgres/races | stale incomplete, second conversion, other location |
| AC24 | pass | rev-policy-payer-standing, at05-at09 | archived+active, incomplete policy, held, failure |
| AC25 | pass | rev-stock-orders | override vs reassign; insufficient stock (FCFS at destination); loaded work owned |
| AC26 | pass | rev-stock-orders, at10-at13 | departure needs unreserved units; receipt once; cancel after load → custody case |
| AC27 | pass + journey 5 | rev-provider-queue-notices | pending/sent/failed/unknown, no recipient, duplicate request, re-issue, withdrawal |
| AC28 | pass (PGlite + real Postgres) | rev-policy-payer-standing, postgres/races | one decision; replay refused; recipients untouched |
| AC29 | pass | rev-provider-queue-notices | one of two holds cleared keeps the other; dedupe; links |
| AC30 | pass + journey 4 | same | repeated follow-through idempotent; receipt resolves only its shortage |
| AC31 | pass | ux-presentation | explicit mapping; glyph per tone; unknown → neutral raw label |
| AC32 | journey 8, 9 | tests/ui | mobile bar + menu, keyboard focus, sign-out; no automated screen-reader audit was run |
| AC33 | journey 1, 2 | tests/ui | same-name, archived product, changed price, validation error, double click |
| AC34 | pass + journeys 8, 9 | rev-authority | 40 accounts paged, scoped search, timeline cursor walk |
| AC35 | pass | ux-presentation | CA/MA around midnight; 8 March 2026 DST change; date-only facts |
| AC36 | pass | ux-presentation | masked message with reference; raw detail only in the server log |
| AC37 | pass (real Postgres) + manual run | postgres/upgrade; `db:preflight` + `db:migrate` on the loaded baseline | see §7 |
| AC38 | pass + journey 7 | rev-authority | disabled mid-session → next request refused without re-login |

No AC failed. Items marked *journey* have browser evidence only (no separate unit test adds information).
Items that need a company credential or account are listed in §9 as not run.

Build and environment notes: the project's intended build is the default `next build` (Turbopack); it
completed in this environment with no port-binding restriction, so no bundler change was made. Runtime
versions verified: Node 22.22.2, npm 10.9.7, Next.js 16.3.5, React 19.2.8, Drizzle 0.45.2, PGlite 0.5.8,
Playwright 1.56.0 (pinned in `package.json`; Chromium from `npx playwright install chromium`), PostgreSQL 16
for the real-database suites. Dependency audit: 0 production vulnerabilities; 4 moderate dev-only advisories
in the `drizzle-kit` → `esbuild` dev-server chain, not applicable to the deployed app and not force-fixed
(details in `DEPLOYMENT.md` §11).

## 6. Original baseline coverage (AT scenarios)

Full: AT01–AT04, AT06–AT08, AT10–AT12 (with the hardening additions). Partial, deliberately not overstated
(details in `IMPLEMENTATION_STATUS.md` §5): AT09 (standing edge cases proven; no real cadence over time),
AT13 (reassignment/transfer of uncommitted work; route commitment is phase 2), AT61/AT62 (fixture identities
and browser journey; not real Google accounts), AT74 (request/approve/replay; invoice notices are phase 3),
AT79/AT80 (authority and visibility proven as exclusion; the driver's assigned-execution view is phase 2).
AT14–AT60, AT63–AT73, AT75–AT78, AT81–AT84: phases 2–4/6, not built.

## 7. Data changes

**Migration `drizzle/0002_hardening.sql`** (forward-only; recorded by drizzle):
* preflight `DO $$ … $$` block raising `fv-ops migration 0002_hardening preflight: <check>` for duplicate
  current identities / subjects, duplicate current license or payment rows, an intake converted twice,
  negative stock/reservation/sample quantities, inconsistent order-line quantities — the transaction rolls
  back and nothing changes;
* `job.status` enum → text + CHECK (`waiting` added); `DROP TYPE job_status`;
* new nullable columns (no data rewrite): decision withdrawal, identity retirement, job claim/waiting, notice
  workflow fields, provider account/fingerprint/last-success, provider reference account, payer assignment,
  submission payload hash, occurrence detail;
* `UPDATE provider_reference SET status='stale'` for established references that carry no account id (none
  existed in the baseline data: 0 rows affected; the rule is tested with an injected row);
* partial unique indexes on current rows and pending notices, active-job dedupe, provider-reference identity,
  one order per intake; CHECK constraints on quantities.

**Compatibility**: every column is nullable or defaulted; no business row is deleted or rewritten; the
previous revision's data reads unchanged. Rollback is by snapshot (the enum drop is not reversed by SQL).

**Evidence** (this workspace, PostgreSQL 16 on 127.0.0.1:5433):
* fresh database: `createPgTestDb` migrates 0000→0002 for every real-Postgres test (10/10 green);
* populated prior revision: `tests/support/fixtures/baseline-884684c.sql` (demo data + activity from
  `884684c`) loaded into `preflight_baseline`; `npm run db:preflight` → 9 checks, all *none*, "Preflight
  clean"; `npm run db:migrate` → "Migrations applied." (journal ids 1–3); five CHECK constraints present;
  7 orders retained; second `db:migrate` → no-op; `db:preflight` still clean; `tests/postgres/upgrade.test.ts`
  additionally checks constraints/indexes, the stale-marking of a legacy established provider reference, that
  legacy payer-by-inheritance rows are kept but no longer count as authority, and that the seeded Sales rep
  can place an order through the current services on the upgraded data;
* pre-existing invalid data: the same baseline with an injected second current identity for one employee →
  migration refused with the preflight diagnostic, no schema or data change (`upgrade.test.ts` case 2).

**Pre-existing invalid data found**: none in the baseline fixture or the demo data.

## 8. Remaining decisions (Owner / accountant only)

Everything below is already handled safely; the application never chooses.

| Decision | Behaviour affected | Safe current handling |
|---|---|---|
| D02 license applicability by market/location class | whether `not_applicable` can ever be recorded | required everywhere; recording refused |
| D11 minimum-value basis | minimum verdict; combined-visit and credit cases | verdict `depends_on_unselected_D11`; below-minimum flagged, never rejected; combined-visit/credit parts stay unsupported even after a selection |
| D12 price treatment for added units | Admin amendments after a price change | refused naming D12; Sales places a new order |
| D13 standing cadence / held / price treatment | standing generation | inert; incomplete selections owned |
| D14 restored priority after a displacement | re-queue behaviour | displaced line waits for an explicit re-queue |
| D32 / IG04 notice sender | who sends customer notices | manual process with recorded outcomes |
| D33 seller context per market | confirmation before finance | recorded, not enforced further (phase 3) |
| SD01–SD10, D01, D05, D06 (Stripe/finance) | payment readiness and collections | nothing built beyond customer association and hosted setup in test mode |

## 9. Commissioning limits — needs credentials or external evidence (not run)

| Check | Missing prerequisite | Next action |
|---|---|---|
| Real Google sign-in, rename, offboard/reuse, disable-while-signed-in (`ACCESS_*` gates; AC18 with real subjects) | Google OAuth client + Workspace test accounts | DEPLOYMENT §6 steps 1–4, then record the two gates on Integrations |
| Stripe connection check, customer association, hosted ACH setup, webhook replay (`STRIPE_*` gates; AC19–AC21 against the real account) | company Stripe **test** key + webhook secret | DEPLOYMENT §7 steps 1–5 |
| Neon backup/restore drill, branch-based upgrade of the production database | Neon project + preview deployment | DEPLOYMENT §4; run `db:preflight` on a branch first |
| Vercel cron execution visibility, claim recovery in the deployed runner | Vercel project | DEPLOYMENT §5; confirm one cron invocation and a manual *Run due jobs now* |
| CI run on GitHub | repository pushed to GitHub | `.github/workflows/ci.yml` is in place; first push runs it |
| Staff usability session | Sales/Admin/Accounting/Owner time | `STAFF_SESSION_SCRIPT.md` |
| OptimoRoute / Gmail / Google Address / Slack / QBO | phase 2–3 scope and credentials | boundary only by design; nothing to run |

## 10. Review instructions

```bash
npm install
npm run demo                 # http://fv-ops.localhost:3000 — demo Owner; "Switch user" for Admin/Accounting/Sales/Driver
npm run test:ui              # in a second shell: the nine journeys with screenshots (SHOTS_DIR=…)
npm run check                # typecheck, lint, 87 tests, build
TEST_DATABASE_URL=postgres://…/postgres npm run test:pg   # disposable Postgres 16: races + upgrade
```
Reproduce the important journeys by hand on the demo: journey 1 (Sales → New account → New order), 3
(order page: Request change / Admin: amend / Cancel remaining in another tab, then the stale form), 4
(Admin → Markets & stock → Record stock evidence), 5 (Accounting → account → Assign payer authority →
Request ACH setup → Notices), 6 (Owner → Decisions → D11), 7 (Owner → Employees & access → disable /
offboard / provision). `npm run demo:reset` restores the seed.

Revision identification: branch `hardening/phase1`, commits `9530ba7` (services + migration), `f7b8400`
(regression tests), `cc234f1` (UX), `9617d8d` (journeys, presentation tests, CI), `a6c3360` (documentation, AC34, upgrade test);
baseline `884684c`. The clean export (`fv-ops-hardening.zip`) contains source,
configuration example, migrations, lockfile, tests, CI workflow and docs — no `node_modules`, `.next`,
`.fv-demo`, `.env`, screenshots or git history.
