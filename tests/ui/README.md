# Role browser journeys (Playwright)

`tests/ui/journeys.mjs` runs the nine role-based journeys of the hardening brief (§6.3), plus a tenth for the
email + PIN sign-in, an eleventh for the setup page, a twelfth for the shipments module (origins, lots,
shipments, documents, delivery, invoice, kegs), a thirteenth for the navigation sections per role, and five for
the second round (14 order to confirm in one screen, 15 short-stock submit with override and hold, 16 the driver
delivering with a refused line, 17 a no-charge sample to a rep's home address, 18 the end-of-day pull sheet for
Balmuth), against a running local demo. Each journey asserts the **visible result** (flash messages, page text) and the **persisted
outcome** (re-read after a fresh page load), takes full-page screenshots of the changed views, and records
step counts and wall-clock time. This is automated validation with fictional data — it is not a staff
usability session (see `docs/STAFF_SESSION_SCRIPT.md` for that).

```bash
npm run demo                         # shell 1: zero-setup demo (embedded database, fictional data)
npm run test:ui                      # shell 2: journeys 1 to 24; exits 1 on any failed assertion, page error or 5xx
WARM_UP=1 npm run test:ui            # serve every route once as the Owner before the journeys (a small machine: the first render of a route in next dev is memory-hungry)
JOURNEYS=14,15 npm run test:ui       # only some journeys (by number), when iterating on one
SHOTS_DIR=/tmp/shots npm run test:ui # choose where screenshots + timings.json land (default tests/ui/shots/, git-ignored)
```

`playwright` is a pinned devDependency; its Chromium is installed with `npx playwright install chromium`
(CI does this). Set `CHROMIUM_PATH` to use another Chromium binary. `BASE_URL` overrides `http://localhost:3000`.

The journeys build on one another (journey 1 creates the account that journeys 2, 3, 5 and 9 use; journey 12
uses the half-barrel SKU because journey 2 archives the sixtel; journey 16 delivers the stop the demo assigned to
the driver), so run the whole file. The seeded data is consumed by journey 2 (the price change), journey 4 (the
shortage receipt), journey 7 (offboarding) and journey 16 (the delivery), so a second run needs `npm run demo:reset`
first. Journey 12 records a lot under the next free run digit for today and confirms a shipment whose number is
then permanent in that demo database. The demo warehouses are EWD Express Wine Delivery (NorCal) and WLA Balmuth &
Co. (SoCal); the breweries hold their own lot stock.

