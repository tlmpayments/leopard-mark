import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { withTx, type DbOrTx } from "@/lib/db/types";
import { appEnv, isProduction } from "@/lib/env";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { DECISION_REGISTER } from "./register.data";
import { validateSelection, type SelectionValidation } from "./schema";
import type { PolicyLookup } from "./types";

/**
 * Seed (idempotent) the decision register. Rows come verbatim from the brief
 * §52; status starts `unselected`. Re-running never changes an existing
 * status or selection.
 */
export async function seedDecisionRegister(db: DbOrTx): Promise<void> {
  for (const d of DECISION_REGISTER) {
    await db
      .insert(schema.decision)
      .values({
        id: d.id,
        register: d.register,
        title: d.title,
        question: d.question,
        confirmedBehavior: d.confirmedBehavior,
        safeSupport: d.safeSupport,
        keepInactive: d.keepInactive,
        accountable: d.accountable,
        selectionSchema: d.selectionSchema ?? null,
      })
      .onConflictDoUpdate({
        target: schema.decision.id,
        set: {
          title: d.title,
          question: d.question,
          confirmedBehavior: d.confirmedBehavior,
          safeSupport: d.safeSupport,
          keepInactive: d.keepInactive,
          accountable: d.accountable,
          selectionSchema: d.selectionSchema ?? null,
        },
      });
  }
}

export interface PolicyOptions {
  now?: Date;
  /** Market the behaviour concerns; a selection scoped to other markets does not apply. */
  marketId?: string | null;
}

type SelectionRow = typeof schema.decisionSelection.$inferSelect;

function appliesToMarket(marketIds: string[] | null | undefined, marketId: string | null | undefined): boolean {
  if (!marketIds || marketIds.length === 0) return true; // selection covers every market
  if (!marketId) return false; // market-scoped selection cannot govern a market-less question
  return marketIds.includes(marketId);
}

/**
 * Deterministic precedence among selections that all apply to (market, time):
 *   1. a market-specific selection beats an all-markets one;
 *   2. the later effective date wins;
 *   3. the later recording wins (a re-recorded selection replaces the earlier one).
 * Selections are immutable history rows; recording a new one never edits or
 * splits an existing one, so unaffected markets and intervals keep their
 * policy (REV-06, AC13/AC14).
 */
export function pickEffective(rows: SelectionRow[], marketId: string | null | undefined): SelectionRow | undefined {
  const applicable = rows.filter((r) => appliesToMarket(r.marketIds, marketId));
  applicable.sort((a, b) => {
    const sa = a.marketIds && a.marketIds.length ? 1 : 0;
    const sb = b.marketIds && b.marketIds.length ? 1 : 0;
    if (sa !== sb) return sb - sa;
    if (a.effectiveFrom.getTime() !== b.effectiveFrom.getTime()) return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    return b.recordedAt.getTime() - a.recordedAt.getTime();
  });
  return applicable[0];
}

async function liveRows(db: DbOrTx, decisionId: string, now: Date) {
  return db
    .select()
    .from(schema.decisionSelection)
    .where(
      and(
        eq(schema.decisionSelection.decisionId, decisionId),
        or(isNull(schema.decisionSelection.supersededAt), gt(schema.decisionSelection.supersededAt, now)),
        lte(schema.decisionSelection.effectiveFrom, now),
      ),
    );
}

/**
 * Look up the effective selection for a decision.
 *
 * - Production selections apply once effective (effectiveFrom ≤ now, not withdrawn)
 *   and only within their recorded market scope.
 * - Test selections apply only outside production (FV_ENV !== "production")
 *   and are always returned with kind "test" so callers/UI can label them.
 * - Anything else is `unselected`.
 */
export async function getPolicy<T extends Record<string, unknown> = Record<string, unknown>>(
  db: DbOrTx,
  decisionId: string,
  opts: PolicyOptions = {},
): Promise<PolicyLookup<T>> {
  const now = opts.now ?? new Date();
  const rows = await liveRows(db, decisionId, now);
  const production = pickEffective(
    rows.filter((r) => r.kind === "production"),
    opts.marketId,
  );
  if (production) {
    return { status: "selected", decisionId, kind: "production", selection: production.selection as T, scope: production.scope, effectiveFrom: production.effectiveFrom, selectionId: production.id };
  }
  if (appEnv() !== "production") {
    const test = pickEffective(
      rows.filter((r) => r.kind === "test"),
      opts.marketId,
    );
    if (test) {
      return { status: "selected", decisionId, kind: "test", selection: test.selection as T, scope: test.scope, effectiveFrom: test.effectiveFrom, selectionId: test.id };
    }
  }
  return { status: "unselected", decisionId };
}

