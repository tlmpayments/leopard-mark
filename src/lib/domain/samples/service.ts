import { and, desc, eq, inArray } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx, type Tx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { applySampleStock } from "../allocation/service";
import { primaryWarehouse } from "../markets/service";

/**
 * Sales samples (brief §17, O19). Record rep, market, SKU, quantity, actual
 * date; notes optional. A withdrawal is a physical stock movement out of the
 * same evidence-backed position that orders reserve against, so it consumes
 * the same allocation exactly once — and only UNRESERVED units (REV-03).
 * Every state transition is claimed atomically inside the transaction with a
 * state predicate, so a repeated or racing request has one effect and the
 * loser gets a clear "already …" refusal (REV-04, AC07/AC08). No customer
 * invoice is created.
 */

export async function recordSampleWithdrawal(
  db: DbOrTx,
  actor: Actor,
  input: { marketId: string; skuId: string; qty: number; withdrawnOn: string; repEmployeeId?: string | null; warehouseId?: string | null; notes?: string | null },
) {
  authorize(actor, "sample.record", { marketId: input.marketId });
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new BusinessError("Quantity must be a positive whole number", { field: "qty" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.withdrawnOn)) throw new BusinessError("Actual date is required (YYYY-MM-DD)", { field: "withdrawnOn" });
  const repEmployeeId = input.repEmployeeId ?? actor.employeeId;
  if (!repEmployeeId) throw new BusinessError("A rep is required", { field: "repEmployeeId" });
  if (repEmployeeId !== actor.employeeId && !actor.grants.some((g) => g.role === "admin" || g.role === "owner")) {
    throw new BusinessError("Sales can record their own samples; Admin records for others", { field: "repEmployeeId" });
  }
  return withTx(db, async (tx) => {
    const warehouseId = input.warehouseId ?? (await primaryWarehouse(tx, input.marketId))?.id;
    if (!warehouseId) throw new BusinessError("No primary warehouse for this market");
    const [wh] = await tx.select().from(schema.warehouse).where(eq(schema.warehouse.id, warehouseId));
    if (!wh || wh.marketId !== input.marketId) throw new BusinessError("That warehouse does not belong to this market", { field: "warehouseId" });
    const [sku] = await tx.select().from(schema.sku).where(eq(schema.sku.id, input.skuId));
    if (!sku) throw new BusinessError("Unknown SKU", { field: "skuId" });
    const [row] = await tx
      .insert(schema.sampleWithdrawal)
      .values({
        marketId: input.marketId,
        warehouseId,
        repEmployeeId,
        skuId: input.skuId,
        qty: input.qty,
        withdrawnOn: input.withdrawnOn,
        notes: input.notes?.trim() || null,
        recordedByEmployeeId: actor.employeeId,
      })
      .returning();
    await applySampleStock(tx, actor, { warehouseId, skuId: input.skuId, delta: -input.qty, kind: "sample_withdrawal", referenceId: row.id, evidence: `Sample withdrawal by rep on ${input.withdrawnOn}` });
    await recordAudit(tx, actor, {
      action: "sample.withdraw",
      subjectType: "sample_withdrawal",
      subjectId: row.id,
      current: { skuId: input.skuId, qty: input.qty, repEmployeeId, withdrawnOn: input.withdrawnOn, warehouseId },
      marketId: input.marketId,
    });
    return row;
  });
}

/** Claim the `withdrawn → next` transition atomically; null when someone else already transitioned it. */
async function claimTransition(tx: Tx, sampleId: string, next: string) {
  const [row] = await tx
    .update(schema.sampleWithdrawal)
    .set({ state: next })
    .where(and(eq(schema.sampleWithdrawal.id, sampleId), eq(schema.sampleWithdrawal.state, "withdrawn")))
    .returning();
  return row ?? null;
}

