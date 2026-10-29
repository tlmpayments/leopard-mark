# Shipments, Lots, Documents and Invoices — build specification

Status: owner decisions of **October 28, 2026** (Shipments & BOL Build — Owner Question List, sections 1 to 10) are the
controlling input. Question numbers below (for example **5.3**) refer to that list. Section 11 beyond 11.1 is on hold.
Still open at the time of writing: **4.5** (packaging that spans two dates), **7.5** (invoice sending and collection channel),
and the Envision / SC Warehouses part of **2.3**. Nothing in this build guesses those three; each is left as a plain field
or a flagged exception.

The build replaces the Sheet-backed BOL maker at bol.tlmbg.co. The BOL becomes a rendered output of a **shipment
record**; one record carries the number, dates, account, lots and drives the documents, the invoice, the ledger movement
and the keg balance (Handoff Brief, target model).

## 1. Decisions digest

| Area | Decision (question) |
| --- | --- |
| Source of truth | TLM Master File workbook; **Customer Accounts** tab is the account master, Accounts' ACC- ids kept as legacy references (1.1, 1.2). Location Information is the origin master; Radford added (1.3). Production is the lot register, backfilled from the BOL log (1.4). Sales tab is the invoice register as read-only history, with the status meanings recorded in 1.5. Inventory tabs untrusted; opening balances from a count (1.6). Dotted legacy lots are history only and never appear in pickers (1.7). Routes out of scope (1.8). |
| Markets | SoCal, NorCal (Self Distribution), NorCal (Distributed — sold only to Matagrano), Connecticut, Massachusetts; Sheet regions are sub-lists (2.1). |
| Origins | Every brewery is an origin. Codes: EBB East Brother, EWD Express Wine Delivery, WLA Balmuth, RAD Radford, BWD Beachwood, PRO Prost, RTB Round Table, ALE AleSmith, JAB Jack's Abby, RAL Real Ale (2.2). Radford is the Massachusetts warehouse serving the MA distributor and both CT distributors (2.3). An origin may exist without a market (Prost, Real Ale). Dock / liftgate / appointment / hours are optional (2.11). |
| Account kinds | retail, distributor, warehouse, host, Familiar Ventures itself, individual (2.4). Distributors now: Matagrano (pickup), Hartford, Dichello, Quality Beverage (delivery); not Reyes (2.5). A **served-by** field (direct, or the distributor) on every account; a direct shipment to a distributor-served account needs an override reason (2.6). Reps: Sheet value = originating rep; owner supplies the reassignment list (2.7). Parents where legal name or billing contact matches (2.8). Addresses parsed automatically, exceptions flagged (2.9). Billing email = invoice recipient, falls back to ordering email (2.10). |
| SKUs | Eight active codes, immutable once referenced (3.2). Position 4 = recipe variant: C Clasico, 0 base recipe with no variant (3.1). Legacy codes searchable as aliases (3.3); Giro and experimental archived, never selectable (3.4, 3.5). **POS** items (tap handle standard, tap handle premium, pint glass case, coasters): no lot, no price, no ledger depletion (3.6, 8.8). UPCs and pallet fraction on the SKU; distributor template prints case UPC and computes pallet count (3.7). Weights 160 / 58 / 22 lb (3.8). One effective-dated price list per market plus per-account overrides with a reason (3.9). Deposits: retail $35 per keg, distributor none, per-account override for floating-deposit accounts (3.10). 24 oz formats inactive (3.11). |
| Lots | Traceability first: lot required on every beer line, chosen from a list; per-lot balances start with the first packaging run entered in fv-ops (4.1). Keep the batch number; a batch usually yields one lot (4.2); a lot holds several SKUs (4.3). Office enters a one-page packaging report, organised by facility then batch (4.4). Warn-and-allow with a reason when a lot has no recorded quantity, block once per-lot balances are live (4.6). Marking convention drafted and printed on the packaging report (4.7). Lot age and best-by tracked internally per package class, never printed on customer documents; day counts to supply (4.8). All 43 Production batches imported as history (4.9); destroyed/cancelled batches keep status, reason, date (4.10). |
| Shipments | Shipments may reference orders but can stand alone (5.1). One shipment can cover several POs, one order can ship in parts; the warehouse gets one master pull sheet per origin per day and the driver one BOL per stop (5.2). Number assigned **at confirmation**; drafts show "draft" (5.3). Voided keeps its number; reissue = same number with a revision mark (5.4). Legacy P = will-call pickup = type D with the pickup location as origin; S = samples; the 22 "Leopard Mark" documents were driver stock loads = legacy transfers, history only (5.5). No route-truck location; depletion per stop on the actual date (5.6). Any origin can ship any type; template chosen by destination kind (5.7). Transfers need receiving confirmation with counts; discrepancies become exceptions (5.8). PO numbers, appointment and pallet build on the shipment and the BOL; pallet count computed and editable (5.9). Status set: draft, confirmed, staged (optional), out, delivered, voided (5.10). Only the office sets the actual date (5.11). Counter key = origin + **scheduled** date (5.12). All 123 logged documents imported as legacy shipments, duplicates merged (5.13). |
| Documents | Shipper = legal name plus dba as posted with CA ABC; Ship From = actual origin (6.1). One company-address setting editable by the Owner (6.2). Distributor template: PO, appointment, carrier, pallet count and build, case UPCs, lot per line, weight, freight class, NMFC, optional seal and trailer, fixed keep-cold line (6.3). Retail template: driver and receiver signatures, delivery window, receiving instructions, empty-keg pick-up by size, licensed-receiver acknowledgement, retail footer; distributor documents carry keg-deposit and (where the state applies it) CRV wording — distributor remits deposit to MicroStar and CRV to the state; owner will share an example for exact wording (6.4). Pickup pack = BOL plus invoice in one PDF (6.5). NMFC proposed for BEER-KEG and BEER-CAN for sign-off (6.6). Snapshot and PDF stored at confirmation; regenerate on demand with a revision mark (6.7). Batch print per origin and date (6.8). Lot per line on both templates (6.9). Picking ticket as a third output (6.10). |
| Invoices | fv-ops owns the INV sequence (7.1). One invoice per shipment by default; "add to open invoice" for the same account within the same week (7.2). NC series for samples; samples never share an invoice with charged goods (7.3). Invoice date = actual delivery or pickup date; terms are a **market** rule (Net 30 today; a future market may be COD); blank account terms inherit the market rule (7.4). Sales history imported with the Sheet's status text (7.6). Distributor invoices say "FOB brewery or designated warehouse"; retail say nothing (7.7). MicroStar keg counts as information lines on distributor invoices; retail invoices show the deposit line (7.8). AR sender ar@theleopardmark.com; remit-to off by default (7.9). Price exceptions need a reason and Owner/Admin approval above a threshold (7.10). Sending and collection stay manual (7.5 open). |
| Ledger and kegs | Opening balances from a count sheet per origin that captures lot codes (8.1, 8.2). No QC hold (8.3). Keg balance per account by size, counts only (8.4); zero at cut-over with manual opening balances (8.5). MicroStar outbound report per distributor and per brewery, monthly (8.6). Adjustments with reason codes and approval above a quantity (8.7). TTB removal flag deferred: beer stays in bond until sold or destroyed (8.9). Raw materials out of scope (8.10). |
| People | No PIN import; temporary PINs; deactivation quick and complete (9.1). People per the recommendation with corrections: Katie Sloan never hired; James Williams, Jack Begley, Ricardo Villanueva gone; two new NorCal reps; **no emails or invites sent** (9.2). Office-only, room for a Host role (9.3). Back office (Admin) confirms and voids (9.4). Sales see only their market (9.5, 9.6). No emails; exceptions surface in the system; anything the Owner sees, Daniel and the main office see (9.7). Imports and counts attributed and audited (9.8). |
| Migration | Tabs per 10.1; repeatable import with dry-run diff, final run at cut-over (10.2); Owner approves, Daniel reviews (10.3); one origin at a time, Richmond first (10.4); Ekos flag kept as a note (10.5); Slack references as text (10.6); line cleaning later (10.7); keep first-delivery and last-cleaning dates, drop the Google link (10.8); nightly read-only export workbook, Sheet frozen as archive (10.9); freeze the workbook the Apps Script writes to (10.10). |

