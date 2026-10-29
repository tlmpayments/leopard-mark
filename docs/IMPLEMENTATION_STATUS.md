# Implementation status — revision 2 (Phase 1 deep, hardened; whole-system skeleton)

Reported per the brief §51/§58 and the hardening prompt §8: **implemented support**, **active approved
behaviour**, **unresolved policy**, **unproven provider capability**, **incomplete acceptance** and
**deferred/future scope** are listed separately. Nothing below claims a provider integration complete
because a request was sent, and no production data is populated with guessed policy or fictitious history.
Revision: branch `hardening/phase1` on top of baseline `884684c`; migrations `0002_hardening` and `0003_pin_signin` added,
then `0004_shipments` for the shipments module of October 28, 2026 (owner decisions in `SHIPMENTS_SPEC.md`).
The per-finding reconciliation is in `HARDENING_REPORT.md`; the ID-level map is in `TRACEABILITY.md`
(section 5 for the shipments build).

## 1. Implemented support (built and tested in this repository)

### Employee access (Phase 1)
* Sign-in with **company email + PIN** (migration `0003_pin_signin`): scrypt-hashed PINs with a 6–12 digit
  policy, temporary PINs set by an Owner/Admin that must be changed at first sign-in, own-PIN change with
  the current PIN, lockout after five failures (15 min, doubling, stored in the database), generic refusals,
  sessions bound to the credential (a reset/change ends them), audit of sign-ins/refusals/resets without the
  PIN value, break-glass `npm run set-pin`. Google OIDC sign-in (PKCE) remains available as an **optional**
  second method when its client is configured. Internal `employee` + `employee_identity` + `role_grant`
  supply authority either way. No auto-provisioning; provisioning by company email; email rename keeps the
  employee and ends the old identity row.
* Exactly five roles with an action catalog (`src/lib/authz/actions.ts`) and market scope on grants. Grant
  authority is enforced **in the service**: Owner grants are Owner-only, nobody edits their own grants, a
  market-scoped Admin manages only inside its markets, provisioning applies the same rule per grant (REV-01).
* Effective disablement stops existing-session business use on the next request; offboarding retires the
  identity (email + subject) and revokes grants so the address can be provisioned to a **new** person with
  intentionally assigned grants and nothing inherited (REV-17). Sessions bound to an ended identity stop.
* Fixture sign-in and the embedded demo are **local-only modes**: refused on any deployment regardless of
  flags; unknown `FV_ENV` is a configuration error; fixture sessions are re-validated per request (REV-02).

### Customers / contacts / license / readiness
* Sales creates a location with minimal entry, contact reuse, billing-same-as-delivery, delivery instructions
  and receiving restrictions; similar names warn only (AT01/AT02). Account workspace (UX-01) shows who /
  orders / readiness / waiting-on / contacts & authority / notices / license / payment / holds / standing /
  later-phase truthful "none" / activity timeline (UX-05, filtered, paginated by cursor).
* Shared AP contact is one person record with per-location authority flags; **payer authority is an explicit
  assignment** with history and a shared-payer note; every setup path (request, hosted session) requires it
  (REV-08). Revocation clears it deliberately.
* License verification decisions with history; `verified` requires number or evidence; `not_applicable` is
  derived from the effective D02 selection for that market, never from a label (REV-07); one current row per
  location (constraint).
* Billing-email change requests with Admin approval, decided once (conditional update); past recipients never
  rewritten (AT74 request/approve path).
* Delivery-readiness evaluation in plain language (`kind`, `plain`, `summary`) — never a block on capture.
* Holds with cause; audited Admin override names exactly one hold, optionally one order, never expires by
  itself (D03). Warehouse override requires authority over both markets (REV-11).
* Lifecycle: inactive (reversible), closed (stops new demand, opens a run-off case; nothing deleted).

