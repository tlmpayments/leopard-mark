import { eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { BusinessError } from "@/lib/errors";

type GateSeed = Omit<typeof schema.capabilityGate.$inferInsert, "status" | "evidence" | "recordedByEmployeeId" | "recordedAt">;

/**
 * Capability acceptance gates from brief §49 and the scoped acceptance list.
 * Status starts `unproven`. A gate becomes `demonstrated` only when a person
 * records the demonstration evidence; a successful API call never does.
 */
export const GATES: GateSeed[] = [
  // Employee access (phase 1)
  { id: "ACCESS_STABLE_IDENTITY", provider: "google_identity", name: "Stable identity survives an email rename; reused email is a new person", classification: "scoped_acceptance", requiredDemonstration: "AT61: rename keeps history/grants; re-used address inherits nothing (email + PIN sign-in; also with Google when configured).", permittedControl: null, phase: 1 },
  { id: "ACCESS_EFFECTIVE_DISABLE", provider: "google_identity", name: "Effective disablement stops an existing session without re-login", classification: "scoped_acceptance", requiredDemonstration: "AT62: disable an already-signed-in employee; next action is refused; a stale sign-in or grant signal cannot restore.", permittedControl: null, phase: 1 },
  // Stripe (phase 1 association, phase 3 finance)
  { id: "STRIPE_CUSTOMER_ASSOCIATION", provider: "stripe", name: "Location-specific Stripe customer association", classification: "scoped_acceptance", requiredDemonstration: "One Stripe customer per licensed location in the company account; no pooling by parent/AP.", permittedControl: null, phase: 1 },
  { id: "STRIPE_HOSTED_SETUP", provider: "stripe", name: "Hosted ACH setup/mandate (no raw bank details internally)", classification: "scoped_acceptance", requiredDemonstration: "Hosted setup completes; only masked reference/status evidence retained.", permittedControl: null, phase: 3 },
  { id: "STRIPE_DELIVERY_DAY_INVOICE", provider: "stripe", name: "Delivery-day invoice with delivery+30 due date, no early collection", classification: "scoped_acceptance", requiredDemonstration: "AT28/AT29/AT31.", permittedControl: null, phase: 3 },
  { id: "STRIPE_CREDIT_BALANCE", provider: "stripe", name: "Native credit balance / credit notes, U17 application", classification: "scoped_acceptance", requiredDemonstration: "AT47/AT49/AT50.", permittedControl: null, phase: 4 },
  { id: "STRIPE_EXTERNAL_PARTIAL", provider: "stripe", name: "External/partial receipt representation without overcollection", classification: "scoped_acceptance", requiredDemonstration: "AT37/AT38/AT40 (SD05).", permittedControl: null, phase: 3 },
  // OptimoRoute (phase 2) — §49 table
  { id: "OR_ACTUALS", provider: "optimoroute", name: "Actual SKU accepted quantities per visit", classification: "must_work_before_initial_field_use", requiredDemonstration: "Multi-SKU order returns explicit accepted quantities incl. zero, associated with the correct visit.", permittedControl: "Admin/Driver approved actuals record; never infer from completed stop. Admin accountable.", phase: 2 },
  { id: "OR_PARTIAL_REFUSED", provider: "optimoroute", name: "Partial/refused outcome", classification: "must_work_before_initial_field_use", requiredDemonstration: "Partial/refused/missing quantities and reasons preserve fulfilled vs residual demand; no automatic resend.", permittedControl: "Admin reconciles original/actual/residual from a controlled record.", phase: 2 },
  { id: "OR_MIXED_VISIT", provider: "optimoroute", name: "Failed beer with successful pickup/service", classification: "must_work_before_initial_field_use", requiredDemonstration: "Zero beer coexists with genuine keg pickup and service completion.", permittedControl: "Separate activity evidence for the same visit, reconciled by Admin.", phase: 2 },
  { id: "OR_KEG_COUNTS", provider: "optimoroute", name: "Keg counts and excess pickups", classification: "must_work_before_initial_field_use", requiredDemonstration: "Count/context recorded independently of beer status; excess recordable.", permittedControl: "Driver supplies count; Admin validates attribution.", phase: 2 },
  { id: "OR_CLEANING", provider: "optimoroute", name: "Cleaning completed/skipped/reason/time", classification: "can_use_temporary_control", requiredDemonstration: "Independent outcome, time and skip reason; skipped stays due.", permittedControl: "Simple checkbox/time/reason under Admin/service accountability.", phase: 2 },
  { id: "OR_SIGNATURE", provider: "optimoroute", name: "Normal signature", classification: "must_work_before_initial_field_use", requiredDemonstration: "Genuine signer evidence associated with actual receipt and retrievable afterward.", permittedControl: "Source-supported paper or accepted digital process; no blanket waiver.", phase: 2 },
  { id: "OR_PHOTOS", provider: "optimoroute", name: "Photos", classification: "can_use_temporary_control", requiredDemonstration: "Driver captures photos associated with customer/order/visit/time; durable evidence.", permittedControl: "Approved associated photo capture; Admin preserves custody.", phase: 2 },
  { id: "OR_OFFLINE", provider: "optimoroute", name: "Offline capture", classification: "can_use_temporary_control", requiredDemonstration: "Loss of connectivity does not fabricate receipt; later evidence keeps occurrence time.", permittedControl: "Admin-approved limited outage record under D21.", phase: 2 },
  { id: "OR_URGENT_CHANGE", provider: "optimoroute", name: "Urgent withdrawn/changed stop", classification: "must_work_before_initial_field_use", requiredDemonstration: "Admin establishes current instruction, contacts driver, confirms withdrawal/change.", permittedControl: "Direct driver contact and acknowledgement.", phase: 2 },
  { id: "OR_EVIDENCE_EDITS", provider: "optimoroute", name: "Evidence edits/history", classification: "must_work_before_initial_field_use", requiredDemonstration: "Original remains retrievable after edit; actor/time/reason distinguished.", permittedControl: "Controlled original capture/retention with authorized corrections.", phase: 2 },
  { id: "OR_EXPORT_EXIT", provider: "optimoroute", name: "Historical export/retrieval and provider exit", classification: "must_work_before_initial_field_use", requiredDemonstration: "Original and corrected artifacts recoverable after link expiry and provider exit.", permittedControl: "Company-controlled durable evidence arrangement.", phase: 2 },
  { id: "OR_DRIVER_USABILITY", provider: "optimoroute", name: "Driver usability", classification: "must_work_before_initial_field_use", requiredDemonstration: "Realistic mixed visit completed without duplicate entry or lost facts.", permittedControl: "Narrow temporary missing-field capture.", phase: 2 },
  { id: "OR_OPTIONAL_TELEMETRY", provider: "optimoroute", name: "Barcode / live tracking / telemetry", classification: "optional_enhancement", requiredDemonstration: "Demonstrate real benefit if later chosen.", permittedControl: null, phase: 2 },
  // Notices / Google content / QBO / Slack
  { id: "NOTICE_SINGLE_SENDER", provider: "gmail", name: "One normal sender per notice purpose with same-obligation fallback", classification: "scoped_acceptance", requiredDemonstration: "AT75: for each notice type one selected sender; Gmail send result separate from business audit.", permittedControl: "Authorized manual single-sender process while D32/IG04 pending.", phase: 1 },
  { id: "GOOGLE_CONTENT_RIGHTS", provider: "google_address", name: "Permitted retention/onward use of Google-derived content", classification: "scoped_acceptance", requiredDemonstration: "IG05: allowed selected use established before relying on restricted content; legitimate customer facts proceed independently.", permittedControl: "Omit restricted content; use customer-confirmed facts.", phase: 1 },
  { id: "QBO_MODEL", provider: "qbo", name: "Selected posting model, no-overlap writers, manual adjustment preservation", classification: "scoped_acceptance", requiredDemonstration: "AT68/AT69/AT76 under the accountant-selected model (IG06).", permittedControl: "Explicit interim accounting responsibility (manual/accountant).", phase: 3 },
  { id: "SLACK_NO_MUTATION", provider: "slack", name: "Slack cannot mutate business state; outage leaves queue usable", classification: "scoped_acceptance", requiredDemonstration: "AT60: delete/edit/react leaves case/audit unchanged.", permittedControl: null, phase: 1 },
];

export async function seedGates(db: DbOrTx) {
  for (const g of GATES) {
    await db
      .insert(schema.capabilityGate)
      .values(g)
      .onConflictDoUpdate({
        target: schema.capabilityGate.id,
        set: { name: g.name, classification: g.classification, requiredDemonstration: g.requiredDemonstration, permittedControl: g.permittedControl ?? null, phase: g.phase, provider: g.provider ?? null },
      });
  }
}

export type GateStatus = (typeof schema.gateStatusEnum.enumValues)[number];

/** A person records the demonstration; evidence is required for anything but `unproven`. */
export async function recordGateStatus(db: DbOrTx, actor: Actor, gateId: string, status: GateStatus, evidence: string) {
  authorize(actor, "gate.record");
  if (status !== "unproven" && !evidence.trim()) throw new BusinessError("Evidence of the demonstration is required", { field: "evidence" });
  const [prior] = await db.select().from(schema.capabilityGate).where(eq(schema.capabilityGate.id, gateId));
  if (!prior) throw new BusinessError("Gate not found");
  const [row] = await db
    .update(schema.capabilityGate)
    .set({ status, evidence: evidence.trim() || null, recordedByEmployeeId: actor.employeeId, recordedAt: new Date() })
    .where(eq(schema.capabilityGate.id, gateId))
    .returning();
  await recordAudit(db, actor, { action: "gate.record", subjectType: "capability_gate", subjectId: gateId, prior: { status: prior.status }, current: { status, evidence: evidence.trim() } });
  return row;
}