## 2. Data model (migration `0004_shipments`)

All new ids are UUIDs. Imported rows use deterministic ids `md5('<entity>|<natural key>')::uuid` so the import is
idempotent and matches the reference data already loaded on October 28 (markets `market|<code>`, origins
`warehouse|<Location Information type or origin code>`, SKUs `sku|<code>`, accounts `location|<lower trade name>`).

### Reference data changes
- `market`: `terms_days int default 30`, `retail_keg_deposit_cents int default 3500`, `distributor_keg_deposit_cents int default 0`, `cod boolean default false`, `region_list text[]` (sub-list under the market).
- `warehouse` (origins): `market_id` becomes nullable; `origin_code text unique`, `lot_facility_code text`, `kind` enum `origin_kind` (`brewery`, `warehouse`, `cold_storage`), `appointment_required boolean`, `loading_dock boolean`, `liftgate_required boolean`, `hours jsonb`, `shipping_contact_name/email/phone`, `address_line1/line2/city/state/postal_code` (text, nullable; `address_text` kept).
- `customer_location`: `kind` enum `account_kind` (`retail`, `distributor`, `warehouse`, `host`, `internal`, `individual`) default `retail`; `served_by_location_id uuid` (FK to the distributor account, null = direct); `legacy_account_id text`; `terms_days_override int`; `deposit_mode` enum (`market_default`, `per_keg`, `floating`, `none`) default `market_default`; `deposit_cents_override int`; `fulfilment` enum (`delivery`, `pickup`) default `delivery`; `appointment_required boolean`; `pallet_rule text`; `receiving_requirements text`; `first_delivery_on text`; `region text`.
- `sku`: `upc_case`, `upc_retail`, `upc_unit` (text), `pallet_fraction numeric(6,4)`, `recipe_variant text` (position 4), `shelf_life_days int` (null until 4.8 day counts arrive).
- `sku_alias` (`alias text pk`, `sku_id`): legacy codes and dotted codes resolve to the active SKU.
- `pos_item` (`id`, `code text unique`, `name`, `active`): seeded with TAPHANDLE-STD, TAPHANDLE-PREM, GLASS-PINT-CASE, COASTERS.
- `company_settings` (single row id `00000000-…-0001`): `legal_name`, `dba`, `office_line1/line2/city/state/postal_code`, `ar_email`, `retail_footer`, `distributor_footer`, `fixed_lines text[]` (keep-cold line), `nmfc_keg`, `nmfc_can`, `nmfc_status` (`proposed` / `approved`), `marking_convention text`.

