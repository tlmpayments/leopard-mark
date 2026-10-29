/**
 * Physical counts (decisions 8.1, 8.2, 1.6). A count sheet per origin captures SKU totals and lot codes; applying it
 * writes one `count` movement per SKU that brings on hand to the counted total, so the ledger starts from evidence,
 * not from the workbook.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { type DbOrTx, withTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { fillUnmetDemand, lockPosition } from "@/lib/domain/allocation/service";
import { lotByCode, parseLotCode } from "@/lib/domain/lots/service";

export interface CountLineInput {
  skuId: string;
  lotCode?: string | null;
  qty: number;
}

export async function createCountSession(db: DbOrTx, actor: Actor, input: { warehouseId: string; countedOn: string; countedBy?: string | null; note?: string | null; lines: CountLineInput[] }) {
  const [wh] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, input.warehouseId));
  if (!wh) throw new BusinessError("Origin not found");
  authorize(actor, "count.record", { marketId: wh.marketId });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.countedOn)) throw new BusinessError("Count date must be YYYY-MM-DD", { field: "countedOn" });
  if (input.lines.length === 0) throw new BusinessError("A count sheet needs at least one line", { field: "lines" });
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 0) throw new BusinessError("Counted quantities are whole numbers of zero or more", { field: "lines" });
    if (l.lotCode && !parseLotCode(l.lotCode)) throw new BusinessError(`${l.lotCode} is not a valid lot code (facility, brand, yymmdd, run)`, { field: "lines" });
  }
  return withTx(db, async (tx) => {
    const [session] = await tx
      .insert(schema.countSession)
      .values({ warehouseId: input.warehouseId, countedOn: input.countedOn, countedBy: input.countedBy ?? null, note: input.note ?? null, enteredByEmployeeId: actor.employeeId })
      .returning();
    for (const l of input.lines) await tx.insert(schema.countLine).values({ sessionId: session.id, skuId: l.skuId, lotCode: l.lotCode?.trim().toUpperCase() || null, qty: l.qty });
    await recordAudit(tx, actor, { action: "count.create", subjectType: "count_session", subjectId: session.id, current: { warehouse: wh.name, countedOn: input.countedOn, lines: input.lines.length }, marketId: wh.marketId });
    return session;
  });
}

/**
 * Apply: on hand becomes the counted total per SKU; lot codes on the lines are kept for later per-lot balances (4.1).
 * Every variance is posted as a count adjustment with the reason given (R2-23); a count that changes a position
 * without a reason is refused.
 */
export async function applyCountSession(db: DbOrTx, actor: Actor, sessionId: string, opts: { reason?: string | null } = {}) {
  const [session] = await db.select().from(schema.countSession).where(eq(schema.countSession.id, sessionId));
  if (!session) throw new BusinessError("Count session not found");
  const [wh] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, session.warehouseId));
  authorize(actor, "count.record", { marketId: wh?.marketId ?? null });
  if (session.status !== "draft") throw new StaleStateError("This count was already applied");
  const reason = opts.reason?.trim() || session.note?.trim() || null;
  return withTx(db, async (tx) => {
    const lines = await tx.select().from(schema.countLine).where(eq(schema.countLine.sessionId, sessionId));
    const totals = new Map<string, number>();
    for (const l of lines) totals.set(l.skuId, (totals.get(l.skuId) ?? 0) + l.qty);
    const changes: Array<{ skuId: string; before: number; after: number }> = [];
    const positions = new Map<string, Awaited<ReturnType<typeof lockPosition>>>();
    for (const [skuId] of Array.from(totals.entries()).sort()) positions.set(skuId, await lockPosition(tx, session.warehouseId, skuId));
    const anyVariance = Array.from(totals.entries()).some(([skuId, qty]) => qty !== positions.get(skuId)!.onHandQty);
    if (anyVariance && !reason) throw new BusinessError("The count differs from the ledger; say why before applying (the reason goes on each adjustment, R2-23)", { field: "reason" });
    for (const [skuId, qty] of Array.from(totals.entries()).sort()) {
      const pos = positions.get(skuId)!;
      const delta = qty - pos.onHandQty;
      await tx
        .update(schema.stockPosition)
        .set({ onHandQty: qty, evidenceSource: `Physical count ${session.countedOn}${session.countedBy ? " by " + session.countedBy : ""}`, evidenceAt: new Date(), confirmedByEmployeeId: actor.employeeId, updatedAt: new Date() })
        .where(eq(schema.stockPosition.id, pos.id));
      const lotLines = lines.filter((l) => l.skuId === skuId && l.lotCode);
      if (lotLines.length) {
        for (const ll of lotLines) {
          const lot = ll.lotCode ? await lotByCode(tx, ll.lotCode) : null;
          await tx.insert(schema.stockMovement).values({ warehouseId: session.warehouseId, skuId, kind: "count", qtyDelta: 0, referenceType: "count_session", referenceId: sessionId, evidence: `Counted ${ll.qty} of lot ${ll.lotCode}`, actorEmployeeId: actor.employeeId, lotId: lot?.id ?? null });
        }
      }
      await tx.insert(schema.stockMovement).values({ warehouseId: session.warehouseId, skuId, kind: "count", qtyDelta: delta, referenceType: "count_session", referenceId: sessionId, evidence: `Physical count ${session.countedOn}: on hand set to ${qty}${delta !== 0 ? ` (was ${pos.onHandQty}; ${reason})` : ""}`, actorEmployeeId: actor.employeeId });
      changes.push({ skuId, before: pos.onHandQty, after: qty });
      if (delta > 0) await fillUnmetDemand(tx, actor, session.warehouseId, skuId);
    }
    const [row] = await tx.update(schema.countSession).set({ status: "applied", appliedAt: new Date(), appliedByEmployeeId: actor.employeeId }).where(and(eq(schema.countSession.id, sessionId), eq(schema.countSession.status, "draft"))).returning();
    if (!row) throw new StaleStateError("This count was applied by someone else a moment ago");
    await recordAudit(tx, actor, { action: "count.apply", subjectType: "count_session", subjectId: sessionId, current: { changes }, reason: reason ?? undefined, marketId: wh?.marketId ?? null });
    return { session: row, changes };
  });
}

export async function listCountSessions(db: DbOrTx, opts: { warehouseId?: string } = {}) {
  const q = db.select({ s: schema.countSession, warehouse: schema.warehouse }).from(schema.countSession).innerJoin(schema.warehouse, eq(schema.warehouse.id, schema.countSession.warehouseId)).orderBy(desc(schema.countSession.countedOn), desc(schema.countSession.createdAt));
  return opts.warehouseId ? q.where(eq(schema.countSession.warehouseId, opts.warehouseId)) : q;
}

export async function getCountSession(db: DbOrTx, sessionId: string) {
  const [s] = await db.select().from(schema.countSession).where(eq(schema.countSession.id, sessionId));
  if (!s) return null;
  const lines = await db
    .select({ l: schema.countLine, sku: schema.sku })
    .from(schema.countLine)
    .innerJoin(schema.sku, eq(schema.sku.id, schema.countLine.skuId))
    .where(eq(schema.countLine.sessionId, sessionId))
    .orderBy(asc(schema.sku.code), asc(schema.countLine.lotCode));
  const [warehouse] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, s.warehouseId));
  return { session: s, lines, warehouse: warehouse ?? null };
}