### Catalog / pricing / markets
* Markets scope catalog, prices, warehouses, order numbering. Global defaults fixed in code: Net-30, $35 keg
  deposit, $90 minimum, no Sales price override. SKUs with package kinds; archiving keeps history and blocks
  new orders. Market prices with effective dating; orders retain price-at-submission. Products page for
  every role that may see the catalog (drivers excluded from prices).

### Orders / allocation / samples / standing
* Sales flow account → SKU → qty → optional date/notes → submit; searchable account picker distinguishing
  same-name accounts by address; values survive validation errors; live totals; server-minted submission key
  — same key + same payload replays, same key + changed payload is refused naming the original, a new key is
  a new order (AC12). Mixed orders; 24/7 capture; capture under holds and readiness gaps (AT06).
* **Coherent allocation** (REV-03/05/09): one position lock ordering for reserve / release / refill /
  sample / transfer / reassignment; availability = on hand − reserved with an explicit **deficit**; freed
  units (cancellation, quantity reduction, receipt, transfer receipt) go to older waiting demand before any
  new reservation; samples reserve like orders; movement kinds have fixed direction (damage never adds);
  a physical count below reservations is recorded as-is and opens **one owned discrepancy** naming the orders.
* $90 minimum evaluated with candidate bases; verdict `meets` / `below` / `depends_on_unselected_D11`;
  below-minimum captured and flagged (AT07); reassessed on amendment.
* Cancellation of undelivered demand releases reserved units only, refills waiting demand, withdraws unsent
  notices about the order, and opens a custody reconciliation case for loaded units. Every order mutation
  locks and validates state inside the transaction; stale pages get a refusal naming the current state
  (REV-10; AC11 on real Postgres).
* Sales change requests (D10) are recorded without effect; Admin amendment applies only when no price
  question arises (D12) and adjusts the existing reservation in place (queue position kept).
* Repeat-order preview with price/archival cues; archived SKUs never resurrected (AT08).
* Samples consume the same allocation once; transitions are claimed atomically — a second return or a racing
  correction is refused (REV-04; AC07/AC08 on real Postgres).
* Standing arrangements captured as internal demand; generation only under a **valid, executable** D13
  selection; partial generation (archived line) is reported as `generated_partial` with the skipped lines and
  an owned review case; incomplete policy / held arrangements / failures open owned cases instead of
  defaulting (REV-16). Never a Stripe Subscription.
* Warehouse: *override* (future orders) versus *reassign existing order* (uncommitted order, FCFS at the
  destination, market/seller/prices retained); loaded work refused with a custody case (§4.6). Transfers as
  departure / receipt with in-transit stock available nowhere (AT13).
* Email intake: source message preserved; conversion is one transaction with a unique link to the source
  order; a converted intake cannot regress or convert twice (REV-15; AC23 on real Postgres); rejection is an
  explicit action.

### Control and communication
* Audit events with actor/prior/current/reason on every material change; voided/superseded/withdrawn/retired
  records kept. Activity timeline composes them per account/order with permission-filtered detail.
* Exceptions: dedupe keys, causal resolution (`resolveByDedupeKeys`) when the cause goes, targeted follow-through
  once per logical effect (stock receipt, cancellation, license decision, hold change, policy change), reopen
  with reason, market scoping, links; command center as an actionable work queue (UX-02) with an explicit
  "not built" list.
* **Manual notices as a workflow** (REV-18/UX-08): one intent per business event (dedupe of pending intents),
  subject link, recipient/content/version, outcome recorded by a person with how + evidence, failure and
  missing-recipient cases, re-issue as a new version, withdrawal when the cause is cancelled. No sender exists.
* Decision register: all 66 D/SD/T/IG records seeded unselected; Owner records production selections through
  **typed fields** from the register (UX-07) with market scope and effective date; selections are immutable
  rows resolved by precedence (market-specific > all; later effective; later recorded); withdrawal marks one
  row; effective policy shown per market; decisions flagged *execution implemented* only for D01, D02, D09,
  D11, D13 (REV-06). Test selections never apply under `FV_ENV=production`.
