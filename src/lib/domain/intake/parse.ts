/**
 * Pre-filling an order from an intake email (Round 4). For a KNOWN sender (an email address or domain that belongs to
 * one account's contacts) the parser reads the message text and its attachments and drafts the order: lines by SKU
 * alias (Martignetti's item numbers 7799101 to 7799103), SKU code or product name, the PO number and a requested date.
 * The draft is a suggestion a person checks and converts; nothing is ordered and nothing is sent back automatically.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { skuLabel } from "@/lib/domain/catalog/label";

export interface ParsedLine {
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  via: "alias" | "code" | "name";
  matched: string;
}

export interface ParsedDraft {
  locationId: string | null;
  locationName: string | null;
  senderKnown: boolean;
  senderMatch: "contact_email" | "domain" | null;
  lines: ParsedLine[];
  poNumber: string | null;
  requestedDate: string | null;
  confidence: "high" | "medium" | "low";
  notes: string[];
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com", "me.com", "live.com", "msn.com", "comcast.net", "att.net", "sbcglobal.net"]);

/** The account a sender belongs to: an exact contact email, else a company domain used by exactly one account's contacts. */
export async function locationForSender(db: DbOrTx, email: string | null): Promise<{ locationId: string; match: "contact_email" | "domain" } | null> {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  const exact = await db
    .select({ locationId: schema.locationContact.locationId })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.locationContact.locationId))
    .where(and(eq(schema.locationContact.current, true), sql`lower(${schema.contact.email}) = ${e}`, eq(schema.customerLocation.status, "active")));
  const exactIds = Array.from(new Set(exact.map((r) => r.locationId)));
  if (exactIds.length === 1) return { locationId: exactIds[0], match: "contact_email" };
  if (exactIds.length > 1) return null; // a shared AP address: a person decides
  const domain = e.split("@")[1];
  if (!domain || FREE_MAIL.has(domain)) return null;
  const byDomain = await db
    .select({ locationId: schema.locationContact.locationId })
    .from(schema.locationContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
    .innerJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.locationContact.locationId))
    .where(and(eq(schema.locationContact.current, true), sql`lower(${schema.contact.email}) like ${"%@" + domain}`, eq(schema.customerLocation.status, "active")));
  const ids = Array.from(new Set(byDomain.map((r) => r.locationId)));
  return ids.length === 1 ? { locationId: ids[0], match: "domain" } : null;
}

interface SkuRef {
  id: string;
  code: string;
  name: string;
  brand: string;
  packageKind: string;
}

// Checked in order: the specific package words first, the generic "case" or "cans" last, so "2 cases of the 24 oz"
// reads as 24 oz cases and only an unqualified "cases" falls back to the 12 oz case.
const PACKAGE_HINTS: Record<string, RegExp> = {
  keg_half: /\b(1\s*\/\s*2\s*(bbl|barrel|keg)?|half\s*(bbl|barrel|keg)|halves|hb\b|50\s*l)/i,
  keg_sixtel: /\b(1\s*\/\s*6\s*(bbl|barrel|keg)?|sixtels?|sixth\s*(bbl|barrel|keg)?|sb\b|log\b)/i,
  case_24oz_can: /\b(24\s*oz|24oz|tall\s*boys?|12\s*\/\s*24)\b/i,
  case_12oz_can: /\b(12\s*oz|12oz|2\s*\/\s*12|4\s*\/\s*6|cases?|cs\b|cans?)\b/i,
};

/** The first standalone whole number on a line that is not money, a date, a zip, a phone or part of an item code. */
export function quantityIn(line: string, exclude: string[] = []): number | null {
  let s = line;
  for (const x of exclude) s = s.split(x).join(" ");
  s = s.replace(/\$\s?\d[\d,]*(\.\d+)?/g, " ").replace(/\d[\d,]*\.\d{2}\b/g, " ").replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ").replace(/\b\d{5}(-\d{4})?\b/g, " ").replace(/\b\d{3}[-.)\s]\d{3}[-.\s]\d{4}\b/g, " ").replace(/\b\d{1,2}\s*oz\b/gi, " ").replace(/\b(1\s*\/\s*[26])\b/g, " ").replace(/\b(2\s*\/\s*12|4\s*\/\s*6|12\s*\/\s*24)\b/g, " ");
  const m = /(?:^|[^\d.,])(\d{1,4})(?![\d.,])/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n < 5000 ? n : null;
}

