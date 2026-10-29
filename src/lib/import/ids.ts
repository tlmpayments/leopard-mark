/**
 * Deterministic ids for imported rows (SHIPMENTS_SPEC §2): `md5('<entity>|<natural key>')::uuid`, exactly as the
 * October 28 production load computed them (tools/import/gen_prod.py), so a dry run against production reports those
 * rows as unchanged or updated rather than new.
 */
import { createHash } from "node:crypto";

export function did(entity: string, key: string): string {
  const h = createHash("md5").update(`${entity}|${key}`, "utf8").digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Natural keys used by the production load and by this import. Kept in one place so the two never drift. */
export const ids = {
  market: (code: string) => did("market", code),
  /** Location Information "Type" value (P_CA_Richmond, W_CA_Windsor 01) or the origin code for rows not in the tab (RAD). */
  origin: (typeOrCode: string) => did("warehouse", typeOrCode),
  sku: (code: string) => did("sku", code),
  price: (marketCode: string, skuCode: string, asOf: string) => did("price", `${marketCode}|${skuCode}|${asOf}`),
  location: (tradeName: string) => did("location", tradeName.toLowerCase()),
  address: (locationId: string, kind: "delivery" | "billing") => did("address", `${locationId}|${kind}`),
  locationAddress: (locationId: string, kind: "delivery" | "billing") => did("locaddr", `${locationId}|${kind}`),
  contact: (locationId: string, role: "buyer" | "ap") => did("contact", `${locationId}|${role}`),
  locationContact: (locationId: string, role: "buyer" | "ap") => did("loccontact", `${locationId}|${role}`),
  license: (locationId: string) => did("license", locationId),
  payment: (locationId: string) => did("payment", locationId),
  cleaning: (locationId: string) => did("cleaning", locationId),
  employee: (displayName: string) => did("employee", displayName.toLowerCase()),
  grant: (employeeId: string, role: string, marketCode: string | null) => did("grant", `${employeeId}|${role}|${marketCode ?? ""}`),
  batch: (batchNumber: string) => did("batch", batchNumber),
  lot: (lotCode: string) => did("lot", lotCode),
  lotQty: (lotId: string, skuId: string) => did("lot_qty", `${lotId}|${skuId}`),
  legacyShipment: (docNumber: string) => did("legacy_shipment", docNumber),
  legacyShipmentLine: (docNumber: string, lineNo: number) => did("legacy_shipment_line", `${docNumber}|${lineNo}`),
  legacyInvoice: (number: string) => did("legacy_invoice", number),
  legacyInvoiceLine: (number: string, lineNo: number) => did("legacy_invoice_line", `${number}|${lineNo}`),
};
