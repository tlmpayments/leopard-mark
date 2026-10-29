/**
 * Text helpers ported one-to-one from the October 28 prototype (tools/import/gen_import.py): address parsing, phone
 * normalisation, state and ZIP normalisation and the market inference. The production addresses were created by these
 * rules, so re-parsing the same workbook must yield the same values.
 */
import { MATAGRANO_CITIES, NORCAL_CITIES, OTHER_KNOWN_CITIES, SOCAL_CITIES } from "./rules";
import type { ParsedAddress } from "./types";

const STATE_ABBR: Record<string, string> = { california: "CA", colorado: "CO", massachusetts: "MA", "new york": "NY", texas: "TX", connecticut: "CT", oregon: "OR", nevada: "NV", arizona: "AZ" };

export function normState(s: string): string {
  const t = s.trim();
  if (!t) return "";
  return STATE_ABBR[t.toLowerCase()] ?? t.toUpperCase().slice(0, 2);
}

export function normZip(z: string, state: string): string {
  let t = z.trim();
  if (/^\d{4}$/.test(t) && (state === "MA" || state === "CT")) t = `0${t}`;
  return t;
}

export function normPhone(v: string): string | null {
  const t = v.trim();
  let d = t.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return t || null;
}

const CITY_RE = /^(.+?)[,\s]+([A-Za-z .'#/-]+?),?\s+(CA|California|OR|NV|AZ|TX|MA|CT|NY)\.?\s*,?\s*(\d{5})?(?:-\d{4})?\s*$/i;

const KNOWN_CITIES: string[] = Array.from(new Set([...SOCAL_CITIES, ...NORCAL_CITIES, ...MATAGRANO_CITIES, ...OTHER_KNOWN_CITIES])).sort((a, b) => b.length - a.length || a.localeCompare(b));

function titleCaseCity(city: string): string {
  return city
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() && w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function parseAddress(raw: string): ParsedAddress | null {
  const a = raw.replace(/ /g, " ").trim();
  if (!a || a.toUpperCase() === "N/A") return null;
  const m = CITY_RE.exec(a);
  if (!m) return null;
  let line = m[1].replace(/^[\s,]+|[\s,]+$/g, "");
  let city = m[2].replace(/^[\s,]+|[\s,]+$/g, "");
  const st = normState(m[3]);
  const zip = m[4] ?? "";
  // When the street and city were not comma separated the regex greedily puts the city in `line`.
  const low = `${line} ${city}`.toLowerCase();
  for (const kc of KNOWN_CITIES) {
    if (low.endsWith(` ${kc}`) || city.toLowerCase() === kc) {
      if (city.toLowerCase() !== kc) {
        const full = `${line} ${city}`.trim();
        const idx = full.toLowerCase().lastIndexOf(kc);
        line = full.slice(0, idx).replace(/^[\s,]+|[\s,]+$/g, "");
        city = full.slice(idx).trim();
      }
      break;
    }
  }
  return { line1: line, city: titleCaseCity(city), state: st, postal: zip };
}

export function sameAsDelivery(billing: string): boolean {
  return ["", "same", "same as delivery", "same as shipping"].includes(billing.trim().toLowerCase());
}
