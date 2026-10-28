import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { openException, resolveByDedupeKeys } from "@/lib/exceptions/service";

/**
 * Minimal Postgres-backed job queue (technical choice, brief §58). Vercel Cron
 * calls /api/internal/jobs/run which drains due jobs; an Admin can also
 * trigger a run from the Integrations screen. Handlers must be idempotent —
 * each carries its own one-effect check because a job can be retried.
 *
 * Guarantees (§4.7, REV-14, AC21/AC22):
 *   - Claim fencing: every claim issues a token; completion, retry and
 *     failure are conditional on still holding that token, so a late worker
 *     whose lease expired cannot overwrite a newer claim's outcome.
 *   - Bounded attempts: a reclaim after worker death consumes the attempt
 *     that was claimed, so repeated death ends in `failed` + an owned case.
 *   - Honest waiting: a handler that finds its provider unavailable throws
 *     ProviderUnavailableError → the job becomes `waiting` (not done, not a
 *     retry loop) and is re-queued when the kind's `ready()` check passes.
 *   - Unknown ≠ success: a job that exhausts attempts opens an exception that
 *     says the provider effect must be established before re-requesting.
 */
export type JobHandler = (db: Db, payload: Record<string, unknown>) => Promise<void>;

export interface JobKindDefinition {
  run: JobHandler;
  /** Is the provider/capability this kind needs usable right now? Waiting jobs resume when true. */
  ready?: (db: DbOrTx) => boolean | Promise<boolean>;
}

const handlers = new Map<string, JobKindDefinition>();

/** Technical lease: a `running` job older than this is presumed dead and reclaimed. */
export const LEASE_MS = 15 * 60_000;

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export function registerJobHandler(kind: string, handler: JobHandler | JobKindDefinition) {
  handlers.set(kind, typeof handler === "function" ? { run: handler } : handler);
}

export type EnqueueResult =
  | { outcome: "queued"; job: typeof schema.job.$inferSelect }
  | { outcome: "already_active"; job: typeof schema.job.$inferSelect };

/**
 * Enqueue a job. With a dedupe key, an already queued/running/waiting job of
 * the same key is returned instead of a duplicate; a previously *failed* job
 * does not block a fresh attempt (the active-only unique index sees only
 * queued/running/waiting).
 */
export async function enqueueJob(
  db: DbOrTx,
  kind: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; dedupeKey?: string; maxAttempts?: number } = {},
): Promise<EnqueueResult> {
  const [row] = await db
    .insert(schema.job)
    .values({ kind, payload, runAt: opts.runAt ?? new Date(), dedupeKey: opts.dedupeKey ?? null, maxAttempts: opts.maxAttempts ?? 5 })
    .onConflictDoNothing()
    .returning();
  if (row) return { outcome: "queued", job: row };
  const [existing] = await db
    .select()
    .from(schema.job)
    .where(and(eq(schema.job.dedupeKey, opts.dedupeKey!), inArray(schema.job.status, ["queued", "running", "waiting"])))
    .limit(1);
  return { outcome: "already_active", job: existing };
}

/** Re-queue waiting jobs whose kind reports ready. Called at the start of every run and after a successful connection check. */
export async function resumeWaitingJobs(db: DbOrTx, kind?: string): Promise<number> {
  const conds = [eq(schema.job.status, "waiting")];
  if (kind) conds.push(eq(schema.job.kind, kind));
  const waiting = await db.select().from(schema.job).where(and(...conds));
  let resumed = 0;
  for (const j of waiting) {
    const def = handlers.get(j.kind);
    if (!def?.ready) continue;
    if (!(await def.ready(db))) continue;
    const rows = await db
      .update(schema.job)
      .set({ status: "queued", runAt: new Date(), waitingReason: null, lastError: null })
      .where(and(eq(schema.job.id, j.id), eq(schema.job.status, "waiting")))
      .returning({ id: schema.job.id });
    resumed += rows.length;
  }
  return resumed;
}

export type JobOutcome = "done" | "failed" | "retry" | "skipped" | "waiting" | "lost_claim";

