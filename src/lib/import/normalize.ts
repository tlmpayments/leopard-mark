/**
 * Normaliser: workbook tables to typed records with deterministic ids (SHIPMENTS_SPEC §5, §2).
 *
 * Reference data (markets, origins, SKUs, aliases, prices, people, accounts) follows the October 28 prototype so the
 * rows already in production come out unchanged or updated, never new. History (batches, lots, legacy shipments and
 * invoices) lives in history.ts. Nothing here touches the database; the diff compares these records to it.
 */
import { normPhone, normState, normZip, parseAddress, sameAsDelivery } from "./address";
import { makeContext, nameKey, type NormalizeContext } from "./common";
import { normalizeHistory } from "./history";
import { ids } from "./ids";
import { type ParsedWorkbook, type Sheet, sheetOf } from "./parse";
import {
  ACTIVE_SKUS,
  EXCLUDED_ACCOUNTS,
  EXCLUDED_REPS,
  EXTRA_DISTRIBUTORS,
  LEGACY_TO_NEW,
  MARKETS,
  MATAGRANO_CITIES,
  MATAGRANO_PREFIX,
  NAME_ALIASES,
  NORCAL_CITIES,
  NORTH_REGIONS,
  NO_REP_VALUES,
  ORIGIN_RULES,
  PACKAGE_TYPE_MAP,
  PAYMENT_CHANNEL,
  PEOPLE,
  PRICE_AS_OF,
  SF_REGIONS,
  SOCAL_CITIES,
  SOUTH_REGIONS,
} from "./rules";
import { buildCatalog, resolveCode, type SkuCatalog } from "./skus";
import type { AccountRecord, AliasRecord, EmployeeRecord, MarketRecord, NormalizedImport, OriginRecord, PriceRecord, SkuRecord } from "./types";

export const MARKET_IDS: Record<string, string> = Object.fromEntries(MARKETS.map((m) => [m.code, ids.market(m.code)]));

function isoOrNull(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

function normalizeMarkets(regionsByMarket: Map<string, Set<string>>): MarketRecord[] {
  return MARKETS.map((m) => ({ id: MARKET_IDS[m.code], code: m.code, name: m.name, timezone: m.timezone, regionList: Array.from(regionsByMarket.get(m.code) ?? []).sort() }));
}

// ---------------------------------------------------------------------------
// Origins (Location Information + Radford)
// ---------------------------------------------------------------------------

const HOUR_COLUMNS: Array<[string, string]> = [
  ["Sun", "Shipping Hours - Sunday"],
  ["Mon", "Shipping Hours - Monday"],
  ["Tue", "Shipping Hours - Tuesday"],
  ["Wed", "Shipping Hours Wednesday"],
  ["Thu", "Shipping Hours - Thursday"],
  ["Fri", "Shipping Hours - Friday"],
  ["Sat", "Shipping Hours - Saturday"],
];

function yesNo(v: string): boolean | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  if (["yes", "y", "true"].includes(t)) return true;
  if (["no", "n", "false"].includes(t)) return false;
  return null;
}