export interface RecordSelectionInput {
  decisionId: string;
  kind: "production" | "test";
  selection: Record<string, unknown>;
  scope: string;
  /** NULL/empty = every market. */
  marketIds?: string[] | null;
  effectiveFrom: Date;
  note?: string;
}

export interface RecordSelectionResult {
  row: SelectionRow;
  validation: SelectionValidation;
}

/**
 * Record a selection with scope and effective date (brief §2.2). Authority
 * is enforced here: production selections are Owner-only, test selections
 * are for Admin/Accounting and never in production. The value is validated
 * against the decision's typed schema; malformed values are refused and
 * missing keys are reported as unresolved (a partial selection is recorded
 * as such — each unresolved branch stays inactive in the code that reads
 * it). The insert is atomic; nothing else is edited (see pickEffective).
 */
export async function recordSelection(db: DbOrTx, actor: Actor, input: RecordSelectionInput): Promise<RecordSelectionResult> {
  authorize(actor, input.kind === "production" ? "decision.select_production" : "decision.record_test_selection");
  if (input.kind === "test" && isProduction()) throw new BusinessError("Test selections are not recorded in production");
  const [decision] = await db.select().from(schema.decision).where(eq(schema.decision.id, input.decisionId));
  if (!decision) throw new BusinessError(`Unknown decision ${input.decisionId}`);
  const validation = validateSelection(decision.selectionSchema ?? null, input.selection);
  if (validation.errors.length) throw new BusinessError(`Selection is not valid: ${validation.errors.join("; ")}`, { field: "selection" });
  if (validation.presentKeys.length === 0) throw new BusinessError("Nothing was selected — every field is blank. Leave the decision unselected instead.", { field: "selection" });
  if (!(input.effectiveFrom instanceof Date) || Number.isNaN(input.effectiveFrom.getTime())) throw new BusinessError("Effective date is invalid", { field: "effectiveFrom" });
  const marketIds = input.marketIds && input.marketIds.length ? Array.from(new Set(input.marketIds)) : null;
  if (marketIds) {
    const known = await db.select({ id: schema.market.id }).from(schema.market);
    const ids = new Set(known.map((m) => m.id));
    for (const m of marketIds) if (!ids.has(m)) throw new BusinessError("Unknown market in scope", { field: "marketIds" });
  }
  return withTx(db, async (tx) => {
    const [row] = await tx
      .insert(schema.decisionSelection)
      .values({
        decisionId: input.decisionId,
        kind: input.kind,
        selection: validation.value,
        scope: input.scope,
        marketIds,
        effectiveFrom: input.effectiveFrom,
        recordedByEmployeeId: actor.employeeId,
        note: input.note ?? null,
      })
      .returning();
    await refreshDecisionStatus(tx, input.decisionId);
    await recordAudit(tx, actor, {
      action: `decision.${input.kind}_selection`,
      subjectType: "decision",
      subjectId: input.decisionId,
      current: { selectionId: row.id, selection: validation.value, scope: row.scope, marketIds: row.marketIds, effectiveFrom: row.effectiveFrom.toISOString(), unresolvedKeys: validation.missingKeys },
      reason: input.note ?? null,
    });
    return { row, validation };
  });
}

/** Withdraw one selection (it stays as history with who/why). Unaffected selections keep applying. */
export async function withdrawSelection(db: DbOrTx, actor: Actor, selectionId: string, reason: string) {
  const [sel] = await db.select().from(schema.decisionSelection).where(eq(schema.decisionSelection.id, selectionId));
  if (!sel) throw new BusinessError("Selection not found");
  authorize(actor, sel.kind === "production" ? "decision.select_production" : "decision.record_test_selection");
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(schema.decisionSelection)
      .set({ supersededAt: now, withdrawnByEmployeeId: actor.employeeId, withdrawnReason: reason })
      .where(and(eq(schema.decisionSelection.id, selectionId), or(isNull(schema.decisionSelection.supersededAt), gt(schema.decisionSelection.supersededAt, now))))
      .returning();
    if (!row) throw new StaleStateError("That selection was already withdrawn.");
    await refreshDecisionStatus(tx, sel.decisionId);
    await recordAudit(tx, actor, { action: "decision.withdraw_selection", subjectType: "decision", subjectId: sel.decisionId, prior: { selectionId, scope: sel.scope, marketIds: sel.marketIds }, current: null, reason });
    return row;
  });
}

