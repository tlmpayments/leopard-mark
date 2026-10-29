# Leopard Mark Ops — Familiar Ventures self-distribution operating system

Internal operating layer for Familiar Ventures, LLC (dba The Leopard Mark Beverage Group) built from the
**Exhaustive Claude/Fable Master Implementation Prompt** (Final audited revision 5, September 17, 2026).

This repository revision delivers **Phase 1 (Foundation) deep** on a **whole-system skeleton**, hardened
per the *Phase 1 hardening, operating workflows, and product refinement* prompt (branch `hardening/phase1`;
findings REV-01–18, product items UX-01–12, acceptance AC01–38 — see `docs/HARDENING_REPORT.md` and
`docs/TRACEABILITY.md`), plus the **shipments module** of October 28, 2026 (owner decisions in
`docs/SHIPMENTS_SPEC.md`: shipments, lots, documents, invoices, kegs, stock counts, company settings and the
in-app workbook import):

| Phase | Status in this revision |
|---|---|
| 1. Foundation — employee access/roles/markets, customers/contacts/license readiness, catalog/pricing, orders/allocation/samples/standing, Admin command center/exceptions/audit, decision register, provider associations | **Built, tested, deployable** |
| 2. Delivery | **Shipments built** (October 28 revision): origins with codes, lots and batches, shipment records D/T/S with numbering at confirmation, BOL / picking ticket / pull sheet / pickup pack PDFs, batch print, transfers with receiving confirmation, stock counts. Route planning and a driver execution view beyond assigned stops: not built |
| 3. Invoicing & collections | **Invoices built**: INV and NC series, draft at confirmation, issued at delivery, deposits and distributor wording, mark paid, void. Sending and collection stay manual (owner question 7.5 open); Stripe adapter for customer association only; no debits or collections |
| 4. Kegs & service | **Keg balances built** (per account by size, opening balances, adjustments, MicroStar outbound report). Line cleaning / service: skeleton records only (10.7 later) |
| 5. Customer self-service | **Deferred [F]** by the brief |
| 6. Management intelligence | Not built beyond the MicroStar report; D31 definitions unselected |

Read **docs/IMPLEMENTATION_STATUS.md** for the honest split between implemented support, approved active
behaviour, unresolved policy, unproven provider capability, incomplete acceptance and deferred scope.

## Shipments module (October 28 revision)

The Sheet-backed BOL maker is replaced by a **shipment record**: one record carries the number, the dates, the
account, the lots, and drives the documents, the invoice, the ledger movement and the keg balance. Origins
(breweries, warehouses, cold storage) carry a three-letter origin code and, for breweries, a two-digit lot
facility code; lots are created from a one-page packaging report and every beer line on a shipment names one.
A draft becomes a numbered shipment (`ORIGIN-TYPE-YYMMDD-SEQ`) at confirmation, when stock is allocated,
prices are captured, the BOL and picking ticket are stored as snapshot plus PDF, and the invoice draft opens.
Delivery on the actual date writes the stock movements, posts kegs out and empties collected to the account's
keg balance, and issues the invoice dated that day. Voids keep the number as a gap; regenerated documents carry
a revision mark; transfers are received at the destination with counts. Company settings (shipper block, office
address, footers, NMFC), document counters and POS items live in one Owner-editable place, and the TLM Master
File workbook is imported in-app with a dry run that the Owner approves. The rules are in
`docs/SHIPMENTS_SPEC.md`, keyed to the owner's question numbers; what is built is mapped in
`docs/TRACEABILITY.md` section 5 and `docs/IMPLEMENTATION_STATUS.md`.

## Stack (ordinary technical means, brief §58)

Next.js 16 (App Router, server components + server actions, Turbopack) · TypeScript · Tailwind CSS 4 ·
PostgreSQL (Neon in production) via Drizzle ORM with SQL migrations · a Postgres-backed job queue drained by
Vercel Cron · employee sign-in with company email + PIN (scrypt-hashed, lockout, forced change of temporary
PINs; signed session cookie via jose) with Google OpenID Connect as an optional second method (arctic) ·
Stripe SDK · `@react-pdf/renderer` for server-side PDF documents (BOL, picking ticket, pull sheet, pickup
pack, invoice) · `exceljs` to read the uploaded workbook export · Vitest with PGlite (real Postgres SQL
in-process) for business-scenario tests, a disposable real Postgres for concurrency and upgrade tests,
Playwright (pinned) for role browser journeys.

