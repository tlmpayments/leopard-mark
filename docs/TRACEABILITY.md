# Traceability — hardening revision (branch `hardening/phase1`)

One row per finding / improvement / acceptance scenario, linking the hardening prompt's IDs (REV, UX, AC),
the master prompt's acceptance tests (AT) where one applies, the source that now carries the rule, the
migration that supports it, and the test that proves it. Test names are the `describe > it` titles in
`tests/` (run `npx vitest run --reporter=verbose`). Journeys are `tests/ui/journeys.mjs` (`npm run test:ui`).

Legend for the *Result* column: **pass** = automated test green in this revision; **journey** = asserted in a
browser journey against the fresh demo; **not run** = needs an external prerequisite named in
`docs/HARDENING_REPORT.md` §5.

## 1. Review findings (REV-01 … REV-18)

| REV | Rule now enforced | Source (current) | Migration | Tests | AC | AT |
|---|---|---|---|---|---|---|
| REV-01 | Owner grants are Owner-only; nobody edits their own grants; provisioning applies the same authority per grant; market-scoped Admin cannot grant globally or in another market | `src/lib/domain/employees/service.ts` `assertGrantAuthority`, `grantRole`, `revokeGrant`, `provisionEmployee` | — | rev-authority › REV-01 / AC01 (2 tests) | AC01, AC02 | AT79, AT80 |
| REV-02 | Deployment (`NODE_ENV=production`, `VERCEL*`) refuses fixture sign-in and demo whatever the flags; unknown `FV_ENV` is a `ConfigurationError`; fixture sessions re-checked per request; seed checks before any write and refuses live-like targets | `src/lib/env.ts` (`isDeployment`, `fixtureMode`, `appEnv`, `configurationProblems`), `src/lib/auth/session.ts`, `src/app/api/auth/dev/route.ts`, `src/lib/demo/seed.ts` `assertSeedAllowed`, `scripts/seed-dev.ts`, `package.json` (`seed:dev` no longer forces `FV_ENV`) | — | rev-environment › AC04 (6 tests), AC05; demo-mode (4) | AC04, AC05 | — |
| REV-03 | Samples reserve like orders (unreserved availability); deficit is a first-class figure; a physical count below reservations is kept as-is and opens one owned `allocation_discrepancy` case naming the affected orders | `src/lib/domain/allocation/service.ts` `availability` (`deficitQty`), `applySampleStock`, `surfaceDiscrepancy`, `discrepancyKey` | 0002 `stock_position_qty_chk` | rev-stock-orders › REV-03 / AC06; REV-05 / AC09 (discrepancy) | AC06 | AT11, AT12 |
| REV-04 | Sample transitions are claimed inside the transaction with a state predicate; the second actor gets a `StaleStateError` naming the current state | `src/lib/domain/samples/service.ts` `claimTransition`, `returnSample`, `correctSample` | — | rev-stock-orders › REV-04 / AC07 / AC08; **real Postgres** races › AC07, AC08 | AC07, AC08 | AT12 |
| REV-05 | Movement kinds carry fixed direction (`MOVEMENT_SEMANTICS`): damage/removal only subtract sellable stock; receipt/opening only add; adjustment is signed; internal kinds refused from the generic form; invalid input writes nothing | `src/lib/domain/allocation/service.ts` `recordStockMovement`; `src/app/admin/actions.ts` `stockMovementAction` (positive count of damaged units) | 0002 `stock_position_qty_chk` | rev-stock-orders › REV-05 / AC09 (2 tests) | AC09 | — |
| REV-06 | Selections are immutable rows; the effective one per market is resolved by precedence (market-specific > all-markets, later `effectiveFrom`, later `recordedAt`); withdrawal marks one row; nothing is superseded by overlap | `src/lib/policy/policy.ts` `pickEffective`, `getPolicy`, `recordSelection`, `withdrawSelection`, `policyMatrix` | — | rev-policy-payer-standing › REV-06 / AC13 (2), AC14, AC15 (2); review-fixes › Policy scope | AC13, AC14, AC15 | AT79 |
| REV-07 | `not_applicable` can only be recorded when the effective D02 selection for that market exempts the location class; a wrong-market or withdrawn selection re-evaluates the case | `src/lib/domain/customers/service.ts` `licenseVerificationRequirement`, `recordLicenseDecision`, `reevaluateLicenseCases`; `src/lib/domain/readiness/service.ts` | 0002 `license_verification_current_uq` | rev-policy-payer-standing › REV-07 / AC16 | AC16 | AT03 |
| REV-08 | Payer authority is an explicit assignment (`payerAssignedAt/By`, shared-payer note); `requestPaymentSetup` and hosted setup refuse without it; unrelated contacts refused | `src/lib/domain/payment/service.ts` `authorizedPayer`, `setPayerContact`, `clearPayerContact`, `requestPaymentSetup`; `src/lib/integrations/stripe/adapter.ts` `createHostedSetupSession` | 0002 `payment_relationship.payer_assigned_*`, `payment_relationship_current_uq` | rev-policy-payer-standing › REV-08 / AC17; journey 5 | AC17 | AT02, AT04 |
| REV-09 | Release/refill/reserve is one operation under the position lock: freed units go to older waiting demand (`fillUnmetDemand`) before any new reservation; quantity reductions refill too; D14 restored-priority stays unselected | `src/lib/domain/allocation/service.ts` `releaseLineReservations`, `adjustLineReservation`, `fillUnmetDemand`, `reserveForLine` | — | rev-stock-orders › REV-09 / AC10 (2); **real Postgres** races › AC10 | AC10 | AT10, AT11 |
| REV-10 | Order and line state are locked and validated inside every mutation (`WHERE state = …`); cancelled/fulfilled/closed/archived transitions refused with the current state | `src/lib/domain/orders/service.ts` `adminAmendQuantity`, `cancelUndeliveredDemand`, `requestOrderChange`, `flagAbnormal`; `src/lib/domain/intake/service.ts` | 0002 `order_line_qty_chk`, `reservation_qty_chk` | rev-stock-orders › REV-10 / AC11; **real Postgres** races › AC11; journey 3 | AC11 | AT08, AT10 |
| REV-11 | Warehouse override needs authority over both markets; drivers hold no `location.view`/`order.view`; lists, search and timeline filter by the actor's actual scope; audit detail shown only with `audit.view` in the record's market | `src/lib/authz/actions.ts`; `src/lib/domain/customers/service.ts` `setWarehouseOverride`, `listLocations`; `src/lib/domain/orders/service.ts` `listOrders`; `src/lib/domain/search/service.ts`; `src/lib/domain/timeline/service.ts` | — | rev-authority › REV-11 / AC02, AC03; at61-at62 › Five roles; journey 8 | AC02, AC03 | AT80 |
| REV-12 | Provider status is five separate facts (built / credentials / connection / capability / activation); a boundary-only provider can never be "connected"; a failed or fingerprint-stale check is shown as such | `src/lib/integrations/registry.ts` `providerStatuses`, `credentialFingerprint`, `recordConnectionCheck`, `recordActivation`; `src/app/integrations/page.tsx` | 0002 `provider_connection.account_id/credential_fingerprint/last_success_at` | rev-provider-queue-notices › REV-12 / AC19 | AC19 | — |
| REV-13 | Provider references and their uniqueness are bound to (provider, environment, account); lookups under another mode/account see nothing; rotation for the same verified account keeps associations | `src/lib/integrations/stripe/adapter.ts` `verifiedStripeAccount`, `customerReference`, `checkStripeConnection`; `src/lib/db/schema/platform.ts` | 0002 `provider_reference.provider_account_id`, `provider_reference_provider_id_uq`, `provider_reference_pending_uq`; established rows without an account marked `stale` | rev-provider-queue-notices › REV-13 / AC20 | AC20 | — |
| REV-14 | Unavailable provider → job `waiting` with a reason (never `done`); a successful connection check resumes waiting jobs once | `src/lib/jobs/queue.ts` (`waiting`, `ProviderUnavailableError`, `resumeWaitingJobs`, `ready(db)`), `src/lib/integrations/stripe/adapter.ts` | 0002 `job.status` text + `job_status_chk`, `job.waiting_reason` | rev-provider-queue-notices › REV-14 / AC21 | AC21 | — |
| REV-15 | Intake → order is one transaction; `intake_request_id` is unique on `customer_order`; a converted intake cannot regress or convert again | `src/lib/domain/intake/service.ts` `convertIntakeToOrder`, `markIntakeIncomplete`, `rejectIntake` | 0002 `order_intake_request_uq` | rev-provider-queue-notices › REV-15 / AC23; **real Postgres** races › AC23 | AC23 | — |
| REV-16 | Standing generation validates the executable D13 selection (`d13Executable`), reports `generated_partial` with skipped lines, and opens owned cases for incomplete policy / archived lines / failures; no default for held/pricing | `src/lib/domain/standing/service.ts`; `src/lib/policy/schema.ts` `validateSelection`; `src/lib/policy/implemented.ts` | 0002 `standing_occurrence.detail` | rev-policy-payer-standing › REV-16 / AC24; at05-at09 › AT09 | AC24, AC15 | AT09 (partial — see status doc) |
| REV-17 | Offboarding retires the current identity (`ended_reason/ended_by`), revokes grants, and frees the email for a NEW person with only intentional grants; rename/subject binding are transactional; sessions bound to an ended identity stop | `src/lib/domain/employees/service.ts` `offboardEmployee`, `recordEmailRename`, `resolveGoogleSignIn`, `loadActorForSession` | 0002 `employee_identity.ended_*`, `employee_identity_current_employee_uq`, `employee_identity_subject_uq` (current only) | rev-authority › REV-17 / AC18 (3, incl. AC38); at61-at62 (2); journey 7 | AC18, AC38 | AT61, AT62 (partial — real Google sign-in not run) |
| REV-18 | Notices are a workflow: subject link, recipient, content/version, outcome with evidence and responsible person, missing-recipient and failure cases, re-issue as a new version, dedupe of pending intents, withdrawal when the cause goes | `src/lib/domain/notices/service.ts`; `src/app/admin/notices/*`; `src/components/notice-actions.tsx` | 0002 `notice.*` columns, `notice_pending_dedupe_uq` | rev-provider-queue-notices › REV-18 / AC27 (2); journey 5 | AC27 | AT04, AT74 (partial) |

