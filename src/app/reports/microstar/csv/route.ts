import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename, textResponse } from "@/lib/documents/http";
import { microstarCsv, microstarReport } from "@/lib/domain/kegs/service";

/**
 * GET /reports/microstar/csv?month=YYYY-MM&facility=<warehouseId>
 * The monthly MicroStar outbound CSV per facility (8.6, R2-25); report.export only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? "";
  const facility = req.nextUrl.searchParams.get("facility") || null;
  if (!/^\d{4}-\d{2}$/.test(month)) return textResponse("month must be YYYY-MM", 400);
  if (facility && !/^[0-9a-f-]{36}$/i.test(facility)) return textResponse("facility must be an origin id", 400);
  const actor = await requireAction("report.export");
  const rows = await microstarReport(await getDb(), actor, { month, facilityWarehouseId: facility });
  const body = microstarCsv(rows);
  const facilityCode = rows[0]?.facilityName.split(" ")[0] ?? (facility ? "facility" : "all");
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(["microstar", facilityCode, month], "csv")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