Dependency notes: the two libraries added for the shipments module run on the server only. PDFs are rendered
inside the confirming or issuing transaction and stored as `bytea` next to their JSON snapshot, so a document
is served from storage and re-rendered from its snapshot only when the bytes are missing. The workbook upload
goes through a server action; `next.config.ts` raises `experimental.serverActions.bodySizeLimit` to `8mb` for
it. Real workbook exports never enter the repository (`*.xlsx` is git-ignored; the test that reads one is gated
by `TLM_WORKBOOK_PATH`).

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
scope still apply — or try the real sign-in form with any seeded email and the demo PIN `135790`. A prominent **DEVELOPMENT DEMO MODE** banner is always shown.
The demo warehouses carry no origin codes: give one to an origin in the origins editor under *Markets & stock*
(for example `EBB` with lot facility code `01`) before confirming a shipment, which is what browser journey 12 does.

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
npm run dev                      # http://localhost:3000 → email + PIN sign-in (demo PIN 135790 for seeded people) plus the dev fixture list
```

Production first run — in the browser: deploy, then open `https://<domain>/setup`, enter the setup token
(the deployment's `CRON_SECRET`), apply migrations, provision the first Owner with a temporary PIN, sign in.
Terminal equivalents:

```bash
OWNER_EMAIL=owner@company.com OWNER_NAME="Owner" OWNER_PIN=48215736 npm run bootstrap   # migrate + register + gates + first Owner with a temporary PIN
PIN_EMAIL=owner@company.com PIN=48215736 npm run set-pin                                 # break-glass: temporary PIN for anyone (must change at next sign-in)
```

## Tests and checks

```bash
npm run check                                     # typecheck + lint + the PGlite scenario suite + production build
npm test                                          # 137 passed, 12 skipped (16 test files passed, the 3 real-Postgres files skipped; the skips are that suite and the real-workbook import, see below)
TEST_DATABASE_URL=postgres://… npm run test:pg    # 11 real-Postgres tests: races (AC07/08/10/11/12/22/23/28), setup page, populated-database upgrade (AC37)
TLM_WORKBOOK_PATH=/path/to/export.xlsx npm test   # also runs the import against a real workbook export (owner's machine only; the file never enters the repo)
npm run demo && npm run test:ui                   # 12 role browser journeys with screenshots + timings (tests/ui/README.md)
npm run test:ui:golive                            # go-live path on a production build against an empty Postgres (/setup → Owner → sign-in)
DATABASE_URL=postgres://… npm run db:preflight    # read-only check of a populated database before applying migration 0002
```
`test:pg` creates and drops throwaway `fv_test_*` databases — never point it at a shared server. CI
(`.github/workflows/ci.yml`) runs all of the above with a Postgres service container and no secrets. The
PGlite suite takes a couple of minutes because the document tests render real PDFs.

## Scripts

| Script | What it does |
|---|---|
| `npm run demo` / `npm run preview:local` | zero-setup DEVELOPMENT DEMO MODE (embedded PGlite, seeded data, auto Owner); prints the URL |
| `npm run demo:hosts` | one-time sudo helper mapping `fv-ops.test` → 127.0.0.1 so the demo serves `http://fv-ops.test` |
| `npm run demo:reset` | delete `.fv-demo/` (embedded demo database) |
| `npm run check` | typecheck + lint + tests + production build |
| `npm test` | 137 business-scenario tests on PGlite (AT01–AT13, AT61/AT62, AT79/AT80, REV-01–18 regressions, environment guards, PIN sign-in, presentation/timezone/error masking, shipments acceptance 1–9, document rendering and routes, workbook import); 12 tests are skipped without `TEST_DATABASE_URL` / `TLM_WORKBOOK_PATH` |
| `npm run test:pg` | real-Postgres concurrency, setup-page and upgrade tests (`TEST_DATABASE_URL`) |
| `npm run test:ui` | 12 role browser journeys against the running demo (`SHOTS_DIR` for screenshots) |
| `npm run test:ui:golive` | `/setup` → migrations → first Owner → sign-in on a production build (`BASE_URL`, `SETUP_TOKEN`) |
| `npm run db:generate` | generate a new SQL migration after editing `src/lib/db/schema/*` |
| `npm run db:migrate` | apply migrations to `DATABASE_URL` (forward-only; 0002 runs a preflight and aborts with a diagnostic on invalid data) |
| `npm run db:preflight` | read-only: list rows a populated database must repair before 0002 |
| `npm run bootstrap` | production-safe: migrate, seed decision register (all unselected) and gates (all unproven), provision first Owner with a temporary PIN (`OWNER_PIN`, or a random one printed once) |
| `npm run set-pin` | break-glass temporary PIN for one person (`PIN_EMAIL`, `PIN`); ends their sessions; they choose their own at next sign-in |
| `npm run seed:dev` | development demo data; refuses on any deployment, `FV_ENV=production` or an explicit non-development `FV_ENV` |

## Repository map

```
src/app/                 routes (mobile-first pages + server actions)
  locations/  orders/  samples/            Sales & Admin operational flows
  shipments/                                list, new draft, shipment page (lines, confirm, stage, out, deliver, void, regenerate, receive);
                                            [id]/documents/[kind] serves the BOL, picking ticket or pickup pack PDF; print/ batch-prints an origin and date
  lots/  batches/                           packaging report (lot code computed), lot page with quantities, brew batches
  invoices/                                 list and invoice page (issue, mark paid, void); [id]/pdf serves the invoice
  kegs/                                     keg balances per account by size; opening balances and adjustments
  admin/ (command center, exceptions, employees, markets/stock + origins editor, catalog/prices + UPCs/aliases/overrides, intake,
          counts/ stock count sheets, settings/ company settings, import/ workbook dry run and apply)
  owner/decisions/                          decision register (D/SD/T/IG) — Owner selects production policy
  setup/                                    browser first-run: apply migrations + provision the first Owner (setup token = CRON_SECRET)
  integrations/                             build-versus-activate status, capability gates, jobs, notices
  reports/microstar/                        monthly MicroStar outbound kegs per distributor or brewery (on screen + CSV)
  field/ delivery/ finance/ customer/ reports/ later-phase placeholders (clearly labelled)
  api/auth/*  api/webhooks/stripe  api/internal/jobs/run
src/lib/
  db/schema/            Drizzle schema: platform, market, customer, order, shipments (lots, shipments, documents, invoices, kegs, counts, settings, import runs), later (skeleton)
  auth/  authz/         session cookie, PIN policy/hashing (pin.ts), optional Google identity; five roles, action catalog, market scope
  audit/  exceptions/  jobs/  policy/       audit events, one-incident exceptions, fenced queue, decision register + typed selections + policy lookup
  domain/               markets (+ billing rules), catalog (+ SKU details, aliases, price overrides), customers, orders, allocation (+ shipment allocations),
                        samples, standing, readiness, holds, payment, intake, notices, timeline, search, commandcenter, employees (+ credentials),
                        origins, lots, shipments, invoices, kegs, counts, settings
  documents/            document snapshots and the PDF renderer (pdf.tsx, @react-pdf/renderer), pull-sheet shaping, route helpers
  import/               TLM Master File import: parse (exceljs), normalise with deterministic ids, diff, apply
  integrations/         registry (five facts per provider), gates (§49), stripe/adapter (account-bound), boundaries (OptimoRoute/Gmail/Slack/Google Address/QBO)
  errors.ts  env.ts  format.ts  actions/helpers.ts   business vs technical errors; environment classification; presentation helpers; safe action plumbing
drizzle/                SQL migrations (0000 baseline, 0001, 0002_hardening with preflight, 0003_pin_signin, 0004_shipments)
scripts/                demo launcher (+ hosts helper), migrate, bootstrap, set-pin, seed-dev, db-preflight
tools/import/           the Python prototype that produced the October 28 production load, and its dry-run report (reference only; the TypeScript import is the maintained one)
src/lib/demo/           demo seed + demo Owner lookup (development only); src/lib/db/demo.ts embedded PGlite
tests/scenarios/        PGlite scenario tests (AT*, REV-*, UX/AC presentation, shipments, documents, import)
tests/support/          test database, fixtures, the synthetic workbook builder (workbook.ts)
tests/postgres/         real-Postgres races, setup page, upgrade of the populated baseline (tests/support/fixtures/baseline-884684c.sql)
tests/ui/               Playwright role journeys (journeys.mjs) — need `npm run demo`
docs/                   SHIPMENTS_SPEC, HARDENING_REPORT, TRACEABILITY, IMPLEMENTATION_STATUS, OPERATOR_GUIDE, DEPLOYMENT, COMMISSIONING, ACTIVATION_CHECKLIST, STAFF_SESSION_SCRIPT
.github/workflows/      ci.yml
```

## Non-negotiables honoured in code (brief, Implementation non-negotiables)

Sign-in (company email + PIN, or Google when configured) only identifies the person; internal grants authorize
(five roles; disable stops existing sessions on the next request) ·
each licensed location is separate (no pooling by parent/AP) · orders are captured during holds and readiness
gaps · no invented D01/minimum-basis/pricing/override/overdue/dispute policy — every such branch reads the
decision register and stays inactive while unselected · internal owns demand, allocation, eligibility, custody
and exception state · one intended effect per business event (idempotent submissions, jobs and webhooks) ·
audit from day one with prior/current/actor/reason · no simulated provider outcomes (a pending Stripe
association stays pending until Stripe confirms) · customer portal deferred · no Odoo/manufacturing work.