| # | Journey | Key assertions |
|---|---|---|
| 1 | Sales — new account (same-name warning), first order before license/setup | field error keeps typed values; warning-only duplicate name; readiness explained; order status line; order listed after reload |
| 2 | Sales — repeat after a price change and SKU archival | price-changed badge and "not carried over" notice; new order number; exactly one order after a double click |
| 3 | Sales/Admin — change request, amendment, stale action after cancellation | change request has no silent effect; D12 refusal on a repriced line; amendment applied on the order at current prices; stale amendment refused; no reservation on a cancelled order |
| 4 | Admin — receive stock, sample return, targeted resolution | receipt refills waiting demand oldest-first; only the fixed shortage case resolves; damage records a removal; second sample return refused |
| 5 | Accounting — payer authority, bank setup link through Approvals (round 4) | *Send bank setup link* disabled until payer authority is assigned (never inherited from AP); the request queues an approval item and the account reads *Setup link queued for approval* (`j5-01-payer-and-setup-queued`); on Approvals the item is approved for a hand send (the send switch is off), the Stripe-hosted link exists only after *Generate the bank setup link* and then shows in the message text (`j5-02-approval-with-link`); the send is recorded with evidence; the account reads *Setup link sent, waiting on the payer* and the item is listed under Done |
| 6 | Owner — typed decision selection, market override, withdrawal | matrix by market; NC-only future override leaves MA on the global basis; single withdrawal keeps the rest; history retained |
| 7 | Owner/Admin — disable mid-session, offboard, reuse the email | open session refused on next request; retired identity; new person with only the assigned grant |
| 8 | Driver/Service — honest empty state, no leak | accounts/orders/search refused; product search works; menu lists only permitted destinations |
| 9 | Mobile — Owner frequent tasks and every destination | bottom bar + More menu; skip link and visible focus; searchable account picker distinguishes same-name accounts; sign-out |
| 11 | Setup page | state card shows migrations/Owner; an action without the setup token is refused |
| 10 | Sign-in — email + PIN | wrong PIN refused generically with the email kept; correct PIN signs in with internal authority only; Admin-set temporary PIN → old PIN refused → forced *Choose your PIN* → weak PIN refused → normal use |
| 12 | Shipments — origin code, packaging lot, order drafts and confirms the shipment, BOL PDF, delivery issues the invoice and posts kegs | Admin sets `EBB` / lot facility `01` / kind brewery on East Brother in the origins editor and the code persists after reload as `EBB East Brother` (`j12-01-origins`); the packaging report records a Cantinesca lot with a computed code of the shape `01CNT` + yymmdd + run and shows the quantities packaged (`j12-02-lot`); a delivery to a demo account starts from an order with a PO number and *Submit and confirm shipment* reports `EWD-D-YYMMDD-SEQ` confirmed in the same go, the order page shows it (`j12-03-order-with-shipment`), the BOL and picking ticket are stored, the INV draft exists and stock is allocated at EWD; the BOL and picking ticket routes return `application/pdf` bodies starting with `%PDF`, and the batch print for the origin and date renders; *Mark delivered* with the actual date, the per-line quantities and one empty half barrel reports the delivery, shows an `INV` + five-digit number and the empties collected, and removes the state actions (`j12-04-delivered`); the invoice is listed, its PDF renders, it is issued and carries the keg deposit line (`j12-05-invoice`); the Kegs page has a balance row for the account and the Shipments list shows the number as delivered (`j12-06-shipments-list`); Sales in the same market can open the shipment but sees no void or regenerate controls; an unassigned Driver cannot open it |
| 13 | Navigation — sections in the row, the current section underlined, its pages on the second row, per role | The Owner's row is Accounts, Orders, Shipments, Stock, Invoices, Kegs, Reports, Exceptions, Admin in that order (the MicroStar report sits under Kegs, R2-35; Reports is its own section since round 4), and a single-page section (Shipments) has no second row; /admin/markets and /batches land in Stock (Lots, Stock counts, Markets & stock), /admin/intake in Orders (Orders, Email intake), /finance in Invoices, /reports/microstar in Kegs (Kegs, MicroStar report), /admin/exceptions and /approvals in Exceptions (Exceptions, Approvals, Notices), /reports/ca-sales in Reports and /admin/settings in Admin with its eight pages (`j13-01-owner-stock`); a Sales rep's row is Accounts, Orders, Shipments, Invoices, Kegs with Orders holding one page, and /lots still opens for Sales by URL; a Driver's row is Shipments only |
| 14 | Office — order to confirm in one screen (R2-1, R2-3) | the account picker, then source, products, requested and scheduled dates; *Submit and confirm shipment* records the order and reports `EWD-D-YYMMDD-SEQ confirmed for <date>`; the order page shows the source and the confirmed shipment (`j14-01-order-confirmed`); the BOL and picking ticket print from the order page; the orders list shows the shipment next to the order |
| 15 | Office — short-stock order (R2-5) | asking for 50 Sunlight sixtels shows the shortfall panel with asked, on hand and short per line (`j15-01-shortfall`); *Submit anyway* without a reason is refused with the panel kept; with a reason the order records "Shipped what was on hand", the reason and who decided (`j15-02-short-order`); *Hold* keeps the order held with no shipment; *Lift hold* with a reason reopens it (`j15-03-hold-lifted`) |
| 16 | Driver — deliver from the phone with a refused line (R2-8, R2-38) | the driver's *My stops* lists only the assigned Mission Taproom stop, no prices or other accounts (`j16-01-my-stops`); *Mark delivered* with one case refused reports the delivery and the stop leaves the list; the office sees shipped, kept, refused and damaged per line, the correction control and the invoice issued for the kept quantity (`j16-02-delivered-with-refusal`); the order stays partly delivered |
| 17 | Office — samples as a no-charge order (R2-27, R2-28) | the picker groups the samples recipients (the market's samples house and the rep's home address); on the rep's home *No charge* is on by default and the $90 rule does not apply; *Submit and confirm* reports `WLA-S-YYMMDD-SEQ` from Balmuth; the order is marked no charge (`j17-01-sample-order`); the shipment carries the NC invoice and is typed S |
| 18 | Office — end-of-day pull sheet for Balmuth (R2-29) | *End of day* for WLA Balmuth and the day of the seeded Echo Park stop lists the stop and the aggregate by SKU and lot (`j18-01-end-of-day`); the pull sheet PDF and the day's documents download; auto-send reads *Off (Company settings)* and the Owner's switch is off |
| 19 | Accounting — approve an invoice into Stripe; record a receipt sent by hand (round 4) | the queue holds the seeded items (`j19-01-queue`); approving Silver Lake's Stripe copy runs it at once against the gateway (*Approved and done*); the invoice shows the copy under the portal's number, *Debit scheduled, debit on* the next business day after a weekend due date, the hosted page link and *no verified bank on file* (`j19-02-invoice-collection`); the receipt email is approved for a hand send, its text shown, the send recorded; Sales cannot open Approvals |
| 20 | Accounting — bank on file, the paid invoice, Finance (round 4) | Dogpatch reads *Demo Community Bank ending 4242, verified*, debits wait for approval, card not offered; the payment history lists the ACH debit (`j20-01-account-payments`); the paid invoice shows the copy, an open balance of $0.00, no *Record payment*, the settled debit on its Payments tab (`j20-02-paid-invoice`); Finance lists the ageing with Silver Lake's open invoice, one settled payment, the payout (`j20-03-finance`); the ageing, payouts and CFO CSVs download, the CFO export has a section per table and no arrow characters |
| 21 | Admin — Stripe matching (C2) | *Import from Stripe again* lists two legacy customers and the hand-made invoice BC-0192 (`j21-01-matching`); Marina is suggested by its unique billing email while Golden Gate Grill (two accounts of that name) is not; confirming links the customer and Marina's account shows the legacy bank ending 7781 and the customer id; the legacy invoice is dismissed with a reason and stays under All (`j21-02-after`) |
| 22 | Office — split shipments (R2-39) | *Split* on Silver Lake's three-case draft moves one case to a second draft and lands on it (`j22-01-second-draft`); the order lists both drafts, says it ships in two parts and offers no further draft while one is in play; the seeded Echo Park order shows a numbered first part and a drafted second (`j22-02-two-part-order`) |
| 23 | Admin — intake with a draft (round 4) | the Dogpatch email arrives with *medium confidence*, the account by the sender's address, PO 4471, two lines (by code and by name) and the note to check quantities (`j23-01-intake-draft`); the convert form is pre-filled and converts to an order carrying the PO; a pasted email from an unknown sender gets no account, says so, and still reads the line by name and package (`j23-02-unknown-sender`) |
| 24 | Owner — reports, the round 4 switches, Integrations | California sales by format with barrels and its CSV (`j24-01-ca-sales`); the sample write-off and its CSV (`j24-02-sample-writeoff`); every round 4 switch off by default and the two sender addresses set (`j24-03-settings`); Integrations lists Gmail as truthfully not connected and Stripe as the in-memory stand-in (`j24-04-integrations`) |

## Go-live path on a production build (`tests/ui/production-setup.mjs`)

Runs the exact first-run sequence of a fresh deployment against an **empty** real Postgres: `/setup` →
wrong token refused → migrations applied → first Owner provisioned with a temporary PIN → sign-in → forced
*Choose your PIN* → Owner home → Employees & access; then checks that the production build shows no demo
banner and no fixture sign-in. CI runs it on every push; locally:

```bash
createdb fv_golive && npm run build
DATABASE_URL=postgres://…/fv_golive FV_ENV=production SESSION_SECRET=<16+ chars> CRON_SECRET=<16+ chars> PORT=3100 npm run start
BASE_URL=http://localhost:3100 SETUP_TOKEN=<the CRON_SECRET> npm run test:ui:golive
```
