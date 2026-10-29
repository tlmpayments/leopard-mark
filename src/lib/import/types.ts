/**
 * Normalised records produced from the workbook. Every record carries the deterministic id the production load used
 * (see ids.ts); foreign keys reference other records by those ids and are translated to the ids actually present in
 * the database when the diff runs (diff.ts), so a row that already exists under a natural key is updated, never doubled.
 */
import type { AccountKind, Fulfilment } from "@/lib/domain/customers/shipping";
import type { OriginKind } from "@/lib/domain/origins/service";

export interface Flag {
  entity: string;
  key: string;
  message: string;
}

export interface Excluded {
  entity: string;
  key: string;
  reason: string;
}

export interface MarketRecord {
  id: string;
  code: string;
  name: string;
  timezone: string;
  regionList: string[];
}

export interface OriginRecord {
  id: string;
  /** Location Information "Type" value, or the origin code when the row is not in the tab (RAD). */
  key: string;
  name: string;
  originCode: string | null;
  lotFacilityCode: string | null;
  kind: OriginKind;
  marketCode: string | null;
  marketId: string | null;
  isPrimary: boolean;
  active: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressPostalCode: string | null;
  addressText: string | null;
  fulfillmentContact: string | null;
  shippingContactEmail: string | null;
  shippingContactPhone: string | null;
  appointmentRequired: boolean | null;
  loadingDock: boolean | null;
  hours: Record<string, string> | null;
  note: string;
}

export type PackageKind = "case_12oz_can" | "case_24oz_can" | "keg_sixtel" | "keg_half";

export interface SkuRecord {
  id: string;
  code: string;
  name: string;
  brand: string;
  packageKind: PackageKind;
  sellingUnit: string;
  kegsPerUnit: number;
  weightLb: string | null;
  archived: boolean;
  upcCase: string | null;
  upcRetail: string | null;
  upcUnit: string | null;
  palletFraction: string | null;
  recipeVariant: string | null;
  /** Active successor for an archived legacy code, when one exists. */
  successorCode: string | null;
}

export interface AliasRecord {
  alias: string;
  skuCode: string;
  skuId: string;
  note: string;
}

export interface PriceRecord {
  id: string;
  marketCode: string;
  marketId: string;
  skuCode: string;
  skuId: string;
  priceCents: number;
  /** ISO date; fixed to the October 28 list so ids match production. */
  asOf: string;
}

export interface GrantRecord {
  id: string;
  role: "owner" | "admin" | "accounting" | "sales" | "driver_service";
  marketCode: string | null;
  marketId: string | null;
}

export interface EmployeeRecord {
  id: string;
  displayName: string;
  enabled: boolean;
  disableReason: string | null;
  grants: GrantRecord[];
  /** Sheet "Sales Person" spellings that map to this person. */
  sheetNames: string[];
  source: string;
}

export interface ParsedAddress {
  line1: string;
  city: string;
  state: string;
  postal: string;
}

export interface AccountRecord {
  id: string;
  tradeName: string;
  legalName: string | null;
  marketCode: string;
  marketId: string;
  marketReason: string;
  kind: AccountKind;
  status: "active" | "inactive";
  /** undefined = leave whatever the database has; null = clear; id = set. */
  servedByLocationId?: string | null;
  servedByLabel?: string;
  legacyAccountId: string | null;
  region: string | null;
  termsText: string | null;
  termsDaysOverride: number | null;
  fulfilment: Fulfilment;
  firstDeliveryOn: string | null;
  deliveryInstructions: string | null;
  receivingRestrictions: string | null;
  originatingRepSheet: string | null;
  originatingRepEmployeeId: string | null;
  sourceTab: string;
  delivery: ParsedAddress | null;
  billing: ParsedAddress | null;
  buyer: { name: string; email: string | null; phone: string | null } | null;
  apEmail: string | null;
  license: string | null;
  channel: "unselected" | "stripe_ach" | "fintech";
  setupState: "unknown" | "not_requested";
  payNote: string | null;
  lastCleaning: string | null;
  ekos: string | null;
  priority: string | null;
  /** Non-empty source cells (for the audit event), contact details excluded. */
  raw: Record<string, string>;
}