### Lots
- `brew_batch`: `id`, `facility_warehouse_id`, `brand_code` (SLG, CNT, GSP, XHZ, XVN, XAL), `batch_number` unique (B01CNT26001), `brew_date date`, `vessel_size text`, `status` enum (`scheduled`, `in_progress`, `complete`, `destroyed`, `cancelled`), `status_reason`, `status_changed_on date`, `brewery_batch_number`, `notes`, `source` (`imported`, `entered`).
- `lot`: `id`, `lot_code text unique` (facility 2 + brand 3 + yymmdd + run 1), `facility_warehouse_id`, `brand_code`, `packaging_date date`, `run_code text` (1 char), `batch_id` nullable, `quantities_known boolean`, `source` (`production_tab`, `bol_log_backfill`, `packaging_report`), `legacy_code text` (dotted scheme, never selectable), `notes`, `created_by_employee_id`, `created_at`.
- `lot_sku_qty`: `lot_id`, `sku_id`, `qty_packaged int`; unique (lot, sku).
- Lot picker rule (owner review, Oct 28): every lot with `legacy_code is null` is offered, newest first; a backfilled lot whose quantities are unknown (for example 05CNT2609021, on 31 of the 123 legacy documents) is offered **flagged "quantities unconfirmed"** and the line must carry a reason (4.6); confirming such a line opens exception `lot_quantities_unconfirmed` once per lot. Dotted legacy lots are never offered (1.7).

