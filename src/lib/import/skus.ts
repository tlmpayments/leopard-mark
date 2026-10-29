/**
 * SKU resolution for every code spelling the workbook uses (3.3, 1.7): the eight active codes, the ten-character legacy
 * codes (SGB1AKHB01), the inventory spellings (TLM-SGB1AKHB01-M), the dotted scheme (TLM.EBB.SGB-KEG.1/2) and the
 * Sales rows that carry only a product name and a packaging format. Legacy codes with a successor resolve to the
 * active SKU; Giro and experimental codes resolve to their archived legacy SKU; trade items resolve to POS items.
 */
import { ACTIVE_SKUS, BRAND_TOKENS, LEGACY_TO_NEW, POS_CODE_MAP } from "./rules";
import type { SkuRecord } from "./types";

export type Resolved = { kind: "sku"; code: string; note?: string } | { kind: "pos"; code: string } | null;

export interface SkuCatalog {
  byCode: Map<string, SkuRecord>;
  successor: Map<string, string>;
}

export function buildCatalog(skus: SkuRecord[]): SkuCatalog {
  const byCode = new Map<string, SkuRecord>();
  for (const s of skus) byCode.set(s.code, s);
  const successor = new Map<string, string>();
  for (const [legacy, active] of LEGACY_TO_NEW) successor.set(legacy, active);
  return { byCode, successor };
}

const PACKAGE_SUFFIX: Record<string, string> = { KHB01: "KHB010", KSB01: "KSB010", C1224: "C1206P" };

/** Legacy ten-character code, or null. Successors win over the archived row. */
function resolveLegacy(cat: SkuCatalog, code: string): Resolved {
  const c = code.toUpperCase();
  const active = cat.successor.get(c);
  if (active && cat.byCode.has(active)) return { kind: "sku", code: active, note: `legacy ${c}` };
  if (cat.byCode.has(c)) return { kind: "sku", code: c };
  return null;
}

function brandCodeFor(text: string): string | null {
  const t = text.trim();
  for (const b of BRAND_TOKENS) if (b.match.test(t)) return b.brandCode;
  if (/^[A-Z]{3}$/.test(t.toUpperCase())) return t.toUpperCase();
  return null;
}

/** Package token from a dotted code tail ("KEG.1/2", "CAN.12OZ") or a Sales packaging format. */
function packageToken(text: string): "KHB01" | "KSB01" | "C1224" | "C2412" | "C1212" | null {
  const t = text.toLowerCase();
  if (/1\s*\/\s*2|half/.test(t)) return "KHB01";
  if (/1\s*\/\s*6|sixtel/.test(t)) return "KSB01";
  if (/2\s*\/\s*12/.test(t)) return "C1212";
  if (/24\s*oz|4\/3\//.test(t)) return "C2412";
  if (/12\s*oz|4\/6|case|can/.test(t)) return "C1224";
  return null;
}

function resolveBrandPackage(cat: SkuCatalog, brandCode: string, pkg: string): Resolved {
  if (brandCode === "SLG" || brandCode === "SGB" || brandCode === "SGS") {
    const suffix = PACKAGE_SUFFIX[pkg];
    if (suffix && cat.byCode.has(`SLG0${suffix}`)) return { kind: "sku", code: `SLG0${suffix}`, note: `${brandCode} ${pkg}` };
    if (pkg === "C2412" || pkg === "C1212") return null;
  }
  if (brandCode === "CNT") {
    if (pkg === "C1212" && cat.byCode.has("CNTCC1212C")) return { kind: "sku", code: "CNTCC1212C" };
    const suffix = PACKAGE_SUFFIX[pkg];
    if (suffix && cat.byCode.has(`CNTC${suffix}`)) return { kind: "sku", code: `CNTC${suffix}`, note: `${brandCode} ${pkg}` };
  }
  if (pkg === "C1212") return null;
  const legacy = `${brandCode}1A${pkg}`;
  return resolveLegacy(cat, legacy);
}

const DOTTED_RE = /^TLM\.([A-Z]{3})\.(.+?)-(KEG|CAN)\.(.+)$/i;
const INVENTORY_RE = /^TLM-([A-Z0-9]{8,12})(?:-(M|6PK|3PK|\d+PK))?$/i;

/** Resolve any code spelling to a SKU or a POS item; null when nothing in the catalog matches. */
export function resolveCode(cat: SkuCatalog, rawCode: string): Resolved {
  const code = rawCode.replace(/ /g, " ").trim();
  if (!code || code.toUpperCase() === "N/A") return null;
  const upper = code.toUpperCase();
  if (POS_CODE_MAP[upper]) return { kind: "pos", code: POS_CODE_MAP[upper] };
  if (ACTIVE_SKUS.some((s) => s.code === upper) && cat.byCode.has(upper)) return { kind: "sku", code: upper };
  const legacy = resolveLegacy(cat, upper);
  if (legacy) return legacy;
  const inv = INVENTORY_RE.exec(upper);
  if (inv) {
    const inner = resolveLegacy(cat, inv[1]);
    if (inner) return { kind: "sku", code: inner.code, note: `inventory code ${upper}` };
    return null;
  }
  const dotted = DOTTED_RE.exec(code);
  if (dotted) {
    const brand = brandCodeFor(dotted[2]);
    const pkg = packageToken(`${dotted[3]} ${dotted[4]}`);
    if (!brand || !pkg) return null;
    const r = resolveBrandPackage(cat, brand, pkg);
    return r ? { kind: "sku", code: r.code, note: `dotted code ${upper}` } : null;
  }
  return null;
}

/** Sales rows without a product code carry a product name and a packaging format. */
export function resolveProductPackage(cat: SkuCatalog, product: string, packaging: string): Resolved {
  const brand = brandCodeFor(product);
  const pkg = packageToken(packaging);
  if (!brand || !pkg) return null;
  const r = resolveBrandPackage(cat, brand, pkg);
  return r ? { kind: "sku", code: r.code, note: `${product} / ${packaging}` } : null;
}

/** Brand code of a lot code maps to the active SKU family used for lot quantities (SGB/SGS lots hold Sunlight Groove). */
export function skuForLotBrand(cat: SkuCatalog, brandCode: string, runCode: string, pkg: "KHB01" | "KSB01" | "C1224" | "C2412"): string | null {
  if (brandCode === "XHZ") {
    // Experimental Hazy variants A to D carry the run letter as the variant letter in the legacy code.
    const variant = /^[A-D]$/.test(runCode) ? runCode : "A";
    const code = `XHZ1${variant}${pkg}`;
    return cat.byCode.has(code) ? code : null;
  }
  const r = resolveBrandPackage(cat, brandCode, pkg);
  return r ? r.code : null;
}
