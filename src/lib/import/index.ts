/**
 * In-app, repeatable import of the TLM Master File (SHIPMENTS_SPEC §5, decisions 10.2, 10.3, 9.8).
 *
 * dryRun: parse the .xlsx, normalise, diff against the database and store an import_run (status dry_run) with the
 * records and the report. applyRun (Owner only): recompute the plan inside one transaction, write it, audit it and mark
 * the run applied. Nothing is ever deleted; a second apply reports zero changes.
 */
import { desc, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { type DbOrTx, withTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { applyPlan, type ApplyResult } from "./apply";
import { type ImportReport, planImport } from "./diff";
import { normalizeWorkbook } from "./normalize";
import { parseWorkbook } from "./parse";
import type { NormalizedImport } from "./types";

export type { ApplyResult } from "./apply";
export { ENTITY_LABEL, ENTITY_ORDER, type EntityName, type EntityReport, type FieldChange, type ImportReport } from "./diff";
export type { Excluded, Flag, NormalizedImport } from "./types";

export type ImportRun = typeof schema.importRun.$inferSelect;

export interface RunSummary {
  fileName: string;
  totals: ImportReport["totals"];
  entities: ImportReport["summary"];
  flags: number;
  excluded: number;
  unconfirmedLots: number;
  missingTabs: string[];
  applied?: ApplyResult & { at: string };
}

export interface RunDiff {
  records: NormalizedImport;
  report: ImportReport;
}

export interface DryRunResult {
  run: ImportRun;
  report: ImportReport;
  summary: RunSummary;
}

function summaryOf(fileName: string, report: ImportReport): RunSummary {
  return { fileName, totals: report.totals, entities: report.summary, flags: report.flags.length, excluded: report.excluded.length, unconfirmedLots: report.unconfirmedLots, missingTabs: report.missingTabs };
}

/** Parse, normalise and diff a workbook export; store the result as a dry run for review (import.dry_run). */
export async function dryRun(db: DbOrTx, actor: Actor, input: { fileName: string; bytes: Buffer | Uint8Array }): Promise<DryRunResult> {
  authorize(actor, "import.dry_run");
  if (!input.bytes || input.bytes.length === 0) throw new BusinessError("Choose the .xlsx export of the TLM Master File", { field: "file" });
  if (!/\.xlsx$/i.test(input.fileName)) throw new BusinessError("The import reads an .xlsx export (File > Download > Microsoft Excel in Google Sheets)", { field: "file" });
  let parsed;
  try {
    parsed = await parseWorkbook(input.bytes);
  } catch (err) {
    throw new BusinessError(`The file could not be read as a workbook${err instanceof Error && err.message ? ` (${err.message})` : ""}`, { field: "file" });
  }
  if (parsed.present.length === 0) throw new BusinessError("None of the TLM Master File tabs were found in this workbook (Customer Accounts, Location Information, SKU Master, Production, BOL Maker Log, Sales, …)", { field: "file" });
  const records = normalizeWorkbook(parsed, input.fileName);
  const plan = await planImport(db, records);
  const summary = summaryOf(input.fileName, plan.report);
  const diff: RunDiff = { records, report: plan.report };
  const [run] = await db
    .insert(schema.importRun)
    .values({ source: input.fileName, status: "dry_run", summary, diff, requestedByEmployeeId: actor.employeeId })
    .returning();
  await recordAudit(db, actor, { action: "import.dry_run", subjectType: "import_run", subjectId: run.id, current: { fileName: input.fileName, totals: plan.report.totals, flags: plan.report.flags.length }, reason: "Dry run of the TLM Master File import" });
  return { run, report: plan.report, summary };
}

export async function getRun(db: DbOrTx, runId: string): Promise<(ImportRun & { summary: RunSummary; diff: RunDiff }) | null> {
  const [run] = await db.select().from(schema.importRun).where(eq(schema.importRun.id, runId));
  if (!run) return null;
  return run as ImportRun & { summary: RunSummary; diff: RunDiff };
}

export async function listRuns(db: DbOrTx, limit = 50): Promise<Array<Omit<ImportRun, "diff"> & { summary: RunSummary }>> {
  const rows = await db
    .select({
      id: schema.importRun.id,
      source: schema.importRun.source,
      status: schema.importRun.status,
      summary: schema.importRun.summary,
      requestedByEmployeeId: schema.importRun.requestedByEmployeeId,
      appliedByEmployeeId: schema.importRun.appliedByEmployeeId,
      appliedAt: schema.importRun.appliedAt,
      createdAt: schema.importRun.createdAt,
    })
    .from(schema.importRun)
    .orderBy(desc(schema.importRun.createdAt))
    .limit(limit);
  return rows as Array<Omit<ImportRun, "diff"> & { summary: RunSummary }>;
}

/**
 * Apply a reviewed dry run (import.apply, Owner only). The plan is recomputed against the live database inside the
 * transaction, so what is written reflects the database as it is now, and a run applied twice changes nothing.
 */
export async function applyRun(db: DbOrTx, actor: Actor, runId: string): Promise<{ run: ImportRun; result: ApplyResult; report: ImportReport }> {
  authorize(actor, "import.apply");
  const run = await getRun(db, runId);
  if (!run) throw new BusinessError("Import run not found");
  if (run.status === "applied") throw new StaleStateError("This dry run has already been applied");
  if (run.status !== "dry_run") throw new StaleStateError(`This run is ${run.status}; upload the workbook again for a fresh dry run`);
  if (!run.diff?.records) throw new BusinessError("This run holds no records to apply; upload the workbook again");
  return withTx(db, async (tx) => {
    const plan = await planImport(tx, run.diff.records);
    const result = await applyPlan(tx, actor, plan, runId);
    const summary: RunSummary = { ...summaryOf(run.source, plan.report), applied: { ...result, at: new Date().toISOString() } };
    const [updated] = await tx
      .update(schema.importRun)
      .set({ status: "applied", appliedByEmployeeId: actor.employeeId, appliedAt: new Date(), summary, diff: { records: run.diff.records, report: plan.report } satisfies RunDiff })
      .where(eq(schema.importRun.id, runId))
      .returning();
    await recordAudit(tx, actor, {
      action: "import.run",
      subjectType: "import_run",
      subjectId: runId,
      current: { fileName: run.source, creates: result.creates, updates: result.updates, unchanged: result.unchanged, skipped: result.skipped, exceptionsOpened: result.exceptionsOpened, perEntity: result.perEntity },
      reason: "TLM Master File import applied",
      correlationId: runId,
    });
    return { run: updated, result, report: plan.report };
  });
}

/** Discard a dry run that will not be applied (import.dry_run). The record stays for the audit trail. */
export async function discardRun(db: DbOrTx, actor: Actor, runId: string): Promise<ImportRun> {
  authorize(actor, "import.dry_run");
  const run = await getRun(db, runId);
  if (!run) throw new BusinessError("Import run not found");
  if (run.status !== "dry_run") throw new StaleStateError(`This run is ${run.status} and cannot be discarded`);
  const [updated] = await db.update(schema.importRun).set({ status: "discarded" }).where(eq(schema.importRun.id, runId)).returning();
  await recordAudit(db, actor, { action: "import.discard", subjectType: "import_run", subjectId: runId, prior: { status: "dry_run" }, current: { status: "discarded" }, correlationId: runId });
  return updated;
}