function normalizeOrigins(loc: Sheet | null, ctx: NormalizeContext): OriginRecord[] {
  const out: OriginRecord[] = [];
  const seen = new Set<string>();
  const rowsByType = new Map<string, string[]>();
  if (loc) for (const r of loc.rows) {
    const t = loc.get(r, "Type");
    if (t) rowsByType.set(t, r);
  }
  for (const rule of ORIGIN_RULES) {
    const row = loc && rowsByType.get(rule.key);
    seen.add(rule.key);
    const marketId = rule.marketCode ? MARKET_IDS[rule.marketCode] : null;
    let line1: string | null = null;
    let line2: string | null = null;
    let city: string | null = null;
    let state: string | null = null;
    let postal: string | null = null;
    let email: string | null = null;
    let phone: string | null = null;
    let appointment: boolean | null = null;
    let dock: boolean | null = null;
    let hours: Record<string, string> | null = null;
    if (row && loc) {
      line1 = loc.get(row, "Shipping Address") || null;
      line2 = loc.get(row, "Shipping Address Line #2") || null;
      city = loc.get(row, "Shipping City") || null;
      state = normState(loc.get(row, "Shipping State")) || null;
      postal = normZip(loc.get(row, "Shipping Zip Code"), state ?? "") || null;
      email = loc.get(row, "Shipping Contact Email").toLowerCase() || null;
      phone = normPhone(loc.get(row, "Shipping Contact Phone"));
      appointment = yesNo(loc.get(row, "Appointment Required?"));
      dock = yesNo(loc.get(row, "Loading Dock?"));
      const h: Record<string, string> = {};
      for (const [day, col] of HOUR_COLUMNS) {
        const v = loc.get(row, col);
        if (v) h[day] = v;
      }
      hours = Object.keys(h).length ? h : null;
      if (!postal) ctx.flag("origin", rule.name, `No ZIP code in Location Information (${rule.key})`);
    } else if (rule.address) {
      line1 = rule.address.line1;
      line2 = rule.address.line2;
      city = rule.address.city;
      state = rule.address.state;
      postal = rule.address.postal;
    } else {
      ctx.flag("origin", rule.name, `${rule.key} is not in Location Information; the origin is created without an address`);
    }
    const lineText = [line1, line2].filter(Boolean).join(", ");
    const addressText = line1 ? `${lineText}, ${city ?? ""}, ${state ?? ""} ${postal ?? ""}`.replace(/\s+,/g, ",").trim().replace(/,$/, "") : null;
    const contact = [email, phone].filter(Boolean).join(" / ") || null;
    out.push({
      id: ids.origin(rule.key),
      key: rule.key,
      name: rule.name,
      originCode: rule.originCode,
      lotFacilityCode: rule.lotFacilityCode,
      kind: rule.kind,
      marketCode: rule.marketCode,
      marketId,
      isPrimary: rule.isPrimary,
      active: rule.active,
      addressLine1: line1,
      addressLine2: line2,
      addressCity: city,
      addressState: state,
      addressPostalCode: postal,
      addressText,
      fulfillmentContact: contact,
      shippingContactEmail: email,
      shippingContactPhone: phone,
      appointmentRequired: appointment,
      loadingDock: dock,
      hours,
      note: rule.note,
    });
  }
  if (loc) for (const [t, r] of rowsByType) {
    if (!seen.has(t)) ctx.flag("origin", t, `Location Information row "${loc.get(r, "Company Name") || t}" has no origin rule and was not imported`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SKUs, aliases, prices
// ---------------------------------------------------------------------------

function normalizeSkus(skuMaster: Sheet | null, productInfo: Sheet | null, ctx: NormalizeContext): { skus: SkuRecord[]; legacyPrice: Map<string, number> } {
  const skus: SkuRecord[] = [];
  const legacyPrice = new Map<string, number>();
  const successor = new Map(LEGACY_TO_NEW);
  for (const a of ACTIVE_SKUS) {
    skus.push({
      id: ids.sku(a.code),
      code: a.code,
      name: a.name,
      brand: a.brand,
      packageKind: a.packageKind,
      sellingUnit: a.sellingUnit,
      kegsPerUnit: a.kegsPerUnit,
      weightLb: a.weightLb,
      archived: false,
      upcCase: null,
      upcRetail: null,
      upcUnit: null,
      palletFraction: null,
      recipeVariant: a.code[3],
      successorCode: null,
    });
  }
  if (skuMaster) {
    for (const r of skuMaster.rows) {
      const code = skuMaster.get(r, "SKU").toUpperCase();
      if (!code) continue;
      const pkg = skuMaster.get(r, "PackageType");
      const kind = PACKAGE_TYPE_MAP[pkg];
      if (!kind) {
        ctx.exclude("sku", code, `${pkg || "no package type"} — not a beer package; trade item (3.6)`);
        continue;
      }
      if (skus.some((s) => s.code === code)) continue;
      const product = skuMaster.get(r, "Product");
      const weight = skuMaster.get(r, "WeightPerUnit");
      const price = skuMaster.get(r, "Price");
      if (price && Number.isFinite(Number(price))) legacyPrice.set(code, Math.round(Number(price) * 100));
      skus.push({
        id: ids.sku(code),
        code,
        name: `${product} ${pkg} (legacy)`,
        brand: product,
        packageKind: kind,
        sellingUnit: pkg,
        kegsPerUnit: skuMaster.get(r, "IsKeg").toLowerCase() === "true" ? 1 : 0,
        weightLb: weight && Number.isFinite(Number(weight)) ? weight : null,
        archived: true,
        upcCase: null,
        upcRetail: null,
        upcUnit: null,
        palletFraction: null,
        recipeVariant: null,
        successorCode: successor.get(code) ?? null,
      });
    }
  } else {
    ctx.flag("sku", "SKU Master", "Tab missing: legacy SKUs and the retail price list were not read");
  }
  // UPCs and pallet fraction on the eight active SKUs via the legacy mapping (3.7); the first legacy code in the mapping wins.
  if (productInfo) {
    const infoBySupplier = new Map<string, string[]>();
    for (const r of productInfo.rows) {
      const sc = productInfo.get(r, "Supplier Code (Sales)").toUpperCase();
      if (sc && !infoBySupplier.has(sc)) infoBySupplier.set(sc, r);
    }
    for (const [legacy, active] of LEGACY_TO_NEW) {
      const r = infoBySupplier.get(legacy);
      if (!r) continue;
      const target = skus.find((s) => s.code === active);
      if (!target) continue;
      const upcCase = productInfo.get(r, "Case UPC") || null;
      const upcRetail = productInfo.get(r, "Retail Pack UPC") || null;
      const upcUnit = productInfo.get(r, "Unit UPC") || null;
      const pallet = productInfo.get(r, "Pallet Format");
      const palletFraction = pallet && Number.isFinite(Number(pallet)) ? String(Number(pallet)) : null;
      if (target.upcCase === null && target.upcRetail === null && target.upcUnit === null && target.palletFraction === null) {
        target.upcCase = upcCase;
        target.upcRetail = upcRetail;
        target.upcUnit = upcUnit;
        target.palletFraction = palletFraction;
      } else if ((upcUnit && upcUnit !== target.upcUnit) || (upcCase && upcCase !== target.upcCase)) {
        ctx.flag("sku", active, `Legacy code ${legacy} carries different UPCs (${upcCase ?? "-"} / ${upcUnit ?? "-"}); the first mapped legacy code's UPCs were kept`);
      }
    }
  } else {
    ctx.flag("sku", "Product Information", "Tab missing: UPCs and pallet fractions were not read");
  }
  return { skus, legacyPrice };
}

function normalizePrices(legacyPrice: Map<string, number>, skus: SkuRecord[], ctx: NormalizeContext): PriceRecord[] {
  const newPrice = new Map<string, number>();
  for (const [legacy, active] of LEGACY_TO_NEW) {
    const p = legacyPrice.get(legacy);
    if (p !== undefined && !newPrice.has(active)) newPrice.set(active, p);
  }
  const out: PriceRecord[] = [];
  for (const marketCode of ["NORCAL-SD", "SOCAL"]) {
    for (const [code, cents] of Array.from(newPrice.entries()).sort(([a], [b]) => a.localeCompare(b))) {
      const sku = skus.find((s) => s.code === code);
      if (!sku) continue;
      out.push({ id: ids.price(marketCode, code, PRICE_AS_OF), marketCode, marketId: MARKET_IDS[marketCode], skuCode: code, skuId: sku.id, priceCents: cents, asOf: PRICE_AS_OF });
    }
  }
  const unpriced = ACTIVE_SKUS.filter((a) => !newPrice.has(a.code)).map((a) => a.code);
  if (unpriced.length) ctx.flag("price", "retail list", `No list price in the workbook for ${unpriced.join(", ")}; no price in any market for NORCAL-D, CT, MA (3.9)`);
  return out;
}

/** Every legacy, inventory and dotted spelling seen anywhere resolves to a SKU through an alias (3.3). */
function collectAliases(cat: SkuCatalog, seen: Map<string, string>, ctx: NormalizeContext): AliasRecord[] {
  const out = new Map<string, AliasRecord>();
  for (const [legacy, active] of LEGACY_TO_NEW) {
    const sku = cat.byCode.get(active);
    if (sku) out.set(legacy, { alias: legacy, skuCode: active, skuId: sku.id, note: "Legacy code (SKU Master)" });
  }
  const unresolved = new Map<string, string[]>();
  for (const [code, source] of seen) {
    const upper = code.toUpperCase();
    if (out.has(upper) || cat.byCode.has(upper)) continue;
    const r = resolveCode(cat, code);
    if (!r) {
      if (!unresolved.has(source)) unresolved.set(source, []);
      unresolved.get(source)!.push(code);
      continue;
    }
    if (r.kind === "pos") continue;
    const sku = cat.byCode.get(r.code)!;
    out.set(upper, { alias: upper, skuCode: r.code, skuId: sku.id, note: `Legacy code (${source})` });
  }
  for (const [source, codes] of unresolved) {
    const sorted = codes.sort();
    ctx.flag("sku", source, `${codes.length} code(s) resolve to no SKU or POS item and get no alias: ${sorted.slice(0, 12).join(", ")}${sorted.length > 12 ? ", …" : ""}`);
  }
  return Array.from(out.values()).sort((a, b) => a.alias.localeCompare(b.alias));
}

// ---------------------------------------------------------------------------
// People (9.2)
// ---------------------------------------------------------------------------

function normalizePeople(reps: Sheet | null, ctx: NormalizeContext): EmployeeRecord[] {
  const out: EmployeeRecord[] = [];
  const known = new Set(PEOPLE.map((p) => p.displayName.toLowerCase()));
  if (reps) {
    for (const r of reps.rows) {
      const name = reps.get(r, "Name");
      if (!name) continue;
      const key = name.toLowerCase();
      if (EXCLUDED_REPS[key]) {
        ctx.exclude("person", name, EXCLUDED_REPS[key]);
        continue;
      }
      if (!known.has(key)) ctx.flag("person", name, "Reps tab name has no decision in 9.2; not imported until the owner confirms");
    }
  } else {
    ctx.flag("person", "Reps", "Tab missing: names were taken from the 9.2 decision list only");
  }
  for (const p of PEOPLE) {
    const id = ids.employee(p.displayName);
    const grants: EmployeeRecord["grants"] = [];
    if (p.enabled && p.role && (p.role === "admin" || p.marketCode)) {
      grants.push({ id: ids.grant(id, p.role, p.marketCode), role: p.role, marketCode: p.marketCode, marketId: p.marketCode ? MARKET_IDS[p.marketCode] : null });
    }
    if (p.enabled) ctx.flag("person", p.displayName, "Email to supply before this person can sign in (no identity, no credential created)");
    if (p.enabled && p.role === "sales" && !p.marketCode) ctx.flag("person", p.displayName, "Sales rep without a market grant (Texas has no market yet)");
    out.push({ id, displayName: p.displayName, enabled: p.enabled, disableReason: p.disableReason, grants, sheetNames: p.sheetNames, source: p.source });
  }
  return out;
}

export function repLookup(employees: EmployeeRecord[]): (sheetValue: string) => EmployeeRecord | null {
  const map = new Map<string, EmployeeRecord>();
  for (const e of employees) for (const n of e.sheetNames) map.set(n.toLowerCase(), e);
  return (v) => {
    const k = v.trim().toLowerCase();
    if (NO_REP_VALUES.has(k)) return null;
    return map.get(k) ?? null;
  };
}

// ---------------------------------------------------------------------------
// Accounts (Customer Accounts master + Accounts supplement)
// ---------------------------------------------------------------------------

interface RawAccount {
  name: string;
  rep: string;
  region: string;
  license: string;
  legal: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  instructions: string;
  window: string;
  days: Record<string, string>;
  lastCleaning: string;
  payment: string;
  onFintech: string;
  billingEmail: string;
  billingInstructions: string;
  terms: string;
  billingAddress: string;
  priority: string;
  ekos: string;
  tapHandles: string;
  firstDelivery: string;
  sourceTab: string;
  legacyId: string;
  supplemented: string[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_ABBR: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri" };

function fromMaster(s: Sheet, r: string[]): RawAccount {
  const days: Record<string, string> = {};
  for (const d of DAYS) days[d] = s.get(r, `${d} Delivery Window`);
  return {
    name: s.get(r, "Business Name"),
    rep: s.get(r, "Sales Person"),
    region: s.get(r, "Region"),
    license: s.get(r, "Alc."),
    legal: s.get(r, "Legal Name"),
    contact: s.get(r, "Ordering Contact"),
    phone: s.get(r, "Phone Number"),
    email: s.get(r, "Ordering Contact Email"),
    address: s.get(r, "Delivery Address"),
    instructions: s.get(r, "Delivery Instructions"),
    window: s.get(r, "Delivery WIndow") || s.get(r, "Delivery Window"),
    days,
    lastCleaning: s.get(r, "Date of Last Line Cleaning"),
    payment: s.get(r, "Payment Method"),
    onFintech: s.get(r, "Added on Fintech /  Stripe ACH") || s.get(r, "Added on Fintech / Stripe ACH"),
    billingEmail: s.get(r, "Billing Contact Email"),
    billingInstructions: s.get(r, "Billing Instructions"),
    terms: s.get(r, "Terms"),
    billingAddress: s.get(r, "Billing Address"),
    priority: s.get(r, "Priority"),
    ekos: s.get(r, "Imported to Ekos"),
    tapHandles: s.get(r, "Tap Handles?"),
    firstDelivery: s.get(r, "Date of First Delivery"),
    sourceTab: "Customer Accounts",
    legacyId: "",
    supplemented: [],
  };
}

function fromAccounts(s: Sheet, r: string[]): RawAccount {
  const days: Record<string, string> = {};
  for (const d of DAYS) days[d] = s.get(r, `${d}Window`);
  return {
    name: s.get(r, "BusinessName"),
    rep: s.get(r, "SalesPerson"),
    region: s.get(r, "Region"),
    license: s.get(r, "LicenseNumber"),
    legal: s.get(r, "LegalName"),
    contact: s.get(r, "OrderingContact"),
    phone: s.get(r, "Phone"),
    email: s.get(r, "Email"),
    address: s.get(r, "DeliveryAddress"),
    instructions: s.get(r, "DeliveryInstructions"),
    window: s.get(r, "DeliveryWindowNote"),
    days,
    lastCleaning: "",
    payment: s.get(r, "PaymentMethod"),
    onFintech: "",
    billingEmail: s.get(r, "BillingContactEmail"),
    billingInstructions: s.get(r, "BillingInstructions"),
    terms: s.get(r, "Terms"),
    billingAddress: s.get(r, "BillingAddress"),
    priority: s.get(r, "Priority"),
    ekos: "",
    tapHandles: "",
    firstDelivery: "",
    sourceTab: "Accounts",
    legacyId: s.get(r, "AccountID"),
    supplemented: [],
  };
}

const SUPPLEMENT_FIELDS = ["license", "legal", "contact", "phone", "email", "address", "instructions", "window", "payment", "billingEmail", "billingInstructions", "terms", "billingAddress", "priority", "region", "rep"] as const;

export function marketFor(a: { name: string; region: string; rep: string; address: string }): { marketCode: string; reason: string } {
  const region = a.region.toLowerCase();
  const addr = parseAddress(a.address);
  const city = (addr?.city ?? "").toLowerCase();
  if (a.name.toLowerCase().startsWith(MATAGRANO_PREFIX)) return { marketCode: "NORCAL-D", reason: "distributor" };
  if (SF_REGIONS.has(region) || MATAGRANO_CITIES.has(city)) return { marketCode: "NORCAL-D", reason: "retail in Matagrano territory" };
  if (NORTH_REGIONS.has(region) || NORCAL_CITIES.has(city)) return { marketCode: "NORCAL-SD", reason: "region/city" };
  if (SOUTH_REGIONS.has(region) || SOCAL_CITIES.has(city)) return { marketCode: "SOCAL", reason: "region/city" };
  if (["J. Williams", "R. Villanueva", "S. Sprague", "D. Krause"].includes(a.rep)) return { marketCode: "SOCAL", reason: "inferred from rep" };
  if (a.rep === "T. Gilbert") return { marketCode: "NORCAL-SD", reason: "inferred from rep" };
  return { marketCode: "NORCAL-SD", reason: "DEFAULT — could not infer" };
}

function termsOverride(terms: string): { days: number | null; text: string | null } {
  const t = terms.trim();
  if (!t) return { days: null, text: null };
  const m = /net\s*(\d+)/i.exec(t);
  if (!m) return { days: null, text: t };
  const n = Number(m[1]);
  // Net 30 equals the market rule (7.4): inherit it rather than pin an override.
  return { days: n === 30 ? null : n, text: t };
}

function normalizeAccounts(master: Sheet | null, supplement: Sheet | null, employees: EmployeeRecord[], ctx: NormalizeContext): { accounts: AccountRecord[]; regionsByMarket: Map<string, Set<string>> } {
  const regionsByMarket = new Map<string, Set<string>>();
  const accounts: AccountRecord[] = [];
  if (!master) {
    ctx.flag("account", "Customer Accounts", "Tab missing: no accounts were read");
  }
  const supByName = new Map<string, RawAccount>();
  if (supplement) for (const r of supplement.rows) {
    const s = fromAccounts(supplement, r);
    if (s.name) supByName.set(nameKey(s.name), s);
  }
  const reverseAlias: Record<string, string> = Object.fromEntries(Object.entries(NAME_ALIASES).map(([k, v]) => [v, k]));
  const raws: RawAccount[] = [];
  const seen = new Set<string>();
  if (master) for (const r of master.rows) {
    const a = fromMaster(master, r);
    const key = nameKey(a.name);
    if (key in EXCLUDED_ACCOUNTS) {
      ctx.exclude("account", a.name || "(blank)", EXCLUDED_ACCOUNTS[key]);
      continue;
    }
    if (seen.has(key)) {
      ctx.flag("account", a.name, "Duplicate business name in Customer Accounts; the first row was used");
      continue;
    }
    const sup = supByName.get(key) ?? supByName.get(reverseAlias[key] ?? "");
    if (sup) {
      a.legacyId = sup.legacyId;
      for (const f of SUPPLEMENT_FIELDS) {
        if (!a[f] && sup[f]) {
          a[f] = sup[f];
          a.supplemented.push(f);
        }
      }
      for (const d of DAYS) if (!a.days[d] && sup.days[d]) a.days[d] = sup.days[d];
    }
    raws.push(a);
    seen.add(key);
  }
  if (supplement) for (const r of supplement.rows) {
    const s = fromAccounts(supplement, r);
    const key = nameKey(s.name);
    const key2 = NAME_ALIASES[key] ?? key;
    if (!s.name || seen.has(key2) || key in EXCLUDED_ACCOUNTS) continue;
    const base = key.replace(/\s*\(.*\)$/, "");
    if (Array.from(seen).some((m) => m.startsWith(`${base} (`) || m.startsWith(`${base} #`))) {
      ctx.exclude("account", `${s.name} (${s.legacyId})`, "Accounts-tab row without a site; the master already has it as separate sites");
      continue;
    }
    raws.push(s);
    seen.add(key);
    ctx.flag("account", s.name, `Present only in the Accounts tab (${s.legacyId}); added`);
  }
  const findRep = repLookup(employees);
  const matagranoId = raws.filter((a) => a.name.toLowerCase().startsWith(MATAGRANO_PREFIX)).map((a) => ids.location(a.name))[0] ?? null;
  for (const a of raws) {
    const { marketCode, reason } = marketFor(a);
    const id = ids.location(a.name);
    const isMatagrano = a.name.toLowerCase().startsWith(MATAGRANO_PREFIX);
    const windows = DAYS.filter((d) => a.days[d]).map((d) => `${DAY_ABBR[d]} ${a.days[d]}`).join("; ");
    const restrictions = [a.window ? `Delivery window: ${a.window}` : "", windows ? `Weekday windows: ${windows}` : ""].filter(Boolean).join("; ") || null;
    let instructions: string | null = a.instructions || null;
    if (isMatagrano) instructions = `Distributor account.${instructions ? ` ${instructions}` : ""}`;
    const delivery = parseAddress(a.address);
    let billing: AccountRecord["billing"] = null;
    if (delivery) {
      if (!delivery.postal) ctx.flag("account", a.name, `No ZIP in delivery address "${a.address}"`);
      if (!sameAsDelivery(a.billingAddress)) {
        billing = parseAddress(a.billingAddress);
        if (!billing) ctx.flag("account", a.name, `Billing address not parsed "${a.billingAddress}" (delivery address used for billing)`);
      }
    } else {
      ctx.flag("account", a.name, a.address ? `Delivery address not parsed "${a.address}" — no address row` : "No delivery address — no address row");
    }
    const buyerName = a.contact || (a.email || a.phone ? "Ordering contact" : "");
    if (!buyerName) ctx.flag("account", a.name, "No ordering contact");
    let license = a.license;
    if (["N/A", "NA", "NONE"].includes(license.toUpperCase())) license = "";
    if (!license) ctx.flag("account", a.name, "No license number");
    const channel: AccountRecord["channel"] = PAYMENT_CHANNEL[a.payment.toLowerCase()] ?? "unselected";
    if (channel === "unselected") ctx.flag("account", a.name, a.payment ? `Payment method "${a.payment}" not mapped to a channel` : "No payment method");
    const rep = findRep(a.rep);
    if (a.rep && !rep && !NO_REP_VALUES.has(a.rep.toLowerCase())) ctx.flag("account", a.name, `Sales Person "${a.rep}" is not a known person; originating rep left empty`);
    const terms = termsOverride(a.terms);
    if (terms.text && terms.days === null && !/net\s*30/i.test(terms.text)) ctx.flag("account", a.name, `Terms "${terms.text}" not understood; the market rule applies`);
    const inTerritory = marketCode === "NORCAL-D" && !isMatagrano;
    if (inTerritory && !matagranoId) ctx.flag("account", a.name, "In Matagrano territory but Matagrano is not in the workbook; served-by left empty");
    if (a.region) {
      if (!regionsByMarket.has(marketCode)) regionsByMarket.set(marketCode, new Set());
      regionsByMarket.get(marketCode)!.add(a.region);
    }
    const raw: Record<string, string> = {};
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "string" && v && !["contact", "phone", "email", "billingEmail"].includes(k)) raw[k] = v;
    }
    accounts.push({
      id,
      tradeName: a.name,
      legalName: a.legal || null,
      marketCode,
      marketId: MARKET_IDS[marketCode],
      marketReason: reason,
      kind: isMatagrano ? "distributor" : "retail",
      status: "active",
      servedByLocationId: inTerritory && matagranoId ? matagranoId : undefined,
      servedByLabel: inTerritory && matagranoId ? "Matagrano" : undefined,
      legacyAccountId: a.legacyId || null,
      region: a.region || null,
      termsText: terms.text,
      termsDaysOverride: terms.days,
      fulfilment: isMatagrano ? "pickup" : "delivery",
      firstDeliveryOn: isoOrNull(a.firstDelivery),
      deliveryInstructions: instructions,
      receivingRestrictions: restrictions,
      originatingRepSheet: a.rep || null,
      originatingRepEmployeeId: rep?.id ?? null,
      sourceTab: a.sourceTab,
      delivery,
      billing,
      buyer: buyerName ? { name: buyerName, email: a.email.toLowerCase() || null, phone: normPhone(a.phone) } : null,
      apEmail: a.billingEmail.toLowerCase() || null,
      license: license || null,
      channel,
      setupState: channel === "unselected" ? "not_requested" : "unknown",
      payNote: a.payment ? `Sheet: ${a.payment}` : null,
      lastCleaning: isoOrNull(a.lastCleaning),
      ekos: a.ekos || null,
      priority: a.priority || null,
      raw,
    });
  }
  // Distributor accounts not in the workbook (2.5).
  for (const d of EXTRA_DISTRIBUTORS) {
    const id = ids.location(d.tradeName);
    if (accounts.some((x) => x.id === id)) continue;
    if (!d.address) ctx.flag("account", d.tradeName, "Distributor added without an address (not in the workbook)");
    accounts.push({
      id,
      tradeName: d.tradeName,
      legalName: null,
      marketCode: d.marketCode,
      marketId: MARKET_IDS[d.marketCode],
      marketReason: "distributor (2.5)",
      kind: "distributor",
      status: "active",
      legacyAccountId: null,
      region: null,
      termsText: null,
      termsDaysOverride: null,
      fulfilment: "delivery",
      firstDeliveryOn: null,
      deliveryInstructions: `Distributor account. ${d.note}`,
      receivingRestrictions: null,
      originatingRepSheet: null,
      originatingRepEmployeeId: null,
      sourceTab: "decision 2.5",
      delivery: d.address ? { line1: d.address.line1, city: d.address.city, state: d.address.state, postal: d.address.postal } : null,
      billing: null,
      buyer: null,
      apEmail: null,
      license: null,
      channel: "unselected",
      setupState: "not_requested",
      payNote: null,
      lastCleaning: null,
      ekos: null,
      priority: null,
      raw: { name: d.tradeName, note: d.note },
    });
  }
  // Distributors first so served-by references resolve on insert.
  accounts.sort((a, b) => (a.kind === "distributor" ? 0 : 1) - (b.kind === "distributor" ? 0 : 1) || a.tradeName.localeCompare(b.tradeName));
  return { accounts, regionsByMarket };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function normalizeWorkbook(wb: ParsedWorkbook, fileName: string): NormalizedImport {
  const ctx = makeContext();
  const t = wb.tabs;
  const sheets = {
    master: sheetOf(t["Customer Accounts"], ["Business Name"]),
    supplement: sheetOf(t["Accounts"], ["AccountID", "BusinessName"]),
    locations: sheetOf(t["Location Information"], ["Type", "Company Name"]),
    skuMaster: sheetOf(t["SKU Master"], ["SKU", "PackageType"]),
    productInfo: sheetOf(t["Product Information"], ["Product", "Supplier Code (Sales)"]),
    reps: sheetOf(t["Reps"], ["Name"]),
    production: sheetOf(t["Production"], ["Batch #", "Lot #"]),
    packaged: sheetOf(t["Packaged Products"], ["Lot #", "Product Code"]),
    bolLog: sheetOf(t["BOL Maker Log"], ["DocNumber", "PayloadJSON"]),
    sales: sheetOf(t["Sales"], ["Invoice #", "Customer"]),
  };
  for (const name of wb.missing) ctx.flag("workbook", name, "Tab missing from the export");
  for (const [k, name] of [["master", "Customer Accounts"], ["supplement", "Accounts"], ["locations", "Location Information"], ["skuMaster", "SKU Master"], ["productInfo", "Product Information"], ["reps", "Reps"], ["production", "Production"], ["packaged", "Packaged Products"], ["bolLog", "BOL Maker Log"], ["sales", "Sales"]] as const) {
    if (t[name] && !sheets[k]) ctx.flag("workbook", name, "Header row not recognised; the tab was skipped");
  }

  const origins = normalizeOrigins(sheets.locations, ctx);
  const { skus, legacyPrice } = normalizeSkus(sheets.skuMaster, sheets.productInfo, ctx);
  const cat = buildCatalog(skus);
  const prices = normalizePrices(legacyPrice, skus, ctx);
  const employees = normalizePeople(sheets.reps, ctx);
  const { accounts, regionsByMarket } = normalizeAccounts(sheets.master, sheets.supplement, employees, ctx);
  const markets = normalizeMarkets(regionsByMarket);

  const seenCodes = new Map<string, string>();
  if (sheets.productInfo) for (const r of sheets.productInfo.rows) {
    for (const col of ["Supplier Code (Sales)", "Inventory SKU"]) {
      const c = sheets.productInfo.get(r, col);
      if (c && !seenCodes.has(c.toUpperCase())) seenCodes.set(c.toUpperCase(), "Product Information");
    }
  }
  const history = normalizeHistory({ sheets, origins, accounts, cat, ctx, seenCodes, employees });
  const aliases = collectAliases(cat, seenCodes, ctx);

  return {
    fileName,
    missingTabs: wb.missing,
    markets,
    origins,
    skus,
    aliases,
    prices,
    employees,
    accounts,
    ...history,
    flags: ctx.flags,
    excluded: ctx.excluded,
  };
}