### Shipments
- `shipment`: `id`, `number text unique` (null while draft), `type` enum `shipment_type` (`D`, `T`, `S`), `origin_warehouse_id`, `destination_location_id` nullable, `destination_warehouse_id` nullable (type T), `destination_text` nullable (samples to a person or event), `pickup boolean` (will-call), `template` enum (`distributor`, `retail`, `transfer`), `scheduled_date date`, `actual_date date`, `status` enum (`draft`, `confirmed`, `staged`, `out`, `delivered`, `voided`), `po_numbers text[]`, `appointment text`, `carrier`, `carrier_phone`, `seal_number`, `trailer_number`, `pallet_count int`, `pallet_build text`, `freight_class`, `delivery_window`, `receiving_instructions`, `notes`, `override_reason` (2.6), `driver_employee_id`, `revision int default 0`, `legacy boolean default false`, `legacy_payload jsonb`, `merged_into_shipment_id`, `created_by/at`, `confirmed_by/at`, `delivered_by/at`, `voided_by/at`, `void_reason`, `market_id` for scoping — D and S take the destination account's market, T takes the destination origin's market, a sample to a free-text destination takes the origin's market (owner review, Oct 28: a Richmond pickup by Matagrano is NorCal Distributed, a Richmond transfer to EWD is NorCal Self Distribution).
- `shipment_line`: `id`, `shipment_id`, `line_no`, `sku_id` nullable, `pos_item_id` nullable, `lot_id` nullable, `lot_code text` (legacy text when no lot row), `qty int`, `unit_price_cents int` nullable (captured at confirmation from the price list / override), `weight_lb numeric`, `lot_reason text` (4.6).
- `shipment_order` (`shipment_id`, `order_id`): PO linkage, many-to-many.
- `shipment_keg_pickup`: `shipment_id`, `half_in int`, `sixtel_in int` (empties collected at a retail stop).
- `bol_counter`: `origin_warehouse_id`, `scheduled_date date`, `last_seq int`; pk (origin, date). Confirmation runs
  `insert … on conflict do update set last_seq = bol_counter.last_seq + 1 returning last_seq` inside the confirming
  transaction, so two confirmations for the same origin and date serialise on the row (5.3, 5.12).
- `shipment_allocation`: `shipment_id`, `warehouse_id`, `sku_id`, `qty`, `released_at`. Availability for orders and
  shipments = on hand − active order reservations − active shipment allocations.
- `shipment_receipt` (type T): `shipment_id`, `received_on`, `received_by_employee_id`, lines (`sku_id`, `qty_received`), `discrepancy_note`.
- `shipment_document`: `id`, `shipment_id`, `kind` enum (`bol`, `picking_ticket`, `pickup_pack`, `pull_sheet`), `revision int`, `number text`, `snapshot jsonb`, `pdf bytea`, `created_by/at`.
- `stock_movement.kind` gains `shipment_out`, `count`; `stock_movement.lot_id` nullable; `stock_movement.shipment_id` nullable.
- `count_session` (`warehouse_id`, `counted_on`, `status` draft/applied, `entered_by`, `applied_at`) and `count_line` (`session_id`, `sku_id`, `lot_code`, `qty`). Applying a session writes one `count` movement per SKU bringing on hand to the counted total and records lot codes on the lines for later per-lot balances.

### Numbering
`ORIGIN-TYPE-YYMMDD-SEQ`: origin = `warehouse.origin_code` (confirmation refuses an origin without a code), type = D/T/S,
date = scheduled date at confirmation, seq = three digits from `bol_counter`, resets per origin per day. The number never
changes; moving the actual date does not renumber. A void keeps the number as a permanent gap. Regeneration of a document
after an edit increments `shipment.revision` and prints `R<n>` after the number.

### State machine
`draft` → `confirmed` (number assigned, allocations written, BOL + picking ticket snapshot and PDF stored, invoice draft
created for D and S; for a **pickup** shipment the invoice is issued at confirmation, dated the scheduled pickup date, so
the numbered invoice travels in the pickup pack — owner review, Oct 28) → `staged` (optional, distributor loads) → `out`
(optional, driver day) → `delivered` (actual date set by the office: allocations consumed, `shipment_out` movements
written per line, keg event written, invoice issued with invoice date = actual date; a pickup invoice already issued is
re-dated to the actual date when it differs, number unchanged) ; any non-delivered state → `voided` (reason required; allocations released; number kept;
draft invoice voided). Type T: delivery writes `transfer_out` at the origin and `in_transit` at the destination; a
`shipment_receipt` moves in_transit to on hand and raises `receiving_discrepancy` when counts differ (5.8).
Legacy shipments are inserted directly as `delivered` with `legacy = true` and never touch the ledger.

### Kegs
`keg_event`: `id`, `location_id`, `shipment_id` nullable, `on date`, `half_out`, `sixtel_out`, `half_in`, `sixtel_in`,
`kind` (`shipment`, `pickup`, `opening`, `adjustment`), `note`, `recorded_by`. Balance per account by size = Σ out − Σ in.
A delivered D or S shipment writes `*_out` from its keg lines and `*_in` from `shipment_keg_pickup`. Opening balances are
`opening` events entered by hand (8.5).

