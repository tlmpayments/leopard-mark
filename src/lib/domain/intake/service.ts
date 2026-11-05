import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { submitOrder, type OrderLineInput } from "../orders/service";
import { draftFromMessage } from "./parse";

/**
 * Email order intake (brief §12, R14 [R], D09 [D]).
 *
 * Technical support only: the source message is preserved verbatim and an
 * Admin decides whether it is identifiable demand (location + SKU + qty) or
 * an incomplete inquiry. No duplicate-cancellation rule or abnormal threshold
 * is invented. Round 4 adds a pre-filled DRAFT for a known sender (the parser
 * in ./parse): a suggestion the person checks, never demand on its own.
 * Conversion goes through the one downstream order process (O12) and is
 * atomic with the source-state change: one intake yields at most one order,
 * enforced by a database unique index on the order's intake reference and by
 * claiming the intake row under lock (REV-15, AC23). A converted intake never
 * regresses through a stale form; undoing a conversion is an explicit, audited
 * act (cancel the order).
 */

export async function recordIntakeRequest(
  db: DbOrTx,
  actor: Actor,
  input: { fromEmail?: string | null; subject?: string | null; body: string; sourceReference?: string | null; marketId?: string | null },
) {
  authorize(actor, "intake.handle", { marketId: input.marketId ?? null });
  if (!input.body.trim()) throw new BusinessError("Message body is required", { field: "body" });
  return withTx(db, async (tx) => {
    const fromEmail = input.fromEmail?.trim().toLowerCase() || null;
    // The same draft a mailbox message gets: who, what, PO and date, for the person to check.
    const draft = await draftFromMessage(tx, { fromEmail, subject: input.subject ?? null, text: input.body, attachmentTexts: [], receivedAt: new Date() });
    const [known] = draft.locationId && !input.marketId ? await tx.select({ marketId: schema.customerLocation.marketId }).from(schema.customerLocation).where(eq(schema.customerLocation.id, draft.locationId)) : [];
    const [row] = await tx
      .insert(schema.orderIntakeRequest)
      .values({
        fromEmail,
        subject: input.subject?.trim() || null,
        body: input.body,
        sourceReference: input.sourceReference ?? null,
        marketId: input.marketId ?? known?.marketId ?? null,
        locationId: draft.locationId,
        parsed: draft as unknown as Record<string, unknown>,
        parseNote: draft.notes.join(" ") || null,
      })
      .returning();
    await recordAudit(tx, actor, { action: "intake.record", subjectType: "order_intake_request", subjectId: row.id, current: { fromEmail: row.fromEmail, subject: row.subject } });
    await openException(tx, actor, {
      category: "email_intake",
      title: `Email order to review${row.fromEmail ? ` — ${row.fromEmail}` : ""}`,
      cause: row.subject ?? "(no subject)",
      marketId: input.marketId ?? null,
      ownerRole: "admin",
      nextAction: "Match location, SKU, quantity and intent; convert to an order or mark incomplete and clarify only essentials (R14/D09).",
      dedupeKey: `email_intake:${row.id}`,
      links: [{ subjectType: "order_intake_request", subjectId: row.id }],
    });
    return row;
  });
}

export async function convertIntakeToOrder(
  db: DbOrTx,
  actor: Actor,
  input: { intakeId: string; locationId: string; lines: OrderLineInput[]; requestedDate?: string | null; notes?: string | null; shortfallDecision?: "ship_available" | "hold" | null; shortfallReason?: string | null; poNumbers?: string[] | null },
) {
  const [pre] = await db.select().from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, input.intakeId));
  if (!pre) throw new BusinessError("Intake request not found");
  const [loc] = await db.select({ marketId: schema.customerLocation.marketId }).from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found", { field: "locationId" });
  authorize(actor, "intake.handle", { marketId: pre.marketId ?? loc.marketId });
  authorize(actor, "order.submit", { marketId: loc.marketId });
  return withTx(db, async (tx) => {
    // Claim the intake under lock: two handlers converting at once are serialized and the second sees "converted".
    const [req] = await tx.select().from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, input.intakeId)).for("update");
    if (req.state === "converted") {
      const [existing] = req.orderId ? await tx.select({ orderNumber: schema.order.orderNumber }).from(schema.order).where(eq(schema.order.id, req.orderId)) : [];
      throw new StaleStateError(`This email was already converted${existing ? ` to ${existing.orderNumber}` : ""}. To change it, amend or cancel that order.`);
    }
    if (req.state === "rejected") throw new StaleStateError("This email was rejected; record a new intake if it is a new request.");
    const result = await submitOrder(tx, actor, {
      locationId: input.locationId,
      lines: input.lines,
      requestedDate: input.requestedDate,
      notes: input.notes ?? `From email: ${req.subject ?? ""}`.trim(),
      source: "email",
      submissionKey: `intake:${req.id}`,
      intakeRequestId: req.id,
      poNumbers: input.poNumbers ?? null,
      shortfallDecision: input.shortfallDecision ?? null,
      shortfallReason: input.shortfallReason ?? null,
    });
    if (result.replayed) throw new StaleStateError(`This email already produced ${result.order.orderNumber}.`);
    await tx
      .update(schema.orderIntakeRequest)
      .set({ state: "converted", orderId: result.order.id, locationId: input.locationId, handledByEmployeeId: actor.employeeId, handledAt: new Date() })
      .where(eq(schema.orderIntakeRequest.id, req.id));
    await resolveByDedupeKeys(tx, actor, [`email_intake:${req.id}`], `Converted to ${result.order.orderNumber}`);
    await recordAudit(tx, actor, { action: "intake.convert", subjectType: "order_intake_request", subjectId: req.id, current: { orderId: result.order.id, orderNumber: result.order.orderNumber } });
    return result;
  });
}

