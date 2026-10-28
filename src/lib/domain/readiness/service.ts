import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { getPolicy } from "@/lib/policy/policy";
import { licenseVerificationRequirement } from "../customers/service";

/**
 * Delivery eligibility conditions for a location (brief §9–§11, §19, §31).
 *
 * Phase 1 exposes the readiness dimensions Sales and Admin need to see. The
 * confirmed rules apply automatically; where a rule depends on an unselected
 * decision the condition is reported as `unresolved` with the decision id —
 * never asserted from a convenient provider field (D01) or from a status
 * label alone (D02, REV-07).
 *
 * This is permission to hand over merchandise. It never blocks account
 * access, order capture, authorized pickup or service.
 *
 * Every condition carries a plain-language `plain` sentence and a `kind`
 * (UX-04) so screens can say "License verification is needed before
 * delivery" instead of leading with enum names.
 */
export type ConditionStatus = "satisfied" | "blocked" | "unresolved" | "pending";

/** What sort of thing this is for the person reading it (UX-04). */
export type ConditionKind = "info" | "action_needed" | "blocked" | "unresolved_decision" | "provider_unavailable";

export interface ReadinessCondition {
  code: string;
  label: string;
  status: ConditionStatus;
  kind: ConditionKind;
  owner: "admin" | "accounting" | "owner" | "customer" | "sales";
  /** One plain sentence with the consequence and who acts next. */
  plain: string;
  /** Supporting detail (policy ids, evidence) for Admin/Owner tools. */
  detail: string;
  decisionId?: string;
}

export interface LocationReadiness {
  locationId: string;
  acceptedDeliveries: number;
  isFirstDelivery: boolean;
  conditions: ReadinessCondition[];
  /** Merchandise handover is releasable only when no condition is blocked/unresolved/pending. */
  releasable: boolean;
  /** One-line summary for the account header. */
  summary: string;
}