## 2. Architecture work (§4)

| § | Rule | Source | Tests |
|---|---|---|---|
| 4.1 service boundary | every mutation authorizes and validates inside the service; pages only render | all `src/lib/domain/*/service.ts`; `src/lib/actions/helpers.ts` | every REV test calls services directly, never actions |
| 4.2 atomic transitions | conditional updates / row locks / claim tokens; `StaleStateError` for the loser | samples, orders, intake, notices, jobs, billing-email decisions | **real Postgres** races (8 tests) |
| 4.3 coherent allocation | one position lock ordering (position → reservations) for reserve / release / refill / sample / transfer / reassignment | `src/lib/domain/allocation/service.ts` | rev-stock-orders (all), at10-at13 |
| 4.4 constraints | CHECKs on quantities, partial unique indexes on "current" rows, active-job dedupe, provider-reference identity; preflight refuses with a diagnostic | `drizzle/0002_hardening.sql`, `scripts/db-preflight.ts` | **real Postgres** upgrade › AC37 (2) |
| 4.5 policy timelines | immutable selections, precedence resolution, typed schema, executable-support flag per decision | `src/lib/policy/*` | rev-policy-payer-standing (5) |
| 4.6 warehouse reassignment | future default (override) vs `reassignOrderWarehouse` of an uncommitted order; loaded work → `custody_reconciliation` case, refusal code `loaded_work` | `src/lib/domain/allocation/service.ts` `reassignOrderWarehouse`; `src/app/orders/[id]/page.tsx` | rev-stock-orders › §4.6 / AC25, AC26 |
| 4.7 queue | claim tokens with lease, bounded attempts, `waiting`, terminal failure → owned case | `src/lib/jobs/queue.ts` | rev-provider-queue-notices › §4.7 / AC22; races › AC22; review-fixes › Jobs (2) |
| 4.8 exceptions | dedupe keys, causal resolution (`resolveByDedupeKeys`), reopen, links, market scoping | `src/lib/exceptions/service.ts` | rev-provider-queue-notices › §4.8 / AC29 / AC30 |

