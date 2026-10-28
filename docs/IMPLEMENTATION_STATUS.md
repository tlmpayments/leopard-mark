# Implementation status — revision 2 (Phase 1 deep, hardened; whole-system skeleton)

Reported per the brief §51/§58 and the hardening prompt §8: **implemented support**, **active approved
behaviour**, **unresolved policy**, **unproven provider capability**, **incomplete acceptance** and
**deferred/future scope** are listed separately. Nothing below claims a provider integration complete
because a request was sent, and no production data is populated with guessed policy or fictitious history.
Revision: branch `hardening/phase1` on top of baseline `884684c`; migration `0002_hardening` added.
The per-finding reconciliation is in `HARDENING_REPORT.md`; the ID-level map is in `TRACEABILITY.md`.

## 1. Implemented support (built and tested in this repository)

### Employee access (Phase 1)
* Google OIDC sign-in (PKCE) as the identity assertion; internal `employee` + `employee_identity` +
  `role_grant` supply authority. No auto-provisioning; provisioning by company email; first sign-in binds the
  Google subject (transactional); email rename keeps the employee and ends the old identity row.
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

### Development demo mode (local inspection only)
* `npm run demo`: embedded PGlite under `.fv-demo/` with the production migrations, seeded through the real
  domain services, auto-signed in as the demo Owner, DEVELOPMENT DEMO MODE banner, friendly local URL.
  Impossible on a deployment (guards tested). Providers are never mocked as successful.

### Provider adapters (build-versus-activate)
| Provider | Built | Credentials | Connection verified | Capability demonstrated | Authorized live | Production-ready |
|---|---|---|---|---|---|---|
| Google Identity | Yes | No (FV to supply) | No | No — `ACCESS_*` gates need real accounts | IG03 unselected | **No** |
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

## 4. Unproven provider capability

Every capability gate is `unproven` (Integrations page). No connection check has been recorded for any
provider because no company credential was available to this revision. In particular: Stripe
location-specific customer association and hosted ACH setup in the company account; Google identity
stability/effective disable with real Workspace accounts; all OptimoRoute field gates; single-sender notice
fit; Google content rights; QBO model; Slack no-mutation. A person records demonstrations with evidence.

## 5. Incomplete acceptance (what the tests do not establish)

| Scenario | Automated evidence | What remains |
|---|---|---|
| AT09 standing handling | archived + active lines, incomplete policy, held/skip, generation failure (`rev-policy-payer-standing`, `at05-at09`) | price-change treatment at generation time follows D12 and is refused/owned rather than decided; pause/resume UI is minimal; no real cadence has run over calendar time |
| AT13 reassignment of existing commitments | override vs reassign, insufficient stock, loaded work (`rev-stock-orders` §4.6) | route commitment itself is phase 2; "loaded" is a recorded fact, not a delivery workflow |
| AT61/AT62 identity lifecycle | fixture-based rename / offboard / reuse / disable-mid-session tests and journey 7 | the same flows with real Google Workspace accounts and the `ACCESS_*` gates |
| AT74 billing-contact/notice consequences | request/approve/replay (`AC28`), past recipients untouched | future-notice recipient handling is exercised only for the two notice purposes that exist (order received, setup invitation); invoice notices are phase 3 |
| AT79/AT80 Owner authority and visibility | REV-01/REV-11 tests, role matrix, journeys 7–8 | field (driver) visibility is proven as *exclusion* only — the assigned-execution view is phase 2 |
| Provider setup completion, finance, POD, delivery, keg credits, cleaning, formal accounting, production migration | boundary tests only | not built; screens say so |
| Staff usability | nine automated journeys with fictional data (`tests/ui/journeys.mjs`) | a real staff session (`STAFF_SESSION_SCRIPT.md`) has **not** been run |
| Backup/restore drill, Neon branch upgrade, Vercel cron visibility | upgrade of the populated baseline on a local Postgres 16 | the drill in `DEPLOYMENT.md` §4 needs the Neon project — **not run** |