/** Correct a mistaken withdrawal with history (R24): the original stays, marked corrected. */
export async function correctSampleWithdrawal(db: DbOrTx, actor: Actor, sampleId: string, correctedQty: number, reason: string) {
  const [orig] = await db.select().from(schema.sampleWithdrawal).where(eq(schema.sampleWithdrawal.id, sampleId));
  if (!orig) throw new BusinessError("Sample not found");
  authorize(actor, "sample.record", { marketId: orig.marketId });
  if (!Number.isInteger(correctedQty) || correctedQty < 0) throw new BusinessError("Corrected quantity must be a whole number", { field: "correctedQty" });
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const claimed = await claimTransition(tx, sampleId, "corrected");
    if (!claimed) {
      const [now] = await tx.select({ state: schema.sampleWithdrawal.state }).from(schema.sampleWithdrawal).where(eq(schema.sampleWithdrawal.id, sampleId));
      throw new StaleStateError(`This sample is already ${now?.state.replace(/_/g, " ")}; only an outstanding withdrawal can be corrected`);
    }
    const [row] = await tx
      .insert(schema.sampleWithdrawal)
      .values({
        marketId: claimed.marketId,
        warehouseId: claimed.warehouseId,
        repEmployeeId: claimed.repEmployeeId,
        skuId: claimed.skuId,
        qty: correctedQty,
        withdrawnOn: claimed.withdrawnOn,
        notes: reason,
        state: "withdrawn",
        correctedOfId: claimed.id,
        recordedByEmployeeId: actor.employeeId,
      })
      .returning();
    const delta = claimed.qty - correctedQty; // hand back over-recorded units (or take more — only unreserved ones)
    if (delta !== 0) {
      await applySampleStock(tx, actor, { warehouseId: claimed.warehouseId, skuId: claimed.skuId, delta, kind: "adjustment", referenceId: row.id, evidence: `Sample correction: ${reason}` });
    }
    await recordAudit(tx, actor, { action: "sample.correct", subjectType: "sample_withdrawal", subjectId: claimed.id, prior: { qty: claimed.qty }, current: { qty: correctedQty, replacementId: row.id }, reason, marketId: claimed.marketId });
    return row;
  });
}

/** Unused sample returned: sellable (with evidence) restores availability; damaged never does. */
export async function returnSample(db: DbOrTx, actor: Actor, sampleId: string, condition: "sellable" | "damaged", evidence: string) {
  const [orig] = await db.select().from(schema.sampleWithdrawal).where(eq(schema.sampleWithdrawal.id, sampleId));
  if (!orig) throw new BusinessError("Sample not found");
  authorize(actor, "stock.record", { marketId: orig.marketId });
  if (!evidence.trim()) throw new BusinessError("Return evidence is required", { field: "evidence" });
  return withTx(db, async (tx) => {
    const claimed = await claimTransition(tx, sampleId, condition === "sellable" ? "returned_sellable" : "returned_damaged");
    if (!claimed) {
      const [now] = await tx.select({ state: schema.sampleWithdrawal.state }).from(schema.sampleWithdrawal).where(eq(schema.sampleWithdrawal.id, sampleId));
      throw new StaleStateError(`This sample is already ${now?.state.replace(/_/g, " ")}; a return is recorded once`);
    }
    if (condition === "sellable") {
      await applySampleStock(tx, actor, { warehouseId: claimed.warehouseId, skuId: claimed.skuId, delta: claimed.qty, kind: "sample_return", referenceId: claimed.id, evidence });
    } else {
      await tx.insert(schema.stockMovement).values({
        warehouseId: claimed.warehouseId,
        skuId: claimed.skuId,
        kind: "damage",
        qtyDelta: 0,
        referenceType: "sample_withdrawal",
        referenceId: claimed.id,
        evidence: `Damaged sample return (not sellable): ${evidence}`,
        actorEmployeeId: actor.employeeId,
      });
    }
    await recordAudit(tx, actor, { action: "sample.return", subjectType: "sample_withdrawal", subjectId: claimed.id, current: { condition, qty: claimed.qty }, reason: evidence, marketId: claimed.marketId });
    return claimed;
  });
}

export async function listSamples(db: DbOrTx, actor: Actor, opts: { marketId?: string; limit?: number } = {}) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting", "sales"]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.sampleWithdrawal.marketId, scope));
  }
  if (opts.marketId) conds.push(eq(schema.sampleWithdrawal.marketId, opts.marketId));
  return db
    .select({ s: schema.sampleWithdrawal, sku: schema.sku, rep: schema.employee })
    .from(schema.sampleWithdrawal)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.sampleWithdrawal.skuId))
    .innerJoin(schema.employee, eq(schema.employee.id, schema.sampleWithdrawal.repEmployeeId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.sampleWithdrawal.withdrawnOn), desc(schema.sampleWithdrawal.createdAt))
    .limit(opts.limit ?? 100);
}