* Job queue: claim tokens with lease and fencing (a late old worker cannot complete), bounded attempts,
  terminal failure → owned case, **waiting** state for unavailable providers with one-shot resumption after
  a verified connection (REV-14, §4.7; AC22 on real Postgres). Vercel cron runner; manual run.
* Provider registry with five separate facts (built / credentials / connection / capability / activation);
  connection checks record the verified account id and a credential fingerprint; references bound to
  (provider, mode, account) (REV-12/13).
* Search across trade name, address, contact, order number, SKU within market authority and role (drivers:
  products only). Navigation with frequent items + full menu, skip link, visible focus, mobile bottom bar.
* Dates in the market timezone with zone labels; date-only facts unshifted; technical errors masked with a
  logged reference (UX-10).

### Shipments, lots, documents, invoices, kegs, counts, settings, import (Oct 28 revision)
Built from the owner's answers of October 28, 2026 (`SHIPMENTS_SPEC.md`, question numbers in brackets) and
tested in `tests/scenarios/shipments.test.ts`, `documents.test.ts`, `import.test.ts` and browser journey 12.
* **Origins** (2.2, 2.3, 2.11): the `warehouse` record carries a unique three-letter origin code, a two-digit
  lot facility code for breweries, a kind (brewery, warehouse, cold storage), structured address, hours, dock /
  liftgate / appointment flags and a shipping contact; the market is optional (Prost, Real Ale). Edited by
  Admin in the origins editor; the confirmed code list lives in `src/lib/domain/origins/service.ts`.
* **Accounts** (2.4 to 2.6, 2.10, 3.9, 3.10, 7.4): kind, served-by distributor (a direct shipment to a served
  account needs an override reason), legacy ACC- id, fulfilment (delivery or will-call), deposit mode and
  per-keg override, terms override, pallet rule, receiving requirements, per-account price overrides with a
  reason. Market billing rules: terms days, retail and distributor keg deposit, COD, region list.
* **Catalog** (3.1 to 3.8): SKU details for documents (UPC case / retail / unit, weight, pallet fraction, recipe
  variant, shelf life), legacy and dotted code aliases that resolve to the active SKU and are never selectable,
  archived SKUs refused on shipment lines, POS items (no lot, no price, no ledger effect).
* **Lots and batches** (4.1 to 4.4, 4.6 to 4.10): brew batches with status, reason and date; the one-page
  packaging report computes the lot code (facility 2 digits + brand 3 letters + yymmdd + run) and stores
  quantities per SKU; lots with unknown quantities are offered in the picker flagged "quantities unconfirmed",
  the line must carry a reason, and one `lot_quantities_unconfirmed` case opens per lot until the host's
  figures are confirmed; dotted legacy lots never appear in pickers; lot age is internal only.
* **Shipments** (5.1 to 5.13): types D / T / S, will-call pickup as D with the pickup flag; draft, lines,
  confirmation that assigns `ORIGIN-TYPE-YYMMDD-SEQ` from a per-origin, per-scheduled-date counter inside the
  transaction, allocates stock (availability for orders subtracts active shipment allocations), captures prices
  and stores the BOL and picking ticket; optional staged and out; delivery on the actual date set by the office
  writes `shipment_out` (transfers: `transfer_out` and in transit at the destination), posts the keg event and
  issues the invoice; void keeps the number as a gap, releases allocations and voids the draft invoice;
  logistics edits after confirmation never renumber and regenerate the documents with a revision mark; transfers
  are received at the destination with counts and a `receiving_discrepancy` case when they differ; the day
  pull sheet aggregates an origin's confirmed shipments by SKU and lot; orders can be linked at creation; legacy
  BOL documents are imported as delivered history that never touches the ledger.
