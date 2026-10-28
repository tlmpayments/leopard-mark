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
GOOGLE_CLIENT_ID=…  GOOGLE_CLIENT_SECRET=…  [GOOGLE_ALLOWED_HD=<workspace domain>]
```
Do **not** set `DEV_AUTH_BYPASS`, `FV_DEMO` or a `TEST_DATABASE_URL` on any Vercel environment. Preview
deployments use `FV_ENV=development` or `test` with their own database; they still refuse fixture access.

## 2. Isolated test / demo / live data and credentials

| Environment | Database | Sign-in | Provider keys |
|---|---|---|---|
| local demo (`npm run demo`) | embedded PGlite under `.fv-demo/` (git-ignored); `DATABASE_URL` is ignored by the launcher | auto demo Owner + *Switch user* | none — providers show their real not-connected state |
| local dev against Postgres | your own `DATABASE_URL` | Google, or fixture list with `DEV_AUTH_BYPASS=true` (local only) | test keys only |
| automated tests | PGlite in-process; `TEST_DATABASE_URL` creates and drops `fv_test_*` databases on a **throwaway** server | n/a | none (placeholder strings never leave the process) |
| Vercel preview | separate Neon branch/database | Google only | Stripe **test** key at most |
| Vercel production | production Neon database | Google only | keys added only per `ACTIVATION_CHECKLIST.md` |

The dev seed (`npm run seed:dev`) checks its target **before any write**: it refuses on a deployment, on
`FV_ENV=production`, and on any explicit non-development `FV_ENV`. Stripe keys carry their mode in the prefix;
the Integrations page shows the mode and the verified account id, and provider references are bound to
(provider, mode, account) — a key from another account or mode never reuses existing references.

## 3. Forward migrations, upgrade verification, recovery

Migrations are forward-only SQL files in `drizzle/` applied with `npm run db:migrate` (recorded once in
`drizzle.__drizzle_migrations`; re-running is a no-op). This revision adds **`0002_hardening`**:

* new columns (decision withdrawal, identity retirement, job claim/waiting, notice workflow, provider
  account binding, payer assignment, submission payload hash, occurrence detail);
* `job.status` becomes text with a CHECK (adds `waiting`);
* partial unique indexes on *current* rows (identity, license verification, payment relationship), active-job
  dedupe, provider-reference identity, one order per intake, one pending notice per business intent;
* CHECK constraints on stock, order-line, reservation and sample quantities;
* a **preflight block** that aborts the migration with `fv-ops migration 0002_hardening preflight: <check>` if
  existing rows violate an invariant — nothing is changed in that case.

Upgrade procedure for a populated database (also in OPERATOR_GUIDE → Upgrading):

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

## 6. Google sign-in and disablement — commissioning steps and remaining evidence

1. Create the OAuth web client; register `https://<domain>/api/auth/google/callback`; set
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ALLOWED_HD`.
2. `DATABASE_URL=… OWNER_EMAIL=… npm run bootstrap` (migrates, seeds the decision register unselected and the
   capability gates unproven, provisions the Owner by email). Sign in as the Owner with Google.
3. Provision every employee (role + market scope) under Employees & access.
4. Evidence still to record on the Integrations page with real accounts: `ACCESS_STABLE_IDENTITY` (rename an
   employee's Workspace address, sign in again, then reuse the old address for a new person after offboarding)
   and `ACCESS_EFFECTIVE_DISABLE` (disable an employee who is signed in and watch their next request be
   refused). The same flows are proven automatically with the dev fixture (`tests/scenarios/rev-authority.test.ts`,
   `at61-at62-access.test.ts`, browser journey 7) — **not yet with real Google accounts**.

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

* No live Stripe key until phase 3 acceptance (SD01–SD10/IG09). No invoices, debits, credits or collections
  exist in this revision; the hosted setup session is the only payer-facing Stripe object, in test mode.
* No customer notice is sent by the application (D32/IG04 unselected) — the manual single-sender process
  records outcomes. No Gmail/Slack/OptimoRoute/Google Address/QBO credentials are needed or read for any
  business effect; setting them changes nothing but the "credentials present" fact.
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
2. **Google sign-in**: removing the client credentials blocks new sign-ins; existing sessions continue until
   the cookie expires or the employee is disabled. To force everyone out, rotate `SESSION_SECRET`.
3. **Jobs**: remove the cron entry (or rotate `CRON_SECRET`) to stop automatic processing; Admin can still run
   due jobs manually.
4. **Database**: restore a Neon branch/point-in-time snapshot; never delete rows.

## 11. Dependency / security check (actual result, scope)

`npm audit --omit=dev` on the committed lockfile: **0 vulnerabilities** in production dependencies.
`npm audit` (including dev tooling): 4 moderate advisories, all one chain — `drizzle-kit` →
`@esbuild-kit/esm-loader` → `esbuild ≤0.24.2` (GHSA-67mh-4wv8-2f99, esbuild's *development server* accepting
cross-origin requests). `drizzle-kit` is used only by `npm run db:generate` on a developer machine and never
runs a server, so the advisory does not apply to the deployed application; the fix npm proposes is a
breaking downgrade of drizzle-kit and was not applied. Re-check with `npm audit` before each release; no
indiscriminate upgrades were made in this revision.

## 12. Continuous integration

`.github/workflows/ci.yml` runs without any secret: typecheck, lint, the PGlite suite, the real-Postgres
races/upgrade suite against a service container, the migration preflight on the populated baseline, the
production build, then the nine browser journeys against a fresh local demo (screenshots uploaded as a
workflow artifact). Fixture sign-in is enabled only inside that local demo job, never on a deployment.