export async function evaluateLocationReadiness(db: DbOrTx, locationId: string, opts: { orderId?: string | null } = {}): Promise<LocationReadiness> {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, locationId));
  if (!loc) throw new Error("Location not found");
  const conditions: ReadinessCondition[] = [];

  // --- serviceability / license (O07, D02) ---
  const [license] = await db
    .select()
    .from(schema.licenseVerification)
    .where(and(eq(schema.licenseVerification.locationId, locationId), eq(schema.licenseVerification.current, true)))
    .limit(1);
  const req = await licenseVerificationRequirement(db, loc.marketId);
  const exemptByPolicy = !req.required && req.kind === "production";
  if (exemptByPolicy) {
    conditions.push({ code: "license", label: "License verification", status: "satisfied", kind: "info", owner: "admin", plain: "License verification is not required in this market.", detail: `Effective production D02 selection does not list this market as requiring verification.`, decisionId: "D02" });
  } else if (license?.state === "verified") {
    conditions.push({ code: "license", label: "License verification", status: "satisfied", kind: "info", owner: "admin", plain: `License verified${license.licenseNumber ? ` (${license.licenseNumber})` : ""}.`, detail: license.evidence ? `Evidence: ${license.evidence}` : "" });
  } else if (license?.state === "rejected") {
    conditions.push({ code: "license", label: "License verification", status: "blocked", kind: "blocked", owner: "admin", plain: "License rejected — this location cannot receive merchandise under the current decision.", detail: license.note ?? "" });
  } else if (license?.state === "not_applicable") {
    conditions.push({
      code: "license",
      label: "License verification",
      status: "pending",
      kind: "action_needed",
      owner: "admin",
      plain: !req.required && req.kind === "test" ? "License verification is needed before delivery: the exemption relies on a TEST D02 selection, which never counts as production policy." : "License verification is needed before delivery: it was recorded as not applicable, but the effective D02 policy requires verification in this market.",
      detail: req.basis === "unselected" ? "D02 is unselected; verification is required everywhere (confirmed behaviour)." : "Effective D02 selection requires verification here.",
      decisionId: "D02",
    });
  } else {
    conditions.push({
      code: "license",
      label: "License verification",
      status: "pending",
      kind: "action_needed",
      owner: "admin",
      plain: "License verification is needed before delivery. Orders can still be captured.",
      detail: "Company verifies the license internally before first delivery where applicable (O07).",
    });
  }

  // --- location status ---
  if (loc.status === "closed") {
    conditions.push({ code: "status", label: "Location status", status: "blocked", kind: "blocked", owner: "admin", plain: "This location is closed — no new deliveries; run-off continues.", detail: "J31" });
  } else if (loc.status === "inactive") {
    conditions.push({ code: "status", label: "Location status", status: "pending", kind: "action_needed", owner: "admin", plain: "This location is inactive; Admin reviews before any release.", detail: "Reversible." });
  }

  // --- first / second delivery rule (O09, D01) ---
  const [{ accepted }] = await db
    .select({ accepted: sql<number>`count(*)::int` })
    .from(schema.deliveryVisit)
    .where(and(eq(schema.deliveryVisit.locationId, locationId), eq(schema.deliveryVisit.outcome, "accepted")));
  const isFirst = accepted === 0;
  const [payment] = await db
    .select()
    .from(schema.paymentRelationship)
    .where(and(eq(schema.paymentRelationship.locationId, locationId), eq(schema.paymentRelationship.current, true)))
    .limit(1);
  if (isFirst) {
    const setup = payment?.setupState ?? "not_requested";
    conditions.push({
      code: "delivery_rule",
      label: "First-delivery allowance",
      status: "satisfied",
      kind: "info",
      owner: "admin",
      plain: setup === "not_requested" ? "First delivery may go ahead before payment setup; the payment setup invitation still needs to be sent." : "First delivery may go ahead before payment setup is complete.",
      detail: "O09/U04: first delivery may precede completed ACH setup if every other applicable condition passes.",
    });
  } else {
    const d01 = await getPolicy<{ readiness_interpretation?: string }>(db, "D01", { marketId: loc.marketId });
    if (d01.status !== "selected") {
      conditions.push({
        code: "delivery_rule",
        label: "Second-delivery readiness",
        status: "unresolved",
        kind: "unresolved_decision",
        owner: "owner",
        decisionId: "D01",
        plain: `A further delivery is waiting on an Owner decision (D01): what counts as an established payment relationship has not been selected.`,
        detail: `Location has ${accepted} accepted delivery(ies). The system will not assume a saved bank, an initiated debit or a paid invoice satisfies it.`,
      });
    } else {
      const interp = String(d01.selection.readiness_interpretation ?? "");
      const setup = payment?.setupState ?? "not_requested";
      const usable = setup === "method_usable";
      let ok = false;
      let plain = "";
      let detail = "";
      let kind: ConditionKind = "blocked";
      if (interp === "valid_authorization") {
        ok = usable && !payment?.directRevocationAt;
        plain = ok ? "A valid reusable payment authorization is on file." : `Payment setup must be usable before another delivery (currently: ${setup.replace(/_/g, " ")}${payment?.directRevocationAt ? ", authorization revoked by the customer" : ""}).`;
        detail = `D01 = valid_authorization [${d01.kind} selection]`;
        kind = ok ? "info" : "action_needed";
      } else if (interp === "initiated_debit" || interp === "first_successful_payment") {
        plain = `The selected D01 interpretation ("${interp.replace(/_/g, " ")}") needs payment evidence that phase 3 has not built yet — reported as not satisfied rather than assumed.`;
        detail = `[${d01.kind} selection] execution not implemented`;
        kind = "provider_unavailable";
      } else {
        plain = `The D01 selection ("${interp}") is not one the system knows how to apply.`;
        detail = `[${d01.kind} selection]`;
      }
      conditions.push({ code: "delivery_rule", label: "Second-delivery readiness", status: ok ? "satisfied" : "blocked", kind, owner: "accounting", decisionId: "D01", plain, detail });
    }
  }

  // --- direct revocation (brief §11) ---
  if (payment?.directRevocationAt) {
    conditions.push({
      code: "revocation",
      label: "Customer revoked payment authorization",
      status: "pending",
      kind: "action_needed",
      owner: "accounting",
      plain: "The customer revoked payment authorization: no new debits; Accounting reviews before further deliveries.",
      detail: "Readiness for later deliveries returns to review (D01/D06). Existing debt remains.",
    });
  }

  // --- causal holds (O11, U06–U11) ---
  const holds = await db.select().from(schema.hold).where(and(eq(schema.hold.locationId, locationId), eq(schema.hold.active, true)));
  const overrides = await db
    .select()
    .from(schema.holdOverride)
    .where(and(eq(schema.holdOverride.locationId, locationId), sql`${schema.holdOverride.withdrawnAt} is null`));
  for (const h of holds) {
    // An override covers only the hold it names, granted after that hold existed,
    // and — when it names an order — only that order's delivery.
    const ov = overrides.find((o) => o.holdId === h.id && o.grantedAt >= h.createdAt && (o.orderId == null || (opts.orderId != null && o.orderId === opts.orderId)));
    const kindLabel = h.kind.replace(/_/g, " ");
    conditions.push({
      code: `hold:${h.id}`,
      label: `Hold — ${kindLabel}`,
      status: ov ? "satisfied" : "blocked",
      kind: ov ? "info" : "blocked",
      owner: h.kind === "payment_failure" ? "accounting" : "admin",
      plain: ov ? `Delivery is permitted despite the ${kindLabel} hold (Admin override: ${ov.reason}). The hold itself remains.` : `Delivery is blocked by a ${kindLabel} hold: ${h.cause}. Orders can still be captured; ${h.kind === "payment_failure" ? "Accounting" : "Admin"} resolves the cause or grants an audited override.`,
      detail: ov ? `Override scope: ${ov.scope}. Override changes permission, not the financial fact.` : overrides.some((o) => o.holdId === h.id && o.orderId) ? "An order-specific override exists; it applies only to that order." : "",
    });
  }

  const releasable = conditions.every((c) => c.status === "satisfied");
  const blocking = conditions.filter((c) => c.status !== "satisfied");
  const summary = releasable
    ? "Ready for delivery when scheduled."
    : blocking.length === 1
      ? blocking[0].plain
      : `${blocking.length} things before delivery: ${blocking.map((c) => c.label.toLowerCase()).join(", ")}.`;
  return { locationId, acceptedDeliveries: accepted, isFirstDelivery: isFirst, conditions, releasable, summary };
}
