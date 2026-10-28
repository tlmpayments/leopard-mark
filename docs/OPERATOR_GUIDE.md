# Operator guide — supported workflows, recovery, upgrading, local testing

This guide covers what the application actually supports in this revision. Anything not listed here is
either a later phase (Delivery, Invoicing, Kegs, Service, Reporting) or an Owner decision that is still
unselected — the screens say so rather than pretending.

## Where to look
* **Home** — role-specific: Sales sees their accounts and open orders; Admin sees the work queue summary;
  Accounting sees payment setup work and notices; Driver/Service sees an honest empty state until Delivery
  is built. Every page has *Search* (scoped to your market authority) and, on a phone, a bottom bar with the
  frequent destinations plus **More** (every permitted destination and sign-out).
* **Account workspace** (`Accounts → account`) — the one place for an account: who, open orders, delivery
  readiness in plain words, what is waiting on whom, contacts and their authority, notices, license, payment,
  holds, standing arrangements, and the **Activity** timeline (filterable, "Older activity" reaches all history).
* **Command center** (Admin) — open work by category with age, owner role, next action and links to the
  affected records; "not built yet" categories are listed explicitly so an absent number is never read as a
  clean state.
* **Exceptions** — every case carries cause, owner, next action, waiting party, review point, links and
  history. Cases resolve when their **cause** goes away (a receipt fills the shortage, a hold clears, a licence
  is verified) — resolving a case by hand is for cases whose cause was handled outside the application, and
  needs a note. A resolved case can be reopened with a reason; nothing is deleted.
* **Integrations** (Admin/Accounting) — per provider, five separate facts: built · credentials present ·
  connection verified · capability demonstrated · authorized for live use. Plus job queue counts (queued,
  running, **waiting**, failed, done) and the notices queue link.

## Stock: receipts, counts, damage, discrepancies (Admin → Markets & stock)
Stock is evidence-backed, not a live WMS. Every movement needs an evidence source (who counted / which
transfer sheet). Movement kinds have fixed meaning — the form cannot be used to smuggle a sign:

| Kind | Enter | Effect |
|---|---|---|
| Opening count | units counted | adds sellable stock (first count of a SKU at a warehouse) |
| Receipt | units received | adds sellable stock; **waiting demand is filled oldest-first automatically** and the shortage cases whose cause is gone resolve |
| Physical adjustment | signed number (+found / −missing) | corrects sellable stock either way |
| Damage | number of damaged units (positive) | removes them from sellable stock; can never add |

**A count below current reservations** (e.g. 15 counted while 20 are promised) is recorded as-is — the
physical fact is never rounded up — and the table shows *"N reserved but not on hand"* next to that SKU. One
**allocation discrepancy** case opens naming the affected orders. Resolve it by: receiving/adjusting stock
(the case resolves when the deficit is gone), or by deciding which order waits — *Release reserved units* on the
order line records the displacement with a note and hands the freed units to other waiting demand
oldest-first; the displaced line waits for an explicit *Re-queue displaced demand*. Restored priority after a release is D14 (unselected),
so the application never re-orders the queue by itself.

**Transfers** between warehouses: *departure* debits the origin (units are in transit — available nowhere)
and *receipt* credits the destination, refilling waiting demand there. Cancelling an order after loading
opens a **custody reconciliation** case instead of inventing a warehouse receipt.

**Samples** consume the same availability as orders: a withdrawal is refused when only fewer unreserved
units exist. A sellable return restores stock once; a damaged return never does. The second attempt to
return or correct the same sample is refused with its current state.

## Orders: change requests, amendments, cancellation, warehouse
* Sales records a **change request**; it has no effect on demand or allocation until Admin acts (D10/D12
  unselected). Admin applies a **quantity amendment** only when no price question arises: if the line's
  submitted price no longer matches the current market price, added units are refused naming D12.
* **Cancel remaining** releases reserved, undelivered units; the freed units go to older waiting demand before
  any new order. Notices about that order that were never sent are withdrawn (kept as *superseded*).
* A stale page cannot amend a cancelled order, increase an archived product, or capture for a closed
  account — the server refuses with the current state, whatever the page showed earlier.
* **Warehouse**: *Warehouse override* on the account changes future orders only. *Reassign existing order* on an
  uncommitted order moves that order (FCFS at the destination; market, seller context and prices unchanged).
  An order with loaded units cannot be reassigned; a custody reconciliation case is opened instead.