/** Withdraw every current/future production selection: the decision returns to unselected everywhere. */
export async function withdrawProductionSelection(db: DbOrTx, actor: Actor, decisionId: string, reason: string) {
  authorize(actor, "decision.select_production");
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  return withTx(db, async (tx) => {
    const now = new Date();
    const rows = await tx
      .update(schema.decisionSelection)
      .set({ supersededAt: now, withdrawnByEmployeeId: actor.employeeId, withdrawnReason: reason })
      .where(
        and(
          eq(schema.decisionSelection.decisionId, decisionId),
          eq(schema.decisionSelection.kind, "production"),
          or(isNull(schema.decisionSelection.supersededAt), gt(schema.decisionSelection.supersededAt, now)),
        ),
      )
      .returning({ id: schema.decisionSelection.id });
    await refreshDecisionStatus(tx, decisionId);
    await recordAudit(tx, actor, { action: "decision.withdraw_production_selection", subjectType: "decision", subjectId: decisionId, prior: { withdrawn: rows.map((r) => r.id) }, current: null, reason });
    return rows.length;
  });
}

/** Stored status = "a production selection is effective right now (in any market scope)". */
export async function refreshDecisionStatus(db: DbOrTx, decisionId: string) {
  const now = new Date();
  const [effective] = await db
    .select({ id: schema.decisionSelection.id })
    .from(schema.decisionSelection)
    .where(
      and(
        eq(schema.decisionSelection.decisionId, decisionId),
        eq(schema.decisionSelection.kind, "production"),
        lte(schema.decisionSelection.effectiveFrom, now),
        or(isNull(schema.decisionSelection.supersededAt), gt(schema.decisionSelection.supersededAt, now)),
      ),
    )
    .limit(1);
  await db.update(schema.decision).set({ status: effective ? "selected" : "unselected" }).where(eq(schema.decision.id, decisionId));
}

export async function listDecisions(db: DbOrTx) {
  const now = new Date();
  const decisions = await db.select().from(schema.decision).orderBy(schema.decision.id);
  const selections = await db
    .select()
    .from(schema.decisionSelection)
    .where(or(isNull(schema.decisionSelection.supersededAt), gt(schema.decisionSelection.supersededAt, now)))
    .orderBy(desc(schema.decisionSelection.effectiveFrom));
  const byId = new Map<string, typeof selections>();
  for (const s of selections) {
    const list = byId.get(s.decisionId) ?? [];
    list.push(s);
    byId.set(s.decisionId, list);
  }
  return decisions.map((d) => {
    const sel = byId.get(d.id) ?? [];
    const effectiveNow = sel.some((s) => s.kind === "production" && s.effectiveFrom <= now);
    const scheduled = sel.some((s) => s.kind === "production" && s.effectiveFrom > now);
    const testOnly = !effectiveNow && sel.some((s) => s.kind === "test" && s.effectiveFrom <= now);
    return { ...d, status: effectiveNow ? ("selected" as const) : ("unselected" as const), scheduled, testOnly, selections: sel };
  });
}

export interface MarketPolicyCell {
  marketId: string;
  marketCode: string;
  effective: SelectionRow | null;
  effectiveKind: "production" | "test" | null;
  scheduled: SelectionRow[];
}

/**
 * Effective policy per market for a decision at `now`, plus scheduled
 * (future-dated) selections — what the register screen shows instead of a
 * single global flag (§4.5, UX-07). Uses the same precedence as getPolicy.
 */
export async function policyMatrix(db: DbOrTx, decisionId: string, now = new Date()): Promise<{ cells: MarketPolicyCell[]; history: SelectionRow[] }> {
  const markets = await db.select().from(schema.market).orderBy(schema.market.code);
  const all = await db.select().from(schema.decisionSelection).where(eq(schema.decisionSelection.decisionId, decisionId)).orderBy(desc(schema.decisionSelection.recordedAt));
  const live = all.filter((r) => (r.supersededAt === null || r.supersededAt > now) && r.effectiveFrom <= now);
  const future = all.filter((r) => (r.supersededAt === null || r.supersededAt > now) && r.effectiveFrom > now);
  const cells: MarketPolicyCell[] = markets.map((m) => {
    const production = pickEffective(
      live.filter((r) => r.kind === "production"),
      m.id,
    );
    const test = appEnv() !== "production" ? pickEffective(live.filter((r) => r.kind === "test"), m.id) : undefined;
    const effective = production ?? test ?? null;
    return {
      marketId: m.id,
      marketCode: m.code,
      effective,
      effectiveKind: production ? "production" : test ? "test" : null,
      scheduled: future.filter((r) => appliesToMarket(r.marketIds, m.id)).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime()),
    };
  });
  return { cells, history: all };
}

export function decisionSeed(id: string) {
  return DECISION_REGISTER.find((d) => d.id === id);
}
