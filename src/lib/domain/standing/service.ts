import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";
import { getPolicy } from "@/lib/policy/policy";
import { submitOrder } from "../orders/service";

/**
 * Standing arrangements (brief §14, O14/U22, D13).
 *
 * The arrangement is captured as internal demand structure. Generating
 * occurrences requires a COMPLETE, executable D13 selection (cadence_days
 * AND an explicit generate_when_held). Without one, nothing is generated —
 * that is the "unselected" business meaning, not an error — and the fact is
 * recorded once per arrangement/cycle as an owned case so it is not silently
 * lost (REV-16, AC24). Only the CURRENT cycle is ever generated (no future
 * stock commitments); occurrences are unique per cycle key by construction
 * (no duplicates); the occurrence row and its order commit in one
 * transaction so a failure never burns a cycle. Archived lines are never
 * silently dropped: the order carries the orderable lines and the skipped
 * lines are recorded on the occurrence and surfaced for review. Never a
 * Stripe Subscription.
 */

export async function createStandingArrangement(
  db: DbOrTx,
  actor: Actor,
  input: { locationId: string; lines: Array<{ skuId: string; qty: number }>; authorizationNote: string; requestedCadence?: string | null },
) {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, input.locationId));
  if (!loc) throw new BusinessError("Location not found");
  authorize(actor, "standing.manage", { marketId: loc.marketId });
  if (!input.lines.length) throw new BusinessError("At least one line is required", { field: "lines" });
  if (!input.authorizationNote.trim()) throw new BusinessError("Record who authorized the standing order and how", { field: "authorizationNote" });
  if (loc.status === "closed") throw new BusinessError("This location is closed; no new standing demand");
  return withTx(db, async (tx) => {
    for (const l of input.lines) {
      const [s] = await tx.select().from(schema.sku).where(eq(schema.sku.id, l.skuId));
      if (!s || s.archivedAt) throw new BusinessError("Archived or unknown SKU cannot be placed on a standing arrangement", { field: "lines" });
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new BusinessError("Quantities must be positive whole numbers", { field: "lines" });
    }
    const [row] = await tx
      .insert(schema.standingArrangement)
      .values({ locationId: input.locationId, authorizationNote: input.authorizationNote.trim(), requestedCadence: input.requestedCadence?.trim() || null, createdByEmployeeId: actor.employeeId })
      .returning();
    for (const l of input.lines) {
      await tx.insert(schema.standingArrangementLine).values({ arrangementId: row.id, skuId: l.skuId, qty: l.qty });
    }
    await recordAudit(tx, actor, { action: "standing.create", subjectType: "standing_arrangement", subjectId: row.id, current: { locationId: input.locationId, lines: input.lines, requestedCadence: input.requestedCadence ?? null }, marketId: loc.marketId });
    return row;
  });
}

export async function setStandingState(db: DbOrTx, actor: Actor, arrangementId: string, state: "defined" | "paused" | "ended", reason: string) {
  const [arr] = await db.select().from(schema.standingArrangement).where(eq(schema.standingArrangement.id, arrangementId));
  if (!arr) throw new BusinessError("Arrangement not found");
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, arr.locationId));
  authorize(actor, "standing.manage", { marketId: loc?.marketId });
  if (arr.state === "ended") throw new StaleStateError("This arrangement has ended; capture a new one if the customer wants it again.");
  if (arr.state === state) return arr;
  if (state === "ended" && !reason.trim()) throw new BusinessError("A reason is required to end an arrangement", { field: "reason" });
  const [row] = await db
    .update(schema.standingArrangement)
    .set({ state, endedAt: state === "ended" ? new Date() : null, endReason: state === "ended" ? reason : null })
    .where(and(eq(schema.standingArrangement.id, arrangementId), eq(schema.standingArrangement.state, arr.state)))
    .returning();
  if (!row) throw new StaleStateError("The arrangement changed while you were editing; reload and try again.");
  await recordAudit(db, actor, { action: "standing.state", subjectType: "standing_arrangement", subjectId: arrangementId, prior: { state: arr.state }, current: { state }, reason, marketId: loc?.marketId });
  return row;
}

export interface GenerationReport {
  policy: "unselected" | "production" | "test";
  generated: Array<{ arrangementId: string; orderId: string; cycleKey: string; skippedLines: number }>;
  skipped: Array<{ arrangementId: string; cycleKey: string; reason: string }>;
  /** Arrangements whose generation threw; nothing was written for them (retried next run) and a case is open. */
  failed: Array<{ arrangementId: string; cycleKey: string; error: string }>;
}

type D13Selection = Record<string, unknown> & {
  cadence_days?: unknown;
  generate_when_held?: unknown;
};

/** An executable D13 selection needs BOTH keys with valid values; anything less is an unresolved branch. */
export function d13Executable(selection: D13Selection): { ok: true; cadenceDays: number; generateWhenHeld: boolean } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const cadence = Number(selection.cadence_days);
  if (!Number.isInteger(cadence) || cadence <= 0) missing.push("cadence_days");
  if (typeof selection.generate_when_held !== "boolean") missing.push("generate_when_held");
  if (missing.length) return { ok: false, missing };
  return { ok: true, cadenceDays: cadence, generateWhenHeld: selection.generate_when_held as boolean };
}