* **Documents** (6.1 to 6.10): server-side PDFs with `@react-pdf/renderer` from JSON snapshots stored at
  confirmation and issue (`shipment_document`, PDF as `bytea`); distributor / freight BOL (PO, appointment,
  carrier, seal and trailer, pallet count and build, case UPCs, lot per line, weights, freight class, NMFC once
  approved, fixed keep-cold line, distributor footer), retail delivery receipt (window, receiving instructions,
  lot per line, empty-keg pick-up by size, signatures, retail footer), picking ticket, day pull sheet, invoice,
  pickup pack (BOL plus invoice in one PDF), batch print per origin and date; VOID and `R<n>` marks; shipper
  block and footers from company settings; no arrow characters printed. Documents stored without PDF bytes are
  rendered from their snapshot when opened.
* **Invoices** (7.1 to 7.4, 7.6 to 7.10): INV and NC series from `doc_counter` (next INV26376 and NC26002); a
  draft per shipment at confirmation, issued at delivery dated the actual date; pickups issued at confirmation
  and re-dated at delivery without renumbering; "add to open invoice" for the same account within the week;
  samples never share a charged invoice; terms from the account override else the market rule; retail keg
  deposit line at the market rate unless floating or none; distributor invoices with no deposit, the wording
  "FOB brewery or designated warehouse" and a MicroStar information line; mark paid (manual status); void keeps
  the number as a gap; legacy Sales rows imported read-only with the Sheet's status text.
* **Kegs** (8.4 to 8.7): balance per account by size, counts only; deliveries and empties collected post
  automatically from the shipment; opening balances, adjustments and stand-alone pickups by hand with a note;
  MicroStar monthly outbound report per distributor or per brewery, on screen and CSV.
* **Stock counts** (8.1, 8.2, 1.6): count sheets per origin with lot codes; applying one sets on hand to the
  counted total with `count` movements and keeps a zero-delta movement per lot line for later per-lot balances.
* **Company settings** (6.1, 6.2, 6.6, 4.7, 7.9): one Owner-editable row for the shipper block, office address,
  AR email, footers, fixed lines, NMFC and status, marking convention, remit-to; counters and POS items seeded
  at `/setup`.
* **Import** (9.x, 10.x): in-app upload of the TLM Master File export, dry run with a diff per entity, Owner
  approval, apply in one transaction with deterministic ids (idempotent, never deletes, every row audited under
  the run id); PINs, emails and inventory figures are never imported; no email is sent by any flow.
* **Access** (9.3 to 9.6): `shipment.*`, `lot.*`, `invoice.*`, `keg.*`, `count.record`, `settings.manage`
  (Owner only), `import.dry_run`, `import.apply` (Owner only), `report.export` in the action catalog; Admin
  confirms, delivers, voids and receives; Accounting issues and voids invoices; Sales views in its market;
  Driver / Service sees only assigned stops; every confirmation, delivery, void, count and import writes audit.
* Migration `0004_shipments` (additive, no preflight) and `experimental.serverActions.bodySizeLimit = 8mb` for
  the upload; dependencies `@react-pdf/renderer` and `exceljs`.

### Development demo mode (local inspection only)
* `npm run demo`: embedded PGlite under `.fv-demo/` with the production migrations, seeded through the real
  domain services, auto-signed in as the demo Owner, DEVELOPMENT DEMO MODE banner, friendly local URL.
  Impossible on a deployment (guards tested). Providers are never mocked as successful. The demo warehouses
  carry no origin codes; journey 12 sets East Brother to `EBB` / lot facility `01` through the origins editor.

