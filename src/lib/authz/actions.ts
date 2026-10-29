import type { Role } from "./actor";

/**
 * Business action catalog and the roles that hold each action.
 *
 * Source: brief §5 role table, O03/O06/O25/O32 and the do-not-invent rules.
 * Owner has full functional access (every action). Where an authority
 * question is open (D08/D10/D28/T07) the catalog keeps the confirmed
 * powers and does not add a restriction or a new grant.
 */
export const ACTIONS = {
  // --- people / access (Owner/Admin access function, IG03) ---
  "employee.manage": ["admin"],
  "employee.view": ["admin", "accounting"],
  // --- policy (Owner selects business policy) ---
  "decision.select_production": [],
  "decision.record_test_selection": ["admin", "accounting"],
  "decision.view": ["admin", "accounting", "sales"],
  // --- markets / catalog / prices (Admin controls operations; no Sales override) ---
  "market.manage": ["admin"],
  "catalog.manage": ["admin"],
  /** Read-only product view for everyone who orders or executes deliveries (UX-09). */
  "catalog.view": ["admin", "accounting", "sales", "driver_service"],
  "price.manage": ["admin"],
  "warehouse.manage": ["admin"],
  "stock.record": ["admin"],
  // --- customers ---
  "location.create": ["admin", "sales"],
  /** Driver/Service sees only assigned execution context (field.view_assigned), not market-wide accounts (REV-11). */
  "location.view": ["admin", "accounting", "sales"],
  "location.edit_operational": ["admin", "sales"],
  "location.request_billing_email_change": ["admin", "sales", "accounting"],
  "location.billing_email.approve": ["admin"],
  "location.lifecycle": ["admin"],
  "location.assign_rep": ["admin"],
  "location.warehouse_override": ["admin"],
  "license.verify": ["admin"],
  "payment.request_setup": ["admin", "accounting"],
  "payment.record_direct_revocation": ["admin", "accounting"],
  "payment.view": ["admin", "accounting"],
  "hold.manage": ["admin"],
  "hold.override": ["admin"],
  "hold.view": ["admin", "accounting", "sales"],
  // --- orders / demand ---
  "order.submit": ["admin", "sales"],
  "order.view": ["admin", "accounting", "sales"],
  "order.cancel_undelivered": ["admin"],
  "order.request_change": ["admin", "sales"],
  "order.flag_abnormal": ["admin", "sales"],
  "intake.handle": ["admin"],
  "allocation.resolve": ["admin"],
  "sample.record": ["admin", "sales"],
  "standing.manage": ["admin", "sales"],
  // --- exceptions / command center ---
  "exception.view": ["admin", "accounting", "sales"],
  "exception.manage": ["admin", "accounting"],
  // --- finance (phase 3/4 powers named by the brief; kept for authority correctness) ---
  "credit.issue": ["admin", "accounting"],
  "credit.request": ["admin", "accounting", "sales"],
  "finance.view": ["admin", "accounting"],
  // --- customer notices (manual single-sender process; D32/IG04 unselected) ---
  "notice.view": ["admin", "accounting", "sales"],
  "notice.record_outcome": ["admin", "accounting"],
  // --- integrations ---
  "integration.view": ["admin", "accounting"],
  "integration.manage": ["admin"],
  "gate.record": ["admin", "accounting"],
  // --- audit / reporting ---
  "audit.view": ["admin", "accounting"],
  "report.view": ["admin", "accounting", "sales"],
  // --- field (phase 2) ---
  "field.view_assigned": ["driver_service", "admin"],
  // --- shipments, lots, documents, invoices, kegs, counts (docs/SHIPMENTS_SPEC.md §3; "back office" = admin, 9.4) ---
  "shipment.view": ["admin", "accounting", "sales", "driver_service"],
  "shipment.manage": ["admin"],
  "shipment.confirm": ["admin"],
  "shipment.deliver": ["admin"],
  "shipment.void": ["admin"],
  "shipment.receive": ["admin"],
  "lot.view": ["admin", "accounting", "sales"],
  "lot.manage": ["admin"],
  "invoice.view": ["admin", "accounting", "sales"],
  "invoice.issue": ["admin", "accounting"],
  "invoice.void": ["admin", "accounting"],
  "keg.view": ["admin", "accounting", "sales"],
  "keg.record": ["admin"],
  "count.record": ["admin"],
  /** Company settings (shipper block, office address, footers, NMFC): Owner only (6.2). */
  "settings.manage": [],
  "import.dry_run": ["admin"],
  /** Applying an import to production: Owner only (10.3). */
  "import.apply": [],
  "report.export": ["admin", "accounting"],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof ACTIONS;

/** Human description used by the access screens. */
export const ACTION_LABEL: Partial<Record<Action, string>> = {
  "decision.select_production": "Select production business policy (Owner only)",
  "location.billing_email.approve": "Approve billing-email changes",
  "hold.override": "Override a delivery hold (audited)",
  "credit.issue": "Issue reason-coded credits",
  "order.cancel_undelivered": "Cancel undelivered demand (D10 pending for Sales)",
};
