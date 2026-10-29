/**
 * Workbook reader for the TLM Master File export (.xlsx).
 *
 * Every tab becomes a plain table of trimmed strings so the normaliser never sees exceljs types: numbers like 542804.0
 * print as "542804", dates as YYYY-MM-DD, rich text and hyperlinks as their text, formulas as their cached result,
 * booleans as "True"/"False" (the spelling the Sheet's CSV export used) and empty cells as "". Fully empty rows are
 * dropped; trailing empty cells are trimmed. Missing tabs are reported, not fatal, so a partial export still dry-runs.
 */
import ExcelJS from "exceljs";

export type Table = string[][];

export interface ParsedWorkbook {
  /** Tab name as it appears in the workbook (trimmed) to its rows. */
  tabs: Record<string, Table>;
  present: string[];
  missing: string[];
}

/** Tabs the import reads (SHIPMENTS_SPEC 10.1). Everything else in the workbook is ignored. */
export const REFERENCE_TABS = ["Customer Accounts", "Accounts", "Location Information", "SKU Master", "Product Information", "Commodities", "Reps"] as const;
export const HISTORY_TABS = ["Production", "Packaged Products", "BOL Maker Log", "Sales"] as const;
export const EXPECTED_TABS: readonly string[] = [...REFERENCE_TABS, ...HISTORY_TABS];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoDate(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function numberText(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  // Strip floating-point noise from formula results (3101.7000000000003) without touching large integers.
  return String(Number(n.toFixed(10)));
}

/** The Sheet's CSV export printed whole numbers as "542804.0"; strings carrying that shape are normalised the same way. */
export function cleanText(s: string): string {
  const t = s.replace(/ /g, " ").trim();
  if (/^-?\d+\.0$/.test(t)) return t.slice(0, -2);
  return t;
}

function richTextToString(rt: unknown): string {
  if (!rt || typeof rt !== "object") return "";
  const parts = (rt as { richText?: Array<{ text?: string }> }).richText;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => p?.text ?? "").join("");
}

export function cellValueText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return isoDate(v);
  if (typeof v === "number") return numberText(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return cleanText(v);
  if (typeof v === "object") {
    if ("richText" in v) return cleanText(richTextToString(v));
    if ("hyperlink" in v) {
      const text = (v as { text: unknown }).text;
      return typeof text === "string" ? cleanText(text) : cleanText(richTextToString(text));
    }
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as { result?: unknown }).result;
      if (result === undefined) return "";
      return cellValueText(result as ExcelJS.CellValue);
    }
    if ("error" in v) return "";
  }
  return cleanText(String(v));
}

function worksheetToTable(ws: ExcelJS.Worksheet): Table {
  const out: Table = [];
  for (let r = 1; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cells[col - 1] = cellValueText(cell.value);
    });
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = "";
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.some((c) => c !== "")) out.push(cells);
  }
  return out;
}

/** Read an .xlsx export. Tab names are matched exactly after trimming; a tab that is missing is listed, not an error. */
export async function parseWorkbook(bytes: Buffer | Uint8Array): Promise<ParsedWorkbook> {
  const wb = new ExcelJS.Workbook();
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const tabs: Record<string, Table> = {};
  for (const ws of wb.worksheets) {
    const name = ws.name.trim();
    if (!EXPECTED_TABS.includes(name)) continue;
    tabs[name] = worksheetToTable(ws);
  }
  const present = EXPECTED_TABS.filter((t) => t in tabs);
  const missing = EXPECTED_TABS.filter((t) => !(t in tabs));
  return { tabs, present, missing };
}

/**
 * Locate the header row of a tab (some tabs carry a title row above it: "M2 | Sales", "Reps:", "Product Information
 * and Codes") and return a column lookup. Header cells are reduced to their first line ("Alc.\nLicense #" matches "Alc.").
 */
export interface Sheet {
  header: string[];
  rows: string[][];
  /** Column index for a header name (first line, trimmed, case-insensitive); -1 when absent. */
  col(name: string): number;
  get(row: string[], name: string): string;
}

export function sheetOf(table: Table | undefined, anchorHeaders: string[]): Sheet | null {
  if (!table) return null;
  const norm = (h: string) => cleanText(h.split("\n")[0]).toLowerCase();
  const anchors = anchorHeaders.map((a) => a.toLowerCase());
  let headerIdx = -1;
  for (let i = 0; i < Math.min(table.length, 5); i += 1) {
    const cells = table[i].map(norm);
    if (anchors.every((a) => cells.includes(a))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return null;
  const header = table[headerIdx].map((h) => cleanText(h.split("\n")[0]));
  const lookup = new Map<string, number>();
  header.forEach((h, i) => {
    const k = h.toLowerCase();
    if (!lookup.has(k)) lookup.set(k, i);
  });
  const rows = table.slice(headerIdx + 1);
  const col = (name: string) => lookup.get(name.toLowerCase()) ?? -1;
  return {
    header,
    rows,
    col,
    get(row, name) {
      const i = col(name);
      return i >= 0 && i < row.length ? cleanText(row[i] ?? "") : "";
    },
  };
}