### Provider adapters (build-versus-activate)
| Provider | Built | Credentials | Connection verified | Capability demonstrated | Authorized live | Production-ready |
|---|---|---|---|---|---|---|
| Google Identity (optional) | Yes | No — not needed: sign-in is email + PIN | No | `ACCESS_*` gates apply to email + PIN sign-in too; need real staff | IG03 unselected | not required for live use |
| Stripe | Yes (customer association, hosted setup session, webhook receipt; account/mode-bound references; waiting jobs) | No | No | No — `STRIPE_CUSTOMER_ASSOCIATION`, `STRIPE_HOSTED_SETUP` unproven | SD01–SD10, D01, D05, D06 unselected | **No** |
| OptimoRoute | Boundary only | No | not applicable | No (`OR_*`) | IG01, D19–D21 unselected | **No** — phase 2 |
| Gmail | Boundary only (manual process supported in-app) | No | not applicable | No (`NOTICE_SINGLE_SENDER`) | D32/IG04 unselected | **No** |
| Google Address | Boundary only | No | not applicable | No (`GOOGLE_CONTENT_RIGHTS`) | IG05 unselected | **No** |
| Slack | Boundary only | No | not applicable | No (`SLACK_NO_MUTATION`) | IG07/D27/D32 unselected | **No** |
| QuickBooks Online | Not implemented | No | not applicable | No (`QBO_MODEL`) | IG06/D25/D29/D30/D33 unselected | **No** — phase 3 |

A boundary-only provider cannot become "connected" through an environment variable (REV-12). For every "No"
the remaining action is in `COMMISSIONING.md`, `ACTIVATION_CHECKLIST.md` and `DEPLOYMENT.md` §6–8.

## 2. Active approved behaviour (confirmed rules operating automatically)

Net-30 basis stored as a global · $35 per keg deposit per order line · $90 threshold check · FCFS allocation
at submission · retained unmet demand refilled oldest-first on every stock release/receipt · order capture
under holds · billing-email approval · first-delivery allowance shown as satisfied when no accepted delivery
exists · license verification required before applicable first delivery (all markets until D02 selects
otherwise) · closure keeps all obligations · shortage/minimum/discrepancy/notice cases resolve when their
cause goes · unsent notices withdrawn when their order is cancelled · audit on every material change.

Shipments build (owner decisions of October 28, operating automatically): shipment number assigned once at
confirmation from the origin + scheduled-date counter and never changed · lot required on every beer line ·
stock allocated at confirmation and consumed at delivery on the actual date · invoice draft at confirmation,
issued at delivery (pickups at confirmation, re-dated at delivery) · terms from the account override else the
market rule (Net 30) · retail keg deposit at the market rate ($35), none for distributors, FOB wording and
MicroStar line on distributor invoices · keg balance posted from every delivered shipment · void keeps every
number as a gap · documents regenerated with a revision mark after any edit.

## 3. Unresolved policy (kept unselected; affected branches inactive)

All 35 D, 10 SD, 10 T and 11 IG records are unselected. Branches this revision actively guards:

| Decision | How the code behaves while unselected |
|---|---|
| D01 | Second-delivery readiness reported as `unresolved`, never satisfied from a saved bank/initiated debit/paid invoice |
| D02 | Verification required in every market; `not_applicable` cannot be recorded; no refresh schedule |
| D03 | Overrides never expire automatically; each names one hold (and optionally one order) |
| D07 | Closure opens a review case; no automatic disposition |
| D09 | No automatic abnormal flag; manual flag available |
| D10 | Sales records change requests; Admin cancels undelivered demand (existing operational control) |
| D11 | Minimum verdict may be `depends_on_unselected_D11`; below-minimum demand is flagged, not rejected. **Combined-visit and credit cases remain unsupported** even after a D11 selection (`combine_same_visit`, `below_minimum_pending` stay inactive and are named as such in the selection result) |
| D12 | Admin amendment refused when added units would need a price decision |
| D13 | Standing occurrences are not generated; an incomplete selection is owned, never defaulted |
| D14 | No reservation expiry; Admin release keeps demand unmet with a displacement note; no restored priority |
| D16 | Stock recorded from person-confirmed evidence; no cadence/tolerance |
| D27 | Severity/review points are free text set by a person; no SLA |
| D32 / IG04 | Notices recorded for the manual process; no automated send |
| D33 | Seller context per market must be Owner-confirmed |

Owner question list of the shipments build (October 28): items still blank from the owner, left as plain
fields or flagged exceptions rather than guessed.

