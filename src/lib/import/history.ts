/**
 * Legacy history (SHIPMENTS_SPEC §2 "Legacy history", decisions 1.4, 1.5, 1.7, 4.9, 4.10, 5.5, 5.13, 7.6):
 * Production and Packaged Products to batches and lots, BOL Maker Log to legacy shipments (plus backfilled lots),
 * Sales to legacy invoices, and the invoice-to-shipment links by BOL number.
 */
import { parseLotCode } from "@/lib/domain/lots/service";
import { parseAddress } from "./address";
import { ids } from "./ids";
import { looseKey, nameKey, type NormalizeContext } from "./common";
import type { Sheet } from "./parse";
import { EXCLUDED_ACCOUNTS, NAME_ALIASES, ORIGIN_NAME_HINTS, PREFIX_ALIASES } from "./rules";
import { resolveCode, resolveProductPackage, skuForLotBrand, type SkuCatalog } from "./skus";
import type { AccountRecord, BatchRecord, BatchStatus, EmployeeRecord, InvoiceLineRecord, InvoiceRecord, LotRecord, OriginRecord, ShipmentLineRecord, ShipmentRecord } from "./types";

export interface HistoryInput {
  sheets: { production: Sheet | null; packaged: Sheet | null; bolLog: Sheet | null; sales: Sheet | null };
  origins: OriginRecord[];
  accounts: AccountRecord[];
  cat: SkuCatalog;
  ctx: NormalizeContext;
  /** Code spellings seen anywhere, for the alias table (code to source tab). */
  seenCodes: Map<string, string>;
  employees: EmployeeRecord[];
}

export interface HistoryOutput {
  batches: BatchRecord[];
  lots: LotRecord[];
  shipments: ShipmentRecord[];
  invoices: InvoiceRecord[];
  links: Array<{ invoiceNumber: string; shipmentNumber: string }>;
}

const STATUS_MAP: Record<string, BatchStatus> = { complete: "complete", completed: "complete", "in progress": "in_progress", scheduled: "scheduled", destroyed: "destroyed", cancelled: "cancelled", canceled: "cancelled" };

function isoDate(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim());
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