/**
 * Generate due occurrences. Called by the jobs runner (and by tests with an
 * explicit test selection). With D13 unselected this returns immediately.
 */
export async function generateStandingOccurrences(db: DbOrTx, actor: Actor, now = new Date()): Promise<GenerationReport> {
  const report: GenerationReport = { policy: "unselected", generated: [], skipped: [], failed: [] };
  const active = await db.select().from(schema.standingArrangement).where(eq(schema.standingArrangement.state, "defined"));
  for (const arr of active) {
    const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, arr.locationId));
    if (!loc) continue;
    // Policy is market-scoped: a D13 selection for one market does not generate in another.
    const d13 = await getPolicy<D13Selection>(db, "D13", { now, marketId: loc.marketId });
    if (d13.status !== "selected") continue;
    report.policy = report.policy === "production" ? "production" : d13.kind;
    const exec = d13Executable(d13.selection);
    if (!exec.ok) {
      // Recorded once per arrangement (dedupe) so the unresolved branch is visible, never silently skipped.
      await openException(db, actor, {
        category: "standing_policy_incomplete",
        title: `Standing order not generated — D13 selection incomplete (${loc.tradeName})`,
        cause: `The effective D13 selection lacks ${exec.missing.join(", ")}. No occurrence is generated and no default is assumed.`,
        marketId: loc.marketId,
        locationId: loc.id,
        ownerRole: "owner",
        nextAction: "Owner completes the D13 selection (cadence_days and generate_when_held) on the decision register; generation resumes on the next run.",
        dedupeKey: `standing_policy_incomplete:${arr.id}`,
        links: [{ subjectType: "standing_arrangement", subjectId: arr.id }],
      });
      report.skipped.push({ arrangementId: arr.id, cycleKey: "*", reason: `D13 selection incomplete: ${exec.missing.join(", ")}` });
      continue;
    }
    await resolveByDedupeKeys(db, actor, [`standing_policy_incomplete:${arr.id}`], "D13 selection is now executable");
    const cycleKey = cycleKeyFor(arr.createdAt, exec.cadenceDays, now);
    try {
      await withTx(db, async (tx) => {
        const [exists] = await tx
          .select({ id: schema.standingOccurrence.id })
          .from(schema.standingOccurrence)
          .where(and(eq(schema.standingOccurrence.arrangementId, arr.id), eq(schema.standingOccurrence.cycleKey, cycleKey)))
          .limit(1);
        if (exists) return; // one occurrence per cycle
        if (loc.status !== "active") {
          await tx.insert(schema.standingOccurrence).values({ arrangementId: arr.id, cycleKey, outcome: "skipped_closed", policySelectionId: d13.selectionId, detail: { locationStatus: loc.status } });
          report.skipped.push({ arrangementId: arr.id, cycleKey, reason: `location ${loc.status}` });
          return;
        }
        if (!exec.generateWhenHeld) {
          const holds = await tx.select({ id: schema.hold.id, cause: schema.hold.cause }).from(schema.hold).where(and(eq(schema.hold.locationId, loc.id), eq(schema.hold.active, true)));
          if (holds.length) {
            await tx.insert(schema.standingOccurrence).values({ arrangementId: arr.id, cycleKey, outcome: "skipped_policy", policySelectionId: d13.selectionId, detail: { holds: holds.map((h) => h.cause) } });
            report.skipped.push({ arrangementId: arr.id, cycleKey, reason: "held (per D13 selection generate_when_held=false)" });
            await openException(tx, actor, {
              category: "standing_skipped",
              title: `Standing order skipped while held — ${loc.tradeName}`,
              cause: `Cycle ${cycleKey} not generated because the location is held and D13 says generate_when_held=false. Holds: ${holds.map((h) => h.cause).join("; ")}`,
              marketId: loc.marketId,
              locationId: loc.id,
              ownerRole: "sales",
              nextAction: "Tell the customer; capture a one-off order when the hold clears if they still want it.",
              dedupeKey: `standing_skipped:${arr.id}:${cycleKey}`,
              links: [{ subjectType: "standing_arrangement", subjectId: arr.id }],
            });
            return;
          }
        }
        const lines = await tx.select().from(schema.standingArrangementLine).where(eq(schema.standingArrangementLine.arrangementId, arr.id));
        const skus = await tx.select().from(schema.sku).where(inArray(schema.sku.id, lines.map((l) => l.skuId)));
        const archived = lines.filter((l) => skus.find((s) => s.id === l.skuId)?.archivedAt);
        const orderable = lines.filter((l) => !skus.find((s) => s.id === l.skuId)?.archivedAt);
        const skippedLines = archived.map((l) => ({ skuId: l.skuId, sku: skus.find((s) => s.id === l.skuId)?.name ?? l.skuId, qty: l.qty, reason: "archived" }));
        if (orderable.length === 0) {
          await tx.insert(schema.standingOccurrence).values({ arrangementId: arr.id, cycleKey, outcome: "skipped_archived_sku", policySelectionId: d13.selectionId, detail: { skippedLines } });
          report.skipped.push({ arrangementId: arr.id, cycleKey, reason: "all SKUs archived — arrangement needs review" });
          await openException(tx, actor, {
            category: "standing_review",
            title: `Standing order needs review — every product archived (${loc.tradeName})`,
            cause: `Cycle ${cycleKey}: ${skippedLines.map((s) => `${s.sku} × ${s.qty}`).join(", ")} can no longer be ordered.`,
            marketId: loc.marketId,
            locationId: loc.id,
            ownerRole: "sales",
            nextAction: "Agree replacement products with the customer and capture a new arrangement, or end this one.",
            dedupeKey: `standing_review:${arr.id}`,
            links: [{ subjectType: "standing_arrangement", subjectId: arr.id }],
          });
          return;
        }
        const [occ] = await tx
          .insert(schema.standingOccurrence)
          .values({ arrangementId: arr.id, cycleKey, outcome: skippedLines.length ? "generated_partial" : "generated", policySelectionId: d13.selectionId, detail: skippedLines.length ? { skippedLines } : null })
          .returning();
        const result = await submitOrder(tx, actor, {
          locationId: loc.id,
          lines: orderable.map((l) => ({ skuId: l.skuId, qty: l.qty })),
          source: "standing",
          // Nobody is at the keyboard when a standing order generates: a short origin holds the order for the office (R2-5).
          shortfallDecision: "hold",
          shortfallReason: "Standing order generated while the origin was short; the office decides",
          submissionKey: `standing:${arr.id}:${cycleKey}`,
          standingOccurrenceId: occ.id,
          repEmployeeId: loc.currentRepEmployeeId,
          notes: skippedLines.length ? `Standing order; not included (archived): ${skippedLines.map((s) => `${s.sku} × ${s.qty}`).join(", ")}` : null,
        });
        await tx.update(schema.standingOccurrence).set({ orderId: result.order.id }).where(eq(schema.standingOccurrence.id, occ.id));
        if (skippedLines.length) {
          await openException(tx, actor, {
            category: "standing_review",
            title: `Standing order ${result.order.orderNumber} generated without archived product(s) — ${loc.tradeName}`,
            cause: `Not included: ${skippedLines.map((s) => `${s.sku} × ${s.qty}`).join(", ")} (archived). The customer's arrangement still lists them.`,
            marketId: loc.marketId,
            locationId: loc.id,
            ownerRole: "sales",
            nextAction: "Agree a replacement with the customer and update the arrangement (end + recapture), or confirm the reduced order.",
            dedupeKey: `standing_review:${arr.id}`,
            links: [
              { subjectType: "standing_arrangement", subjectId: arr.id },
              { subjectType: "order", subjectId: result.order.id },
            ],
          });
        } else {
          await resolveByDedupeKeys(tx, actor, [`standing_review:${arr.id}`], "Every line orderable again");
        }
        await resolveByDedupeKeys(tx, actor, [`standing_generation_failed:${arr.id}`], "Generation succeeded");
        report.generated.push({ arrangementId: arr.id, orderId: result.order.id, cycleKey, skippedLines: skippedLines.length });
      });
    } catch (err) {
      // Nothing was written for this arrangement; it is retried on the next run and the failure is owned, not just logged.
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ arrangementId: arr.id, cycleKey, error: message });
      await openException(db, actor, {
        category: "standing_generation_failed",
        title: `Standing order could not be generated — ${loc.tradeName}`,
        cause: `Cycle ${cycleKey}: ${message}`,
        marketId: loc.marketId,
        locationId: loc.id,
        ownerRole: "admin",
        nextAction: "Fix the cause (price, warehouse, product) — generation is retried on the next run.",
        dedupeKey: `standing_generation_failed:${arr.id}`,
        links: [{ subjectType: "standing_arrangement", subjectId: arr.id }],
      });
    }
  }
  return report;
}

function cycleKeyFor(start: Date, cadenceDays: number, now: Date): string {
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const cycle = Math.max(0, Math.floor(days / cadenceDays));
  return `c${cycle}`;
}

export async function listStandingForLocation(db: DbOrTx, locationId: string) {
  const arrs = await db
    .select()
    .from(schema.standingArrangement)
    .where(and(eq(schema.standingArrangement.locationId, locationId), ne(schema.standingArrangement.state, "ended")))
    .orderBy(desc(schema.standingArrangement.createdAt));
  const out = [];
  for (const a of arrs) {
    const lines = await db
      .select({ l: schema.standingArrangementLine, sku: schema.sku })
      .from(schema.standingArrangementLine)
      .innerJoin(schema.sku, eq(schema.sku.id, schema.standingArrangementLine.skuId))
      .where(eq(schema.standingArrangementLine.arrangementId, a.id));
    const occurrences = await db.select().from(schema.standingOccurrence).where(eq(schema.standingOccurrence.arrangementId, a.id)).orderBy(desc(schema.standingOccurrence.generatedAt));
    out.push({ arrangement: a, lines, occurrences });
  }
  return out;
}