export async function runDueJobs(db: Db, opts: { limit?: number; workerId?: string; now?: Date } = {}) {
  const limit = opts.limit ?? 20;
  const workerId = opts.workerId ?? `worker-${process.pid}`;
  const now = opts.now ?? new Date();
  // 1. Reclaim jobs whose worker died mid-run (lease expired). The dead attempt stays counted;
  //    a job out of attempts fails now instead of being reclaimed forever.
  const expired = await db
    .select()
    .from(schema.job)
    .where(and(eq(schema.job.status, "running"), lt(schema.job.lockedAt, new Date(now.getTime() - LEASE_MS))));
  for (const j of expired) {
    // A row claimed before fencing existed (null token) is reclaimed by its null token — same conditional shape.
    const sameClaim = and(eq(schema.job.id, j.id), eq(schema.job.status, "running"), j.claimToken ? eq(schema.job.claimToken, j.claimToken) : isNull(schema.job.claimToken));
    if (j.attempts >= j.maxAttempts) {
      await terminalFailure(db, j, `lease expired after ${j.attempts} attempt(s); outcome of the last attempt is unknown`, sameClaim);
    } else {
      await db
        .update(schema.job)
        .set({ status: "queued", lockedAt: null, lockedBy: null, claimToken: null, lastError: `lease expired (attempt ${j.attempts}); reclaimed` })
        .where(sameClaim);
    }
  }
  // 2. Waiting work resumes once its provider is usable.
  await resumeWaitingJobs(db);
  // 3. Claim and run due jobs.
  const due = await db
    .select()
    .from(schema.job)
    .where(and(eq(schema.job.status, "queued"), lte(schema.job.runAt, now)))
    .orderBy(asc(schema.job.runAt))
    .limit(limit);
  const results: Array<{ id: string; kind: string; outcome: JobOutcome; detail?: string }> = [];
  for (const j of due) {
    const token = randomUUID();
    const claimed = await db
      .update(schema.job)
      .set({ status: "running", lockedAt: new Date(), lockedBy: workerId, claimToken: token, attempts: sql`${schema.job.attempts} + 1` })
      .where(and(eq(schema.job.id, j.id), eq(schema.job.status, "queued")))
      .returning();
    if (claimed.length === 0) {
      results.push({ id: j.id, kind: j.kind, outcome: "skipped" });
      continue;
    }
    const attempts = claimed[0].attempts;
    const owned = and(eq(schema.job.id, j.id), eq(schema.job.status, "running"), eq(schema.job.claimToken, token));
    const def = handlers.get(j.kind);
    try {
      if (!def) throw new Error(`No handler registered for job kind ${j.kind}`);
      await def.run(db, j.payload);
      const done = await db.update(schema.job).set({ status: "done", finishedAt: new Date(), lockedAt: null, lockedBy: null, claimToken: null }).where(owned).returning({ id: schema.job.id });
      results.push({ id: j.id, kind: j.kind, outcome: done.length ? "done" : "lost_claim" });
      if (done.length) await resolveByDedupeKeys(db, SYSTEM_ACTOR, [`job_failed:${j.id}`], "Job completed on a later attempt");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof ProviderUnavailableError) {
        // Not a failure: the work is durable and resumes when the provider is usable. The claimed attempt is not charged.
        const w = await db
          .update(schema.job)
          .set({ status: "waiting", waitingReason: message, lastError: null, lockedAt: null, lockedBy: null, claimToken: null, attempts: sql`greatest(${schema.job.attempts} - 1, 0)` })
          .where(owned)
          .returning({ id: schema.job.id });
        results.push({ id: j.id, kind: j.kind, outcome: w.length ? "waiting" : "lost_claim", detail: message });
        continue;
      }
      if (attempts >= j.maxAttempts) {
        const failed = await terminalFailure(db, { ...j, attempts }, message, owned);
        results.push({ id: j.id, kind: j.kind, outcome: failed ? "failed" : "lost_claim", detail: message });
      } else {
        // Bounded backoff; never blindly repeats a consequential external effect — handlers check prior effect first.
        const delayMs = Math.min(60_000 * 2 ** (attempts - 1), 30 * 60_000);
        const r = await db
          .update(schema.job)
          .set({ status: "queued", lastError: message, runAt: new Date(Date.now() + delayMs), lockedAt: null, lockedBy: null, claimToken: null })
          .where(owned)
          .returning({ id: schema.job.id });
        results.push({ id: j.id, kind: j.kind, outcome: r.length ? "retry" : "lost_claim", detail: message });
      }
    }
  }
  return results;
}

async function terminalFailure(db: Db, j: typeof schema.job.$inferSelect, message: string, where?: ReturnType<typeof and>) {
  const rows = await db
    .update(schema.job)
    .set({ status: "failed", lastError: message, finishedAt: new Date(), lockedAt: null, lockedBy: null, claimToken: null })
    .where(where ?? and(eq(schema.job.id, j.id), eq(schema.job.status, "running"), j.claimToken ? eq(schema.job.claimToken, j.claimToken) : isNull(schema.job.claimToken)))
    .returning({ id: schema.job.id });
  if (!rows.length) return false;
  await openException(db, SYSTEM_ACTOR, {
    category: "provider_handoff_failed",
    title: `Background job failed after ${j.attempts} attempt(s): ${j.kind}`,
    cause: `${message}. The outcome of the provider call is UNKNOWN until checked: a timeout does not prove nothing happened.`,
    ownerRole: j.kind.startsWith("stripe") ? "accounting" : "admin",
    nextAction: "Establish whether the provider effect happened (J26/J27) — the handler reconciles prior effects — then re-request from the relevant screen.",
    dedupeKey: `job_failed:${j.id}`,
    links: [{ subjectType: "job", subjectId: j.id }],
  });
  return true;
}

export async function jobSummary(db: DbOrTx) {
  const rows = await db.select({ status: schema.job.status, count: sql<number>`count(*)::int` }).from(schema.job).groupBy(schema.job.status);
  const out: Record<string, number> = { queued: 0, running: 0, waiting: 0, done: 0, failed: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function listJobs(db: DbOrTx, opts: { statuses?: string[]; limit?: number } = {}) {
  const conds = opts.statuses?.length ? [inArray(schema.job.status, opts.statuses as never)] : [];
  return db
    .select()
    .from(schema.job)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.job.status), asc(schema.job.runAt))
    .limit(opts.limit ?? 50);
}