export async function markIntakeIncomplete(db: DbOrTx, actor: Actor, intakeId: string, missingEssentials: string) {
  const [pre] = await db.select().from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, intakeId));
  if (!pre) throw new BusinessError("Intake request not found");
  authorize(actor, "intake.handle", { marketId: pre.marketId ?? null });
  if (!missingEssentials.trim()) throw new BusinessError("Say which essentials are missing", { field: "missing" });
  return withTx(db, async (tx) => {
    // Conditional transition: a converted or rejected intake never regresses through a stale action (REV-15).
    const [row] = await tx
      .update(schema.orderIntakeRequest)
      .set({ state: "incomplete", missingEssentials, handledByEmployeeId: actor.employeeId, handledAt: new Date() })
      .where(and(eq(schema.orderIntakeRequest.id, intakeId), inArray(schema.orderIntakeRequest.state, ["received", "incomplete"])))
      .returning();
    if (!row) {
      const [now] = await tx.select({ state: schema.orderIntakeRequest.state }).from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, intakeId));
      throw new StaleStateError(`This email is already ${now?.state}; it cannot be marked incomplete.`);
    }
    await recordAudit(tx, actor, { action: "intake.incomplete", subjectType: "order_intake_request", subjectId: intakeId, current: { missingEssentials } });
    await tx
      .update(schema.exceptionCase)
      .set({ state: "waiting", waitingParty: "customer", nextAction: `Clarify: ${missingEssentials}`, updatedAt: new Date() })
      .where(and(eq(schema.exceptionCase.dedupeKey, `email_intake:${intakeId}`), ne(schema.exceptionCase.state, "resolved")));
    return row;
  });
}

/** Explicit rejection (not demand): audited, never a silent reset. */
export async function rejectIntake(db: DbOrTx, actor: Actor, intakeId: string, reason: string) {
  const [pre] = await db.select().from(schema.orderIntakeRequest).where(eq(schema.orderIntakeRequest.id, intakeId));
  if (!pre) throw new BusinessError("Intake request not found");
  authorize(actor, "intake.handle", { marketId: pre.marketId ?? null });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const [row] = await tx
      .update(schema.orderIntakeRequest)
      .set({ state: "rejected", missingEssentials: reason, handledByEmployeeId: actor.employeeId, handledAt: new Date() })
      .where(and(eq(schema.orderIntakeRequest.id, intakeId), inArray(schema.orderIntakeRequest.state, ["received", "incomplete"])))
      .returning();
    if (!row) throw new StaleStateError("This email was already handled.");
    await recordAudit(tx, actor, { action: "intake.reject", subjectType: "order_intake_request", subjectId: intakeId, reason });
    await resolveByDedupeKeys(tx, actor, [`email_intake:${intakeId}`], `Not an order: ${reason}`);
    return row;
  });
}

export async function listOpenIntake(db: DbOrTx) {
  return db
    .select()
    .from(schema.orderIntakeRequest)
    .where(inArray(schema.orderIntakeRequest.state, ["received", "incomplete"]))
    .orderBy(desc(schema.orderIntakeRequest.receivedAt));
}

/** Attachments kept with the open intake requests (Round 4), without their bytes. */
export async function attachmentsForIntake(db: DbOrTx, intakeIds: string[]) {
  if (!intakeIds.length) return [];
  return db
    .select({ id: schema.intakeAttachment.id, intakeId: schema.intakeAttachment.intakeId, filename: schema.intakeAttachment.filename, mime: schema.intakeAttachment.mime, sizeBytes: schema.intakeAttachment.sizeBytes, textExtract: schema.intakeAttachment.textExtract, kept: sql<boolean>`${schema.intakeAttachment.data} is not null` })
    .from(schema.intakeAttachment)
    .where(inArray(schema.intakeAttachment.intakeId, intakeIds));
}