export type BatchStatus = "scheduled" | "in_progress" | "complete" | "destroyed" | "cancelled";

export interface BatchRecord {
  id: string;
  batchNumber: string;
  facilityCode: string;
  facilityOriginId: string;
  brandCode: string;
  brewDate: string | null;
  vesselSize: string | null;
  status: BatchStatus;
  statusReason: string | null;
  statusChangedOn: string | null;
  breweryBatchNumber: string | null;
  notes: string | null;
  product: string;
}

export interface LotQtyRecord {
  id: string;
  skuCode: string;
  skuId: string;
  qty: number;
}

export interface LotRecord {
  id: string;
  lotCode: string;
  legacyCode: string | null;
  facilityCode: string;
  facilityOriginId: string;
  brandCode: string;
  packagingDate: string;
  runCode: string;
  batchNumber: string | null;
  batchId: string | null;
  quantitiesKnown: boolean;
  source: "production_tab" | "bol_log_backfill";
  notes: string | null;
  quantities: LotQtyRecord[];
}

export interface ShipmentLineRecord {
  id: string;
  lineNo: number;
  skuCode: string | null;
  skuId: string | null;
  posItemCode: string | null;
  lotCode: string | null;
  lotId: string | null;
  qty: number;
  weightLb: string | null;
}

export interface ShipmentRecord {
  id: string;
  number: string;
  type: "D" | "T" | "S";
  pickup: boolean;
  originKey: string;
  originId: string;
  destinationLocationId: string | null;
  destinationWarehouseId: string | null;
  destinationText: string | null;
  destinationLabel: string;
  destinationKind: string | null;
  template: "distributor" | "retail" | "transfer";
  scheduledDate: string;
  actualDate: string;
  marketId: string | null;
  carrier: string | null;
  carrierPhone: string | null;
  freightClass: string | null;
  palletCount: number | null;
  appointment: string | null;
  deliveryWindow: string | null;
  receivingInstructions: string | null;
  notes: string | null;
  invoiceNumber: string | null;
  mergedIntoNumber: string | null;
  mergedIntoShipmentId: string | null;
  kegPickup: { halfIn: number; sixtelIn: number } | null;
  legacyPayload: Record<string, unknown>;
  lines: ShipmentLineRecord[];
}

export interface InvoiceLineRecord {
  id: string;
  lineNo: number;
  kind: "beer" | "deposit" | "pos" | "info";
  skuCode: string | null;
  skuId: string | null;
  description: string;
  lotCode: string | null;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface InvoiceRecord {
  id: string;
  number: string;
  series: "INV" | "NC";
  status: "issued" | "paid" | "void";
  legacyStatus: string;
  invoiceDate: string | null;
  customerText: string;
  locationId: string | null;
  marketId: string | null;
  subtotalCents: number;
  totalCents: number;
  notes: string | null;
  shipmentNumbers: string[];
  legacyPayload: Record<string, unknown>;
  lines: InvoiceLineRecord[];
}

export interface NormalizedImport {
  fileName: string;
  missingTabs: string[];
  markets: MarketRecord[];
  origins: OriginRecord[];
  skus: SkuRecord[];
  aliases: AliasRecord[];
  prices: PriceRecord[];
  employees: EmployeeRecord[];
  accounts: AccountRecord[];
  batches: BatchRecord[];
  lots: LotRecord[];
  shipments: ShipmentRecord[];
  invoices: InvoiceRecord[];
  /** Legacy invoice to legacy shipment links by number (from the Sales BOL # column and the log's invoiceNumber). */
  links: Array<{ invoiceNumber: string; shipmentNumber: string }>;
  flags: Flag[];
  excluded: Excluded[];
}
