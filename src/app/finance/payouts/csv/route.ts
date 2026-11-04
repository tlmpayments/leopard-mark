import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { safeFilename } from "@/lib/documents/http";
import { csvLine, listPayoutsWithDetail } from "@/lib/domain/collection";

/** GET /finance/payouts/csv — every synced payout with the invoices and fees inside it (S8). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAction("report.export");
  const rows = await listPayoutsWithDetail(await getDb(), 500);
  const money = (c: number) => (c / 100).toFixed(2);
  const lines = [csvLine(["Arrival", "Payout", "Status", "Payout amount", "Type", "Invoice", "Account", "Gross", "Fee", "Net", "Description"])];
  for (const { payout, lines: bts } of rows) {
    if (!bts.length) lines.push(csvLine([payout.arrivalDate, payout.payoutId, payout.status, money(payout.amountCents), "", "", "", "", "", "", "no balance transactions pulled yet"]));
    for (const b of bts) lines.push(csvLine([payout.arrivalDate, payout.payoutId, payout.status, money(payout.amountCents), b.bt.type, b.inv?.number ?? "", b.loc?.tradeName ?? "", money(b.bt.amountCents), money(b.bt.feeCents), money(b.bt.netCents), b.bt.description ?? ""]));
  }
  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${safeFilename(["stripe-payouts"], "csv")}"`, "Cache-Control": "private, no-store" },
  });
}
