/**
 * Shapes the result of `pullSheet()` (src/lib/domain/shipments/service.ts) into the day pull-sheet snapshot the
 * renderer takes. Structurally typed on purpose: the documents package does not import the domain layer.
 */
import type { PullSheetSnapshot } from "./types";

export interface PullSheetSource {
  origin: { name: string; originCode: string | null };
  scheduledDate: string;
  aggregate: Array<{ skuCode: string; description: string; lotCode: string | null; qty: number }>;
  stops: Array<{ shipment: { number: string | null }; destinationName: string; lines: Array<{ skuCode: string; lotCode: string | null; qty: number }> }>;
}

export function toPullSheetSnapshot(sheet: PullSheetSource, generatedBy: string, now: Date = new Date()): PullSheetSnapshot {
  return {
    version: 1,
    kind: "pull_sheet_day",
    origin: sheet.origin.name,
    originCode: sheet.origin.originCode,
    scheduledDate: sheet.scheduledDate,
    aggregate: sheet.aggregate.map((a) => ({ skuCode: a.skuCode, description: a.description, lotCode: a.lotCode, qty: a.qty })),
    stops: sheet.stops.map((s) => ({
      number: s.shipment.number,
      destinationName: s.destinationName,
      lines: s.lines.map((l) => ({ skuCode: l.skuCode, lotCode: l.lotCode, qty: l.qty })),
    })),
    generatedAt: now.toISOString(),
    generatedBy,
  };
}
