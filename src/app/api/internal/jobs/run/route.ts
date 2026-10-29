import { NextResponse, type NextRequest } from "next/server";
import { SYSTEM_ACTOR } from "@/lib/authz/actor";
import { getDb } from "@/lib/db/client";
import { generateStandingOccurrences } from "@/lib/domain/standing/service";
import { schedulePullSheetSends } from "@/lib/domain/pullsheet/service";
import { runDueJobs } from "@/lib/jobs/queue";
import "@/lib/integrations/stripe/adapter"; // registers job handlers

/**
 * Cron-driven job runner (vercel.json schedules it). Protected by CRON_SECRET
 * (Vercel sends `Authorization: Bearer <CRON_SECRET>`). Also runs standing
 * generation, which is inert while D13 is unselected.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const out: Record<string, unknown> = { ranAt: new Date().toISOString() };
  try {
    // End-of-day pull sheets (R2-29): queued only while the company switch is on; the job waits until a send transport exists.
    out.pullSheets = await schedulePullSheetSends(await getDb());
  } catch (err) {
    out.pullSheetsError = err instanceof Error ? err.message : String(err);
  }
  try {
    out.jobs = await runDueJobs((await getDb()), { limit: 50, workerId: "vercel-cron" });
  } catch (err) {
    out.jobsError = err instanceof Error ? err.message : String(err);
  }
  try {
    out.standing = await generateStandingOccurrences((await getDb()), SYSTEM_ACTOR);
  } catch (err) {
    out.standingError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json(out, { status: out.jobsError || out.standingError ? 500 : 200 });
}
