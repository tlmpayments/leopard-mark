import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename, textResponse } from "@/lib/documents/http";
import { cfoExportCsv } from "@/lib/domain/collection";

/** GET /finance/export/csv?month=YYYY-MM — the month's invoices, payments, credits, fees and payouts in one CSV (R2). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return textResponse("month must be YYYY-MM", 400);
  const actor = await requireAction("report.export");
  const body = await cfoExportCsv(await getDb(), actor, month);
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename(["leopard-mark-export", month], "csv")}"`, "Cache-Control": "private, no-store" },
  });
}
