# Operator guide — supported workflows, recovery, upgrading, local testing

This guide covers what the application actually supports in this revision. Shipments, lots, documents,
invoices, keg balances, stock counts, company settings and the workbook import were added on October 28, 2026
(owner decisions in `SHIPMENTS_SPEC.md`, keyed to the owner's question numbers quoted below). Anything not
listed here is either a later phase (Service / line cleaning, Reporting beyond the MicroStar report, route
planning) or an Owner decision that is still unselected — the screens say so rather than pretending. Three
owner questions are still open and are left as plain fields or flagged exceptions rather than guessed: 4.5
(packaging that spans two dates), 7.5 (how invoices are sent and collected), and the Envision / SC Warehouses
part of 2.3.

## Where to look
* **Home** — role-specific: Sales sees their accounts and open orders; Admin sees the work queue summary;
  Accounting sees payment setup work and notices; Driver/Service sees the stops assigned to them under
  *Shipments* and nothing else. Every page has *Search* (scoped to your market authority) and, on a phone, a
  bottom bar with the frequent destinations plus **More** (every permitted destination and sign-out).
* **Shipments** (Admin, Accounting, Sales view; Driver sees assigned stops) — list filtered by origin, date,
  status and type; *New shipment* for a delivery (D), transfer (T) or sample (S); the shipment page carries the
  lines, the state actions, the stored documents and the invoice link.
* **Lots** (Admin, Accounting, Sales view) — the lot register; *New packaging report* records a run; *Batches*
  lists brews per facility.
* **Invoices** (Admin, Accounting; Sales view) — INV and NC invoices with status, PDF, mark paid and void.
* **Kegs** (Admin, Accounting, Sales view) — keg balance per account by size, with the event history and the
  form for opening balances and adjustments.
* **Admin: Markets & stock** — stock positions as before, plus the **origins editor** (origin code, lot facility
  code, kind, address, hours, dock / liftgate / appointment, shipping contact) and the market billing rules
  (terms, keg deposits, COD, region list).
* **Admin: Catalog** — SKU details for documents (UPCs, weights, pallet fraction, recipe variant, shelf life)
  and the legacy code aliases.
* **Account workspace, *Shipping & billing* card** — account kind, served-by distributor, legacy ACC- id,
  fulfilment (delivery or will-call pickup), appointment required, deposit mode and per-keg override, terms
  override, pallet rule, receiving requirements, and per-account price overrides with a reason.
* **Admin: Stock counts** — count sheets per origin with lot codes; applying one sets on hand to the counted total.
* **Admin: Company settings** (Owner only) — shipper block, office address, AR email, footers, fixed lines,
  NMFC, marking convention, remit-to, and the POS item list.
* **Admin: Import from workbook** — upload the TLM Master File export, read the dry run, Owner applies.
* **MicroStar report** (Admin, Accounting) — monthly outbound kegs per distributor or per brewery, on screen
  and as CSV.
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

## Origins: codes, lot facility codes, kinds (Admin: Markets & stock, origins editor)
Every brewery, warehouse and cold store that ships is an **origin** (the `warehouse` record with extra fields).
* **Origin code** — three letters, unique, typed in capitals: the confirmed codes are EBB East Brother, BWD
  Beachwood, PRO Prost, RTB Round Table, ALE AleSmith, JAB Jack's Abby, RAL Real Ale, EWD Express Wine Delivery,
  WLA Balmuth, RAD Radford (2.2). The code is the first segment of every shipment number, so **confirmation
  refuses an origin that has no code** and tells you to set one. A code already used by another origin is refused.
* **Lot facility code** — two digits (01 to 99) on breweries only; it is the first segment of every lot code.
  The packaging report refuses a facility without one; a batch can only be recorded at an origin of kind brewery.
* **Kind** — brewery, warehouse or cold storage. The kind drives which documents an origin's shipments get
  (the template is chosen by the destination, not the origin) and which origins the MicroStar "per brewery"
  report groups by.
* **Market** is optional on an origin (Prost and Real Ale have none today); an origin without a market cannot
  be a market's primary warehouse. **Address** is structured (line 1, line 2, city, state, postal code) with the
  old free-text address as the fallback on documents; the **shipping contact** prints in the Ship From block;
  **hours**, **loading dock**, **liftgate required** and **appointment required** are optional and kept on the
  origin record for the office (2.11).
* Radford (31 Plymouth St, Mansfield, MA 02048) is the Massachusetts warehouse serving the MA distributor and
  both CT distributors; the Envision / SC Warehouses part of 2.3 is open, so the import brings those two in
  **inactive** and without a code.

## Lots and batches (Admin: Lots, Batches)
* **Batch** (4.2, 4.10): facility (a brewery), brand code, batch number (unique, e.g. B01CNT26001), brew date,
  vessel, status (scheduled, in progress, complete, destroyed, cancelled). Destroyed or cancelled needs a reason
  and a date; the record is kept. A batch usually yields one lot; recording a packaging run against an
  in-progress batch marks it complete.
* **Packaging report** (4.4) — the one-page entry per run: facility, brand (SLG Sunlight Groove, CNT
  Cantinesca; retired and experimental codes are listed inactive), packaging date, run digit, optional batch,
  quantities packaged per SKU, notes. The **lot code is computed, never typed**: facility code (2 digits) +
  brand (3 letters) + packaging date as yymmdd + run (1 character), for example `01CNT2610071`. A second run
  on the same day takes the next run digit; the same code twice is refused. A lot holds several SKUs (4.3).
  Packaging that spans two dates (4.5) is an open question: enter the run under the date the host reports and
  say so in the notes.
* **Unknown quantities** (4.6): a lot can be recorded with *quantities not yet known* (the import does this
  for the lots that appear only on legacy BOLs). The lot picker on a shipment line offers it **flagged
  "quantities unconfirmed"**; the line must then carry a **reason**, and confirming opens one
  `lot_quantities_unconfirmed` case per lot. *Confirm quantities* on the lot page enters the host's figures and
  resolves the case. Dotted legacy lot codes are history only and never appear in the picker (1.7).
* Lot age in days is shown internally on the Lots list; nothing about age or best-by is printed on customer
  documents (4.8). Per-lot balances start with the first packaging run entered here (4.1);
  the stock counts record lot codes so those balances can be built later.

## Shipments (Admin creates, confirms, delivers, voids; Accounting and Sales view; Driver sees assigned stops)
A shipment is one movement from one origin: **D** delivery to an account, **T** transfer to another origin,
**S** samples to an account or to a named person or event. **Will-call pickup** (the legacy "P" documents) is a
D shipment with *Will-call* ticked and the pickup location as origin (5.5). Shipments may reference orders but
stand alone (5.1); open orders for the destination can be ticked when the draft is created (not afterwards).
The sequence:
1. **Create draft** — type, origin, destination, scheduled date, PO numbers, appointment, carrier, seal and
   trailer, pallet count and build, freight class, delivery window, receiving instructions, driver, notes.
   The draft shows *draft* and has **no number**. A direct delivery to an account that is **served by a
   distributor** needs an *override reason* before it can be confirmed (2.6).
2. **Save lines** — each line is a SKU with a **lot chosen from the list** and a quantity, or a POS item (tap
   handle, glassware, coasters: no lot, no price, no stock effect). Archived SKUs and dotted legacy lots are
   refused. A line on an unconfirmed-quantity lot needs its reason (see Lots).
3. **Confirm (assign number)** — the number `ORIGIN-TYPE-YYMMDD-SEQ` is taken from a counter per origin and
   **scheduled date** (two confirmations for the same origin and day get -001 and -002; another origin or day
   starts again at -001). In the same transaction stock is **allocated** at the origin (availability for orders
   drops; a shortfall opens a `shipment_stock_shortfall` case rather than blocking), unit prices are captured
   (account override, else the market price; samples at $0; transfers none), the **BOL and picking ticket** are
   stored as snapshot plus PDF, and for D and S shipments to an account the **invoice draft** is created. The
   number is **never changed** afterwards: moving the scheduled or actual date, editing logistics fields or
   lines does not renumber (5.3, 5.12).
4. **Mark staged** (optional, distributor loads) and **Mark out** (optional, driver day) are plain status
   steps.
5. **Mark delivered** — only the office does this and it sets the **actual date** (5.11), with the **empties
   collected** at a retail stop by size (1/2 bbl, 1/6 bbl). Allocations are consumed, one `shipment_out`
   movement per line is written (transfers: `transfer_out` at the origin, in transit at the destination), the
   keg event is posted, and the invoice is **issued dated the actual date**. Delivering more than is on record
   floors the position at zero and opens an `allocation_discrepancy` case asking for a count.
6. **Void** (any state before delivered; reason required) — allocations are released, a draft invoice is
   voided, the number is **kept as a permanent gap** and the stored BOL is re-issued with the VOID mark (5.4).
   A delivered shipment is not voided; record a correction instead.
* **After confirmation** only logistics fields can change (PO numbers, appointment, carrier, seal, trailer,
  pallet count and build, freight class, delivery window, receiving instructions, notes, driver, scheduled
  date); changing the route (type, origin, destination) means void and re-create. Lines can still be replaced
  while confirmed or staged: the shipment is re-allocated and re-priced. Every such edit **regenerates the
  documents with the next revision**: the same number followed by `R1`, `R2` and so on (6.7). *Regenerate (next
  revision)* does the same on request, with a reason.
* **Transfers are received at the destination** (5.8): after delivery, *Record receipt* with the date and the
  counted quantity per SKU moves in-transit stock to on hand; a count that differs from the BOL opens a
  `receiving_discrepancy` case naming the lines. A receipt recorded twice has no second effect.
* **Documents** (6.x) — the shipment page links the latest **bill of lading** (distributor / freight template
  for distributor, warehouse and host destinations and for transfers; retail delivery receipt otherwise, with
  signature blocks, delivery window, receiving instructions and the empty-keg pick-up by size), the **picking
  ticket** (warehouse-facing, no prices) and, for pickups, the **pickup pack** (BOL followed by the invoice in
  one PDF). Shipper = legal name plus dba from company settings; Ship From = the actual origin. Documents exist
  from confirmation onward; a document stored without PDF bytes is rendered from its snapshot when opened.
* **Day print** on the Shipments list (one origin, one scheduled date) returns one PDF: the **pull sheet** (all
  confirmed, staged, out and delivered shipments of that origin and day aggregated by SKU and lot, then the
  per-stop list, 5.2) followed by every BOL and picking ticket in number order (6.8). Drivers print a stop's own
  documents from the shipment instead; batch print is an office and warehouse function.
* **Who sees what** (9.4 to 9.6): Admin creates, confirms, delivers, voids and receives; Accounting and Sales
  view (Sales only in their market); a Driver sees only shipments assigned to them and gets a refusal on any
  other. Market scoping: D and S shipments belong to the destination account's market, a transfer to the
  destination origin's market, a sample to a free-text destination to the origin's market.
* **Legacy history**: the 123 logged BOL documents are imported as delivered shipments marked *legacy*; they
  show in the list with *Include imported history*, carry the old numbers, never touch the ledger and cannot be
  edited.

## Invoices (Accounting and Admin issue, mark paid and void; Sales view)
* fv-ops owns the numbering (7.1, 7.3): **INV** for charged goods and **NC** for samples, both as series + two-digit
  year + sequence (`INV26376`, `NC26002` are the next numbers after the Sheet; the sequence widens past 999).
  Samples never share an invoice with charged goods.
* **One invoice per shipment by default** (7.2): the draft is created at confirmation and **issued when the
  shipment is delivered, dated the actual delivery date** (7.4). A second confirmed shipment for the same
  account within the same week can be added to the open draft; the draft then issues when every shipment on
  it is delivered. **Will-call pickups** are issued at confirmation, dated the scheduled pickup date, so the
  numbered invoice travels in the pickup pack; if the actual pickup date differs, delivery **re-dates** the
  invoice and its due date without changing the number and stores the next revision of the PDF. Accounting or
  Admin can also issue an open draft by hand with a chosen invoice date (*Issue INV* / *Issue NC*); the number
  is taken at that moment.
* **Terms** come from the account's override, else the market rule (Net 30 today; a market may be COD). The
  due date is the invoice date plus the terms.
* **Deposits and wording** (3.10, 7.7, 7.8): retail invoices carry one *Keg deposit* line at the market rate
  ($35 per keg today) unless the account's deposit mode is *floating* (an information line says so) or *none*,
  or a per-keg override is set; distributor invoices carry **no deposit**, print "FOB brewery or designated
  warehouse" and a **MicroStar information line** with the kegs shipped by size. POS lines print at no charge.
  An NC invoice has every line at $0.
* **Mark paid** records a manual payment status with a note; **Void** needs a reason, keeps the number as a
  gap and leaves the shipment alone (voiding a shipment voids only its *draft* invoice; an issued one is left for
  a person to decide). A paid invoice is not voided; issue a credit instead.
* The invoice PDF is served from the document stored at issue; a draft renders live with a DRAFT stamp and a
  voided invoice with a VOID stamp. The AR sender address and the optional remit-to block come from company
  settings (7.9).
* **Sending and collection stay manual** (7.5 open): nothing in the application emails an invoice or records a
  payment with a provider. Legacy invoices from the Sales tab are listed with their Sheet status text and are
  read-only.

## Kegs (Admin records; Accounting and Sales view)
* The balance per account and size is **counts only** (8.4): kegs out minus kegs in, for 1/2 bbl and 1/6 bbl.
  A delivered D or S shipment posts the keg lines as *out* and the empties collected at the stop as *in*
  automatically; the keg event carries the shipment number.
* **Opening balances** at cut-over (8.5) and **adjustments** (8.7) are entered by hand on the Kegs page or the
  account's keg page: date, kind, counts by size and direction, and a note saying who counted or what happened.
  A stand-alone pickup without a shipment uses kind *pickup*. Nothing is deleted; an error is corrected with an
  adjustment.
* **MicroStar report** (8.6): choose a month and group by distributor (destination accounts of kind
  distributor) or by brewery (the shipment's origin); the same rows download as CSV.

## Stock counts (Admin: Stock counts)
* A **count sheet** per origin (8.1, 8.2): date, who counted, a note, and lines of SKU, optional **lot code**
  and quantity. Lot codes are checked for shape (facility, brand, yymmdd, run). Several lines may name the same
  SKU with different lots.
* **Apply count** sets on hand per SKU to the counted total with one `count` movement, records one zero-delta
  movement per lot line so per-lot balances can be built later, and refills waiting demand when the count
  raised stock. A sheet is applied once; the ledger starts from this evidence, not from the workbook (1.6).
  Opening counts after the import are done this way, one origin at a time, Richmond first (10.4).

## Company settings, counters and POS items (Owner: Company settings)
* **Shipper block** (6.1, 6.2): legal name, dba as posted with CA ABC, office address, phone and the AR sender
  email print on every new document. **Document wording**: retail footer, distributor footer (keg deposit and
  CRV wording, a placeholder until the owner's example arrives, 6.4) and the fixed lines on freight documents
  (the keep-cold line). **NMFC** for kegs and cans with a status: *proposed* until signed off, printed on
  distributor documents only once *approved* (6.6). **Marking convention** (4.7). **Remit-to** text, off by
  default (7.9). Every change is audited with prior and current values; only the Owner may save.
* **Counters** are seeded on the first `/setup` run (INV 2026 at 375 and NC 2026 at 1, so the next numbers are
  INV26376 and NC26002; BOL counters start empty per origin and day) and advance inside the issuing
  transaction. They are not edited on screen; a void leaves a gap by design.
* **POS items** (3.6): code, name, active. Seeded with TAPHANDLE-STD, TAPHANDLE-PREM, GLASS-PINT-CASE and
  COASTERS; POS lines on a shipment have no lot, no price and no ledger effect.

## Import from the workbook (Admin runs the dry run; Owner applies)
1. Export the TLM Master File as **.xlsx** (Google Sheets: File, Download, Microsoft Excel) and upload it under
   *Import from workbook*. Tabs read: Customer Accounts, Accounts (supplement only), Location Information, SKU
   Master, Product Information, Commodities, Reps (names only), Production, Packaged Products, BOL Maker Log,
   Sales. Uploads up to 8 MB are accepted.
2. The **dry run** stores a run with a diff per entity: create, update, unchanged, skipped, flagged and excluded
   rows with the reason for each. Rows are matched by the same deterministic ids the October 28 production load
   used, so what is already there shows as unchanged or updated, never as new. Values typed in fv-ops are never
   blanked by an empty cell; closed accounts stay closed.
3. The **Owner applies** the dry run (`import.apply` is Owner-only, 10.3). Apply recomputes the plan against the
   live database inside one transaction, upserts by id, never deletes, writes one audit event per changed row
   under the run id and one `import.run` event, and opens the `lot_quantities_unconfirmed` case once per lot
   without quantities. Applying the same workbook again reports no changes (10.2). A dry run that will not be
   applied is **discarded** (the record stays).
4. What the import writes: markets and region lists; origins with codes, kinds and addresses (Prost and Real
   Ale without a market; Envision and SC Warehouses inactive); SKUs, aliases and prices; accounts with kind,
   served-by, status, terms, fulfilment and legacy ACC- ids; people; batches and lots (dotted codes as history;
   BOL-only lots backfilled with unknown quantities); legacy shipments and invoices with their links.
5. **Never imported**: PINs (people arrive by name only, with no email, no identity and no sign-in until the
   Owner provides a temporary PIN, 9.1, 9.2); inventory tab figures (opening stock comes from a count, 1.6);
   anything into the stock ledger or the keg balances from history. No email is sent by any step (9.7).
Real workbook exports never enter the repository: `*.xlsx` is git-ignored and the test that reads one is gated
by `TLM_WORKBOOK_PATH`. The report of the dry run against the production data is in
`tools/import/dry-run-report-2026-10-28.md`.

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

## Upgrading a populated database
Browser route: open `/setup`, read the state card (pending migrations are listed), enter the setup token
(the deployment's `CRON_SECRET`) and apply. The same preflight as below runs inside the migration: a refusal
shows the diagnostic and nothing changes. Terminal route:
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

Migration `0004_shipments` (October 28) is applied the same way through `/setup`. It is additive (new tables and
nullable or defaulted columns, no preflight block) and the same apply step seeds the company settings row, the
INV and NC counters and the POS items if they are missing. After it, run the in-app import (Owner applies) and
check the origins and counters as described in `DEPLOYMENT.md` section 14.

## First Owner and provisioning
`OWNER_EMAIL=… OWNER_PIN=… npm run bootstrap` provisions the Owner with a temporary PIN (chosen at first
sign-in). The Owner then provisions Admin/Accounting/Sales/Driver people with market scope and a temporary PIN each.

## Local development and tests
```bash
npm run demo                 # zero-setup demo: embedded database, fictional data, auto demo Owner (Switch user, or email + demo PIN 135790)
npm run demo:reset           # wipe .fv-demo/ so the next start reseeds
npm test                     # 137 passed, 12 skipped (16 test files passed, 3 skipped) on PGlite (real Postgres SQL in-process; no server; a couple of minutes, the document tests render real PDFs)
TEST_DATABASE_URL=postgres://… npm run test:pg   # 11 real-Postgres tests: races, setup page, populated-database upgrade (disposable database!) — these are the skips above
TLM_WORKBOOK_PATH=… npm test # also runs the import against a real workbook export (the twelfth skip); the file never enters the repository
npm run test:ui              # 12 role browser journeys against the running demo (screenshots + timings); journey 12 covers origins, lots, shipments, documents, delivery, invoice and kegs
npm run test:ui:golive       # go-live path on a production build against an empty Postgres (see tests/ui/production-setup.mjs)
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