function num(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function cents(s: string): number | null {
  const n = num(s.replace(/[$,]/g, ""));
  return n === null ? null : Math.round(n * 100);
}

/** Brand token of a dotted lot code or a Production "Product" cell to a three-letter lot brand code. */
function brandFromProduct(product: string): string | null {
  const p = product.toLowerCase();
  if (p.includes("bay area") || p === "sgb") return "SGB";
  if (p.includes("socal") || p === "sgs") return "SGS";
  if (p.includes("sunlight") || p === "slg") return "SLG";
  if (p.includes("cantinesca") || p === "cnt") return "CNT";
  if (p.includes("giro") || p === "gsp") return "GSP";
  if (p.includes("hazy") || p === "xhz") return "XHZ";
  if (p.includes("vienna") || p === "xvn") return "XVN";
  if (p.includes("experimental all") || p === "xal") return "XAL";
  if (/^[A-Z]{3}$/.test(product.trim().toUpperCase())) return product.trim().toUpperCase();
  return null;
}

/** Dotted lot codes with or without the TLM prefix: TLM.EBB.SGB.001, PRO.CNT.001. */
const DOTTED_LOT_RE = /^(?:TLM\.)?([A-Z]{3})\.(.+?)\.(\d{3})$/i;

export function canonicalDottedLot(code: string): string | null {
  const m = DOTTED_LOT_RE.exec(code.trim());
  if (!m) return null;
  return `TLM.${m[1].toUpperCase()}.${m[2].toUpperCase()}.${m[3]}`;
}

/** A lot code with a stray zero in the date part (05CNT02609021) collapses to the twelve-character code. */
export function repairLotCode(code: string): { code: string; repaired: boolean } {
  const c = code.trim().toUpperCase();
  if (parseLotCode(c)) return { code: c, repaired: false };
  const m = /^(\d{2})([A-Z]{3})0(\d{6})([A-Z0-9])$/.exec(c);
  if (m) {
    const fixed = `${m[1]}${m[2]}${m[3]}${m[4]}`;
    if (parseLotCode(fixed)) return { code: fixed, repaired: true };
  }
  return { code: c, repaired: false };
}

function yymmdd(iso: string): string {
  return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
}

// ---------------------------------------------------------------------------
// Batches and lots
// ---------------------------------------------------------------------------

type PkgCol = { col: string; pkg: "KHB01" | "KSB01" | "C1224" | "C2412" };
const QTY_COLUMNS: PkgCol[] = [
  { col: "1/2 Kegs Packaged", pkg: "KHB01" },
  { col: "1/6 Kegs Packaged", pkg: "KSB01" },
  { col: "4/6/12oz Cases Packaged", pkg: "C1224" },
  { col: "4/3/24oz Cases Packaged", pkg: "C2412" },
];

function quantitiesFor(ctx: NormalizeContext, cat: SkuCatalog, lotId: string, lotCode: string, brand: string, run: string, values: Array<{ pkg: PkgCol["pkg"]; raw: string }>): { quantities: LotRecord["quantities"]; any: boolean } {
  const quantities: LotRecord["quantities"] = [];
  let any = false;
  for (const v of values) {
    const n = num(v.raw);
    if (n === null) continue;
    any = true;
    if (v.pkg === "C2412") {
      if (n > 0) ctx.flag("lot", lotCode, `${n} cases of 4/3/24oz not recorded: the 24 oz format is inactive (3.11)`);
      continue;
    }
    const skuCode = skuForLotBrand(cat, brand, run, v.pkg);
    if (!skuCode) {
      if (n > 0) ctx.flag("lot", lotCode, `No SKU for brand ${brand} ${v.pkg}; ${n} units not recorded`);
      continue;
    }
    const qty = Math.round(n);
    if (qty !== n) ctx.flag("lot", lotCode, `Fractional quantity ${n} for ${skuCode} rounded to ${qty}`);
    const sku = cat.byCode.get(skuCode)!;
    const existing = quantities.find((q) => q.skuCode === skuCode);
    if (existing) existing.qty += qty;
    else quantities.push({ id: ids.lotQty(lotId, sku.id), skuCode, skuId: sku.id, qty });
  }
  return { quantities, any };
}

function normalizeBatchesAndLots(input: HistoryInput): { batches: BatchRecord[]; lots: LotRecord[] } {
  const { sheets, origins, cat, ctx } = input;
  const batches: BatchRecord[] = [];
  const lots: LotRecord[] = [];
  const byFacility = new Map(origins.filter((o) => o.lotFacilityCode).map((o) => [o.lotFacilityCode!, o]));
  const realCodes = new Set<string>();
  const prod = sheets.production;
  if (!prod) {
    ctx.flag("workbook", "Production", "Tab missing: no batches or lots were read");
    return { batches, lots };
  }
  // First pass: real lot codes, so synthetic codes for dotted lots can avoid collisions.
  for (const r of prod.rows) {
    const lotRaw = prod.get(r, "Lot #");
    if (parseLotCode(lotRaw)) realCodes.add(lotRaw.toUpperCase());
  }
  for (const r of prod.rows) {
    const batchNumber = prod.get(r, "Batch #").toUpperCase();
    if (!batchNumber) continue;
    const location = prod.get(r, "Location");
    const facilityCode = /^(\d{2})/.exec(location)?.[1] ?? /^B(\d{2})/.exec(batchNumber)?.[1] ?? null;
    const facility = facilityCode ? byFacility.get(facilityCode) : undefined;
    if (!facility) {
      ctx.flag("batch", batchNumber, `Location "${location}" names no known lot facility; batch skipped`);
      continue;
    }
    const product = prod.get(r, "Product");
    const brandCode = /^B\d{2}([A-Z]{3})/.exec(batchNumber)?.[1] ?? brandFromProduct(product) ?? "UNK";
    const statusText = prod.get(r, "Status");
    const status = STATUS_MAP[statusText.toLowerCase()];
    if (!status) ctx.flag("batch", batchNumber, `Status "${statusText}" not recognised; recorded as scheduled`);
    const packageDate = isoDate(prod.get(r, "Actual Package Date"));
    const notes = prod.get(r, "Notes") || null;
    const brewDate = isoDate(prod.get(r, "Brew Date"));
    const finalStatus: BatchStatus = status ?? "scheduled";
    batches.push({
      id: ids.batch(batchNumber),
      batchNumber,
      facilityCode: facility.lotFacilityCode!,
      facilityOriginId: facility.id,
      brandCode,
      brewDate,
      vesselSize: prod.get(r, "Vessel / Tank Size") || null,
      status: finalStatus,
      statusReason: finalStatus === "destroyed" || finalStatus === "cancelled" ? notes ?? `${statusText} per the Production tab` : null,
      statusChangedOn: finalStatus === "complete" ? packageDate : null,
      breweryBatchNumber: prod.get(r, "Brewery Batch Number") || null,
      notes,
      product,
    });
    // Lot
    const lotRaw = prod.get(r, "Lot #");
    if (!lotRaw || ["TBD", "N/A", "-"].includes(lotRaw.toUpperCase())) continue;
    const values = QTY_COLUMNS.map((c) => ({ pkg: c.pkg, raw: prod.get(r, c.col) }));
    const parsed = parseLotCode(lotRaw);
    if (parsed) {
      const lotCode = lotRaw.toUpperCase();
      const lotFacility = byFacility.get(parsed.facilityCode);
      if (!lotFacility) {
        ctx.flag("lot", lotCode, "Lot facility prefix names no known brewery; lot skipped");
        continue;
      }
      if (lotFacility.id !== facility.id) ctx.flag("lot", lotCode, `Lot facility ${parsed.facilityCode} differs from the batch location ${location}; the lot code wins`);
      const lotId = ids.lot(lotCode);
      const { quantities, any } = quantitiesFor(ctx, cat, lotId, lotCode, parsed.brandCode, parsed.runCode, values);
      lots.push({ id: lotId, lotCode, legacyCode: null, facilityCode: parsed.facilityCode, facilityOriginId: lotFacility.id, brandCode: parsed.brandCode, packagingDate: parsed.packagingDate, runCode: parsed.runCode, batchNumber, batchId: ids.batch(batchNumber), quantitiesKnown: any, source: "production_tab", notes: null, quantities });
      if (!any) ctx.flag("lot", lotCode, "Production row has no packaged quantities; the lot is imported with quantities unknown");
      continue;
    }
    const dotted = canonicalDottedLot(lotRaw);
    if (dotted) {
      if (!packageDate) {
        ctx.flag("lot", dotted, `Dotted lot without a packaging date (${finalStatus}); no lot row`);
        continue;
      }
      const m = DOTTED_LOT_RE.exec(dotted)!;
      const dottedBrand = brandFromProduct(m[2]) ?? brandCode;
      const synthetic = `${facility.lotFacilityCode}${dottedBrand}${yymmdd(packageDate)}1`;
      const lotCode = realCodes.has(synthetic) ? dotted : synthetic;
      if (realCodes.has(synthetic)) ctx.flag("lot", dotted, `Synthetic code ${synthetic} collides with a real lot; the dotted code is used as the lot code`);
      else realCodes.add(synthetic);
      const lotId = ids.lot(lotCode);
      const { quantities, any } = quantitiesFor(ctx, cat, lotId, lotCode, dottedBrand, "1", values);
      lots.push({ id: lotId, lotCode, legacyCode: dotted, facilityCode: facility.lotFacilityCode!, facilityOriginId: facility.id, brandCode: dottedBrand, packagingDate: packageDate, runCode: "1", batchNumber, batchId: ids.batch(batchNumber), quantitiesKnown: any, source: "production_tab", notes: `Legacy dotted lot ${dotted} (history only, 1.7)`, quantities });
      continue;
    }
    ctx.flag("lot", lotRaw, `Lot code on batch ${batchNumber} not understood; no lot row`);
  }
  // Packaged Products: quantities for dotted lots (and for lots whose Production row has none) by synthetic code.
  const pk = sheets.packaged;
  if (pk) {
    const manufacturerFacility = (name: string): string | null => {
      const n = name.toLowerCase();
      for (const h of ORIGIN_NAME_HINTS) if (n.includes(h.contains)) return origins.find((o) => o.originCode === h.originCode)?.lotFacilityCode ?? null;
      return null;
    };
    const perLot = new Map<string, Array<{ code: string; qty: number; row: string[] }>>();
    for (const r of pk.rows) {
      const lotRaw = pk.get(r, "Lot #");
      const code = pk.get(r, "Product Code");
      const qty = num(pk.get(r, "Qty"));
      if (!lotRaw || !code || qty === null) continue;
      input.seenCodes.set(code.toUpperCase(), "Packaged Products");
      let target: string | null = null;
      const dotted = canonicalDottedLot(lotRaw);
      if (dotted) {
        const byLegacy = lots.find((l) => l.legacyCode === dotted);
        if (byLegacy) target = byLegacy.lotCode;
        else {
          const pkgDate = isoDate(pk.get(r, "Packaged Date"));
          const fac = manufacturerFacility(pk.get(r, "Manufacturer"));
          const brand = brandFromProduct(DOTTED_LOT_RE.exec(dotted)![2]) ?? brandFromProduct(pk.get(r, "Product"));
          if (pkgDate && fac && brand) target = `${fac}${brand}${yymmdd(pkgDate)}1`;
        }
      } else if (parseLotCode(lotRaw)) {
        target = lotRaw.toUpperCase();
        if (!lots.some((l) => l.lotCode === target)) {
          // Typos in the tab (01GSB2606021 for 01SGB2606021, 02SGS260312A for 02XHZ260312A): one Production lot with the
          // same facility, date and run whose brand matches the product code's brand, or is an anagram of the typed brand.
          const p = parseLotCode(target)!;
          const codeBrand = /^(?:TLM-)?([A-Z]{3})/.exec(code.toUpperCase())?.[1] ?? null;
          const sameDay = lots.filter((l) => l.facilityCode === p.facilityCode && l.packagingDate === p.packagingDate && l.runCode === p.runCode);
          const fix = sameDay.filter((l) => l.brandCode === codeBrand || l.brandCode.split("").sort().join("") === p.brandCode.split("").sort().join(""));
          if (fix.length === 1) {
            ctx.flag("lot", fix[0].lotCode, `Packaged Products lot ${target} read as ${fix[0].lotCode} (same facility, date and run)`);
            target = fix[0].lotCode;
          }
        }
      }
      if (!target || !lots.some((l) => l.lotCode === target)) {
        ctx.flag("lot", lotRaw, `Packaged Products row (${code}, ${qty}) matches no Production lot; ignored`);
        continue;
      }
      if (!perLot.has(target)) perLot.set(target, []);
      perLot.get(target)!.push({ code, qty, row: r });
    }
    for (const [lotCode, rows] of perLot) {
      const lot = lots.find((l) => l.lotCode === lotCode)!;
      if (lot.quantitiesKnown) continue; // Production quantities win.
      for (const { code, qty } of rows) {
        const r = resolveCode(cat, code);
        if (!r || r.kind !== "sku") {
          ctx.flag("lot", lotCode, `Packaged Products code ${code} not resolved; ${qty} units not recorded`);
          continue;
        }
        const sku = cat.byCode.get(r.code)!;
        const rounded = Math.round(qty);
        if (rounded !== qty) ctx.flag("lot", lotCode, `Fractional quantity ${qty} for ${r.code} rounded to ${rounded}`);
        const existing = lot.quantities.find((q) => q.skuCode === r.code);
        if (existing) existing.qty += rounded;
        else lot.quantities.push({ id: ids.lotQty(lot.id, sku.id), skuCode: r.code, skuId: sku.id, qty: rounded });
      }
      if (lot.quantities.length) {
        lot.quantitiesKnown = true;
        lot.notes = `${lot.notes ? lot.notes + "\n" : ""}Quantities from the Packaged Products tab`;
      }
    }
  }
  return { batches, lots };
}

// ---------------------------------------------------------------------------
// BOL Maker Log to legacy shipments and backfilled lots
// ---------------------------------------------------------------------------

interface LogLine {
  sku?: string;
  lot?: string | null;
  qty?: number | string;
  weightPerUnit?: number | string;
  isKeg?: boolean;
  description?: string;
  package?: string;
}

interface LogPayload {
  docType?: string;
  bolNumber?: string;
  invoiceNumber?: string;
  date?: string;
  dateIso?: string;
  deliveryWindow?: string;
  receivingInstructions?: string;
  refNote?: string;
  notes?: string;
  emptyPickups?: { halfBbl?: number | string; sixthBbl?: number | string };
  toAccount?: { AccountID?: string; BusinessName?: string; DeliveryAddress?: string } | null;
  fromLoc?: { LocationID?: string; Name?: string } | null;
  toLoc?: { LocationID?: string; Name?: string } | null;
  fromName?: string;
  toName?: string;
  carrier?: string;
  carrierPhone?: string;
  weight?: string | number;
  handlingUnitCount?: string | number;
  handlingUnitType?: string;
  freightClass?: string;
  nmfcNumber?: string;
  originAppointment?: string;
  destinationAppointment?: string;
  eventType?: string;
  actor?: string;
  lines?: LogLine[];
}

const LEOPARD_MARK = "the leopard mark";

function parseDocNumber(doc: string): { prefix: string; letter: "D" | "T" | "P" | "S" | null; freight: boolean } {
  const parts = doc.toUpperCase().split("-");
  if (parts[0] === "BOL") {
    const letter = parts[1] && /^[DTPS]$/.test(parts[1]) ? (parts[1] as "D" | "T" | "P" | "S") : null;
    // BOL-WH-WIL-261013-09: tokens between BOL and the date name a warehouse.
    const dateIdx = parts.findIndex((p, i) => i > 0 && /^\d{6,7}$/.test(p));
    const prefix = dateIdx > 1 ? parts.slice(1, dateIdx).filter((p) => !/^[DTPS]$/.test(p)).join("-") : "";
    return { prefix, letter, freight: true };
  }
  const letter = parts[1] && /^[DTPS]$/.test(parts[1]) ? (parts[1] as "D" | "T" | "P" | "S") : null;
  return { prefix: parts[0], letter, freight: false };
}

function normalizeShipments(input: HistoryInput, lots: LotRecord[]): { shipments: ShipmentRecord[]; backfilled: LotRecord[]; links: Array<{ invoiceNumber: string; shipmentNumber: string }> } {
  const { sheets, origins, accounts, cat, ctx } = input;
  const shipments: ShipmentRecord[] = [];
  const backfilled: LotRecord[] = [];
  const links: Array<{ invoiceNumber: string; shipmentNumber: string }> = [];
  const log = sheets.bolLog;
  if (!log) {
    ctx.flag("workbook", "BOL Maker Log", "Tab missing: no legacy shipments were read");
    return { shipments, backfilled, links };
  }
  const originByCode = new Map(origins.filter((o) => o.originCode).map((o) => [o.originCode!, o]));
  const originByKey = new Map(origins.map((o) => [o.key, o]));
  const byFacility = new Map(origins.filter((o) => o.lotFacilityCode).map((o) => [o.lotFacilityCode!, o]));
  const accountByKey = new Map(accounts.map((a) => [nameKey(a.tradeName), a]));
  const accountByLoose = new Map(accounts.map((a) => [looseKey(a.tradeName), a]));
  const lotByCode = new Map(lots.map((l) => [l.lotCode, l]));
  const ebb = originByCode.get("EBB") ?? origins[0];

  const originByName = (name: string): OriginRecord | null => {
    const n = name.toLowerCase();
    for (const h of ORIGIN_NAME_HINTS) if (n.includes(h.contains)) return originByCode.get(h.originCode) ?? null;
    return null;
  };
  const findAccount = (docNumber: string, name: string, address: string | undefined): AccountRecord | null => {
    const key = NAME_ALIASES[nameKey(name)] ?? nameKey(name);
    const direct = accountByKey.get(key) ?? accountByLoose.get(looseKey(name));
    if (direct) return direct;
    // A site-less name (La Nena Cantina, El Pescador) resolves to one of the master's sites by delivery address.
    const sites = accounts.filter((a) => {
      const k = nameKey(a.tradeName);
      return k.startsWith(`${key} (`) || k.startsWith(`${key} #`);
    });
    if (sites.length === 1) return sites[0];
    if (sites.length > 1) {
      const pa = address ? parseAddress(address) : null;
      const hits = pa ? sites.filter((a) => a.delivery && looseKey(a.delivery.line1) === looseKey(pa.line1)) : [];
      if (hits.length === 1) {
        ctx.flag("shipment", docNumber, `"${name}" matched to the site ${hits[0].tradeName} by delivery address`);
        return hits[0];
      }
      ctx.flag("shipment", docNumber, `"${name}" has ${sites.length} sites in the account master and the address picks none; kept as text`);
    }
    return null;
  };

  for (const r of log.rows) {
    const docNumber = log.get(r, "DocNumber").toUpperCase();
    if (!docNumber) continue;
    const docType = log.get(r, "DocType").toLowerCase();
    let payload: LogPayload = {};
    const rawPayload = log.get(r, "PayloadJSON");
    try {
      payload = rawPayload ? (JSON.parse(rawPayload) as LogPayload) : {};
    } catch {
      ctx.flag("shipment", docNumber, "PayloadJSON is not valid JSON; the row was imported from its columns only");
    }
    const date = payload.dateIso && isoDate(payload.dateIso) ? isoDate(payload.dateIso)! : isoDate(log.get(r, "Date"));
    if (!date) {
      ctx.flag("shipment", docNumber, "No usable date; shipment skipped");
      continue;
    }
    const { prefix, letter, freight } = parseDocNumber(docNumber);
    const isFreight = docType ? docType === "freight" : freight;

    // Origin
    let origin: OriginRecord | null = null;
    let originNote: string | null = null;
    if (isFreight) {
      const fromKey = payload.fromLoc?.LocationID;
      origin = (fromKey && originByKey.get(fromKey)) || originByName(payload.fromLoc?.Name ?? "") || originByName(payload.fromName ?? "") || (prefix && PREFIX_ALIASES[prefix] ? originByCode.get(PREFIX_ALIASES[prefix].originCode) ?? null : null) || (prefix ? originByCode.get(prefix) ?? null : null);
      if (prefix && PREFIX_ALIASES[prefix] && origin?.originCode === PREFIX_ALIASES[prefix].originCode) originNote = PREFIX_ALIASES[prefix].note;
    } else {
      origin = originByCode.get(prefix) ?? null;
      if (!origin && PREFIX_ALIASES[prefix]) {
        origin = originByCode.get(PREFIX_ALIASES[prefix].originCode) ?? null;
        originNote = PREFIX_ALIASES[prefix].note;
      }
    }
    if (!origin) {
      origin = ebb;
      originNote = `Prefix "${prefix || "(none)"}" names no origin; East Brother assumed`;
    }
    if (originNote) ctx.flag("shipment", docNumber, originNote);

    // Destination
    let type: ShipmentRecord["type"] = letter === "T" ? "T" : letter === "S" ? "S" : "D";
    const pickup = letter === "P";
    let destinationLocationId: string | null = null;
    let destinationWarehouseId: string | null = null;
    let destinationText: string | null = null;
    let destinationLabel = "";
    let destinationKind: string | null = null;
    let marketId: string | null = origin.marketId;
    const toName = (isFreight ? payload.toName || payload.toLoc?.Name : payload.toAccount?.BusinessName) ?? "";
    const toKey = payload.toLoc?.LocationID;
    if (nameKey(toName) === LEOPARD_MARK) {
      type = "T";
      destinationText = "Driver stock load (legacy)";
      destinationLabel = "The Leopard Mark (driver stock load)";
    } else {
      const acct = toName ? findAccount(docNumber, toName, payload.toAccount?.DeliveryAddress) : null;
      const wh = (toKey && originByKey.get(toKey)) || (toName ? originByName(toName) : null);
      if (acct) {
        destinationLocationId = acct.id;
        destinationLabel = acct.tradeName;
        destinationKind = acct.kind;
        marketId = acct.marketId;
        if (type === "T") ctx.flag("shipment", docNumber, `Transfer document addressed to the account ${acct.tradeName}; kept as a transfer per the prefix letter`);
      } else if (wh) {
        destinationWarehouseId = wh.id;
        destinationLabel = wh.name;
        destinationKind = "warehouse";
        if (isFreight) type = "T";
        if (!isFreight && type !== "T") {
          ctx.flag("shipment", docNumber, `Document to the origin ${wh.name} carries letter ${letter ?? "none"}; typed as a transfer`);
          type = "T";
        }
      } else {
        destinationText = toName || "(no destination)";
        destinationLabel = destinationText;
        const key = nameKey(toName);
        if (key in EXCLUDED_ACCOUNTS && EXCLUDED_ACCOUNTS[key].startsWith("sales rep")) {
          if (type !== "S") ctx.flag("shipment", docNumber, `Addressed to the rep ${toName}; kept as type ${type} per the prefix letter`);
        } else ctx.flag("shipment", docNumber, `Destination "${toName || "(blank)"}" matches no account or origin; kept as text`);
        if (isFreight) type = "D";
      }
    }
    if (type === "T" && destinationWarehouseId && destinationWarehouseId === origin.id) {
      // The legacy numbering used the receiving warehouse as the prefix; the real origin is the brewery that packaged the lot.
      const firstLot = (payload.lines ?? []).map((l) => (l.lot ? repairLotCode(String(l.lot)) : null)).find((x) => x && parseLotCode(x.code));
      const fac = firstLot ? byFacility.get(parseLotCode(firstLot.code)!.facilityCode) : undefined;
      if (fac && fac.id !== origin.id) {
        ctx.flag("shipment", docNumber, `Prefix ${prefix} is also the destination; origin set to ${fac.name} from lot ${firstLot!.code}`);
        origin = fac;
      } else ctx.flag("shipment", docNumber, `Origin and destination are both ${origin.name}`);
    }
    const template: ShipmentRecord["template"] = type === "T" ? "transfer" : destinationKind === "distributor" || destinationKind === "warehouse" || destinationKind === "host" ? "distributor" : "retail";

    // Lines
    const lines: ShipmentLineRecord[] = [];
    let lineNo = 0;
    for (const l of payload.lines ?? []) {
      lineNo += 1;
      const code = String(l.sku ?? "").trim();
      if (code) input.seenCodes.set(code.toUpperCase(), "BOL Maker Log");
      const qtyN = num(String(l.qty ?? ""));
      const qty = qtyN === null ? 0 : Math.round(qtyN);
      const resolved = code ? resolveCode(cat, code) : null;
      if (!resolved) {
        ctx.flag("shipment", docNumber, `Line ${lineNo}: code "${code || "(blank)"}" not resolved; line kept in the legacy payload only`);
        continue;
      }
      let lotCode: string | null = null;
      let lotId: string | null = null;
      if (resolved.kind === "sku" && l.lot) {
        const rep = repairLotCode(String(l.lot));
        lotCode = rep.code;
        if (rep.repaired) ctx.flag("shipment", docNumber, `Lot code ${String(l.lot)} repaired to ${rep.code}`);
        const parsed = parseLotCode(lotCode);
        if (parsed) {
          let lot = lotByCode.get(lotCode);
          if (!lot) {
            const fac = byFacility.get(parsed.facilityCode);
            if (fac) {
              lot = { id: ids.lot(lotCode), lotCode, legacyCode: null, facilityCode: parsed.facilityCode, facilityOriginId: fac.id, brandCode: parsed.brandCode, packagingDate: parsed.packagingDate, runCode: parsed.runCode, batchNumber: null, batchId: null, quantitiesKnown: false, source: "bol_log_backfill", notes: `Backfilled from BOL ${docNumber} (1.4)`, quantities: [] };
              lotByCode.set(lotCode, lot);
              backfilled.push(lot);
            } else ctx.flag("shipment", docNumber, `Lot ${lotCode} names facility ${parsed.facilityCode}, which is no known brewery; lot kept as text`);
          }
          lotId = lot?.id ?? null;
        } else ctx.flag("shipment", docNumber, `Lot code "${lotCode}" is not a lot code; kept as text`);
      }
      const sku = resolved.kind === "sku" ? cat.byCode.get(resolved.code)! : null;
      const unitWeight = num(String(l.weightPerUnit ?? "")) ?? (sku?.weightLb ? Number(sku.weightLb) : null);
      lines.push({
        id: ids.legacyShipmentLine(docNumber, lineNo),
        lineNo,
        skuCode: sku?.code ?? null,
        skuId: sku?.id ?? null,
        posItemCode: resolved.kind === "pos" ? resolved.code : null,
        lotCode,
        lotId,
        qty,
        weightLb: sku && unitWeight !== null ? String(Math.round(unitWeight * qty * 100) / 100) : null,
      });
    }
    if (lines.length === 0) ctx.flag("shipment", docNumber, "No lines resolved on this document");

    const appointment = [payload.originAppointment ? `Origin: ${payload.originAppointment}` : "", payload.destinationAppointment ? `Destination: ${payload.destinationAppointment}` : ""].filter(Boolean).join("; ") || null;
    const notes = [payload.notes, payload.refNote ? `Ref: ${payload.refNote}` : "", payload.eventType ? `Legacy event ${payload.eventType}${payload.actor ? ` by ${payload.actor}` : ""}` : ""].filter((x) => x && String(x).trim()).join("\n") || null;
    const pallets = payload.handlingUnitType && /pallet/i.test(payload.handlingUnitType) ? num(String(payload.handlingUnitCount ?? "")) : null;
    const ep = payload.emptyPickups;
    const kegPickup = ep ? { halfIn: Math.round(num(String(ep.halfBbl ?? "")) ?? 0), sixtelIn: Math.round(num(String(ep.sixthBbl ?? "")) ?? 0) } : null;
    const invoiceNumber = payload.invoiceNumber && /^(INV|NC)\d+/i.test(payload.invoiceNumber.trim()) ? payload.invoiceNumber.trim().toUpperCase() : null;
    if (invoiceNumber) links.push({ invoiceNumber, shipmentNumber: docNumber });
    const summary = log.get(r, "Summary");
    shipments.push({
      id: ids.legacyShipment(docNumber),
      number: docNumber,
      type,
      pickup,
      originKey: origin.key,
      originId: origin.id,
      destinationLocationId,
      destinationWarehouseId,
      destinationText,
      destinationLabel,
      destinationKind,
      template,
      scheduledDate: date,
      actualDate: date,
      marketId,
      carrier: payload.carrier?.trim() || null,
      carrierPhone: payload.carrierPhone?.trim() || null,
      freightClass: payload.freightClass?.trim() || null,
      palletCount: pallets === null ? null : Math.round(pallets),
      appointment,
      deliveryWindow: payload.deliveryWindow?.trim() || null,
      receivingInstructions: payload.receivingInstructions?.trim() || null,
      notes,
      invoiceNumber,
      mergedIntoNumber: null,
      mergedIntoShipmentId: null,
      kegPickup,
      legacyPayload: { ...payload, docNumber, docType, summary, createdAt: log.get(r, "CreatedAt") || null, updatedAt: log.get(r, "UpdatedAt") || null },
      lines,
    });
  }

  // Duplicates: same destination, same date, same lines. A number that differs only by zero padding merges into the padded one (5.13).
  const signature = (s: ShipmentRecord) => `${s.destinationLocationId ?? s.destinationWarehouseId ?? s.destinationText}|${s.scheduledDate}|${s.lines.map((l) => `${l.skuCode ?? l.posItemCode}:${l.lotCode ?? ""}:${l.qty}`).sort().join(",")}`;
  const groups = new Map<string, ShipmentRecord[]>();
  for (const s of shipments) {
    const k = signature(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const unpad = (n: string) => n.split("-").map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p)).join("-");
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const s of group) {
      if (s.mergedIntoNumber) continue;
      const twin = group.find((o) => o !== s && !o.mergedIntoNumber && unpad(o.number) === unpad(s.number));
      if (twin) {
        const [canonical, dup] = twin.number.length >= s.number.length ? [twin, s] : [s, twin];
        dup.mergedIntoNumber = canonical.number;
        dup.mergedIntoShipmentId = canonical.id;
        ctx.flag("shipment", dup.number, `Duplicate of ${canonical.number} (same account, date and lines; number differs only by zero padding); merged`);
      } else {
        ctx.flag("shipment", s.number, `Possible duplicate: ${group.filter((o) => o !== s).map((o) => o.number).join(", ")} has the same destination, date and lines`);
      }
    }
  }
  return { shipments, backfilled, links };
}

