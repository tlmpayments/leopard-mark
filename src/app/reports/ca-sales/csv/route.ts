import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename, textResponse } from "@/lib/documents/http";
import { isCaliforniaMarket, listMarketsForReports, salesByFormat, salesByFormatCsv } from "@/lib/domain/reports/service";

/** GET /reports/ca-sales/csv?from=YYYY-MM-DD&to=YYYY-MM-DD&market=<id>&market=<id> — sales by format for the chosen markets. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return textResponse("from and to must be YYYY-MM-DD", 400);
  const actor = await requireAction("report.export");
  const db = await getDb();
  const markets = await listMarketsForReports(db);
  const chosen = req.nextUrl.searchParams.getAll("market").filter((m) => /^[0-9a-f-]{36}$/i.test(m));
  const ids = chosen.length ? chosen : markets.filter(isCaliforniaMarket).map((m) => m.id);
  const r = await salesByFormat(db, actor, { from, to, marketIds: ids });
  const label = markets.filter((m) => ids.includes(m.id)).map((m) => m.code).join(", ") || "no markets";
  return new Response(salesByFormatCsv(r, { from, to, marketLabel: label }), {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename(["ca-sales-by-format", from, to], "csv")}"`, "Cache-Control": "private, no-store" },
  });
}
