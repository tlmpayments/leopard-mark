# Deployment runbook — Vercel + Neon Postgres

## 1. Runtime and configuration validation

| Item | Value |
|---|---|
| Runtime | Node.js 22 (CI and local verification ran on 22.22); Next.js 16.3 on Vercel, all routes dynamic |
| Database | Neon Postgres 16 — the **pooled** connection string as `DATABASE_URL`; migrations are run by an operator, never on deploy |
| Jobs | `GET /api/internal/jobs/run`, scheduled by `vercel.json` (`*/5 * * * *`), header `Authorization: Bearer <CRON_SECRET>` |
| Sessions | signed cookie (`SESSION_SECRET`); authorization is re-read from the database on **every** request |
| Secrets | Vercel environment variables only; nothing is read from files at runtime; `.env.example` lists names, never values |

**Validation the process performs at startup and on every page**: `src/lib/env.ts` classifies the process
as a *deployment* whenever `NODE_ENV=production` or any `VERCEL`/`VERCEL_ENV` variable is present. In a
deployment the demo database and the fixture sign-in are refused unconditionally — `FV_ENV=development`,
`FV_DEMO=true` or `DEV_AUTH_BYPASS=true` cannot re-enable them (tests: `tests/scenarios/rev-environment.test.ts`,
`demo-mode.test.ts`). An unknown `FV_ENV` value is a **configuration error**: the process does not fall back
to development; pages show *Configuration needs attention* to Admin/Accounting and the Integrations page
lists every problem (`configurationProblems()`). Required for a production deployment:

```
FV_ENV=production  APP_BASE_URL=https://<domain>  DATABASE_URL=…  SESSION_SECRET=…  CRON_SECRET=…
[GOOGLE_CLIENT_ID=…  GOOGLE_CLIENT_SECRET=…  GOOGLE_ALLOWED_HD=<workspace domain>]   # optional: adds "Continue with Google"
```
Employees sign in with their **company email + PIN**; no identity provider is required for live use.
Do **not** set `DEV_AUTH_BYPASS`, `FV_DEMO` or a `TEST_DATABASE_URL` on any Vercel environment. Preview
deployments use `FV_ENV=development` or `test` with their own database; they still refuse fixture access.

**Request body size**: `next.config.ts` sets `experimental.serverActions.bodySizeLimit` to `8mb` so the
in-app workbook import can receive the TLM Master File export through a server action (the export is a few
hundred KB today). No other route accepts an upload. The PDF routes stream stored bytes and need no setting.
`@react-pdf/renderer` and `exceljs` run in the Node.js runtime on Vercel (the document routes declare
`runtime = "nodejs"`); nothing runs at the edge.

## 2. Isolated test / demo / live data and credentials

| Environment | Database | Sign-in | Provider keys |
|---|---|---|---|
| local demo (`npm run demo`) | embedded PGlite under `.fv-demo/` (git-ignored); `DATABASE_URL` is ignored by the launcher | auto demo Owner + *Switch user*; email + demo PIN `135790` for the real form | none — providers show their real not-connected state |
| local dev against Postgres | your own `DATABASE_URL` | email + PIN (dev seed sets the demo PIN), or fixture list with `DEV_AUTH_BYPASS=true` (local only) | test keys only |
| automated tests | PGlite in-process; `TEST_DATABASE_URL` creates and drops `fv_test_*` databases on a **throwaway** server | n/a | none (placeholder strings never leave the process) |
| Vercel preview | separate Neon branch/database | email + PIN (Google if configured) | Stripe **test** key at most |
| Vercel production | production Neon database | email + PIN (Google if configured) | keys added only per `ACTIVATION_CHECKLIST.md` |

The dev seed (`npm run seed:dev`) checks its target **before any write**: it refuses on a deployment, on
`FV_ENV=production`, and on any explicit non-development `FV_ENV`. Stripe keys carry their mode in the prefix;
the Integrations page shows the mode and the verified account id, and provider references are bound to
(provider, mode, account) — a key from another account or mode never reuses existing references.

## 3. Forward migrations, upgrade verification, recovery