## 6. Deferred / future scope

Phase 5 customer self-service (magic links, portal) — deferred [F]. Odoo/manufacturing — out of scope. Phase
2–4 workflows and phase 6 metrics — not built; bounded skeleton tables (`delivery_visit`,
`delivery_visit_line`, `invoice_obligation`, `keg_movement`, `cleaning_obligation`) exist so phase-1 views can
state "none yet" truthfully. No Connect, Stripe Tax, Subscriptions, new vendors, WMS or generic ERP.

## 7. Coverage map (brief §53/§58 + hardening §6)

| Scenario | Test | Notes |
|---|---|---|
| AT01–AT04 | tests/scenarios/at01-at04 | creation, similar names, license later verified, first order before ACH; AT74 request/approve |
| AT05–AT09 | tests/scenarios/at05-at09 | D01 unresolved, holds, minimum, price change, standing (test D13), AT79 register discipline |
| AT10–AT13 | tests/scenarios/at10-at13 | reservation/cancellation, shortage, samples, warehouse reassignment/transfers |
| AT61/AT62/AT80 | tests/scenarios/at61-at62 | fixture identity lifecycle, five-role matrix |
| REV-01/11/17 · AC01–03, AC18, AC34, AC38 | tests/scenarios/rev-authority | authority, scope, driver exclusion, offboarding, pagination/scope |
| REV-02 · AC04/AC05 | tests/scenarios/rev-environment, demo-mode | every flag combination; seed safety |
| REV-03/04/05/09/10, §4.6 · AC06–AC12, AC25, AC26 | tests/scenarios/rev-stock-orders | allocation coherence, movement semantics, stale transitions, submission keys, reassignment, transfers |
| REV-06/07/08/16 · AC13–AC17, AC24, AC28 | tests/scenarios/rev-policy-payer-standing | policy timelines/typing, D02 applicability, payer authority, standing, billing-email decisions |
| REV-12/13/14/15/18, §4.7/§4.8 · AC19–AC23, AC27, AC29, AC30 | tests/scenarios/rev-provider-queue-notices | provider facts, account binding, waiting work, fencing, intake, notices, follow-through |
| UX-04/UX-10 · AC31, AC35, AC36 | tests/scenarios/ux-presentation | status mapping, timezone/DST, error masking |
| Review fixes (revision 1) | tests/scenarios/review-fixes | override scope, policy scope, jobs, amendment reassessment, market scope, identity integrity |
| **Real Postgres** · AC07/08/10/11/12/22/23/28, AC37 | tests/postgres/races, tests/postgres/upgrade | `TEST_DATABASE_URL`; populated baseline `884684c` upgraded and preflight refusal |
| Journeys 1–9 · AC03, AC09, AC11–14, AC17, AC18, AC27, AC30, AC32–34, AC38 | tests/ui/journeys.mjs | `npm run test:ui`; screenshots + timings |
| AT14–AT60, AT63–AT73, AT75–AT78, AT81–AT84 | not yet | phases 2–4 |

87 PGlite tests (`npm test`), 10 real-Postgres tests (`npm run test:pg`), 9 browser journeys (`npm run test:ui`)
were green on the delivered revision; results and commands are recorded in `HARDENING_REPORT.md`.

## 8. Independent review history

Revision 1 fixed the 17 findings of the first reviewer (override scope, hosted setup URL, failed jobs,
stranded jobs, standing atomicity, market scope, policy scope/dating, amendment reassessment, duplicate
pending references, Google rename audit, duplicate provisioning, D13 horizon key, Admin release transaction,
D07 rename authority, real transfers, UUID validation, ILIKE escaping). Revision 2 reconciled the second
review's REV-01–REV-18 against the current code — every finding was present — and fixed each at the service
boundary with regression tests (`HARDENING_REPORT.md` §3).
