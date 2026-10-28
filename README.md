# Leopard Mark Ops — Familiar Ventures self-distribution operating system

Internal operating layer for Familiar Ventures, LLC (dba The Leopard Mark Beverage Group) built from the
**Exhaustive Claude/Fable Master Implementation Prompt** (Final audited revision 5, September 17, 2026).

This repository revision delivers **Phase 1 (Foundation) deep** on a **whole-system skeleton**, hardened
per the *Phase 1 hardening, operating workflows, and product refinement* prompt (branch `hardening/phase1`;
findings REV-01–18, product items UX-01–12, acceptance AC01–38 — see `docs/HARDENING_REPORT.md` and
`docs/TRACEABILITY.md`):

| Phase | Status in this revision |
|---|---|
| 1. Foundation — employee access/roles/markets, customers/contacts/license readiness, catalog/pricing, orders/allocation/samples/standing, Admin command center/exceptions/audit, decision register, provider associations | **Built, tested, deployable** |
| 2. Delivery | Skeleton records + boundary only (not built) |
| 3. Invoicing & collections | Skeleton records + Stripe adapter for customer association only (not built) |
| 4. Kegs & service | Skeleton records only (not built) |
| 5. Customer self-service | **Deferred [F]** by the brief |
| 6. Management intelligence | Not built; D31 definitions unselected |

Read **docs/IMPLEMENTATION_STATUS.md** for the honest split between implemented support, approved active
behaviour, unresolved policy, unproven provider capability, incomplete acceptance and deferred scope.

## Stack (ordinary technical means, brief §58)

Next.js 16 (App Router, server components + server actions, Turbopack) · TypeScript · Tailwind CSS 4 ·
PostgreSQL (Neon in production) via Drizzle ORM with SQL migrations · a Postgres-backed job queue drained by
Vercel Cron · Google OpenID Connect for employee identity (arctic + jose; no second identity provider) ·
Stripe SDK · Vitest with PGlite (real Postgres SQL in-process) for business-scenario tests, a disposable real
Postgres for concurrency and upgrade tests, Playwright (pinned) for role browser journeys.

## Local Demo

Zero setup — no Google, no Neon/Postgres, no Stripe or other credentials:

```bash
npm install
npm run demo
```

Then open **http://fv-ops.localhost:3000** (Chrome/Firefox; `http://localhost:3000` works in every browser).
The command prints the exact URL. Want the prettier **http://fv-ops.test**? One-time, asks for your macOS
password: `npm run demo:hosts` — afterwards `npm run demo` serves it on port 80 automatically.

What demo mode is: an embedded **PGlite** database (real Postgres SQL in-process, persisted under
`.fv-demo/`) running the same Drizzle schema and migrations as production, seeded once with representative
data (markets, warehouses, catalog with **sample** prices, seven accounts in various states, orders including a
shortage and a below-minimum one, a hold, a closure, a standing arrangement, samples, an email intake, a
pending billing-email change and a Stripe association request). You are auto-signed in as the **demo Owner**;
use *Switch demo user* to see the portal as Admin, Accounting, Sales or Driver — internal grants and market
scope still apply. A prominent **DEVELOPMENT DEMO MODE** banner is always shown.

What it is not: nothing simulates a provider. Stripe, Google, OptimoRoute, Gmail, Slack, QBO all show their real
IMPLEMENTED / NOT CONNECTED or NOT IMPLEMENTED state and every capability gate stays unproven. Demo mode is
impossible under a production build, on Vercel (production or preview) or with `FV_ENV=production` (guards in
`src/lib/env.ts`, tested in `tests/scenarios/demo-mode.test.ts`). Plain `npm run dev` with no `DATABASE_URL`
also lands in demo mode; setting `DATABASE_URL` switches back to the real Postgres path.

`npm run demo:reset` deletes the embedded database so the next start reseeds. `npm run preview:local` is an
alias of `npm run demo`.

## Quick start against a real Postgres (local development)

```bash
cp .env.example .env            # fill DATABASE_URL, SESSION_SECRET; set DEV_AUTH_BYPASS=true for fixture sign-in
npm install
npm run db:migrate               # apply drizzle/ migrations
npm run seed:dev                 # same representative demo data into your Postgres (refuses in production)
npm run dev                      # http://localhost:3000 → sign-in page lists dev fixture employees
```

Production bootstrap (no demo data):

```bash
OWNER_EMAIL=owner@company.com OWNER_NAME="Owner" npm run bootstrap   # migrate + decision register + gates + first Owner
```

## Tests and checks