### Invoices
- `invoice`: `id`, `number text unique` (INV26xxx or NC26xxx), `series` (`INV`, `NC`), `location_id`, `market_id`, `status` enum (`draft`, `issued`, `paid`, `void`), `legacy boolean`, `legacy_status text` (Sheet text, 7.6), `invoice_date date`, `due_date date`, `terms_days int`, `fob_wording text`, `subtotal_cents`, `deposit_cents`, `total_cents`, `notes`, `issued_by/at`, `voided_by/at`, `void_reason`, `legacy_payload jsonb`.
- `invoice_line`: `invoice_id`, `line_no`, `kind` (`beer`, `deposit`, `pos`, `info`), `shipment_line_id` nullable, `sku_id` nullable, `description`, `qty`, `unit_price_cents`, `line_total_cents`, `lot_code`.
- `invoice_shipment` (`invoice_id`, `shipment_id`).
- `doc_counter` (`series`, `year`, `last_seq`): seeded INV/2026 = 375 and NC/2026 = 1 from the Sheet, so the next numbers are INV26376 and NC26002 (7.1, 7.3).
- `price_override`: `location_id`, `sku_id`, `price_cents`, `reason`, `approved_by_employee_id`, `effective_from/to`.
- Invoice rules: price = account override else market price effective on the invoice date; distributor and `kind =
  distributor` accounts get `fob_wording = "FOB brewery or designated warehouse"` and MicroStar information lines (kegs
  out by size); retail gets a deposit line at the market rate unless `deposit_mode` is `floating` or `none`; terms =
  account override else market `terms_days`; S shipments issue on the NC series with every line at $0.

### Legacy history
- BOL Maker Log → `shipment` rows (`legacy = true`, status `delivered`, `number` = legacy number, `type` from the prefix letter, P → D with `pickup = true`, "The Leopard Mark" ship-to → type T with `destination_text = "Driver stock load (legacy)"`), lines by SKU alias with `lot_code` text and a `lot_id` when a lot row exists. Duplicate `WLA-090326-1` merges into `WLA-090326-01` (`merged_into_shipment_id`).
- Sales tab → `invoice` rows (`legacy = true`, `legacy_status` = Sheet text, lines from Sales lines, linked to legacy shipments by BOL number when present).
- Production and Packaged Products → `brew_batch` and `lot` (+ `lot_sku_qty`); the 17 lot codes present only on BOLs → `lot` rows with `source = bol_log_backfill`, `quantities_known = false`, and one exception `lot_quantities_unconfirmed` each.

## 3. Access
New actions (Owner always; "back office" = `admin`):
`shipment.view` (admin, accounting, sales; driver_service for assigned stops), `shipment.manage` (admin), `shipment.confirm` (admin), `shipment.deliver` (admin), `shipment.void` (admin), `shipment.receive` (admin), `lot.view` (admin, accounting, sales), `lot.manage` (admin), `invoice.view` (admin, accounting, sales), `invoice.issue` (admin, accounting), `invoice.void` (admin, accounting), `keg.view` (admin, accounting, sales), `keg.record` (admin), `count.record` (admin), `settings.manage` (Owner only), `import.dry_run` (admin), `import.apply` (Owner only), `report.export` (admin, accounting).
Market scoping is unchanged: Sales see only their market's accounts, shipments and invoices (9.5, 9.6). No email is sent by any flow in this build (9.7).

## 4. Documents
Rendered server-side with `@react-pdf/renderer`, stored as `shipment_document` rows at confirmation and regenerated on
demand with a revision mark. Templates:
- **Distributor / freight BOL** (destination kind distributor, or type T): shipper block (company settings), Ship From = origin address, Ship To, PO numbers, appointment, carrier, seal and trailer (optional), pallet count and build, lines with SKU, case UPC, lot, qty, unit weight, total weight; freight class and NMFC (from settings when approved); fixed lines (keep cold); deposit and CRV wording (6.4) — wording placeholder until the owner's example arrives; no signatures for pickup; carrier signature for freight.
- **Retail delivery receipt** (destination kind retail or other): Ship From = origin, Ship To, delivery window, receiving instructions, lines with lot, empty-keg pick-up by size, Delivered By / Received By signatures, licensed-receiver acknowledgement, retail footer from settings.
- **Picking ticket**: warehouse-facing, no prices; origin, scheduled date, destination, lines with lot and qty, pallet build.
- **Pull sheet** (5.2): all confirmed shipments for an origin and scheduled date aggregated by SKU and lot, plus the per-stop list.
- **Invoice**: header from settings, INV/NC number, invoice date, due date, terms, lines, deposit or MicroStar info lines, FOB wording for distributors, no signature blocks, no remit-to unless enabled. No arrow characters anywhere; write "to".
- **Pickup pack**: BOL followed by the invoice in one PDF.
- **Batch print**: one PDF with every document for an origin and date.