Migrations are forward-only SQL files in `drizzle/` applied with `npm run db:migrate` (recorded once in
`drizzle.__drizzle_migrations`; re-running is a no-op). **`0004_shipments`** (the fifth migration, October 28)
carries the shipments module: twelve new enums, 24 new tables (`shipment`, `shipment_line`,
`shipment_allocation`, `shipment_document` with the PDF as `bytea`, `shipment_order`, `shipment_keg_pickup`,
`shipment_receipt` and lines, `bol_counter`, `brew_batch`, `lot`, `lot_sku_qty`, `invoice`, `invoice_line`,
`invoice_shipment`, `doc_counter`, `price_override`, `sku_alias`, `pos_item`, `company_settings`, `keg_event`,
`count_session`, `count_line`, `import_run`), new nullable or defaulted columns on `market` (terms, deposits,
COD, region list), `warehouse` (origin code, lot facility code, kind, address fields, hours, dock / liftgate /
appointment, shipping contact; `market_id` becomes nullable), `customer_location` (kind, served-by, legacy id,
deposit mode, terms override, fulfilment, pallet rule, receiving requirements, region), `sku` (UPCs, pallet
fraction, recipe variant, shelf life) and `stock_movement` (lot and shipment references), plus the
`shipment_out` and `count` movement kinds. It is **additive with no preflight block**; it is applied through
`/setup` with the setup token exactly like the earlier migrations, after the same snapshot. The apply step also
seeds the single `company_settings` row, the INV and NC counters (last numbers 375 and 1 for 2026) and the four
POS items when they are missing (`seedShipmentDefaults`, idempotent). **`0003_pin_signin`** adds the
`employee_credential` table (PIN hashes, lockout state, history) — purely additive, no preflight needed;
upgraded employees have no PIN until an Owner/Admin sets one. The hardening revision added **`0002_hardening`**:

* new columns (decision withdrawal, identity retirement, job claim/waiting, notice workflow, provider
  account binding, payer assignment, submission payload hash, occurrence detail);
* `job.status` becomes text with a CHECK (adds `waiting`);
* partial unique indexes on *current* rows (identity, license verification, payment relationship), active-job
  dedupe, provider-reference identity, one order per intake, one pending notice per business intent;
* CHECK constraints on stock, order-line, reservation and sample quantities;
* a **preflight block** that aborts the migration with `fv-ops migration 0002_hardening preflight: <check>` if
  existing rows violate an invariant — nothing is changed in that case.

Upgrade procedure for a populated database (also in OPERATOR_GUIDE → Upgrading). From the browser:
`/setup` lists pending migrations and applies them with the setup token (the same preflight protects the
data — a refusal shows the diagnostic and changes nothing). From a terminal:

```bash
# 1. snapshot: Neon branch or point-in-time restore point
# 2. read-only preflight (same checks as the migration)
DATABASE_URL=… npm run db:preflight
# 3. repair anything listed, from evidence, without deleting history
# 4. apply
DATABASE_URL=… npm run db:migrate
# 5. verify
DATABASE_URL=… npm run db:preflight     # still clean; app starts; Integrations shows the environment
```

Verified in this revision (see HARDENING_REPORT.md §7): a fresh database migrates 0000→0002; a populated
baseline of the previous revision (`tests/support/fixtures/baseline-884684c.sql`, demo data + activity) is
upgraded by `npm run db:migrate` with every business record retained and the new constraints in place; the
same baseline with an injected duplicate current identity is **refused** with the preflight diagnostic and
left untouched (`tests/postgres/upgrade.test.ts`, run under `TEST_DATABASE_URL`).

Recovery: roll back by restoring the snapshot, never by deleting rows. If a migration aborts, the transaction
is rolled back — fix the data and re-run. If the application starts against a database whose migrations
are behind, requests fail with a technical error reference in the logs (no data is written); apply the
migrations and redeploy.

## 4. Database access and backup/restore responsibilities

* Neon holds the data; **Neon's point-in-time restore and branching are the backup mechanism**. Owner/Admin
  keep the Neon project; the application has no backup code of its own and deletes nothing.
* Before every migration and before any bulk data correction: create a Neon branch (or note the restore
  point). After: confirm the app starts and the Integrations page shows the expected environment.
* Restore drill: restore the branch to a *new* database, point a preview deployment at it, sign in, open an
  account workspace and its activity timeline, then discard. **Not run in this revision** — requires the Neon
  project and a preview deployment; the steps above are the executable instruction.
* Access: humans reach the database only through Neon's console/psql with their own credentials; the
  application uses the pooled `DATABASE_URL` only. `TEST_DATABASE_URL` must never point at Neon.

## 5. Cron, execution visibility, expired claims, waiting work

* Vercel cron calls `/api/internal/jobs/run` with `Authorization: Bearer <CRON_SECRET>`; a wrong or missing
  secret is refused (401). Check *Vercel → Cron Jobs* for invocations and the function logs for the run summary.