```bash
npm run check                                     # typecheck + lint + 87 PGlite scenario tests + production build
TEST_DATABASE_URL=postgres://… npm run test:pg    # 10 real-Postgres tests: races (AC07/08/10/11/12/22/23/28) + populated-database upgrade (AC37)
npm run demo && npm run test:ui                   # 9 role browser journeys with screenshots + timings (tests/ui/README.md)
DATABASE_URL=postgres://… npm run db:preflight    # read-only check of a populated database before applying migration 0002
```
`test:pg` creates and drops throwaway `fv_test_*` databases — never point it at a shared server. CI
(`.github/workflows/ci.yml`) runs all of the above with a Postgres service container and no secrets.

## Scripts

| Script | What it does |
|---|---|
| `npm run demo` / `npm run preview:local` | zero-setup DEVELOPMENT DEMO MODE (embedded PGlite, seeded data, auto Owner); prints the URL |
| `npm run demo:hosts` | one-time sudo helper mapping `fv-ops.test` → 127.0.0.1 so the demo serves `http://fv-ops.test` |
| `npm run demo:reset` | delete `.fv-demo/` (embedded demo database) |
| `npm run check` | typecheck + lint + tests + production build |
| `npm test` | 87 business-scenario tests (AT01–AT13, AT61/AT62, AT79/AT80, REV-01–18 regressions, environment guards, presentation/timezone/error masking) on PGlite |
| `npm run test:pg` | real-Postgres concurrency + upgrade tests (`TEST_DATABASE_URL`) |
| `npm run test:ui` | role browser journeys against the running demo (`SHOTS_DIR` for screenshots) |
| `npm run db:generate` | generate a new SQL migration after editing `src/lib/db/schema/*` |
| `npm run db:migrate` | apply migrations to `DATABASE_URL` (forward-only; 0002 runs a preflight and aborts with a diagnostic on invalid data) |
| `npm run db:preflight` | read-only: list rows a populated database must repair before 0002 |
| `npm run bootstrap` | production-safe: migrate, seed decision register (all unselected) and gates (all unproven), provision first Owner |
| `npm run seed:dev` | development demo data; refuses on any deployment, `FV_ENV=production` or an explicit non-development `FV_ENV` |

## Repository map

```
src/app/                 routes (mobile-first pages + server actions)
  locations/  orders/  samples/            Sales & Admin operational flows
  admin/ (command center, exceptions, employees, markets/stock, catalog/prices, intake)
  owner/decisions/                          decision register (D/SD/T/IG) — Owner selects production policy
  integrations/                             build-versus-activate status, capability gates, jobs, notices
  field/ delivery/ finance/ kegs/ customer/ reports/   later-phase placeholders (clearly labelled)
  api/auth/*  api/webhooks/stripe  api/internal/jobs/run
src/lib/
  db/schema/            Drizzle schema: platform, market, customer, order, later (phase 2–4 skeleton)
  auth/  authz/         Google identity; five roles, action catalog, market scope
  audit/  exceptions/  jobs/  policy/       audit events, one-incident exceptions, fenced queue, decision register + typed selections + policy lookup
  domain/               markets, catalog, customers, orders, allocation, samples, standing, readiness, holds, payment, intake, notices, timeline, search, commandcenter, employees
  integrations/         registry (five facts per provider), gates (§49), stripe/adapter (account-bound), boundaries (OptimoRoute/Gmail/Slack/Google Address/QBO)
  errors.ts  env.ts  format.ts  actions/helpers.ts   business vs technical errors; environment classification; presentation helpers; safe action plumbing
drizzle/                SQL migrations (0000 baseline, 0001, 0002_hardening with preflight)
scripts/                demo launcher (+ hosts helper), migrate, bootstrap, seed-dev, db-preflight
src/lib/demo/           demo seed + demo Owner lookup (development only); src/lib/db/demo.ts embedded PGlite
tests/scenarios/        PGlite scenario tests (AT*, REV-*, UX/AC presentation)
tests/postgres/         real-Postgres races + upgrade of the populated baseline (tests/support/fixtures/baseline-884684c.sql)
tests/ui/               Playwright role journeys (journeys.mjs) — need `npm run demo`
docs/                   HARDENING_REPORT, TRACEABILITY, IMPLEMENTATION_STATUS, OPERATOR_GUIDE, DEPLOYMENT, COMMISSIONING, ACTIVATION_CHECKLIST, STAFF_SESSION_SCRIPT
.github/workflows/      ci.yml
```

## Non-negotiables honoured in code (brief, Implementation non-negotiables)

Google authenticates, internal authorizes (five roles; disable stops existing sessions on the next request) ·
each licensed location is separate (no pooling by parent/AP) · orders are captured during holds and readiness
gaps · no invented D01/minimum-basis/pricing/override/overdue/dispute policy — every such branch reads the
decision register and stays inactive while unselected · internal owns demand, allocation, eligibility, custody
and exception state · one intended effect per business event (idempotent submissions, jobs and webhooks) ·
audit from day one with prior/current/actor/reason · no simulated provider outcomes (a pending Stripe
association stays pending until Stripe confirms) · customer portal deferred · no Odoo/manufacturing work.
