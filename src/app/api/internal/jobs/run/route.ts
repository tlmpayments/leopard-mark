import { NextResponse, type NextRequest } from "next/server";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import { getDb } from "@/lib/db/client";
import { generateStandingOccurrences } from "@/lib/domain/standing/service";
import { schedulePullSheetSends } from "@/lib/domain/pullsheet/service";
import { sweepOriginStockAging, sweepOverdueInvoices } from "@/lib/domain/alerts/service";
import { chaseUnfinishedSetups, reconcileWithStripe, scheduleDueDateDebits } from "@/lib/domain/collection";
import { pollIntakeMailbox } from "@/lib/domain/intake/mailbox";
import { runDueJobs } from "@/lib/jobs/queue";
import "@/lib/integrations/stripe/adapter"; // registers job handlers
import "@/lib/domain/collection"; // registers the Stripe executors, hooks and jobs (Round 4)

/**
 * Cron-driven job runner (vercel.json schedules it every five minutes). Protected by CRON_SECRET (Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`). Also runs standing generation, which is inert while D13 is unselected.
 *
 * Round 4 adds: the orders@ mailbox poll (every run, when the switch is on), the due-date debit sweep (hourly), the
 * unfinished bank setup chase (hourly) and the nightly reconciliation with Stripe (first run after 02:00 UTC).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const out: Record<string, unknown> = { ranAt: new Date().toISOString() };
  const now = new Date();
  const hourly = now.getUTCMinutes() < 5 || req.nextUrl.searchParams.get("sweeps") === "1";
  const nightly = (now.getUTCHours() === 2 && now.getUTCMinutes() < 5) || req.nextUrl.searchParams.get("nightly") === "1";
  try {
    // End-of-day pull sheets (R2-29): one approval item per warehouse and day while the company switch is on.
    out.pullSheets = await schedulePullSheetSends(await getDb());
  } catch (err) {
    out.pullSheetsError = err instanceof Error ? err.message : String(err);
  }
  try {
    // The orders@ mailbox into Email intake (Round 4), read only; a no-op while the switch is off.
    out.mailbox = await pollIntakeMailbox(await getDb());
  } catch (err) {
    out.mailboxError = err instanceof Error ? err.message : String(err);
  }
  try {
    if (hourly) {
      // Round 3 sweeps: overdue invoices and beer aging at an origin with a days-on-hand limit. Cases only, no email.
      out.overdue = await sweepOverdueInvoices(await getDb(), SYSTEM_ACTOR);
      out.aging = await sweepOriginStockAging(await getDb(), SYSTEM_ACTOR);
      // Round 4: debits whose date has arrived become approval items; setup links sent days ago with no bank open a case.
      out.debits = await scheduleDueDateDebits(await getDb(), now);
      out.setupChase = await chaseUnfinishedSetups(await getDb(), now);
    }
    if (nightly) out.reconcile = await reconcileWithStripe(await getDb(), now);
  } catch (err) {
    out.sweepsError = err instanceof Error ? err.message : String(err);
  }
  try {
    out.jobs = await runDueJobs(await getDb(), { limit: 50, workerId: "vercel-cron" });
  } catch (err) {
    out.jobsError = err instanceof Error ? err.message : String(err);
  }
  try {
    out.standing = await generateStandingOccurrences(await getDb(), SYSTEM_ACTOR);
  } catch (err) {
    out.standingError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(out, { status: out.jobsError || out.standingError ? 500 : 200 });
}