// ---------------------------------------------------------------------------
// Sales to legacy invoices
// ---------------------------------------------------------------------------

function normalizeInvoices(input: HistoryInput, shipments: ShipmentRecord[]): { invoices: InvoiceRecord[]; links: Array<{ invoiceNumber: string; shipmentNumber: string }> } {
  const { sheets, accounts, cat, ctx } = input;
  const invoices: InvoiceRecord[] = [];
  const links: Array<{ invoiceNumber: string; shipmentNumber: string }> = [];
  const sales = sheets.sales;
  if (!sales) {
    ctx.flag("workbook", "Sales", "Tab missing: no legacy invoices were read");
    return { invoices, links };
  }
  const shipmentNumbers = new Set(shipments.map((s) => s.number));
  const byTrade = new Map(accounts.map((a) => [nameKey(a.tradeName), a]));
  const byLoose = new Map<string, AccountRecord>();
  const byLegal = new Map<string, AccountRecord>();
  const byLicense = new Map<string, AccountRecord>();
  for (const a of accounts) {
    const lk = looseKey(a.tradeName);
    if (lk && !byLoose.has(lk)) byLoose.set(lk, a);
    if (a.legalName) {
      const k = looseKey(a.legalName);
      if (k && !byLegal.has(k)) byLegal.set(k, a);
    }
    if (a.license) byLicense.set(a.license.replace(/\s+/g, "").toLowerCase(), a);
  }
  const matchCustomer = (customer: string, license: string): AccountRecord | null => {
    const whole = customer.trim();
    if (!whole) return null;
    const direct = byTrade.get(NAME_ALIASES[nameKey(whole)] ?? nameKey(whole)) ?? byLoose.get(looseKey(whole)) ?? byLegal.get(looseKey(whole));
    if (direct) return direct;
    const parts = whole.split(/\s+\/\s+|\s\/\s|\//).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      for (const p of [...parts].reverse()) {
        const hit = byTrade.get(NAME_ALIASES[nameKey(p)] ?? nameKey(p)) ?? byLoose.get(looseKey(p));
        if (hit) return hit;
      }
      for (const p of parts) {
        const hit = byLegal.get(looseKey(p));
        if (hit) return hit;
      }
    }
    const lic = license.replace(/\s+/g, "").toLowerCase();
    if (lic && byLicense.has(lic)) return byLicense.get(lic)!;
    // Prefix match on the trade name ("SFS 39 Inc. / Franciscan Crab" to "Franciscan Crab Restaurant").
    const tail = looseKey(parts[parts.length - 1] ?? whole);
    if (tail.length >= 6) {
      const hits = accounts.filter((a) => looseKey(a.tradeName).startsWith(tail));
      if (hits.length === 1) return hits[0];
    }
    return null;
  };

  const missingBols: string[] = [];
  const grouped = new Map<string, string[][]>();
  for (const r of sales.rows) {
    const n = sales.get(r, "Invoice #").toUpperCase();
    if (!n) continue;
    if (!grouped.has(n)) grouped.set(n, []);
    grouped.get(n)!.push(r);
  }
  for (const [number, rows] of grouped) {
    const first = rows[0];
    const statuses = Array.from(new Set(rows.map((r) => sales.get(r, "Invoice Status"))));
    const legacyStatus = statuses.find((s) => s) ?? "";
    if (statuses.filter(Boolean).length > 1) ctx.flag("invoice", number, `Rows carry different statuses (${statuses.join(", ")}); the first was kept`);
    const status: InvoiceRecord["status"] = legacyStatus.toLowerCase() === "paid" ? "paid" : legacyStatus.toLowerCase() === "void" ? "void" : "issued";
    const customers = Array.from(new Set(rows.map((r) => sales.get(r, "Customer")).filter(Boolean)));
    if (customers.length > 1) ctx.flag("invoice", number, `Rows name different customers (${customers.join(" | ")}); the first was used`);
    const customerText = customers[0] ?? "";
    const account = matchCustomer(customerText, sales.get(first, "License Number"));
    if (!account) ctx.flag("invoice", number, `Customer "${customerText || "(blank)"}" matches no account; invoice imported without an account`);
    const invoiceDate = rows.map((r) => isoDate(sales.get(r, "Delivery (Invoice) Date"))).find((d) => d) ?? rows.map((r) => isoDate(sales.get(r, "PO Date"))).find((d) => d) ?? null;
    if (!invoiceDate) ctx.flag("invoice", number, "No invoice date");
    const lines: InvoiceLineRecord[] = [];
    let lineNo = 0;
    let subtotal = 0;
    let half = 0;
    let sixtel = 0;
    const taps = { TLM: 0, SGB: 0, CNT: 0 };
    const bols = new Set<string>();
    for (const r of rows) {
      const code = sales.get(r, "Product Code");
      const product = sales.get(r, "Product Name");
      const packaging = sales.get(r, "Packaging Format");
      const qtyN = num(sales.get(r, "Qty"));
      const price = cents(sales.get(r, "Price (ea)"));
      const total = cents(sales.get(r, "Line Total"));
      const lotRaw = sales.get(r, "Lot #");
      if (code && code.toUpperCase() !== "N/A") input.seenCodes.set(code.toUpperCase(), "Sales");
      const resolved = code && code.toUpperCase() !== "N/A" ? resolveCode(cat, code) : null;
      const byProduct = !resolved && (product || packaging) ? resolveProductPackage(cat, product, packaging) : null;
      const hit = resolved ?? byProduct;
      const hasLine = Boolean(code || product || qtyN !== null || total !== null);
      if (hasLine) {
        lineNo += 1;
        const qty = qtyN === null ? 0 : Math.round(qtyN);
        const unit = price ?? (qty && total !== null ? Math.round(total / qty) : 0);
        const lineTotal = total ?? unit * qty;
        subtotal += lineTotal;
        let lotCode: string | null = null;
        if (lotRaw) {
          const dotted = canonicalDottedLot(lotRaw);
          lotCode = dotted ?? repairLotCode(lotRaw).code;
        }
        const sku = hit && hit.kind === "sku" ? cat.byCode.get(hit.code)! : null;
        if (!hit) ctx.flag("invoice", number, `Line ${lineNo}: "${code || product || "(blank)"}" ${packaging ? `/ ${packaging} ` : ""}not resolved to a SKU; line kept without a SKU`);
        lines.push({
          id: ids.legacyInvoiceLine(number, lineNo),
          lineNo,
          kind: hit?.kind === "pos" ? "pos" : "beer",
          skuCode: sku?.code ?? null,
          skuId: sku?.id ?? null,
          description: [product || sku?.name || code || "Line", packaging].filter(Boolean).join(" — "),
          lotCode,
          qty,
          unitPriceCents: unit,
          lineTotalCents: lineTotal,
        });
      }
      half += num(sales.get(r, "MicroStar 1/2 Empty")) ?? 0;
      sixtel += num(sales.get(r, "MicroStar 1/6 Empty")) ?? 0;
      taps.TLM += num(sales.get(r, "TLM Tap Handle")) ?? 0;
      taps.SGB += num(sales.get(r, "SGB Tap Handle")) ?? 0;
      taps.CNT += num(sales.get(r, "CNT Tap Handle")) ?? 0;
      const bol = sales.get(r, "BOL #").toUpperCase();
      if (bol && /^[A-Z]{3}/.test(bol)) bols.add(bol);
    }
    const info = (description: string, qty: number) => {
      lineNo += 1;
      lines.push({ id: ids.legacyInvoiceLine(number, lineNo), lineNo, kind: "info", skuCode: null, skuId: null, description, lotCode: null, qty, unitPriceCents: 0, lineTotalCents: 0 });
    };
    const pos = (description: string, qty: number) => {
      lineNo += 1;
      lines.push({ id: ids.legacyInvoiceLine(number, lineNo), lineNo, kind: "pos", skuCode: null, skuId: null, description, lotCode: null, qty, unitPriceCents: 0, lineTotalCents: 0 });
    };
    if (half > 0) info("MicroStar 1/2 bbl empties returned", Math.round(half));
    if (sixtel > 0) info("MicroStar 1/6 bbl empties returned", Math.round(sixtel));
    if (taps.TLM > 0) pos("Tap handle (TLM)", Math.round(taps.TLM));
    if (taps.SGB > 0) pos("Tap handle, standard (Sunlight Groove)", Math.round(taps.SGB));
    if (taps.CNT > 0) pos("Tap handle, premium (Cantinesca)", Math.round(taps.CNT));
    for (const b of bols) {
      if (shipmentNumbers.has(b)) links.push({ invoiceNumber: number, shipmentNumber: b });
      else missingBols.push(`${number}: ${b}`);
    }
    const notes = Array.from(new Set(rows.map((r) => sales.get(r, "Notes")).filter(Boolean))).join("\n") || null;
    invoices.push({
      id: ids.legacyInvoice(number),
      number,
      series: number.startsWith("NC") ? "NC" : "INV",
      status,
      legacyStatus,
      invoiceDate,
      customerText,
      locationId: account?.id ?? null,
      marketId: account?.marketId ?? null,
      subtotalCents: subtotal,
      totalCents: subtotal,
      notes,
      shipmentNumbers: Array.from(bols),
      legacyPayload: {
        customer: customerText,
        licenseNumber: sales.get(first, "License Number") || null,
        poDate: isoDate(sales.get(first, "PO Date")),
        salesRep: sales.get(first, "Sales Rep") || null,
        paymentMethod: sales.get(first, "Payment Method") || null,
        achInvoiceRef: sales.get(first, "ACH Invoice") || null,
        delivered: sales.get(first, "Delivered") || null,
        inventorySource: Array.from(new Set(rows.map((r) => sales.get(r, "Inventory Source")).filter(Boolean))),
        createdByOrderForm: sales.get(first, "Created by Order Form") || null,
        expectedEmptyKegs: rows.map((r) => num(sales.get(r, "Expected Empty Kegs")) ?? 0).reduce((a, b) => a + b, 0) || null,
        slackChannel: sales.get(first, "Slack Channel") || null,
        slackThreadTs: sales.get(first, "Slack Thread TS") || null,
        bolNumbers: Array.from(bols),
        rows: rows.map((r) => Object.fromEntries(sales.header.map((h, i) => [h, r[i] ?? ""]).filter(([h, v]) => h && v))),
      },
      lines,
    });
  }
  if (missingBols.length) {
    ctx.flag("invoice", "BOL #", `${missingBols.length} invoice line group(s) reference BOL numbers that are not in the BOL Maker Log (documents from before the log started); no links made. First: ${missingBols.slice(0, 5).join(", ")}${missingBols.length > 5 ? ", …" : ""}`);
  }
  return { invoices, links };
}

export function normalizeHistory(input: HistoryInput): HistoryOutput {
  const { batches, lots } = normalizeBatchesAndLots(input);
  const { shipments, backfilled, links: logLinks } = normalizeShipments(input, lots);
  const allLots = [...lots, ...backfilled].sort((a, b) => a.lotCode.localeCompare(b.lotCode));
  const { invoices, links: salesLinks } = normalizeInvoices(input, shipments);
  const invoiceNumbers = new Set(invoices.map((i) => i.number));
  const seen = new Set<string>();
  const links: Array<{ invoiceNumber: string; shipmentNumber: string }> = [];
  for (const l of [...salesLinks, ...logLinks]) {
    const k = `${l.invoiceNumber}|${l.shipmentNumber}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (!invoiceNumbers.has(l.invoiceNumber)) {
      input.ctx.flag("shipment", l.shipmentNumber, `Invoice ${l.invoiceNumber} on the BOL is not in the Sales tab; link not made`);
      continue;
    }
    links.push(l);
  }
  return { batches, lots: allLots, shipments, invoices, links };
}
