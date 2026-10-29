import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename, textResponse } from "@/lib/documents/http";
import { microstarCsv, microstarReport } from "@/lib/domain/kegs/service";

/**
 * GET /reports/microstar/csv?month=YYYY-MM&groupBy=distributor|brewery
 * The monthly MicroStar outbound report (8.6) as a CSV download; report.export only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? "";
  const groupBy = req.nextUrl.searchParams.get("groupBy") === "brewery" ? "brewery" : "distributor";
  if (!/^\d{4}-\d{2}$/.test(month)) return textResponse("month must be YYYY-MM", 400);
  const actor = await requireAction("report.export");
  const rows = await microstarReport(await getDb(), actor, { month, groupBy });
  const body = microstarCsv(rows);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(["microstar", month, groupBy], "csv")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
