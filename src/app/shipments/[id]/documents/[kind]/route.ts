import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { isDriverOnly, isUuid, pdfResponse, safeFilename, textResponse } from "@/lib/documents/http";
import { renderDocument } from "@/lib/documents/pdf";
import type { InvoiceSnapshot, ShipmentSnapshot } from "@/lib/documents/types";
import { buildInvoiceSnapshot, latestInvoiceDocument, type Invoice } from "@/lib/domain/invoices/service";
import { getShipment, latestDocument } from "@/lib/domain/shipments/service";

/**
 * GET /shipments/[id]/documents/bol | picking_ticket | pickup_pack
 *
 * Streams the latest stored document for the shipment as an inline PDF (docs/SHIPMENTS_SPEC.md §4, 6.5, 6.7). The
 * bytes stored at confirmation are served as they are; when the renderer was unavailable at that moment the stored
 * snapshot is rendered now, so the document still shows what was true when it was issued. The pickup pack is the
 * bill of lading followed by the shipment's invoice in one PDF.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["bol", "picking_ticket", "pickup_pack"] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

/** The invoice to pack with the BOL: an issued (or paid) one first, else the open draft; voided invoices never print. */
function invoiceForPack(invoices: Invoice[]): Invoice | null {
  const live = invoices.filter((i) => i.status !== "void");
  const byRecency = (a: Invoice, b: Invoice) => (b.issuedAt?.getTime() ?? b.createdAt.getTime()) - (a.issuedAt?.getTime() ?? a.createdAt.getTime());
  const issued = live.filter((i) => i.status === "issued" || i.status === "paid").sort(byRecency);
  if (issued[0]) return issued[0];
  const drafts = live.filter((i) => i.status === "draft").sort(byRecency);
  return drafts[0] ?? null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await ctx.params;
  if (!isKind(kind)) return textResponse("Unknown document kind", 404);
  if (!isUuid(id)) return textResponse("Shipment not found", 404);
  const db = await getDb();
  const detail = await getShipment(db, id);
  if (!detail) return textResponse("Shipment not found", 404);
  const actor = await requireAction("shipment.view", detail.shipment.marketId);
  if (isDriverOnly(actor) && detail.shipment.driverEmployeeId !== actor.employeeId) return textResponse("This stop is not assigned to you", 403);

  const shipment = detail.shipment;
  if (kind === "pickup_pack") {
    const bol = await latestDocument(db, shipment.id, "bol");
    if (!bol) return textResponse("No bill of lading yet; the documents exist from confirmation onward", 404);
    const invoice = invoiceForPack(detail.invoices);
    let invoiceSnapshot: InvoiceSnapshot | null = null;
    if (invoice) {
      const stored = invoice.status === "draft" ? null : await latestInvoiceDocument(db, invoice.id);
      invoiceSnapshot = stored ? (stored.snapshot as InvoiceSnapshot) : await buildInvoiceSnapshot(db, invoice.id, actor.displayName);
    }
    const pdf = await renderDocument({ kind: "pickup_pack", bol: bol.snapshot as ShipmentSnapshot, invoice: invoiceSnapshot });
    return pdfResponse(pdf, safeFilename([bol.number ?? "draft", bol.revision > 0 ? `R${bol.revision}` : null, "pickup-pack"]));
  }

  const doc = await latestDocument(db, shipment.id, kind);
  if (!doc) return textResponse("No document yet; the documents exist from confirmation onward", 404);
  const pdf = doc.pdf ? Buffer.from(doc.pdf) : await renderDocument(doc.snapshot as ShipmentSnapshot);
  return pdfResponse(pdf, safeFilename([doc.number ?? "draft", doc.revision > 0 ? `R${doc.revision}` : null, kind === "bol" ? "bol" : "picking-ticket"]));
}
