import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename, textResponse } from "@/lib/documents/http";
import { arAging, arAgingCsv } from "@/lib/domain/collection";
import { todayIso } from "@/app/shipments/labels";

/** GET /finance/aging/csv?asOf=YYYY-MM-DD — receivables ageing by account (S7); report.export only. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const asOf = req.nextUrl.searchParams.get("asOf") || todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return textResponse("asOf must be YYYY-MM-DD", 400);
  const actor = await requireAction("report.export");
  const r = await arAging(await getDb(), actor, asOf, { includeLegacy: req.nextUrl.searchParams.get("legacy") === "1" });
  return new Response(arAgingCsv(r, asOf), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename(["ar-aging", asOf], "csv")}"`, "Cache-Control": "private, no-store" },
  });
}
