/**
 * Document snapshots (docs/SHIPMENTS_SPEC.md §4). A snapshot is everything a template needs, captured at a point in
 * time; the PDF is rendered from the snapshot, never from live rows, so a regenerated document under the same number
 * carries a revision mark and still shows what was true when it was issued.
 */
export type DocumentKind = "bol" | "picking_ticket" | "pickup_pack" | "pull_sheet" | "invoice";

export interface PartyBlock {
  name: string;
  legalName?: string | null;
  lines: string[];
  license?: string | null;
  contact?: string | null;
  phone?: string | null;
}

export interface SnapshotLine {
  lineNo: number;
  skuCode: string | null;
  description: string;
  packageLabel: string;
  upcCase?: string | null;
  lotCode: string | null;
  qty: number;
  unitWeightLb: number | null;
  totalWeightLb: number | null;
  isKeg: boolean;
  kegSize?: "half" | "sixtel" | null;
  isPos: boolean;
  unitPriceCents?: number | null;
}

export interface ShipmentSnapshot {
  version: 1;
  kind: "bol" | "picking_ticket" | "pull_sheet";
  template: "distributor" | "retail" | "transfer";
  number: string | null;
  revision: number;
  status: string;
  voided: boolean;
  type: "D" | "T" | "S";
  pickup: boolean;
  scheduledDate: string;
  actualDate: string | null;
  shipper: { legalName: string; dba: string; lines: string[]; arEmail: string; phone?: string | null };
  shipFrom: PartyBlock & { originCode: string | null };
  shipTo: PartyBlock;
  poNumbers: string[];
  appointment: string | null;
  carrier: string | null;
  carrierPhone: string | null;
  sealNumber: string | null;
  trailerNumber: string | null;
  palletCount: number | null;
  palletBuild: string | null;
  freightClass: string | null;
  nmfc: { keg: string | null; can: string | null; status: string } | null;
  deliveryWindow: string | null;
  receivingInstructions: string | null;
  notes: string | null;
  lines: SnapshotLine[];
  totals: { kegs: number; cases: number; units: number; weightLb: number; halfKegs: number; sixtelKegs: number };
  kegPickup: { halfIn: number; sixtelIn: number } | null;
  footer: string | null;
  fixedLines: string[];
  generatedAt: string;
  generatedBy: string;
}

export interface InvoiceSnapshotLine {
  lineNo: number;
  kind: "beer" | "deposit" | "pos" | "info";
  description: string;
  lotCode: string | null;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface InvoiceSnapshot {
  version: 1;
  kind: "invoice";
  number: string | null;
  series: "INV" | "NC";
  status: string;
  revision: number;
  invoiceDate: string | null;
  dueDate: string | null;
  termsDays: number | null;
  issuer: { legalName: string; dba: string; lines: string[]; arEmail: string; remitTo: string | null };
  billTo: PartyBlock;
  shipTo: PartyBlock | null;
  shipmentNumbers: string[];
  poNumbers: string[];
  fobWording: string | null;
  lines: InvoiceSnapshotLine[];
  subtotalCents: number;
  depositCents: number;
  totalCents: number;
  notes: string | null;
  generatedAt: string;
  generatedBy: string;
}

export type AnySnapshot = ShipmentSnapshot | InvoiceSnapshot;

/**
 * The warehouse's master pull for one origin and scheduled date (5.2, §4 "Pull sheet"): every confirmed shipment
 * aggregated by SKU and lot, plus the per-stop list. Built by the batch-print route from `pullSheet()`; it is not
 * stored as a shipment_document because it belongs to the day, not to one shipment.
 */
export interface PullSheetSnapshot {
  version: 1;
  kind: "pull_sheet_day";
  origin: string;
  originCode?: string | null;
  scheduledDate: string;
  aggregate: Array<{ skuCode: string; description: string; lotCode: string | null; qty: number }>;
  stops: Array<{ number: string | null; destinationName: string; lines: Array<{ skuCode: string; lotCode: string | null; qty: number }> }>;
  generatedAt?: string;
  generatedBy?: string;
}

/** Implemented in src/lib/documents/pdf.tsx (@react-pdf/renderer). Returns PDF bytes for a snapshot. */
export type Renderer = (
  snapshot: AnySnapshot | PullSheetSnapshot | { kind: "pickup_pack"; bol: ShipmentSnapshot; invoice: InvoiceSnapshot | null } | { kind: "batch"; documents: AnySnapshot[] },
) => Promise<Buffer>;
