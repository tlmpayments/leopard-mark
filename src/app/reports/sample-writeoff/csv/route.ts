import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename, textResponse } from "@/lib/documents/http";
import { sampleWriteOff, sampleWriteOffCsv } from "@/lib/domain/reports/service";

/** GET /reports/sample-writeoff/csv?from=YYYY-MM-DD&to=YYYY-MM-DD — no-charge goods at unit cost by month and recipient. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return textResponse("from and to must be YYYY-MM-DD", 400);
  const actor = await requireAction("report.export");
  const r = await sampleWriteOff(await getDb(), actor, { from, to });
  return new Response(sampleWriteOffCsv(r, { from, to }), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename(["sample-writeoff", from, to], "csv")}"`, "Cache-Control": "private, no-store" },
  });
}