| Question | How the code behaves while open |
|---|---|
| 4.5 packaging that spans two dates | The packaging report takes one packaging date and one run character; a run that spans two dates is entered under the date the host reports, with the fact in the notes. No two-date rule exists in the lot code or the picker |
| 7.5 sending and collection of invoices | Invoices are issued, numbered and rendered; nothing emails them and nothing records a payment with a provider. *Mark paid* is a manual status with a note. The AR sender address is a setting that prints only; no Stripe or QuickBooks path exists |
| 2.3 Envision / SC Warehouses | Both origins are imported **inactive** with no origin code and no lot facility code; they cannot be chosen as an origin or confirmed until the Owner decides and an Admin activates them with a code. Radford is active as the MA warehouse |
| 6.4 exact deposit / CRV wording | The distributor footer and the retail footer are settings seeded with placeholder wording and marked as such; they print as set until the owner's example arrives |
| 6.6 NMFC | Stored as *proposed*; printed on distributor documents only once the Owner sets the status to *approved* |
| 4.8 day counts to supply | `shelf_life_days` exists on the SKU, is not imported and is null until an Admin enters the owner's day counts on the catalog page; lot age is shown internally only and nothing about age or best-by prints |
| Section 11 beyond 11.1 | On hold, not built; no table, route or action exists for it |

## 4. Unproven provider capability

Every capability gate is `unproven` (Integrations page). No connection check has been recorded for any
provider because no company credential was available to this revision. In particular: Stripe
location-specific customer association and hosted ACH setup in the company account; identity
stability/effective disable with real staff accounts (email + PIN); all OptimoRoute field gates; single-sender notice
fit; Google content rights; QBO model; Slack no-mutation. A person records demonstrations with evidence.

## 5. Incomplete acceptance (what the tests do not establish)

| Scenario | Automated evidence | What remains |
|---|---|---|
| AT09 standing handling | archived + active lines, incomplete policy, held/skip, generation failure (`rev-policy-payer-standing`, `at05-at09`) | price-change treatment at generation time follows D12 and is refused/owned rather than decided; pause/resume UI is minimal; no real cadence has run over calendar time |
| AT13 reassignment of existing commitments | override vs reassign, insufficient stock, loaded work (`rev-stock-orders` §4.6) | route commitment itself is phase 2; "loaded" is a recorded fact, not a delivery workflow |
| AT61/AT62 identity lifecycle | PIN sign-in tests, fixture-based rename / offboard / reuse / disable-mid-session tests, journeys 7 and 10 | the same flows with real staff accounts and the `ACCESS_*` gates recorded |
| AT74 billing-contact/notice consequences | request/approve/replay (`AC28`), past recipients untouched | future-notice recipient handling is exercised only for the two notice purposes that exist (order received, setup invitation); invoice notices are phase 3 |
| AT79/AT80 Owner authority and visibility | REV-01/REV-11 tests, role matrix, journeys 7–8 | field (driver) visibility is proven as *exclusion* only — the assigned-execution view is phase 2 |
| Provider setup completion, finance (debits, credits, collections), POD, cleaning, formal accounting | boundary tests only | not built; screens say so |
| Shipment documents (BOL, picking ticket, pull sheet, pickup pack, invoice, batch print) | `documents.test.ts`: every template renders to a PDF with the expected text (numbers, VOID, R1, PO / carrier / pallet / NMFC fields, deposit and FOB lines, page counts); route handlers serve stored bytes or re-render from the snapshot; journey 12 fetches the BOL, picking ticket, batch print and invoice PDFs | PDFs are checked for **structure and content, not visually signed off** by the office; **no real printer or carrier has validated** the freight BOL; the deposit / CRV wording (6.4) and NMFC (6.6) are placeholders awaiting the owner |
| Shipment numbering under load | `shipments.test.ts` Acceptance 1 (sequential on PGlite) | the `bol_counter` upsert serialises concurrent confirmations by design, but no real-Postgres race test exists for it yet |
| Pallet count (3.7, 5.9) | pallet count and build are fields on the shipment and print on the BOL | the count is **not computed from the SKU pallet fraction** yet; the office types it |
| Order linkage (5.1) | `shipment_order` rows written at creation | orders can be linked **only when the draft is created**; no later link, no fulfilment status flows back to the order |
| Workbook import (9.x, 10.x) | `import.test.ts` against a **synthetic** workbook built in `tests/support/workbook.ts` (dry run, Owner apply, idempotent second run, edited workbook, every decision field), plus **one dry run** of the Python prototype against the production data (`tools/import/dry-run-report-2026-10-28.md`) | the in-app import has **not yet been applied to production**; the real-export test runs only on the owner's machine (`TLM_WORKBOOK_PATH`) and is skipped in CI |
| Keg balances (8.4, 8.5) | automatic posting from delivery, opening balances, MicroStar report (`shipments.test.ts` 8.x; journey 12) | opening balances for real accounts are not entered; no MicroStar serial tracking (counts only, by design) |
| Staff usability | twelve automated journeys with fictional data (`tests/ui/journeys.mjs`) | a real staff session (`STAFF_SESSION_SCRIPT.md`) has **not** been run; the shipments screens have not been used by the office |
| Backup/restore drill, Neon branch upgrade, Vercel cron visibility | upgrade of the populated baseline on a local Postgres 16 (`tests/postgres/upgrade.test.ts` applies every migration in `drizzle/`, 0004 included, under `TEST_DATABASE_URL`; skipped in the PGlite-only run) | the drill in `DEPLOYMENT.md` §4 needs the Neon project — **not run**; 0004 has not yet been applied to the production database |

