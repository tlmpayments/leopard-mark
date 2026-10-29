import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { isUuid, pdfResponse, safeFilename, textResponse } from "@/lib/documents/http";
import { renderDocument } from "@/lib/documents/pdf";
import type { InvoiceSnapshot } from "@/lib/documents/types";
import { buildInvoiceSnapshot, getInvoice, latestInvoiceDocument } from "@/lib/domain/invoices/service";

/**
 * GET /invoices/[id]/pdf
 *
 * The issued invoice is served from the document stored at issue (7.x); a draft has no stored document, so its
 * snapshot is built live and rendered with a DRAFT stamp. A voided invoice is also rendered live so the VOID stamp
 * shows, whatever was stored when it was issued.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return textResponse("Invoice not found", 404);
  const db = await getDb();
  const detail = await getInvoice(db, id);
  if (!detail) return textResponse("Invoice not found", 404);
  const actor = await requireAction("invoice.view", detail.invoice.marketId);

  const inv = detail.invoice;
  const live = inv.status === "draft" || inv.status === "void";
  const stored = live ? null : await latestInvoiceDocument(db, inv.id);
  let pdf: Buffer;
  if (stored?.pdf) pdf = Buffer.from(stored.pdf);
  else if (stored) pdf = await renderDocument(stored.snapshot as InvoiceSnapshot);
  else pdf = await renderDocument(await buildInvoiceSnapshot(db, inv.id, actor.displayName));
  const stem = inv.number ?? `${inv.series}-draft`;
  return pdfResponse(pdf, safeFilename([stem, inv.status === "void" ? "VOID" : null, "invoice"]));
}