export function findPoNumber(text: string): string | null {
  const m = /\b(?:P\.?\s?O\.?|purchase\s+order)\s*(?:#|no\.?|number|num\.?)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})/i.exec(text);
  return m ? m[1].replace(/[.,;]$/, "") : null;
}

export function findRequestedDate(text: string, received: Date): string | null {
  const m = /\b(?:deliver(?:y)?|ship|need(?:ed)?|arrive|by)\s*(?:by|on|date|for)?\s*[:#]?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i.exec(text);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year = m[3] ? Number(m[3]) : received.getUTCFullYear();
  if (year < 100) year += 2000;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (!m[3] && d.getTime() < received.getTime() - 7 * 86_400_000) d.setUTCFullYear(year + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Lines from free text: each text line that names an item (alias, code or brand plus package) and carries a quantity.
 * Aliases win over codes, codes over names; one line of text yields at most one order line.
 */
export function linesFromText(text: string, skus: SkuRef[], aliases: Array<{ alias: string; skuId: string }>): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Map<string, number>();
  const add = (sku: SkuRef, qty: number, via: ParsedLine["via"], matched: string) => {
    const idx = seen.get(sku.id);
    if (idx !== undefined) {
      out[idx].qty += qty;
      return;
    }
    seen.set(sku.id, out.length);
    out.push({ skuId: sku.id, skuCode: sku.code, skuName: skuLabel(sku), qty, via, matched: matched.trim().slice(0, 120) });
  };
  const byId = new Map(skus.map((s) => [s.id, s]));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    let hit = false;
    for (const a of aliases) {
      if (!a.alias || !new RegExp(`(^|[^0-9A-Za-z])${a.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9A-Za-z]|$)`, "i").test(line)) continue;
      const sku = byId.get(a.skuId);
      if (!sku) continue;
      const qty = quantityIn(line, [a.alias]);
      if (qty) {
        add(sku, qty, "alias", line);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    for (const s of skus) {
      if (!new RegExp(`(^|[^0-9A-Za-z-])${s.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9A-Za-z-]|$)`, "i").test(line)) continue;
      const qty = quantityIn(line, [s.code]);
      if (qty) {
        add(s, qty, "code", line);
        hit = true;
        break;
      }
    }
    if (hit) continue;
    // Free text names items by brand and package, often several to a sentence: "4 sixtels of Cantinesca and 10 cases
    // of the 12 oz Cantinesca cans". Each segment yields at most one line.
    const brands = Array.from(new Set(skus.map((s) => s.brand)));
    for (const segment of line.split(/,|;|\band\b|\bplus\b|\balso\b/i)) {
      const brand = brands.find((b) => new RegExp(b.split(/\s+/)[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(segment));
      if (!brand) continue;
      const candidates = skus.filter((s) => s.brand === brand);
      const pkg = Object.entries(PACKAGE_HINTS).find(([kind, re]) => re.test(segment) && candidates.some((s) => s.packageKind === kind));
      if (!pkg) continue;
      const sku = candidates.find((s) => s.packageKind === pkg[0]);
      if (!sku) continue;
      const qty = quantityIn(segment);
      if (qty) add(sku, qty, "name", segment);
    }
  }
  return out;
}

/** Catalog references for the parser: active SKUs and every alias. */
export async function parserCatalog(db: DbOrTx) {
  const skus = await db.select({ id: schema.sku.id, code: schema.sku.code, name: schema.sku.name, brand: schema.sku.brand, packageKind: schema.sku.packageKind }).from(schema.sku).where(isNull(schema.sku.archivedAt));
  const aliases = await db.select({ alias: schema.skuAlias.alias, skuId: schema.skuAlias.skuId }).from(schema.skuAlias).where(inArray(schema.skuAlias.skuId, skus.map((s) => s.id)));
  return { skus, aliases: aliases.sort((a, b) => b.alias.length - a.alias.length) };
}

/** The whole draft for an email: who, what, PO, date, and how sure the parser is. */
export async function draftFromMessage(db: DbOrTx, input: { fromEmail: string | null; subject: string | null; text: string; attachmentTexts: string[]; receivedAt: Date }): Promise<ParsedDraft> {
  const sender = await locationForSender(db, input.fromEmail);
  const notes: string[] = [];
  const [loc] = sender ? await db.select({ tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(eq(schema.customerLocation.id, sender.locationId)) : [];
  const { skus, aliases } = await parserCatalog(db);
  const corpus = [input.subject ?? "", input.text, ...input.attachmentTexts].join("\n");
  let lines = linesFromText([input.text, ...input.attachmentTexts].join("\n"), skus, aliases);
  if (!lines.length && input.subject) lines = linesFromText(input.subject, skus, aliases);
  const poNumber = findPoNumber(corpus);
  const requestedDate = findRequestedDate(corpus, input.receivedAt);
  if (!sender) notes.push("Sender is not a contact on any one active account; choose the account.");
  else if (sender.match === "domain") notes.push("Matched by the sender's company domain, not an exact contact; confirm the account.");
  if (!lines.length) notes.push("No product lines were recognised; enter them from the message.");
  if (lines.some((l) => l.via === "name")) notes.push("Some lines were matched by product name and package; check the quantities.");
  if (input.attachmentTexts.length && !lines.some((l) => l.via === "alias")) notes.push("The attachment carried no known item numbers.");
  const confidence: ParsedDraft["confidence"] = sender && lines.length && lines.every((l) => l.via !== "name") && sender.match === "contact_email" ? "high" : sender && lines.length ? "medium" : "low";
  return { locationId: sender?.locationId ?? null, locationName: loc?.tradeName ?? null, senderKnown: Boolean(sender), senderMatch: sender?.match ?? null, lines, poNumber, requestedDate, confidence, notes };
}