## 3. Product work (UX-01 … UX-12)

| UX | Delivered | Source | Evidence |
|---|---|---|---|
| UX-01 account workspace | right-now panel (who / orders / readiness), waiting-on list, readiness detail, contacts & authority, notices, license, payment, holds, standing, later-phase truthful "none", activity timeline | `src/app/locations/[id]/page.tsx`, `src/app/locations/actions.ts` | journeys 1, 5 (`j1-02`, `j5-01`) |
| UX-02 command center | work queue by category with age, owner, next action, market scope, links; explicit "not built" list | `src/components/work-queue.tsx`, `src/app/admin/page.tsx`, `src/lib/domain/commandcenter/service.ts` | journey 4 (`j4-01`) |
| UX-03 orders | searchable account picker (same-name accounts distinguished by address), hydration-safe form with preserved values and field errors, live totals, server-minted submission key, repeat preview with price/archival cues, pending-state submit | `src/app/orders/new/*`, `src/app/orders/actions.ts` | journeys 1, 2, 9 (`j1-03`, `j2-01`, `j9-02`) |
| UX-04 plain states | explicit `STATUS_PRESENTATION` mapping with glyphs; `orderStatusLine`, readiness `plain`/`summary` | `src/lib/format.ts`, `src/components/ui.tsx`, `src/lib/domain/readiness/service.ts` | ux-presentation › AC31; journeys 1, 3 |
| UX-05 timeline | one account/order activity timeline with filters, cursor pagination, source links, permission filter | `src/lib/domain/timeline/service.ts`, `src/components/timeline.tsx` | journeys 1, 5 (activity card in screenshots) |
| UX-06 follow-through | stock receipt / cancellation / license / hold / policy changes re-evaluate the affected cases once per effect; D02 follow-through | `src/lib/policy/followthrough.ts`, `resolveByDedupeKeys`, `reevaluateLicenseCases` | rev-provider-queue-notices › AC29/AC30; journey 4 |
| UX-07 decision register | typed fields from the register schema (`sel:<key>`), market checkboxes, effective date, per-market matrix, history with per-selection withdrawal, implemented-vs-recorded badge | `src/app/owner/decisions/[id]/page.tsx`, `src/app/owner/actions.ts`, `src/lib/policy/schema.ts` | journey 6 (`j6-01`, `j6-02`) |
| UX-08 manual notices | notices queue (pending / sent / failed), outcome form with sent-via + evidence, re-issue, subject links, withdrawal on cancellation | `src/app/admin/notices/*`, `src/components/notice-actions.tsx` | journey 5 (`j5-02`) |
| UX-09 navigation / search / mobile / a11y | role-aware nav with frequent items + More menu, skip link, visible focus, mobile bottom bar, search scoped by role/market with pagination | `src/components/shell.tsx`, `src/app/menu/page.tsx`, `src/app/search/page.tsx` | journeys 8, 9 (`j8-01`, `j9-01`) |
| UX-10 dates / errors | market-timezone timestamps with zone label, date-only facts as entered, sample date defaults to the market day; technical errors masked with a logged reference | `src/lib/format.ts`, `src/lib/actions/helpers.ts` `safeErrorMessage` | ux-presentation › AC35, AC36 |
| UX-11 honest demo | demo banner, seeded data through real services, providers in their real not-connected state, `demo:reset`, seed refuses live-like targets | `scripts/demo.mjs`, `src/lib/demo/seed.ts`, `src/lib/env.ts` | demo-mode (4), rev-environment › AC05; every journey runs on it |
| UX-12 staff journeys | nine automated role journeys with screenshots and timings; staff session script for the real usability session (not performed) | `tests/ui/journeys.mjs`, `docs/STAFF_SESSION_SCRIPT.md` | `npm run test:ui` → `PROBLEMS: none`, `timings.json` |