## 6. Deferred / future scope

Phase 5 customer self-service (magic links, portal) — deferred [F]. Odoo/manufacturing — out of scope. Of
phases 2–4, the shipments module above is built; still not built are route optimisation and a driver execution
view beyond assigned stops, proof of delivery, line cleaning / service (10.7), credits and collections, host
logins, raw materials (8.10), TTB removal records (8.9), QC holds (8.3), Texas (Reyes) and Rhode Island, the
nightly push of an export workbook to Google Sheets (10.9), and section 11.2 to 11.7 (on hold). Phase 6
metrics beyond the MicroStar report — not built. The bounded skeleton tables (`delivery_visit`,
`delivery_visit_line`, `invoice_obligation`, `keg_movement`, `cleaning_obligation`) remain so the earlier
views can state "none yet" truthfully; the live records are `shipment`, `invoice` and `keg_event`. No Connect,
Stripe Tax, Subscriptions, new vendors, WMS or generic ERP.

## 7. Coverage map (brief §53/§58 + hardening §6)

| Scenario | Test | Notes |
|---|---|---|
| AT01–AT04 | tests/scenarios/at01-at04 | creation, similar names, license later verified, first order before ACH; AT74 request/approve |
| AT05–AT09 | tests/scenarios/at05-at09 | D01 unresolved, holds, minimum, price change, standing (test D13), AT79 register discipline |
| AT10–AT13 | tests/scenarios/at10-at13 | reservation/cancellation, shortage, samples, warehouse reassignment/transfers |
| AT61/AT62/AT80 | tests/scenarios/at61-at62 | fixture identity lifecycle, five-role matrix |
| REV-01/11/17 · AC01–03, AC18, AC34, AC38 | tests/scenarios/rev-authority | authority, scope, driver exclusion, offboarding, pagination/scope |
| Email + PIN sign-in | tests/scenarios/pin-signin | policy/hashing, outcomes, lockout, disablement, temporary PIN, own change, PIN authority, session binding, offboarding |
| REV-02 · AC04/AC05 | tests/scenarios/rev-environment, demo-mode | every flag combination; seed safety |
| REV-03/04/05/09/10, §4.6 · AC06–AC12, AC25, AC26 | tests/scenarios/rev-stock-orders | allocation coherence, movement semantics, stale transitions, submission keys, reassignment, transfers |
| REV-06/07/08/16 · AC13–AC17, AC24, AC28 | tests/scenarios/rev-policy-payer-standing | policy timelines/typing, D02 applicability, payer authority, standing, billing-email decisions |
| REV-12/13/14/15/18, §4.7/§4.8 · AC19–AC23, AC27, AC29, AC30 | tests/scenarios/rev-provider-queue-notices | provider facts, account binding, waiting work, fencing, intake, notices, follow-through |
| UX-04/UX-10 · AC31, AC35, AC36 | tests/scenarios/ux-presentation | status mapping, timezone/DST, error masking |
| Review fixes (revision 1) | tests/scenarios/review-fixes | override scope, policy scope, jobs, amendment reassessment, market scope, identity integrity |
| Shipments acceptance 1–5, 8, 9 · owner questions 1.7, 2.2, 2.6, 3.4, 4.x, 5.x, 7.x, 8.x, 9.4–9.6 | tests/scenarios/shipments | lot codes and picker, numbering, confirmation guards, allocate / void / deliver, pickup invoicing and market scoping, transfers, invoices and counters, counts / kegs / MicroStar, access and audit (17 tests) |
| Shipments acceptance 6 · owner questions 6.1–6.10 | tests/scenarios/documents | formatting rules (no arrows), every template to PDF, VOID and R1, pickup pack, pull sheet and batch print, route handlers (13 tests) |
| Shipments acceptance 7 · owner questions 9.x, 10.x | tests/scenarios/import | synthetic workbook: parse, dry run, Owner apply, every decision field, idempotent second run, edited workbook, rejection (13 tests); the real-export test is gated by `TLM_WORKBOOK_PATH` |
| **Real Postgres** · AC07/08/10/11/12/22/23/28, AC37, setup page | tests/postgres/races, tests/postgres/setup, tests/postgres/upgrade | `TEST_DATABASE_URL`; populated baseline `884684c` upgraded and preflight refusal (11 tests) |
| Journeys 1–11 · AC03, AC09, AC11–14, AC17, AC18, AC27, AC30, AC32–34, AC38; PIN sign-in; setup page | tests/ui/journeys.mjs | `npm run test:ui`; screenshots + timings |
| Journey 12 · shipments end to end | tests/ui/journeys.mjs | origin code and lot facility code, packaging report, draft with lines, confirmation assigns `EBB-D-YYMMDD-SEQ`, BOL / picking ticket / batch print PDFs, delivery issues the INV invoice and posts the keg pickup, invoice PDF, keg balance, Sales view-only, driver refused |
| AT14–AT60, AT63–AT73, AT75–AT78, AT81–AT84 | not yet | the remaining phase 2–4 scenarios (route execution, POD, service, credits and collections) |

At the hardening revision 94 PGlite tests, 10 real-Postgres tests and 10 browser journeys were green; results and
commands are recorded in `HARDENING_REPORT.md`. On the shipments revision (October 28) `npm test` reports
**137 passed and 12 skipped** (16 test files passed, the 3 real-Postgres files skipped; the skips are the 11 real-Postgres tests, which need
`TEST_DATABASE_URL`, and the real-workbook import, which needs `TLM_WORKBOOK_PATH`); `npm run test:ui` runs
**12 journeys**.

## 8. Independent review history

Revision 1 fixed the 17 findings of the first reviewer (override scope, hosted setup URL, failed jobs,
stranded jobs, standing atomicity, market scope, policy scope/dating, amendment reassessment, duplicate
pending references, Google rename audit, duplicate provisioning, D13 horizon key, Admin release transaction,
D07 rename authority, real transfers, UUID validation, ILIKE escaping). Revision 2 reconciled the second
review's REV-01–REV-18 against the current code — every finding was present — and fixed each at the service
boundary with regression tests (`HARDENING_REPORT.md` §3).