## 5. Import (in-app, repeatable)
`/admin/import`: upload an `.xlsx` export of the TLM Master File → parser reads Customer Accounts, Accounts (supplement
only), Location Information, SKU Master, Product Information, Commodities, Production, Packaged Products, BOL Maker Log,
Sales, Reps (names only) → normaliser produces records with the deterministic ids above → **dry run** stores an
`import_run` (`status = dry_run`) with a diff per entity (create / update / unchanged / excluded / flagged) → Owner
approves (`import.apply`) → apply writes in one transaction, upserting by id, never deleting, and records
`import.location` style audit events. The Python prototype that produced the October 28 load lives at
`tools/import/` for reference; the TypeScript import in `src/lib/import/` is the maintained one.

## 6. Exports
- `/reports/microstar`: monthly outbound kegs per distributor and per brewery (8.6), CSV and on-screen.
- `/reports/export`: a read-only workbook (accounts, origins, SKUs, prices, lots, shipments, invoices, stock, keg balances) downloadable on demand; the nightly push to a Google Sheet (10.9) is wired as a job that runs only when Google credentials are configured and the Google Workspace gate is selected. Until then the workbook is downloaded by hand.

## 7. Routes
`/shipments` (list, filters: origin, date, status, type) · `/shipments/new` · `/shipments/[id]` (edit, confirm, stage, out, deliver, void, documents, receive) · `/shipments/print?origin=&date=` (batch print, pull sheet) · `/lots` · `/lots/new` (packaging report) · `/lots/[id]` · `/batches` · `/invoices` · `/invoices/[id]` · `/kegs` (balances by account and size, opening balances) · `/admin/counts` · `/admin/counts/new` · `/admin/settings` · `/admin/import` · `/admin/markets` (billing rules, origin fields) · `/admin/catalog` (UPCs, pallet fraction, aliases, POS items) · `/reports/microstar` · `/reports/export`.
Navigation: "Shipments", "Lots", "Invoices" for admin/accounting; Sales see Shipments and Invoices (view only); Driver sees assigned stops.

## 8. Acceptance (tests)
1. Confirming two drafts for the same origin and scheduled date in parallel yields `-001` and `-002`; a different origin or date restarts at `-001`.
2. Confirmation refuses an origin without an origin code; refuses a D shipment to a distributor-served account without `override_reason`; refuses a beer line without a lot; allows a lot with unknown quantities only with a reason and opens one exception.
3. Confirm allocates; availability for orders drops by the allocated qty; void releases and keeps the number; deliver writes `shipment_out` per line, a keg event, and issues the invoice dated the actual date; renumbering never happens when the actual date differs from the scheduled date.
4. Type T delivery puts stock in transit at the destination; a receipt with a short count raises `receiving_discrepancy`.
5. INV numbers continue from INV26376; NC from NC26002; an S shipment issues an NC invoice with $0 lines; a retail invoice carries a $35 per-keg deposit line; a distributor invoice carries none and prints the FOB wording and MicroStar info lines; a floating-deposit account carries no deposit line.
6. Documents render for each template; the BOL for a voided shipment prints VOID; a regenerated BOL prints R1; a pickup pack contains both documents; batch print returns one PDF for an origin and date.
7. Import dry run against the October 28 workbook reports 139 accounts unchanged (ids match the production load), 123 legacy shipments, 374 legacy invoices, 43 batches, 17 backfilled lots; apply is idempotent (second run reports no changes).
8. Sales in SoCal cannot see NorCal shipments or invoices; Driver sees only assigned stops; Admin confirms and voids; only the Owner applies an import or edits company settings.
9. No flow sends email; every import, count, confirmation, delivery and void writes an audit event.

## 9. Out of scope for this release
Invoice sending and payment collection (7.5 open; Stripe limitations to be worked out), QuickBooks sync, Slack notices,
route optimisation, host logins, raw materials, prospect routes, TTB removal records, QC holds, Texas (Reyes), Rhode
Island, nightly push to Google Sheets (export workbook only), section 11.2 to 11.7.