## Payer assignment and payment setup (Accounting)
Shared AP details are a **destination for invoices**, never payer authority. On the account workspace:
1. *Assign payer authority* — pick the contact who is authorized to set up payment for this location. A
   contact shared with another location needs the shared-payer note (why this person may act for both).
2. *Request ACH setup* becomes available. It records a Stripe customer-association job and one **Payment
   setup invitation** notice for the manual sender. While Stripe is not connected the job **waits** (visible
   on Integrations) and resumes by itself after a successful connection check.
3. *Revoke current payer* when the person changes; a new assignment is a new decision with history.
Repeating the request reuses the pending invitation — it never creates a second one.

## Manual notices (Accounting/Admin → Notices)
Until D32/IG04 is selected the application never sends anything. Each business event records one notice
intent (order received, payment setup invitation) with recipient, content and version. The **Notices** queue
lists what is pending; the account/order pages show the same notices in place. A person:
* sends the message from the authorized company mailbox, then records **Sent** with *how* (e.g. "Gmail from
  ops@…") and *evidence* (message id / time); or **Failed** / **Unknown** with what happened — these open an
  owned follow-up case.
* **Re-issue** a new version when the recipient or content must change; the old version is kept as superseded.
* A notice with no recipient email opens a case for Sales to complete the contact; the outcome cannot be
  recorded as sent until a recipient exists.
Recording "sent" is staff evidence, not provider confirmation, and the page says so.

## Sign-in PINs (Owner/Admin → Employees & access; everyone → Change PIN)
* People sign in with their **company email + PIN**. A new person gets a **temporary PIN** from an Owner/Admin
  (at provisioning, or *Set PIN* under Manage) — tell it to them directly; it is never shown again. Their
  first sign-in goes straight to *Choose your PIN*; nothing else works until they have chosen one.
* **Forgot PIN**: Owner/Admin → *Reset PIN* (a reason is recorded; every session of that person ends). An
  Admin can reset PINs only for non-Owners inside its markets; an Owner for anyone; nobody their own.
* **Lockout**: five wrong attempts lock the PIN for 15 minutes (doubling on further failures); the person
  row shows *PIN locked until …*. A reset clears it.
* **Own PIN**: *Change PIN* in the sidebar / More menu; needs the current PIN; other sessions are signed out.
* Only an Owner locked out with no other Owner needs the command line: `PIN_EMAIL=… PIN=… npm run set-pin`
  against the production `DATABASE_URL` from a trusted machine.
* What is and is not stored: only an scrypt hash of the PIN and the failed-attempt counter. PINs never appear
  in audit notes, logs, URLs or flash messages. Sign-ins and refusals are audited (`auth.sign_in`,
  `auth.refused`), as are sets/resets/changes (`credential.*`).

## Employees: disable, offboard, reuse an email (Owner/Admin → Employees & access)
* **Disable** stops all business use on the person's very next request (no re-login needed); the identity
  and grants stay for history. Also suspend the Google Workspace account separately if they had one.
* **Offboard** (disables first if still enabled) retires the current identity (email and any Google subject), ends the sign-in PIN, revokes every grant
  with a reason, and frees the email. It is irreversible in the sense that the old employee stays retired —
  history is never rewritten.
* **Provision a new person** with that email afterwards: a new employee record with only the grants you
  assign now; nothing is inherited. If the same human returns, provision them again the same way.
* **Rename** (company address change) keeps the same employee, PIN and any Google subject; the old identity
  row is ended and any session bound to it stops.
* Authority rules are enforced in the service, not the page: Owner grants are Owner-only, nobody can change
  their own grants, and a market-scoped Admin manages only their market.

## Decisions (Owner → Decisions)
Each D/SD/T/IG record shows what remains open, what the application would do with a selection (typed fields
from the register — no JSON), and the **effective policy by market** now. Selections are immutable rows with
scope (all markets or chosen markets) and an effective date; a market-specific selection overrides the
all-markets one for that market only; a future-dated one leaves the current policy in force until then.
Withdraw a single selection with a reason; the previous effective selection applies again. Decisions marked
*execution not implemented* are recorded faithfully but no branch runs them — the badge says so.

## Provider failure and reconnection
| Symptom | Meaning | Action |
|---|---|---|
| Stripe shows credentials present / connection **untested** | key set, no check recorded | Integrations → *Check connectivity (binds account + credential)*; the verified account id and key fingerprint are recorded |
| connection **failed** / **stale** | last check failed, or the key changed since the last success | fix the key, check again; references bound to another account or mode are never reused |
| jobs **waiting** with a reason | provider not connected | nothing to redo: they resume after a successful check (or *Run due jobs now*) |
| provider reference stays `pending` | job not yet run | *Run due jobs now*; read the evidence on the account page |
| job **failed** after bounded attempts | terminal | an owned `provider_handoff_failed` case names the cause; fix it and request again — the failed job never blocks a fresh request |
| Webhook returns 400 | signature or `STRIPE_WEBHOOK_SECRET` problem | fix the secret; Stripe retries; duplicates are recorded once |
| "Email or PIN not recognised" | unknown email, no PIN set, or wrong PIN (deliberately the same message) | check the person row: *no PIN* → set one; otherwise reset the PIN; refusals are audited with the real cause |
| "Too many attempts" | PIN locked after five failures | wait, or reset the PIN |
| Google sign-in refused with a reason (only when Google is configured) | not provisioned / disabled / retired address | provision or enable; refusals are audited |
| Nobody can sign in after a secret rotation | `SESSION_SECRET` changed | expected: everyone signs in again |
| Configuration banner "needs attention" | an unknown `FV_ENV` or contradictory deployment flags | fix the environment variables; the process refuses to guess |

Unknown is neither success nor failure: a provider reference in `unknown`/`pending` stays owned and visible;
the application never marks it established from silence.

## Jobs and the cron runner
`GET /api/internal/jobs/run` (header `Authorization: Bearer <CRON_SECRET>`) drains due jobs; Vercel cron calls it every five
minutes. Each run **claims** jobs with a token and a lease; a worker that dies loses its claim after the lease
and a late completion from the old worker is ignored. Attempts are bounded; the last failure opens an owned
case. Jobs whose provider is unavailable park in **waiting** and are resumed by a successful connection
check. Standing-order generation runs on the same tick and stays inert while D13 is unselected.

## Upgrading a populated database (this revision adds migration `0002_hardening`)
1. Take a Neon branch or point-in-time snapshot of the database first.
2. `DATABASE_URL=… npm run db:preflight` — read-only; lists any row that would violate the new invariants
   (duplicate current identities, duplicate current license/payment rows, an intake converted twice, negative
   quantities, inconsistent order-line quantities). A clean run prints *Preflight clean*.
3. Repair each listed row deliberately from evidence — end the duplicate row rather than deleting it (set
   `current=false` with a note in the audit), correct a count with a stock adjustment, and so on. Never delete
   history.
4. `DATABASE_URL=… npm run db:migrate`. The migration re-runs the same checks inside the transaction and
   **aborts with a diagnostic** naming the check if anything still violates it — nothing is changed in that
   case. Re-running after repair is safe (migrations are recorded once).
5. Start the new revision. Established Stripe references recorded before this revision carry no account id;
   they are marked `stale` and are re-verified by the first successful connection check for the same account.
Rollback is by restoring the snapshot, never by deleting rows.

## First Owner and provisioning
`OWNER_EMAIL=… OWNER_PIN=… npm run bootstrap` provisions the Owner with a temporary PIN (chosen at first
sign-in). The Owner then provisions Admin/Accounting/Sales/Driver people with market scope and a temporary PIN each.

## Local development and tests
```bash
npm run demo                 # zero-setup demo: embedded database, fictional data, auto demo Owner (Switch user, or email + demo PIN 135790)
npm run demo:reset           # wipe .fv-demo/ so the next start reseeds
npm test                     # 94 scenario tests on PGlite (real Postgres SQL in-process; no server)
TEST_DATABASE_URL=postgres://… npm run test:pg   # 10 real-Postgres tests: races + populated-database upgrade (disposable database!)
npm run test:ui              # 10 role browser journeys against the running demo (screenshots + timings)
npm run check                # typecheck + lint + tests + production build
npm run db:migrate && npm run seed:dev && DEV_AUTH_BYPASS=true npm run dev   # real local Postgres with fixture sign-in
```
`test:pg` creates and drops databases named `fv_test_*` on the given server — point it at a throwaway
server, never at a shared one. The dev seed refuses any deployment, `FV_ENV=production`, or an explicit
non-development `FV_ENV`; the demo launcher never reads `DATABASE_URL`.

## Data and retention
Nothing in the application deletes business records: audit, voided/superseded rows, resolved exceptions,
withdrawn selections, retired identities and revoked grants are retained. Retention-policy changes are D34
(Owner) and are not implemented as deletion.