## 4. Acceptance scenarios → tests

| AC | Test(s) | Result |
|---|---|---|
| AC01 | rev-authority › REV-01 / AC01 (2) | pass |
| AC02 | rev-authority › REV-11 / AC02; review-fixes › Market scope on mutations (2) | pass |
| AC03 | rev-authority › REV-11 / AC03; journey 8 | pass + journey |
| AC04 | rev-environment › AC04 (6) | pass |
| AC05 | rev-environment › AC05; demo-mode › Demo seed | pass |
| AC06 | rev-stock-orders › REV-03 / AC06 | pass |
| AC07 | rev-stock-orders › REV-04; **postgres/races › AC07** | pass (PGlite + real Postgres) |
| AC08 | rev-stock-orders › REV-04; **postgres/races › AC08** | pass (PGlite + real Postgres) |
| AC09 | rev-stock-orders › REV-05 / AC09 (2); journey 4 | pass + journey |
| AC10 | rev-stock-orders › REV-09 / AC10 (2); **postgres/races › AC10** | pass (PGlite + real Postgres) |
| AC11 | rev-stock-orders › REV-10 / AC11; **postgres/races › AC11**; journey 3 | pass + journey |
| AC12 | rev-stock-orders › AC12; **postgres/races › AC12**; journey 2 (double click) | pass + journey |
| AC13 | rev-policy-payer-standing › REV-06 / AC13 (2); journey 6 | pass + journey |
| AC14 | rev-policy-payer-standing › REV-06 / AC14; journey 6 (withdrawal) | pass + journey |
| AC15 | rev-policy-payer-standing › AC15 (2) | pass |
| AC16 | rev-policy-payer-standing › REV-07 / AC16 | pass |
| AC17 | rev-policy-payer-standing › REV-08 / AC17; journey 5 | pass + journey |
| AC18 | rev-authority › REV-17 / AC18 (3); at61-at62 (2); journey 7 | pass + journey (real Google sign-in: not run) |
| AC19 | rev-provider-queue-notices › REV-12 / AC19 | pass (real provider checks: not run) |
| AC20 | rev-provider-queue-notices › REV-13 / AC20 | pass (real account: not run) |
| AC21 | rev-provider-queue-notices › REV-14 / AC21 | pass |
| AC22 | rev-provider-queue-notices › §4.7 / AC22; **postgres/races › AC22**; review-fixes › Jobs (2) | pass |
| AC23 | rev-provider-queue-notices › REV-15 / AC23; **postgres/races › AC23** | pass |
| AC24 | rev-policy-payer-standing › REV-16 / AC24; at05-at09 › AT09 | pass |
| AC25 | rev-stock-orders › §4.6 / AC25 | pass |
| AC26 | rev-stock-orders › AC26; at10-at13 › AT13 | pass |
| AC27 | rev-provider-queue-notices › REV-18 / AC27 (2); journey 5 | pass + journey |
| AC28 | rev-policy-payer-standing › AC28; **postgres/races › AC28** | pass |
| AC29 | rev-provider-queue-notices › §4.8 / AC29 / AC30 | pass |
| AC30 | same; journey 4 (receipt resolves only the fixed shortage) | pass + journey |
| AC31 | ux-presentation › AC31 (2) | pass |
| AC32 | journeys 8, 9 | journey |
| AC33 | journeys 1, 2 | journey |
| AC34 | rev-authority › UX-05 / UX-09 / AC34 (40 accounts paged, scoped search, timeline cursor walk with filters); journey 8 (search scope), journey 9 (picker) | pass + journey |
| AC35 | ux-presentation › AC35 (5) | pass |
| AC36 | ux-presentation › AC36 (2) | pass |
| AC37 | **postgres/upgrade › AC37 (2)**; `npm run db:preflight` + `npm run db:migrate` on the populated baseline (HARDENING_REPORT §7) | pass |
| AC38 | rev-authority › AC38; journey 7 | pass + journey |