* Each run claims jobs with a **claim token** and a lease (`LEASE_MS`, 15 minutes). A job whose worker died
  is reclaimed after the lease by the next run; a late completion from the old worker is ignored (its token no
  longer matches). Attempts are bounded; the final failure opens a `provider_handoff_failed` case owned by
  Accounting (Stripe kinds) or Admin. The Integrations page shows queued / running / **waiting** / failed / done.
* Jobs that need an unavailable provider park in **waiting** with the reason. They resume — once — after a
  successful *Check connectivity* for that provider, or on the next run if the provider's `ready(db)` check
  passes. *Run due jobs now* (Admin/Accounting) drains immediately.
* Standing-order generation runs on the same tick and is inert while D13 is unselected.

## 6. Employee sign-in (email + PIN) and disablement — commissioning steps and remaining evidence

1. First run — **from the browser, no terminal needed**: open `https://<domain>/setup`. The page shows the
   database state. Enter the setup token (the deployment's `CRON_SECRET`) and click *Apply migrations*
   (also seeds the decision register unselected and the capability gates unproven), then enter the Owner's
   email, name and a temporary PIN and click *Provision the first Owner*. The page refuses a second Owner
   and never shows secrets; every action is audited (`setup.migrate`, `employee.bootstrap_owner`). Terminal
   equivalent: `DATABASE_URL=… OWNER_EMAIL=… OWNER_NAME=… OWNER_PIN=… npm run bootstrap`.
2. Open `https://<domain>/sign-in`, sign in as the Owner, and choose your own PIN when prompted (the
   temporary one allows nothing else).
3. Provision every employee (role + market scope) under **Employees & access**, giving each a temporary PIN
   in person; they choose their own at first sign-in. The page shows who has no PIN, a temporary PIN, or a
   lockout.
4. Lost PIN: an Owner/Admin sets a new temporary PIN from the same page (*Reset PIN*; ends that person's
   sessions). If the only Owner is locked out: `PIN_EMAIL=… PIN=… npm run set-pin` from a trusted machine.
5. What the PIN scheme guarantees and what it does not: PINs are stored only as scrypt hashes; five wrong
   attempts lock the PIN for 15 minutes, doubling on further failures (the state is in the database, so it
   holds across Vercel instances); refusals never reveal whether an email exists; a reset or change ends all
   sessions for that person; the cookie is HTTPS-only. A PIN is still weaker than Workspace SSO — there is
   no second factor and no per-IP throttle beyond the account lockout — so keep PINs private, keep employee
   lists current, and disable leavers promptly. **Google sign-in can be added later** by setting
   `GOOGLE_CLIENT_ID/SECRET` (+ `GOOGLE_ALLOWED_HD`); the button then appears next to the PIN form and the
   same employee records apply.
6. Evidence still to record on the Integrations page with real people: `ACCESS_STABLE_IDENTITY` (rename an
   employee's address, sign in again, then reuse the old address for a new person after offboarding) and
   `ACCESS_EFFECTIVE_DISABLE` (disable an employee who is signed in and watch their next request be refused).
   The same flows are proven automatically (`tests/scenarios/pin-signin.test.ts`, `rev-authority.test.ts`,
   `at61-at62-access.test.ts`, browser journeys 7 and 10) — **not yet with real staff accounts**.

## 7. Stripe — test account, payer, setup capability checks and remaining evidence

1. Set a **test-mode restricted key** (`STRIPE_SECRET_KEY`) and `STRIPE_WEBHOOK_SECRET`; register
   `https://<domain>/api/webhooks/stripe`.
2. Integrations → *Check connectivity (binds account + credential)*: records the verified account id and the
   key fingerprint; waiting `stripe.customer.ensure` jobs resume.
3. On an account: assign payer authority, request ACH setup, run due jobs; the account page shows the Stripe
   customer reference bound to that account and mode. Record `STRIPE_CUSTOMER_ASSOCIATION` with evidence.
4. Create the hosted setup session for the authorized payer and complete it with a test bank account; only
   masked evidence is retained. Record `STRIPE_HOSTED_SETUP`.
5. Replay a webhook delivery: recorded once (`provider_event` unique).
All of 2–5 are **not run** in this revision (no company Stripe account/key was available); the adapter paths
are covered by tests with placeholder values that never leave the process.

## 8. Activation boundaries (no live finance)

* No live Stripe key until phase 3 acceptance (SD01–SD10/IG09). The shipments revision adds **invoice
  documents** (INV / NC numbers, PDFs, a manual *Mark paid* status) but **no debits, credits or collections**:
  nothing charges a bank account or card, nothing talks to Stripe about an invoice, and the Stripe adapter is
  unchanged (customer association and hosted setup session only, no Connect, no Stripe Tax, no Subscriptions).
  Sending and collection of invoices stay manual (owner question 7.5 open).
* No customer notice, invoice or document is **emailed** by the application (D32/IG04 unselected; owner
  decision 9.7) — the manual single-sender process records outcomes, and invoice PDFs are downloaded and sent by a
  person. No Gmail/Slack/OptimoRoute/Google Address/QBO credentials are needed or read for any business effect;
  setting them changes nothing but the "credentials present" fact.
* Production-decision selections are Owner-only; test selections never apply under `FV_ENV=production`.

## 9. Webhook / OAuth callbacks to register

| Provider | Endpoint | Status in this revision |
|---|---|---|
| Google Identity | `GET /api/auth/google/callback` | built |
| Stripe | `POST /api/webhooks/stripe` | built (signature-verified, idempotent record; consequences deferred to phase 3) |
| QuickBooks Online | `/api/oauth/qbo/callback` | reserved, not built |
| OptimoRoute / Gmail / Slack / Google Address | none needed | boundary only |

## 10. Rollback / disconnection (consequential integrations)

1. **Stripe**: remove `STRIPE_SECRET_KEY` and redeploy. The adapter reports credentials absent; queued work
   parks in *waiting* and resumes after the next successful check. No business record is deleted. Webhooks are
   refused (400) without `STRIPE_WEBHOOK_SECRET`.
2. **Sign-in**: to force everyone out, rotate `SESSION_SECRET`; to stop one person, disable them (next request
   refused) or reset their PIN (their sessions end). Removing optional Google credentials only removes the
   Google button.
3. **Jobs**: remove the cron entry (or rotate `CRON_SECRET`) to stop automatic processing; Admin can still run
   due jobs manually.
4. **Database**: restore a Neon branch/point-in-time snapshot; never delete rows.

## 11. Dependency / security check (actual result, scope)

At the hardening revision, `npm audit --omit=dev` on the committed lockfile reported **0 vulnerabilities** in
production dependencies, and `npm audit` (including dev tooling) 4 moderate advisories, all one chain —
`drizzle-kit` → `@esbuild-kit/esm-loader` → `esbuild ≤0.24.2` (GHSA-67mh-4wv8-2f99, esbuild's *development
server* accepting cross-origin requests). `drizzle-kit` is used only by `npm run db:generate` on a developer
machine and never runs a server, so that advisory does not apply to the deployed application.

Re-run on **October 28, 2026** against the same lockfile with the shipments dependencies added
(`@react-pdf/renderer`, `exceljs`): `npm audit --omit=dev` now reports **6 advisories in production
dependencies** (1 critical, 3 high, 2 moderate) because the advisory database has moved on since the last
check: `next` 16.0.0 to 16.4.0 (several advisories; npm's fix is `next@16.4.3`, outside the pinned range),
`sharp` below 0.35.5, `source-map-js` 1.0.0 to 1.2.1, `zod` below 4.6.6, and `uuid` below 11.1.1 reached through
`exceljs`. **No dependency was upgraded to address these in the shipments revision**; the maintainer should
review them, upgrade `next` deliberately with the production build and the full test suite, and record the
result here before the next release. Re-check with `npm audit` before each release; no indiscriminate upgrades
were made.

## 12. Updating production after go-live

Vercel's Git integration deploys every push to the production branch automatically. The routine is: Claude
(or anyone) pushes a commit → Vercel builds and deploys (2–4 minutes; a failed build leaves the previous
deployment live) → if the commit added a migration, open `/setup` and apply it with the setup token (the
app keeps serving the old schema until then; new columns are nullable so the code deployed first does not
break). Rollback of code: Vercel → Deployments → *Promote to Production* on an earlier deployment. Rollback
of data: Neon branch / point-in-time restore (§4).

## 13. Continuous integration

`.github/workflows/ci.yml` runs without any secret: typecheck, lint, the PGlite suite, the real-Postgres
races/upgrade/setup suites against a service container, the migration preflight on the populated baseline,
the production build, the go-live path on that build against an empty database (`/setup` → first Owner →
sign-in), then the browser journeys against a fresh local demo (screenshots uploaded as a workflow artifact). Fixture sign-in is enabled only inside that local demo job, never on a deployment.

## 14. Production follow-through for the shipments revision (October 28)

Production (Vercel project `leopard-mark-ops`, Neon) already holds the reference data loaded from the workbook
by the Python prototype on October 28 (markets, origins, SKUs, prices, accounts; report in
`tools/import/dry-run-report-2026-10-28.md`). The in-app import uses the same deterministic ids, so it updates
those rows rather than duplicating them. After this revision deploys:

1. **Snapshot** the Neon database (branch or restore point), as before every migration.
2. **Apply migration `0004_shipments`** from `/setup` with the setup token (section 3). The state card lists it
   as pending before and applied after; the same step seeds company settings, the INV / NC counters and the POS
   items. The app keeps serving the previous schema until this is done; the shipments pages need it.
3. **Run the in-app import**: an Admin or the Owner uploads the current `.xlsx` export under *Import from
   workbook* and reads the dry run; the **Owner applies** it. Expected effects on the production data: origin
   codes, kinds and lot facility codes set on the existing origins; the Prost and Real Ale origins created
   without a market; served-by and active flags set on the San Francisco accounts inside the distributor's
   territory; people created by name only (no emails, no PINs, no invitations); legacy shipments, invoices,
   batches and lots written as history that never touches the ledger. A second dry run of the same file must
   report zero creates and zero updates.
4. **Verify origins and counters**: under *Markets & stock* every active origin that will ship shows its
   three-letter code (EBB, BWD, PRO, RTB, ALE, JAB, RAL, EWD, WLA, RAD) and every brewery its two-digit lot
   facility code; Radford shows 31 Plymouth St, Mansfield, MA 02048; Envision and SC Warehouses are inactive
   with no code. Confirm one test shipment on a scratch date only if the Owner agrees, since the number it takes
   is permanent; otherwise confirm the counters by reading the next INV / NC numbers on the first real issue
   (INV26376, NC26002).
5. **Company settings**: the Owner reviews the shipper block, office address, AR email, footers and NMFC status
   (left *proposed* until signed off, 6.6) before the first documents print.
6. **Opening counts** per origin with lot codes (one origin at a time, Richmond first, 10.4) and **opening keg
   balances** per account (8.5) are entered by hand; the workbook's inventory figures are not imported (1.6).
7. **Open items** that remain open after this step and must not be guessed in data entry: 4.5 (packaging that
   spans two dates), 7.5 (sending and collection of invoices stay manual), the Envision / SC Warehouses part of
   2.3, and section 11 beyond 11.1 (on hold, not built). No step above sends an email or touches Stripe.

## 15. Production follow-through for round 2 (migration `0005_round2`)

1. **Snapshot** the Neon database (branch or restore point).
2. **Apply migration `0005_round2`** from `/setup` with the setup token (section 3). Additive only: new enum values
   (order sources, the `held` demand state, the `packaging` movement kind, `shortfall_decision`, `pay_by`), new
   tables `credit_memo` and `lot_packaging_entry`, new nullable columns on `market`, `warehouse`,
   `customer_location`, `customer_order`, `brew_batch`, `company_settings`, `invoice` and `shipment_line`, and
   `shipment.scheduled_date` made nullable. Its data statements: accounts with the retired status *inactive* become
   *closed* with the close reason "Was inactive; status retired in round 2 (R2-31)" and an audit row each; the
   `CM` document counter is created at zero; one samples house account per market is created (Samples, SoCal;
   Samples, NorCal; Samples, NorCal (Distributed); Samples, Connecticut; Samples, Massachusetts); every lot with
   quantities gets one packaging entry dated its packaging day, noted as backfilled. Nothing is deleted. The app
   keeps serving until it is applied; the order screen needs it.
3. **Confirm the switch is off**: Company settings shows *Email each warehouse its next-day pull sheet* unchecked.
   Leave it off; the email transport is not built, and a switched-on send only opens a case.
4. **Warehouse send details** (optional, for later): the pull-sheet email and local send time on Express Wine
   Delivery and Balmuth under Markets & stock, from the Owner's list.
5. **Accounts**: set *Pays by* (Fintech, Stripe, check) and, where agreed, *Invoice on receipt* and the floating
   deposit on file per account; add reps' home addresses as samples recipients (Admin, from the account tools).
6. **People**: grant the SoCal driver the Driver/Service role; the driver signs in on the phone and sees *My stops*.
7. **Credit memos** are issued by the Owner or the back office only (`credit.issue` is limited to the admin role).
8. No step above sends an email or touches Stripe.
