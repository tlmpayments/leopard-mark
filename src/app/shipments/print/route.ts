import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { isDriverOnly, isIsoDate, isUuid, pdfResponse, safeFilename, textResponse } from "@/lib/documents/http";
import { renderDocument, type RenderInput } from "@/lib/documents/pdf";
import { toPullSheetSnapshot } from "@/lib/documents/pull-sheet";
import type { AnySnapshot, PullSheetSnapshot, ShipmentSnapshot } from "@/lib/documents/types";
import { buildShipmentSnapshot, latestDocument, pullSheet } from "@/lib/domain/shipments/service";

/**
 * GET /shipments/print?origin=<warehouseId>&date=YYYY-MM-DD&kind=bol|picking_ticket|pull_sheet|all
 *
 * Batch print for one origin and scheduled date (6.8, 5.2): the warehouse's master pull sheet and, per confirmed,
 * staged, out or delivered shipment, its latest stored bill of lading and picking ticket, all in one PDF. "all" is
 * the pull sheet first, then each shipment's BOL and picking ticket in number order. Documents stored without PDF
 * bytes are rendered from their snapshot. This is an office and warehouse function; a driver prints a stop's own
 * documents from the shipment instead.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["bol", "picking_ticket", "pull_sheet", "all"] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.searchParams.get("origin");
  const date = req.nextUrl.searchParams.get("date");
  const kind = req.nextUrl.searchParams.get("kind") ?? "all";
  if (!isUuid(origin)) return textResponse("origin must be an origin (warehouse) id", 400);
  if (!isIsoDate(date)) return textResponse("date must be YYYY-MM-DD", 400);
  if (!isKind(kind)) return textResponse("kind must be bol, picking_ticket, pull_sheet or all", 400);
  const db = await getDb();
  const [originRow] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, origin));
  if (!originRow) return textResponse("Origin not found", 404);
  const actor = await requireAction("shipment.view", originRow.marketId);
  if (isDriverOnly(actor)) return textResponse("Batch print is an office and warehouse function; open your stop to print its documents", 403);

  const sheet = await pullSheet(db, actor, originRow.id, date);
  const documents: Array<AnySnapshot | PullSheetSnapshot> = [];
  if (kind === "pull_sheet" || kind === "all") documents.push(toPullSheetSnapshot(sheet, actor.displayName));
  const perShipment: Array<"bol" | "picking_ticket"> = kind === "all" ? ["bol", "picking_ticket"] : kind === "bol" || kind === "picking_ticket" ? [kind] : [];
  for (const stop of sheet.stops) {
    for (const docKind of perShipment) {
      const stored = await latestDocument(db, stop.shipment.id, docKind);
      documents.push(stored ? (stored.snapshot as ShipmentSnapshot) : await buildShipmentSnapshot(db, stop.shipment.id, docKind, actor.displayName));
    }
  }
  if (documents.length === 0) return textResponse("No confirmed shipments for this origin and date", 404);
  const input: RenderInput = { kind: "batch", documents };
  const pdf = await renderDocument(input);
  return pdfResponse(pdf, safeFilename([sheet.origin.originCode ?? sheet.origin.name, date, kind === "all" ? "documents" : kind]));
}
