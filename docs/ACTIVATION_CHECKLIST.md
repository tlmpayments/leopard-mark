# Production activation checklist (by branch/module)

Production readiness applies by branch, not to the whole application at once (brief, Final commissioning
report). Nothing below is a policy choice; every owner/accountant decision is recorded in the app's decision
register with scope and effective date.

For every provider the checklist distinguishes **configured credentials** → **verified connection** (a
recorded *Check connectivity* with account id) → **proven capability** (a §49 gate recorded with evidence)
→ **authorized live use** (a recorded activation). Ticking an earlier box never implies a later one; the
Integrations page shows the four facts separately.

State of this revision: **no box below is ticked.** Every item needs the company's own accounts or people.
Where the same flow has been proven automatically with fictional data, that is noted — it is not a substitute.

## A. Employee access (phase 1) — before any live use
- [ ] Google OAuth client created; redirect URI registered; `GOOGLE_ALLOWED_HD` set to the Workspace domain
- [ ] First Owner bootstrapped (`npm run bootstrap`) and signed in with Google
- [ ] Every employee provisioned with the correct role and market scope (Admin → Employees & access)
- [ ] AT61 demonstrated with a real Workspace rename, then offboarding and provisioning a new person on the freed address; gate `ACCESS_STABLE_IDENTITY` recorded with evidence (automated equivalent: `rev-authority` tests, journey 7)
- [ ] AT62 demonstrated with an already-signed-in employee (disable → their next request refused without re-login); gate `ACCESS_EFFECTIVE_DISABLE` recorded (automated equivalent: AC38 test, journey 7)
- [ ] `FV_ENV=production`, no `DEV_AUTH_BYPASS` / `FV_DEMO` / `TEST_DATABASE_URL` on Vercel, `SESSION_SECRET` and `CRON_SECRET` rotated to production values; Integrations page shows no configuration problem

## B. Customer / order capture (phase 1) — live operation
- [ ] Markets created with primary warehouses and the actual fulfillment contacts (D16 accountability names the existing partner)
- [ ] Real catalog and market prices entered by Admin (dev seed prices are samples and must not be present)
- [ ] Opening stock positions confirmed from credible partner evidence (D30: known vs estimated distinguished in the evidence text)
- [ ] Seller context confirmed per market (D33) — Owner
- [ ] Decision selections needed for live capture behaviour, if any: D09 (abnormal criterion), D11 (minimum basis) — otherwise leave unselected; the app flags instead of deciding
- [ ] Spreadsheet/EKOS process for account creation and order capture named as retired only after totals reconcile (D30); history retained
- [ ] Payer authority assigned deliberately per location before any setup request (shared AP is never a payer by default); the shared-payer note used where one person pays for several locations

## C. Stripe association (phase 1 boundary of phase 3)
- [ ] Test-mode restricted key set (credentials present)
- [ ] *Check connectivity* recorded `ok` with the company test account id (verified connection); waiting jobs resumed
- [ ] Location-specific customer association demonstrated in the company account; gate `STRIPE_CUSTOMER_ASSOCIATION` recorded
- [ ] Hosted ACH setup session completed by a test payer; only masked evidence retained; gate `STRIPE_HOSTED_SETUP` recorded
- [ ] Webhook endpoint registered with signing secret; a replayed event is recorded once (provider_event unique)
- [ ] Activation for live use recorded on Integrations only after the above — **do not** set a live key until phase 3 finance branches pass SD01–SD10/IG09 acceptance; a live key would see none of the test-mode references (bound to account + mode)

## D. Notices (D32 / IG04)
- [ ] Owner selects the single normal sender per purpose (or reaffirms the recommended §42 matrix)
- [ ] Until then, the authorized manual single-sender process is followed **in the app**: Notices queue → send from the company mailbox → record Sent / Failed / Unknown with how + evidence; missing-recipient and failure cases worked to resolution; re-issue for changed recipients (journey 5 demonstrates the flow with fictional data)
- [ ] The person(s) allowed to record notice outcomes hold Admin or Accounting (the `notice.record_outcome` action)

## E. Later phases (not in this revision)
- [ ] Phase 2: all `OR_*` MUST-WORK gates demonstrated before initial field use; D19–D21 selected where the branch needs them; durable POD custody arrangement (IG02) chosen
- [ ] Phase 3: D01 (readiness), D05, SD01–SD10 selected as needed; accountant selects QBO model and one writer per effect (IG06) before any posting
- [ ] Phase 4: D17/D18 keg validity and exceptional disposition; D26 cleaning baseline
- [ ] Phase 6: D31 metric definitions before any report is presented as authoritative
