// GENERATED from the master brief §52 by scripts/extract-decisions.py — do not hand-edit rows.
import type { DecisionSeed } from "./types";

export const DECISION_REGISTER: DecisionSeed[] = [
  {
    "id": "D01",
    "register": "D",
    "question": "What does \"established/run\" mean: valid authorization, initiated debit, or first successful payment? What is FinTech equivalence? How do partial receipt, concurrent orders, failed/cancelled/unknown attempts, remainder visits, false-receipt correction, and later revoked authorization affect the allowance?",
    "confirmedBehavior": "First-delivery allowance and order capture before setup; second-delivery prerequisite exists.",
    "safeSupport": "Represent readiness evidence, visits and an unselected release interpretation.",
    "keepInactive": "Do not release a second delivery using an invented test or auto-consume/restore a first allowance under an unselected edge-case rule.",
    "accountable": "Owner with Accounting. Before affected delivery-release behavior; not account/order capture.",
    "title": "Second-delivery “established/run” meaning and first-allowance edge cases",
    "selectionSchema": {
      "readiness_interpretation": "one of: valid_authorization | initiated_debit | first_successful_payment",
      "fintech_equivalence": "free text",
      "partial_receipt_consumes_allowance": "true|false",
      "zero_receipt_failure_consumes_allowance": "true|false"
    }
  },
  {
    "id": "D02",
    "register": "D",
    "question": "What establishes a legitimate serviceable location, what verification is required per market, when is it refreshed, and which identity/license changes require review? Who can resolve exceptions?",
    "confirmedBehavior": "Company verifies required license before applicable first delivery; no resale-onboarding expansion.",
    "safeSupport": "Retain supplied/enriched evidence, market applicability and review state.",
    "keepInactive": "No invented refresh schedule, new compliance requirement or false verified status.",
    "accountable": "Owner with responsible compliance adviser/Admin. Before affected market/delivery verification use; ordinary capture can proceed.",
    "title": "Serviceable location, license verification, refresh and material change",
    "selectionSchema": {
      "verification_required_markets": "list of market codes needing license verification before first delivery (default: all)"
    }
  },
  {
    "id": "D03",
    "register": "D",
    "question": "What resolves a failure blocker, what can Admin override, and for how long? Does a pending retry ever justify a separate override?",
    "confirmedBehavior": "Definitive-failure causal holds, automatic valid resolution and audited Admin override.",
    "safeSupport": "Represent cause versus override and support scoped choices without a default.",
    "keepInactive": "No new named-delivery limit, expiry or mandatory second approval until chosen.",
    "accountable": "Owner. Before proposed override restrictions/new blocker-resolution subchoices; existing powers persist.",
    "title": "Failure blocker resolution and Admin override scope/expiry"
  },
  {
    "id": "D04",
    "register": "D",
    "question": "Does unpaid overdue debt without a definitive failure cause a hold? After what interval? How are unresolved FinTech remittances treated?",
    "confirmedBehavior": "Confirmed failure holds and legitimate order capture continue.",
    "safeSupport": "Represent past due separately and owned follow-up.",
    "keepInactive": "No overdue-only hold from elapsed time or unmatched money alone.",
    "accountable": "Owner with Accounting. Only before additional overdue-hold/unselected remittance branch; ordinary collections need not wait.",
    "title": "Overdue-only hold and unresolved FinTech remittance"
  },
  {
    "id": "D05",
    "register": "D",
    "question": "When should setup, missing payment attempts, aged processing, failed attempts, and retries be reviewed? How many retries, at what intervals, with what customer notice?",
    "confirmedBehavior": "Delivery-derived terms; processing alone is not failure.",
    "safeSupport": "Track initiation/result/age and explicit review/recovery selection.",
    "keepInactive": "No invented attempt count, interval, review deadline or native setting.",
    "accountable": "Owner/Accounting. Before relevant collection/review/retry operation; optional recovery automation can wait.",
    "title": "Setup/attempt review timing, retry cadence and notices"
  },
  {
    "id": "D06",
    "register": "D",
    "question": "Who approves payer/channel changes? What establishes FinTech readiness? How are authorization revocation, unusable methods, pending attempts, unmatched remittance, and reauthorization handled?",
    "confirmedBehavior": "Reusable authorization, intentional location payer authority, FinTech support and existing Admin/Accounting powers.",
    "safeSupport": "Track chosen channel, intended scope, old attempts, receipt evidence and pending change.",
    "keepInactive": "No transfer of in-flight collection, unproved cancellation, cross-location mandate reuse or invented FinTech readiness.",
    "accountable": "Owner with Admin/Accounting. Before affected payer/channel/authorization change or receipt application.",
    "title": "Payer/channel changes, revocation, FinTech readiness and allocation authority"
  },
  {
    "id": "D07",
    "register": "D",
    "question": "Which address/identity edits are routine? When is a new location/operator required? How are true duplicates, inactive accounts, closures, and remaining obligations handled?",
    "confirmedBehavior": "Separate locations, legitimate matching names, retained old obligations and permitted routine edits.",
    "safeSupport": "Retain identity history, suspected duplicate and lifecycle requests with linked balances.",
    "keepInactive": "No silent operator merge, debt/credit transfer, standing closure behavior or reopening clearance.",
    "accountable": "Owner/Admin with Accounting where obligations change. Before affected lifecycle change; initial ordinary capture can proceed.",
    "title": "Identity/address/operator change, duplicates, inactivity and closure"
  },
  {
    "id": "D08",
    "register": "D",
    "question": "Which people may order, see invoices, view balances, authorize payment, or access several locations? What are regional Sales visibility limits and field edit/approval boundaries?",
    "confirmedBehavior": "Five roles, current internal authorization, stable identity, shared contact is not broad authority.",
    "safeSupport": "Build employee grants/market scope and authorized contact associations; preserve deferred customer boundary.",
    "keepInactive": "No inferred cross-location/customer access or invented role restriction.",
    "accountable": "Owner/Admin. Employee authorization before use; broader customer-access choices deferred to phase 5.",
    "title": "Employee/customer/market visibility and authority boundaries"
  },
  {
    "id": "D09",
    "register": "D",
    "question": "Who handles unclear order email, which facts are required to accept it, and when should suspected duplicate demand be confirmed? What is the abnormal-order threshold?",
    "confirmedBehavior": "Minimal 24/7 intake, no name block, receipt is not a date promise.",
    "safeSupport": "Retain source requests and distinguish identifiable demand from incomplete inquiry.",
    "keepInactive": "No numeric abnormal threshold, unjustified rejection or guessed duplicate-cancellation decision.",
    "accountable": "Admin under Owner policy. Before affected ambiguous-intake/flagging behavior; technical intake support can proceed.",
    "title": "Ambiguous intake, duplicate demand and abnormal-order criteria",
    "selectionSchema": {
      "abnormal_max_line_qty": "integer, absolute per-line quantity above which an order is flagged",
      "abnormal_max_order_units": "integer, total units above which an order is flagged"
    }
  },
  {
    "id": "D10",
    "register": "D",
    "question": "Who may amend/cancel before scheduling, after commitment, or after loading? Who authorizes additional/substitute handover?",
    "confirmedBehavior": "Actuals and history retained; Driver has no implicit commercial power.",
    "safeSupport": "Support staged change requests and consequences.",
    "keepInactive": "No new cancellation/substitution/overdelivery authority.",
    "accountable": "Owner/Admin. Before the affected amendment or extra/substitute handover branch.",
    "title": "Order amendment/cancellation and extra/substitute handover authority"
  },
  {
    "id": "D11",
    "register": "D",
    "question": "What value counts toward $90; can orders combine by visit; may below-minimum demand be submitted pending consolidation; what exceptions cover shortages/replacements/service/pickup?",
    "confirmedBehavior": "$90 per location/delivery; no billing undelivered goods; nonsale tasks create no fee.",
    "safeSupport": "Retain component values and explicit unselected minimum basis/exemption.",
    "keepInactive": "No merchandise-only/deposit/credit basis, order-combination or below-minimum acceptance default.",
    "accountable": "Owner. Before affected minimum/release behavior, not unrelated account creation.",
    "title": "$90 minimum value basis, combination, below-minimum and exemptions",
    "selectionSchema": {
      "value_basis": "one of: merchandise_only | merchandise_plus_deposits | merchandise_less_credits",
      "combine_same_visit": "true|false",
      "below_minimum_pending": "true|false"
    }
  },
  {
    "id": "D12",
    "register": "D",
    "question": "When is price committed; how are new quantities, edits, reorders, standing orders, market changes, substitutions, and accepted orders for a later-archived product handled? Is any Admin commercial exception authorized?",
    "confirmedBehavior": "Fixed SKU/market prices; no Sales override; internal catalog master.",
    "safeSupport": "Retain price/change context and proposed commitment support.",
    "keepInactive": "No assumed price lock, repricing, standing/addition/substitution rule or unrestricted Admin override.",
    "accountable": "Owner. Before affected price-commitment/change branch.",
    "title": "Price commitment, later changes, standing/substitute/archived commitments",
    "selectionSchema": {
      "price_commitment": "one of: submitted_price_locked | current_price_at_delivery",
      "added_quantity_pricing": "one of: submitted_price | current_price"
    }
  },
  {
    "id": "D13",
    "register": "D",
    "question": "What standing-order cadence, generation horizon, pause/skip/end, authorization, and price-change notice apply? How do hold/inactivity affect generation?",
    "confirmedBehavior": "Standing orders required as internal demand; submitted occurrences follow ordinary allocation.",
    "safeSupport": "Support arrangements and occurrences without an active cadence/horizon.",
    "keepInactive": "No invented recurrence, pause/skip/end, held-generation or notice policy.",
    "accountable": "Owner/Admin. Before standing generation activates; ordinary orders proceed independently.",
    "title": "Standing-order cadence, horizon, pause/skip/end, authorization and notices",
    "selectionSchema": {
      "cadence_days": "integer days between occurrences (one occurrence per current cycle; never generated ahead)",
      "generate_when_held": "true|false"
    }
  },
  {
    "id": "D14",
    "register": "D",
    "question": "How long can blocked/far-future orders reserve stock? Who may reallocate, how is displaced demand informed, and what priority returns after release? What is routine allocation oversight?",
    "confirmedBehavior": "Submission allocation generally first-come-first-served; Admin exceptions; shortages retained.",
    "safeSupport": "Track commitments, age, displacement and explicit release choice.",
    "keepInactive": "No automatic expiry, lost demand or default restored priority.",
    "accountable": "Owner/Admin. Before proposed release/priority behavior; original allocation can operate.",
    "title": "Reservation release/expiry, reallocation and restored priority",
    "selectionSchema": {
      "reservation_review_days": "integer days after which a blocked reservation is reviewed (not auto-released)"
    }
  },
  {
    "id": "D15",
    "register": "D",
    "question": "How are partial/split deliveries, retained shortages, refusals, repeated attempts, and same-visit multi-order invoices handled?",
    "confirmedBehavior": "Bill accepted actuals/date; retain demand and each attempt.",
    "safeSupport": "Represent quantities, attempt history, residual options and invoice associations.",
    "keepInactive": "No automatic refusal reshipment, invented cancellation or multi-date/grouped invoice rule.",
    "accountable": "Owner/Admin/Accounting. Before affected partial/split/residual/grouping branch.",
    "title": "Partial/split/repeated attempts, residual defaults and invoice grouping"
  },
  {
    "id": "D16",
    "register": "D",
    "question": "Who confirms starting stock, receipts, samples, loads, transfers, returns, inspection, adjustments, and route close? What count/reconciliation cadence, tolerances, and stock freshness display apply?",
    "confirmedBehavior": "Allocation-oriented stock, sample consumption, Admin warehouse override and no damaged sellable stock.",
    "safeSupport": "Capture credible physical evidence and difference reconciliation.",
    "keepInactive": "No invented count frequency/tolerance, new fulfillment staff or unsupported stock release.",
    "accountable": "Admin with fulfillment partners. Before relevant live stock/custody operation; unused transfer/inspection branches need not block others.",
    "title": "Stock/custody accountability, evidence, cadence and tolerances"
  },
  {
    "id": "D17",
    "register": "D",
    "question": "What makes a keg return valid? How are excess/foreign/misattributed/full/sample kegs and legacy opening counts/deposits handled? What aging method and bands apply?",
    "confirmedBehavior": "$35/count-based custody; every pickup recordable; no unsupported credit or unexplained negative balance.",
    "safeSupport": "Separate observation, receiving custody, location attribution, opening evidence and entitlement.",
    "keepInactive": "No invented foreign/legacy/sample/full-keg credit validity or aging convention.",
    "accountable": "Owner/Admin with Accounting. Validity before the relevant keg branch; optional aging bands/method can wait.",
    "title": "Keg return validity, foreign/excess/legacy attribution and aging"
  },
  {
    "id": "D18",
    "register": "D",
    "question": "Timing resolved by owner U17: available credit applies to the next finalized invoice; no same-return-delivery exclusion. Remaining choices: disputed credit, erroneous posted/used credit, pooled-credit source attribution, unused excess, closure, exceptional refund/transfer/expiry, and legacy entitlement.",
    "confirmedBehavior": "U17 next-finalized timing already settled; preserve unused value and no ordinary cash refund.",
    "safeSupport": "Track entitlement, actual Stripe posting/use/reversal and exceptional disposition request.",
    "keepInactive": "No expiry, transfer, refund, consumed-credit recovery or optional source-attribution convention by default.",
    "accountable": "Owner/Accounting. Before affected exceptional credit/disposition behavior; normal valid U17 application proceeds.",
    "title": "Credit disputes/errors, used-credit correction and exceptional disposition (timing resolved by U17)"
  },
  {
    "id": "D19",
    "register": "D",
    "question": "May routine scheduling occur within Admin-approved rules? What route capacity, cutoff, stop duration, calendar, driver reorder, and notification rules apply?",
    "confirmedBehavior": "Admin scheduling authority, receiving restrictions and distinct plan/commitment/live assignment.",
    "safeSupport": "Support tentative/released work, constraints and changed-stop awareness.",
    "keepInactive": "No independent automatic schedule authority, cutoff or driver-reorder freedom until selected.",
    "accountable": "Owner/Admin. Before affected delegated scheduling/release behavior; unapproved optional tracking can wait.",
    "title": "Scheduling delegation, cutoffs, capacity, driver reorder and notifications",
    "selectionSchema": {
      "delegated_scheduling": "true|false"
    }
  },
  {
    "id": "D20",
    "register": "D",
    "question": "Which physical/digital signature combination satisfies receipt? Is photo capture mandatory per stop, and what does missing photography block? Who may authorize a missing-signature exception, and how is actual already-unsigned handover resolved?",
    "confirmedBehavior": "Normal signature, photo capability, truthful actuals and durable evidence.",
    "safeSupport": "Record evidence availability/versions and missing-signature exception.",
    "keepInactive": "No blanket signature waiver, universal photo block or invented paper/digital equivalence.",
    "accountable": "Owner/Admin. Before chosen receipt-evidence path; unusual exception remains unresolved until authorized.",
    "title": "Signature combination, missing-signature remedy and photo enforcement"
  },
  {
    "id": "D21",
    "register": "D",
    "question": "During unavailable field/billing/payment handoffs, what temporary evidence and actions are allowed, who owns recovery, and when is a repeat action permitted?",
    "confirmedBehavior": "Unknown is not failure; confirmed facts persist; consequential effects not blindly repeated.",
    "safeSupport": "Support pending handoff, evidence and restoration reconciliation.",
    "keepInactive": "No unapproved manual substitute action, second provider or custom offline system.",
    "accountable": "Admin/Accounting under Owner policy. Before relying on a temporary/provider-dependent recovery path; unrelated preparation proceeds.",
    "title": "Temporary evidence/actions during unavailable handoffs and outage recovery"
  },
  {
    "id": "D22",
    "register": "D",
    "question": "How are instant physical invoices provided? What invoice-evidence issues pause finalization? What happens when an invoice is first issued after its due date?",
    "confirmedBehavior": "Stripe delivery-day invoice and original delivery-plus-30 due date.",
    "safeSupport": "Track readiness/late issue, original dates and physical document demand.",
    "keepInactive": "No surprise late debit, due-date reset, planned morning invoice or signature bypass.",
    "accountable": "Owner/Accounting/Admin. Before affected instant-paper/late/evidence-exception invoicing branch.",
    "title": "Instant physical invoices, evidence exceptions and late first issue"
  },
  {
    "id": "D23",
    "register": "D",
    "question": "What closes a correction before billing, after issuance, during collection, after payment/period close, or after a credit was used on a later invoice? How are uncertain cancellation and late contradictory evidence handled?",
    "confirmedBehavior": "Admin correction authority, preserved history, actual payment stage and one effect.",
    "safeSupport": "Link affected consequences and show unfinished remedy.",
    "keepInactive": "No unproved cancellation, unsupported financial reopen or auto-debit for invalidated used credit.",
    "accountable": "Owner/Accounting/Admin. Before affected correction execution; keep established facts while remedy waits.",
    "title": "Stage-specific correction completion and late-evidence remedies"
  },
  {
    "id": "D24",
    "register": "D",
    "question": "What remedy components are authorized for product issues, replacement, goodwill, or dispute; what deposit/minimum treatment applies; who approves containment and release?",
    "confirmedBehavior": "Source-authorized credits, no mandatory issue photo, no normal cash refund.",
    "safeSupport": "Represent physical/financial/remedy components independently.",
    "keepInactive": "No inferred refund/replacement/deposit/minimum waiver or unapproved containment release.",
    "accountable": "Owner/Admin/Accounting with quality contact. Before relevant product issue/replacement/concession branch.",
    "title": "Product issue/replacement/goodwill remedy components and containment"
  },
  {
    "id": "D25",
    "register": "D",
    "question": "How are partial payments, disputes, full credit, zero-payable invoices, excess cash, credit during processing, reversals, late corrections, and closed periods treated? Is disputed collection paused or continued, and on which amount?",
    "confirmedBehavior": "Exact residual, actual receipt basis, no zero-payable debit, no duplicated collection.",
    "safeSupport": "Represent disputed/undisputed amounts and conditional supported remedy.",
    "keepInactive": "No silent dispute pause/continuation, partial/excess allocation, reversal or closed-period treatment.",
    "accountable": "Owner/Accounting and company accountant. Before affected financial branch; accountant selections for accounting effects.",
    "title": "Partial/disputed/credited/excess/reversed financial treatment"
  },
  {
    "id": "D26",
    "register": "D",
    "question": "What starts the location cleaning clock; what normal work is applicable; how are incomplete, skipped, external, or no-longer-applicable work resolved; when do overdue/skip cases escalate?",
    "confirmedBehavior": "Approximate biweekly simple cleaning, skip remains due, no automatic dedicated trip.",
    "safeSupport": "Track applicable task, baseline pending, completion/skip/reason/history.",
    "keepInactive": "No invented baseline/scope/external reset or numeric overdue escalation.",
    "accountable": "Owner/Admin/service lead. Before relevant service clock/remedy operates; unrelated beer work independent.",
    "title": "Cleaning baseline, scope, applicability and escalation",
    "selectionSchema": {
      "cleaning_interval_days": "integer"
    }
  },
  {
    "id": "D27",
    "register": "D",
    "question": "What exception categories/severity, next-action deadlines, backups, escalation, and review cadence are appropriate?",
    "confirmedBehavior": "One exception model, current business state, meaningful communication and retained history.",
    "safeSupport": "Support lead/next-action/review/severity choices without numeric defaults.",
    "keepInactive": "No adopted SLA, escalation deadline or new approval/hire.",
    "accountable": "Owner/Admin/Accounting. During affected module work, settled before reliance on its exception operating rule.",
    "title": "Exception severity, review timing, backups and escalation"
  },
  {
    "id": "D28",
    "register": "D",
    "question": "Which sensitive actions require evidence, targeted review, or new permission limits? Should source-authorized Admin FinTech confirmation/reconciliation be narrowed in any way?",
    "confirmedBehavior": "Existing Owner/Admin/Accounting/Sales/Driver powers remain.",
    "safeSupport": "Apply known permissions and retain audit; support explicit later changes.",
    "keepInactive": "No narrowing Admin FinTech/credit rights, universal dual approval or new threshold.",
    "accountable": "Owner. Only before a proposed new restriction; can remain unselected.",
    "title": "New permission restrictions, thresholds or second approvals"
  },
  {
    "id": "D29",
    "register": "D",
    "question": "What reconciliation cadence, evidence, tolerance, aggregate accounting method, and unresolved-difference escalation apply?",
    "confirmedBehavior": "Formal QBO, Stripe financial truth, one writer and transaction drill-through.",
    "safeSupport": "Support automatic matching, differences and source-to-posting associations.",
    "keepInactive": "No selected accounting aggregation/classification/cadence/tolerance by implementation.",
    "accountable": "Accounting with Admin and accountant. Before relevant posting/reconciliation/close reliance; no whole-project gate.",
    "title": "Reconciliation cadence, tolerance, aggregation and escalation"
  },
  {
    "id": "D30",
    "register": "D",
    "question": "Which phases may operate live, with what temporary responsibilities, opening balances, cutover date, and acceptance outcomes?",
    "confirmedBehavior": "Six phases; preserve history; no duplicate opening economics.",
    "safeSupport": "Prepare scoped migration inventory, comparisons and reversible technical work.",
    "keepInactive": "No assumed live cutoff, accepted opening estimates or two competing live processes.",
    "accountable": "Owner with Admin/Accounting. Before each affected live cutover; later phases need not be decided now.",
    "title": "Phase live scope, opening balances, cutoff and temporary responsibility"
  },
  {
    "id": "D31",
    "register": "D",
    "question": "What exactly are sales, active/dormant accounts, lifetime account value, attribution, and automation success? How are corrections, credits, samples, deposits, and dates counted?",
    "confirmedBehavior": "Reporting/automation measures and historical/current attribution must be supported.",
    "safeSupport": "Retain event/date/source dimensions and definitions marked unselected.",
    "keepInactive": "No invented revenue/value/dormancy/automation formula presented as approved.",
    "accountable": "Owner/management with Accounting. Before using the affected metric as an authoritative report.",
    "title": "Metric definitions and historical attribution meaning"
  },
  {
    "id": "D32",
    "register": "D",
    "question": "Who receives each order/schedule/invoice/payment/correction notice, which changes warrant notice, and what happens if delivery of an essential notice fails? Which Slack channels own categories?",
    "confirmedBehavior": "Required receipt/schedule/invoice/payment outcome notices; one normal purpose/sender; Slack not business state.",
    "safeSupport": "Build notice intent/evidence and the proposed matrix as unselected choices.",
    "keepInactive": "No activation of section 42's allocation, recipients, optional ETA or escalation by silence.",
    "accountable": "Owner/Admin/Accounting. Before affected automated notice/alert policy; authorized existing/manual single sender can continue.",
    "title": "Notice recipients, sender allocation, essential-failure handling and Slack routing",
    "selectionSchema": {
      "sender_allocation": "object purpose -> gmail|stripe_native"
    }
  },
  {
    "id": "D33",
    "register": "D",
    "question": "What is global policy versus market configuration, who is the selling/invoicing entity, what local dates/calendars apply, and who approves applicable invoice/compliance treatment?",
    "confirmedBehavior": "Confirmed global defaults, internal market policy, Stripe issuer/QBO GL.",
    "safeSupport": "Represent seller/market/date associations and approved applicability.",
    "keepInactive": "No inferred entity, legal rule, market exception, classification or Connect purchase.",
    "accountable": "Owner with appropriate advisers. Before relevant market/financial activation.",
    "title": "Global policy vs market configuration, selling entity, local dates and compliance"
  },
  {
    "id": "D34",
    "register": "D",
    "question": "How are originals/current documents distinguished, access retained after provider exit, and any later retention-policy change approved?",
    "confirmedBehavior": "Generally indefinite original/corrected business evidence and restricted-provider-content distinction.",
    "safeSupport": "Implement durable permitted retrieval and role-limited history with ordinary technical choice.",
    "keepInactive": "No deletion/retention-policy change or assumption temporary URLs satisfy custody.",
    "accountable": "Owner/Admin/Accounting. Custody/rights before evidence reliance; later policy change can remain deferred.",
    "title": "Durable evidence arrangements and retention/access policy changes"
  },
  {
    "id": "D35",
    "register": "D",
    "question": "When should capacity analysis, further FinTech automation, or additional management controls be added?",
    "confirmedBehavior": "Current scope/low-friction principle; future changes need demonstrated value.",
    "safeSupport": "Preserve clean boundaries and existing useful event history.",
    "keepInactive": "No speculative forecasting, new controls or automatic FinTech matching.",
    "accountable": "Owner/management. Safely deferred to justified enhancement decision.",
    "title": "Timing of capacity analysis, FinTech automation and management controls"
  },
  {
    "id": "SD01",
    "register": "SD",
    "question": "Exact day-30 initiation/calendar and late invoice treatment",
    "confirmedBehavior": "Due date is actual delivery +30; no automatic early collection or date reset.",
    "safeSupport": "Support separate due/initiation dates and late-issue exception.",
    "keepInactive": "Do not choose banking-calendar shifts or overdue first-issue notice/debit policy.",
    "accountable": "Owner/Accounting. Before that collection/late-issue branch; D05/D22/D33.",
    "title": "Day-30 initiation calendar and late invoice treatment"
  },
  {
    "id": "SD02",
    "register": "SD",
    "question": "Adoption of native one-off ACH recovery",
    "confirmedBehavior": "No competing collection, no retry-created debt, existing failure remains until resolved.",
    "safeSupport": "Expose actual eligible native recovery/attempt state.",
    "keepInactive": "Do not enable native retries or choose count/cadence from provider defaults.",
    "accountable": "Owner/Accounting. Before recovery automation; D05, not ordinary invoice issue.",
    "title": "Native one-off ACH recovery adoption"
  },
  {
    "id": "SD03",
    "register": "SD",
    "question": "ACH portal scope and customer surface",
    "confirmedBehavior": "Hosted payment credentials/mandates stay with Stripe; first delivery may precede setup.",
    "safeSupport": "Build demonstrated necessary transactional hosted setup/document access.",
    "keepInactive": "No assumed universal ACH portal management or broader customer surface.",
    "accountable": "Admin/Accounting. Setup gate before use; portal/access design deferred; D08/IG10.",
    "title": "ACH portal scope and customer surface"
  },
  {
    "id": "SD04",
    "register": "SD",
    "question": "Financial invoice numbering scheme",
    "confirmedBehavior": "Stripe owns financial invoice number; internal market order number remains distinct.",
    "safeSupport": "Support native number/reference display and retained financial documents.",
    "keepInactive": "No second number issuer or assumed business numbering convention.",
    "accountable": "Accounting/Owner. Before selected invoice issuance scheme; Accounting/Owner with D33.",
    "title": "Financial invoice numbering scheme"
  },
  {
    "id": "SD05",
    "register": "SD",
    "question": "Partial external payment and bulk-remittance representation",
    "confirmedBehavior": "One actual external receipt, exact residual and no overlapping collection.",
    "safeSupport": "Support receipt evidence/allocation references and capability demonstration.",
    "keepInactive": "No false fully-paid status/fictitious credit; no residual fallback with stale payable routes.",
    "accountable": "Accounting/Owner. Before affected external partial/bulk application; D06/D25/IG09.",
    "title": "Partial external payment and bulk-remittance representation"
  },
  {
    "id": "SD06",
    "register": "SD",
    "question": "Credit dispute/error while funds are already available or applied",
    "confirmedBehavior": "U17 actual available/application; no erased history or internal credit reservation.",
    "safeSupport": "Track source entitlement, posting/use and pending dispute/error remedy.",
    "keepInactive": "No unapproved consumed-credit recovery, source-consumption convention or closure disposition.",
    "accountable": "Owner/Accounting. Before relevant recovery; D18/D23–D25.",
    "title": "Credit dispute/error while funds already available or applied"
  },
  {
    "id": "SD07",
    "register": "SD",
    "question": "Supported post-payment reopening, unapplication and correction routes",
    "confirmedBehavior": "Preserve original paid/closed financial evidence and actual cash.",
    "safeSupport": "Represent correction intent/stage and supported linked remedy acceptance.",
    "keepInactive": "No universal paid reopen, unapplication of real cash to mimic reversal or invented adjustment.",
    "accountable": "Accounting/accountant. Before affected correction; D23/D25; accountant approves treatment.",
    "title": "Supported post-payment reopening, unapplication and correction routes"
  },
  {
    "id": "SD08",
    "register": "SD",
    "question": "Review timing and escalation for unknown/stuck finance",
    "confirmedBehavior": "Unknown stays owned; expected processing age is not failure.",
    "safeSupport": "Support last-known evidence, owner and unselected review/escalation points.",
    "keepInactive": "Do not adopt suggested immediate/same-day/daily/next-business-day windows.",
    "accountable": "Owner with Accounting/Admin. During financial module before reliance on review process; D21/D27/D29. IG08 only for actual temporary control.",
    "title": "Review timing and escalation for unknown/stuck finance"
  },
  {
    "id": "SD09",
    "register": "SD",
    "question": "Customer financial notices and collection permissions during disputes",
    "confirmedBehavior": "One intended notice/purpose; operational explanation separate; no guessed dispute collection.",
    "safeSupport": "Keep section 42 sender matrix explicit and unselected.",
    "keepInactive": "No broad Stripe-standard-message override of matrix; neither dispute pause nor continuation selected.",
    "accountable": "Owner/Accounting. Before affected automatic sender/dispute branch; D25/D32/IG04.",
    "title": "Customer financial notices and collection permissions during disputes"
  },
  {
    "id": "SD10",
    "register": "SD",
    "question": "Financial launch acceptance for account-specific capabilities",
    "confirmedBehavior": "Financial facts, evidence and one intended effect remain correct.",
    "safeSupport": "Demonstrate only native/temporary capabilities the launch population uses.",
    "keepInactive": "No optional portal/retry capability as universal launch requirement; no unproved exception path.",
    "accountable": "Owner/Admin/Accounting. Before affected financial branch; D30/IG09.",
    "title": "Financial launch acceptance for account-specific capabilities"
  },
  {
    "id": "T01",
    "register": "T",
    "question": "Stripe process responsibility narrowed in S02/S03/S06; exact supported collection/setup choices remain deferred, with day-30 timing and reusable authorization preserved",
    "confirmedBehavior": "Reusable ACH, delivery-derived terms and native financial boundaries.",
    "safeSupport": "Choose ordinary supported client/plumbing; preserve readiness and collection distinction.",
    "keepInactive": "No selection of D01/D05/D06/D25 business answers.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical work during implementation; business gates only before relevant use.",
    "title": "Stripe process responsibility and supported collection/setup choices"
  },
  {
    "id": "T02",
    "register": "T",
    "question": "Exact ACH authorization wording and supported customer authorization experience",
    "confirmedBehavior": "Stripe hosts genuine authorization; internal does not collect raw bank credentials.",
    "safeSupport": "Use supported hosted authorization experience and necessary evidence references.",
    "keepInactive": "No invented mandate scope/wording or customer payer authority.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Before selected authorization path; D01/D06 and setup acceptance.",
    "title": "ACH authorization wording and customer authorization experience"
  },
  {
    "id": "T03",
    "register": "T",
    "question": "Original routing/POD selection question narrowed: OptimoRoute is the current provider; plan/capability fit and business handoff acceptance remain open. Optional live driver location remains optional.",
    "confirmedBehavior": "OptimoRoute current field/routing provider; internal controls release/actuals.",
    "safeSupport": "Demonstrate fit and choose ordinary handoff mechanics.",
    "keepInactive": "No presumed Custom purchase, substitute provider or optional tracking activation.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Affected field capability before reliance; live tracking can defer; D19–D21.",
    "title": "OptimoRoute plan/capability fit and handoff acceptance"
  },
  {
    "id": "T04",
    "register": "T",
    "question": "Physical-versus-digital receipt/signature procedure and instant physical invoice arrangement",
    "confirmedBehavior": "Required signature, no-price physical-capable BOL and Stripe actual invoice.",
    "safeSupport": "Support physical/digital evidence associations and retained documents.",
    "keepInactive": "No signature waiver or planned-quantity financial invoice.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Selected receipt/instant-paper path before use; D20/D22.",
    "title": "Physical vs digital receipt/signature and instant physical invoice"
  },
  {
    "id": "T05",
    "register": "T",
    "question": "Exact automatic-allocation versus Admin-confirmation presentation, salesperson availability display, and physical reconciliation procedure",
    "confirmedBehavior": "Allocation at submission, generally FCFS; Admin exceptions; customers do not see stock counts.",
    "safeSupport": "Choose practical display/technical realization within known permissions.",
    "keepInactive": "No new manual confirmation requirement or changed allocation/cadence policy.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical presentation during implementation; substantive D14/D16 rules before use.",
    "title": "Allocation presentation, availability display and physical reconciliation"
  },
  {
    "id": "T06",
    "register": "T",
    "question": "Final market numbering syntax and standing-order controls/presentation",
    "confirmedBehavior": "Unique market order reference and internal standing demand.",
    "safeSupport": "Choose ordinary internal identifier/display syntax consistent with market uniqueness; support unselected recurrence.",
    "keepInactive": "No invented standing cadence, invoice grouping or commercial numbering requirement.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical syntax during implementation; linked business choices D09/D13/D15 remain scoped.",
    "title": "Market numbering syntax and standing-order controls/presentation"
  },
  {
    "id": "T07",
    "register": "T",
    "question": "Detailed role capabilities/field permission matrix, regional visibility, and parent-account presentation",
    "confirmedBehavior": "Exactly five roles, existing powers and no implicit parent/contact authority.",
    "safeSupport": "Implement known permissions and ordinary presentation.",
    "keepInactive": "No new role, visibility grant or restriction answering D07/D08/D28 by default.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Affected access before use; future customer surface deferred.",
    "title": "Detailed role capabilities, regional visibility and parent presentation"
  },
  {
    "id": "T08",
    "register": "T",
    "question": "Secure magic-link and short-link mechanism",
    "confirmedBehavior": "Memorable links are not sole credentials; broader customer access deferred.",
    "safeSupport": "Preserve boundary; necessary hosted financial documents remain separate.",
    "keepInactive": "Do not build/select customer magic-link/portal security model now.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Future phase 5; D08/IG10.",
    "title": "Secure magic-link and short-link mechanism (deferred)"
  },
  {
    "id": "T09",
    "register": "T",
    "question": "Exact QuickBooks detail/aggregation/synchronization approach and accountant-approved AR, clearing, fee, deposit, settlement, and credit treatment",
    "confirmedBehavior": "QBO formal GL, accountant treatment, one writer and source detail.",
    "safeSupport": "Build reasonable source-to-accounting support and demonstration for eventual selection.",
    "keepInactive": "No summary/detail/connector/divided model or accounting classification by default.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Posting activation requires D25/D29/IG06; technical means alone do not need owner choice.",
    "title": "QuickBooks detail/aggregation/synchronization and accountant treatment"
  },
  {
    "id": "T10",
    "register": "T",
    "question": "Physical data structure and exact exception/interface arrangements; technical realization of approved correction consequences",
    "confirmedBehavior": "Preserve approved correction consequences, audit and exception ownership.",
    "safeSupport": "Choose database/interface/identifier/technical representation within this brief.",
    "keepInactive": "Do not treat technical schema choices as new owner decisions or use them to settle D23/D27.",
    "accountable": "Existing owner under linked D/SD; Fable chooses ordinary technical means. Technical choices during implementation; business branches follow existing gates.",
    "title": "Physical data structure and technical realization of corrections"
  },
  {
    "id": "IG01",
    "register": "IG",
    "question": "OptimoRoute capability/plan fit; D19–D21; section 49",
    "confirmedBehavior": "OptimoRoute executes; internal owns accepted operational facts.",
    "safeSupport": "Demonstrate applicable section 49 workflows and a narrow permitted capture alternative.",
    "keepInactive": "Do not rely on unproved actuals/mixed results or choose Custom from assumption.",
    "accountable": "Admin; Owner for actual purchase. Only affected field reliance; D19–D21/T03; Admin demonstrates, Owner purchase if needed.",
    "title": "OptimoRoute capability/plan fit (D19–D21, §49)"
  },
  {
    "id": "IG02",
    "register": "IG",
    "question": "POD durable custody and provider-exit arrangement; D20/D34",
    "confirmedBehavior": "Retain durable original/corrected evidence, associations and provider-exit retrieval.",
    "safeSupport": "Choose technical custody/storage and demonstrate retrieval under stated business rights.",
    "keepInactive": "No URL-only retention or unestablished original labelled original.",
    "accountable": "Owner/Admin; existing custodian function. Before evidence-path reliance; D20/D34; existing-role custodian assignment, no new role.",
    "title": "POD durable custody and provider-exit arrangement (D20/D34)"
  },
  {
    "id": "IG03",
    "register": "IG",
    "question": "Employee disablement, lifecycle freshness and bounded session/outage policy; D08/D21",
    "confirmedBehavior": "Google authenticates; internal grants/revokes; known disable stops existing-session business use.",
    "safeSupport": "Implement effective revocation and stable actor identity; choose compliant session mechanics.",
    "keepInactive": "No invented session duration/stale-access policy or automatic group grants.",
    "accountable": "Owner/Admin access function. Employee access launch; D08/D21; Owner/Admin substantive policy, not technical session approval.",
    "title": "Employee disablement, lifecycle freshness and session/outage policy (D08/D21)"
  },
  {
    "id": "IG04",
    "register": "IG",
    "question": "Single financial/operational sender allocation in section 42 and actual sender coverage; D32/SD09",
    "confirmedBehavior": "Required business notice, one normal sender and retained intent/outcome.",
    "safeSupport": "Build matrix/transport evidence without selecting policy.",
    "keepInactive": "Do not activate unapproved duplicate/parallel normal sends.",
    "accountable": "Owner/Admin/Accounting. Affected automated branch; D32/SD09; mailbox mechanics during implementation.",
    "title": "Single financial/operational sender allocation (D32/SD09)"
  },
  {
    "id": "IG05",
    "register": "IG",
    "question": "Permitted retention/onward use of selected Google-derived content; D02/D07/D34",
    "confirmedBehavior": "Legitimate business facts retained; raw provider rights remain separate.",
    "safeSupport": "Establish allowed selected use or omit restricted content and use legitimate independent facts.",
    "keepInactive": "No unrestricted raw retention/coordinate forwarding or data laundering.",
    "accountable": "Owner with appropriate terms advice; Admin. Only affected Google content retention/use; D02/D07/D34.",
    "title": "Permitted retention/onward use of Google-derived content (D02/D07/D34)"
  },
  {
    "id": "IG06",
    "register": "IG",
    "question": "QBO posting model, writer assignment and accounting treatment/cutover; D25/D29/D30/D33",
    "confirmedBehavior": "Accountant model/classification, Stripe truth/QBO GL, one accounting writer.",
    "safeSupport": "Support alternatives/demonstration and opening comparisons.",
    "keepInactive": "No accounting posting or connector overlap before model/writer selection.",
    "accountable": "Accountant/Owner; Accounting. Posting module activation; D25/D29/D30/D33/T09.",
    "title": "QBO posting model, writer assignment and cutover (D25/D29/D30/D33)"
  },
  {
    "id": "IG07",
    "register": "IG",
    "question": "Slack destinations, existing-role coverage, meaningful urgency and escalation; D27/D32",
    "confirmedBehavior": "Actionable Slack/daily summaries; internal queue owns case; direct urgent contact remains possible.",
    "safeSupport": "Assign practical channels/coverage within existing roles under selected notification scope.",
    "keepInactive": "No new hold/service rule or complex interaction requirement.",
    "accountable": "Admin/Accounting. During module work before relying on alerts; D27/D32. Interactivity deferred.",
    "title": "Slack destinations, coverage, urgency and escalation (D27/D32)"
  },
  {
    "id": "IG08",
    "register": "IG",
    "question": "Selected temporary field/outage controls; D20/D21/D27",
    "confirmedBehavior": "Temporary controls preserve actual facts/authority and reconcile restoration.",
    "safeSupport": "Prepare narrow affected control and backlog reconciliation.",
    "keepInactive": "No use of unapproved workaround or blanket backup system.",
    "accountable": "Admin/Accounting under existing authority. Only before use of that temporary control; D20/D21/D27.",
    "title": "Selected temporary field/outage controls (D20/D21/D27)"
  },
  {
    "id": "IG09",
    "register": "IG",
    "question": "Account-specific Stripe exceptions/recovery readiness; SD01/SD02/SD05/SD06/SD07/SD10",
    "confirmedBehavior": "Exact financial outcome/residual, one collector, retained correction history.",
    "safeSupport": "Demonstrate affected timing/retry/partial/note/correction recovery.",
    "keepInactive": "No financial branch relying on unsupported remedy or unselected commercial policy.",
    "accountable": "Accounting; Owner for business choices. Only relevant financial branch; SD01/SD02/SD05–SD07/SD10.",
    "title": "Account-specific Stripe exceptions/recovery readiness (SD01–SD10)"
  },
  {
    "id": "IG10",
    "register": "IG",
    "question": "Customer portal, magic-link and broader customer-access design; T08/D08/SD03",
    "confirmedBehavior": "Customer access remains future; current hosted setup/documents allowed.",
    "safeSupport": "Preserve location/contact authority boundaries without broader customer UI.",
    "keepInactive": "No portal/magic-link choice or build by inclusion.",
    "accountable": "Owner/Admin/Accounting. Safely deferred to phase 5; T08/D08/SD03.",
    "title": "Customer portal, magic-link and broader customer-access design (T08/D08/SD03)"
  },
  {
    "id": "IG11",
    "register": "IG",
    "question": "Optional scales/thresholds, Groups, advanced fields/scanning/tracking, dedicated email vendor",
    "confirmedBehavior": "Current low-volume/proportionate stack and five roles.",
    "safeSupport": "Retain enough current history to evaluate actual future need.",
    "keepInactive": "No automatic threshold/Groups/scanning/tracking/advanced-field/email-vendor adoption.",
    "accountable": "Existing owner for affected function. Safely deferred until demonstrated benefit; D35 and related D27/D32 choices.",
    "title": "Optional scales/thresholds, Groups, scanning/tracking, dedicated email vendor"
  }
];
