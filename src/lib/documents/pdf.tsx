/**
 * PDF renderer for shipment and invoice documents (docs/SHIPMENTS_SPEC.md §4).
 *
 * Every template is a pure function of its snapshot: nothing here reads the database, the clock or the network. The
 * built-in Helvetica family is the only font (no downloads), pages are US Letter with half-inch margins, and the
 * module registers itself with `src/lib/documents/render.ts` at load so the domain services store PDF bytes alongside
 * the snapshot at confirmation (6.7). Arrow characters never reach the page; "to" is written instead.
 */
import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { registerRenderer } from "./render";
import type { AnySnapshot, InvoiceSnapshot, InvoiceSnapshotLine, PartyBlock, PullSheetSnapshot, ShipmentSnapshot, SnapshotLine } from "./types";

export type RenderInput =
  | AnySnapshot
  | PullSheetSnapshot
  | { kind: "pickup_pack"; bol: ShipmentSnapshot; invoice: InvoiceSnapshot | null }
  | { kind: "batch"; documents: Array<AnySnapshot | PullSheetSnapshot> };

type SingleDocument = AnySnapshot | PullSheetSnapshot;

// SKU codes, lot codes and numbers must never be hyphenated across lines.
Font.registerHyphenationCallback((word) => [word]);

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EM_DASH = "—";
// Arrows of every kind (arrows block, supplemental arrows, dingbat arrows) are written as "to" (§4).
const ARROWS = /[←-⇿⟰-⟿➔-➾⬀-⬑]+/g;

/** Strip arrow characters and collapse the surrounding whitespace. Applied to every string that reaches the page. */
export function clean(value: string): string {
  return value.replace(ARROWS, " to ").replace(/[ \t]{2,}/g, " ").trim();
}

function text(value: string | null | undefined, fallback = EM_DASH): string {
  if (value == null) return fallback;
  const c = clean(String(value));
  return c === "" ? fallback : c;
}

/** ISO calendar date (YYYY-MM-DD) to "Nov 5, 2026" with no timezone arithmetic. Other strings pass through cleaned. */
export function formatDate(iso: string | null | undefined, fallback = EM_DASH): string {
  if (!iso) return fallback;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return text(iso, fallback);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return text(iso, fallback);
  return `${MONTHS[month - 1]} ${day}, ${m[1]}`;
}

/** ISO timestamp to "Nov 5, 2026 22:03 UTC" (the stored instant, labelled, never shifted to a guessed local zone). */
function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return text(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Cents to "$1,234.56" (negative amounts as "-$1,234.56"). */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${groupThousands(String(dollars))}.${rest}`;
}

export function formatQty(n: number): string {
  return groupThousands(String(Math.trunc(n)));
}

/** Pounds with two decimals, e.g. "1,234.50". */
export function formatWeight(lb: number | null | undefined, fallback = EM_DASH): string {
  if (lb == null || Number.isNaN(lb)) return fallback;
  const fixed = Math.abs(lb).toFixed(2);
  const [whole, frac] = fixed.split(".");
  return `${lb < 0 ? "-" : ""}${groupThousands(whole)}.${frac}`;
}

function numberWithRevision(number: string | null, revision: number): string {
  if (!number) return "DRAFT";
  return revision > 0 ? `${clean(number)} R${revision}` : clean(number);
}

function typeLabel(type: ShipmentSnapshot["type"]): string {
  if (type === "T") return "Transfer";
  if (type === "S") return "Samples (no charge)";
  return "Delivery";
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const INK = "#111111";
const MUTED = "#555555";
const RULE = "#9a9a9a";
const LIGHT_RULE = "#d0d0d0";
const STAMP = "#b00020";

const styles = StyleSheet.create({
  // No lineHeight on the page: with one set, @react-pdf/renderer 4.9 drops every `render`-prop Text (page numbers).
  page: { paddingTop: 36, paddingHorizontal: 36, paddingBottom: 54, fontFamily: "Helvetica", fontSize: 9, color: INK },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontFamily: "Helvetica-Oblique" },
  muted: { color: MUTED },
  small: { fontSize: 7.5 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 8, marginBottom: 10 },
  shipperBlock: { width: "55%" },
  shipperName: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  titleBlock: { width: "43%", alignItems: "flex-end" },
  title: { fontFamily: "Helvetica-Bold", fontSize: 18, letterSpacing: 1 },
  docNumber: { fontFamily: "Helvetica-Bold", fontSize: 12, marginTop: 2 },
  banner: { borderWidth: 1.5, borderColor: INK, paddingVertical: 4, paddingHorizontal: 8, marginBottom: 8, alignSelf: "flex-start" },
  bannerText: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 0.5 },
  twoCol: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  partyBox: { width: "49%", borderWidth: 1, borderColor: RULE, padding: 6 },
  label: { fontSize: 6.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 1 },
  partyName: { fontFamily: "Helvetica-Bold", fontSize: 10 },
  fields: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: RULE, marginBottom: 8 },
  field: { paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: LIGHT_RULE },
  sectionTitle: { fontFamily: "Helvetica-Bold", fontSize: 9, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6, marginBottom: 3 },
  table: { borderWidth: 1, borderColor: RULE, marginBottom: 8 },
  thRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, backgroundColor: "#f0f0f0" },
  tdRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LIGHT_RULE },
  totalsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: INK, backgroundColor: "#f7f7f7" },
  cell: { paddingVertical: 3, paddingHorizontal: 3, fontSize: 8 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.3 },
  tick: { width: 9, height: 9, borderWidth: 1, borderColor: INK, marginTop: 1 },
  fixedLine: { fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 2 },
  footerText: { fontSize: 7.5, color: MUTED, marginTop: 8, borderTopWidth: 0.5, borderTopColor: LIGHT_RULE, paddingTop: 4 },
  sigRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
  sigBlock: { width: "47%" },
  sigLine: { borderBottomWidth: 1, borderBottomColor: INK, height: 22, marginBottom: 2 },
  sigCaption: { fontSize: 7.5, color: MUTED },
  pageFooter: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: MUTED },
  stampWrap: { position: "absolute", top: 290, left: 0, right: 0, alignItems: "center" },
  stamp: { transform: "rotate(-22deg)", borderWidth: 5, borderColor: STAMP, paddingVertical: 4, paddingHorizontal: 28, opacity: 0.45 },
  stampText: { fontFamily: "Helvetica-Bold", fontSize: 86, color: STAMP, letterSpacing: 10 },
  kegBox: { flexDirection: "row", alignItems: "center", marginRight: 24 },
  kegCount: { width: 44, height: 24, borderWidth: 1, borderColor: INK, marginLeft: 6, justifyContent: "center", alignItems: "center" },
  kegCountText: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  stopHeader: { flexDirection: "row", justifyContent: "space-between", backgroundColor: "#f0f0f0", borderWidth: 1, borderColor: RULE, paddingVertical: 3, paddingHorizontal: 5, marginTop: 6 },
  ack: { fontSize: 8, marginTop: 10, marginBottom: 2 },
});

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Stamp({ word }: { word: string }) {
  return (
    <View fixed style={styles.stampWrap}>
      <View style={styles.stamp}>
        <Text style={styles.stampText}>{word}</Text>
      </View>
    </View>
  );
}

interface IssuerBlock {
  legalName: string;
  dba: string;
  lines: string[];
  arEmail: string;
  phone?: string | null;
}

function Header({ issuer, title, subtitle, number, meta }: { issuer: IssuerBlock; title: string; subtitle?: string | null; number: string; meta?: string[] }) {
  const dba = text(issuer.dba, "");
  const legal = text(issuer.legalName, "");
  // Shipper = legal name plus dba as posted with CA ABC (6.1).
  const shipperLine = dba && dba !== legal ? (legal ? `${legal} dba ${dba}` : dba) : legal || dba;
  return (
    <View style={styles.headerRow}>
      <View style={styles.shipperBlock}>
        <Text style={styles.shipperName}>{shipperLine}</Text>
        {issuer.lines.map((l, i) => (
          <Text key={i}>{text(l, "")}</Text>
        ))}
        {issuer.phone ? <Text>{text(issuer.phone)}</Text> : null}
        <Text>{text(issuer.arEmail, "")}</Text>
      </View>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.docNumber}>{number}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
        {(meta ?? []).map((m, i) => (
          <Text key={i} style={[styles.small, styles.muted]}>
            {m}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Party({ label, party, extra }: { label: string; party: PartyBlock; extra?: Array<string | null | undefined> }) {
  const legal = party.legalName && party.legalName.trim() && party.legalName.trim() !== party.name.trim() ? party.legalName : null;
  return (
    <View style={styles.partyBox}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.partyName}>{text(party.name)}</Text>
      {legal ? <Text>{text(legal)}</Text> : null}
      {party.lines.map((l, i) => (
        <Text key={i}>{text(l, "")}</Text>
      ))}
      {party.license ? <Text style={styles.muted}>License {text(party.license)}</Text> : null}
      {party.contact || party.phone ? <Text style={styles.muted}>{[party.contact, party.phone].filter(Boolean).map((v) => text(v)).join("  ")}</Text> : null}
      {(extra ?? []).filter((e): e is string => Boolean(e && e.trim())).map((e, i) => (
        <Text key={`x${i}`} style={styles.muted}>
          {text(e)}
        </Text>
      ))}
    </View>
  );
}

interface FieldItem {
  label: string;
  value: string | null | undefined;
  span?: 1 | 2 | 4;
}

function Fields({ items }: { items: FieldItem[] }) {
  return (
    <View style={styles.fields}>
      {items.map((f, i) => (
        <View key={i} style={[styles.field, { width: f.span === 4 ? "100%" : f.span === 2 ? "50%" : "25%" }]}>
          <Text style={styles.label}>{f.label}</Text>
          <Text>{text(f.value)}</Text>
        </View>
      ))}
    </View>
  );
}

interface Column<Row> {
  label: string;
  width?: number; // points; omit for the flexible column
  align?: "left" | "right" | "center";
  render: (row: Row, index: number) => React.ReactNode;
}

function cellStyle<Row>(c: Column<Row>) {
  return [styles.cell, c.width != null ? { width: c.width } : { flex: 1 }, { textAlign: c.align ?? "left" }];
}

function Table<Row>({ columns, rows, totals, empty }: { columns: Array<Column<Row>>; rows: Row[]; totals?: React.ReactNode; empty?: string }) {
  return (
    <View style={styles.table}>
      <View style={styles.thRow} wrap={false}>
        {columns.map((c, i) => (
          <View key={i} style={cellStyle(c)}>
            <Text style={styles.th}>{c.label}</Text>
          </View>
        ))}
      </View>
      {rows.length === 0 ? (
        <View style={styles.tdRow}>
          <View style={[styles.cell, { flex: 1 }]}>
            <Text style={[styles.italic, styles.muted]}>{empty ?? "No lines"}</Text>
          </View>
        </View>
      ) : null}
      {rows.map((r, ri) => (
        <View key={ri} style={styles.tdRow} wrap={false}>
          {columns.map((c, ci) => {
            const v = c.render(r, ri);
            return (
              <View key={ci} style={cellStyle(c)}>
                {typeof v === "string" || typeof v === "number" ? <Text>{v}</Text> : v}
              </View>
            );
          })}
        </View>
      ))}
      {totals ? (
        <View style={styles.totalsRow} wrap={false}>
          {totals}
        </View>
      ) : null}
    </View>
  );
}

function Tick() {
  return <View style={styles.tick} />;
}

function Signatures({ blocks }: { blocks: Array<{ label: string; withDate?: boolean }> }) {
  return (
    <View style={styles.sigRow} wrap={false}>
      {blocks.map((b, i) => (
        <View key={i} style={styles.sigBlock}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ width: b.withDate === false ? "100%" : "64%" }}>
              <View style={styles.sigLine} />
              <Text style={styles.sigCaption}>{b.label}</Text>
            </View>
            {b.withDate === false ? null : (
              <View style={{ width: "32%" }}>
                <View style={styles.sigLine} />
                <Text style={styles.sigCaption}>Date</Text>
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

function PageFooter({ left, generatedAt, generatedBy }: { left: string; generatedAt?: string | null; generatedBy?: string | null }) {
  const gen = generatedAt ? `Generated ${formatTimestamp(generatedAt)}${generatedBy ? ` by ${text(generatedBy)}` : ""}` : "";
  return (
    <View fixed style={styles.pageFooter}>
      <Text>{left}</Text>
      <Text>{gen}</Text>
      <Text render={({ subPageNumber, subPageTotalPages }) => `Page ${subPageNumber} of ${subPageTotalPages}`} />
    </View>
  );
}

function shipmentTotals(s: ShipmentSnapshot): string {
  const t = s.totals;
  const parts: string[] = [];
  if (t.kegs > 0) {
    const sizes: string[] = [];
    if (t.halfKegs > 0) sizes.push(`${formatQty(t.halfKegs)} x 1/2 bbl`);
    if (t.sixtelKegs > 0) sizes.push(`${formatQty(t.sixtelKegs)} x 1/6 bbl`);
    parts.push(`${formatQty(t.kegs)} keg${t.kegs === 1 ? "" : "s"}${sizes.length ? ` (${sizes.join(", ")})` : ""}`);
  }
  if (t.cases > 0) parts.push(`${formatQty(t.cases)} case${t.cases === 1 ? "" : "s"}`);
  if (t.units > 0) parts.push(`${formatQty(t.units)} POS unit${t.units === 1 ? "" : "s"}`);
  return parts.length ? parts.join("; ") : "No goods";
}

function stampFor(s: ShipmentSnapshot): string | null {
  if (s.voided) return "VOID";
  if (!s.number || s.status === "draft") return "DRAFT";
  return null;
}

function nmfcText(s: ShipmentSnapshot): string | null {
  if (!s.nmfc) return null;
  const proposed = s.nmfc.status === "proposed";
  // Settings may already carry the "proposed" wording inside the code string; print the warning once.
  const strip = (v: string | null) => (v ? v.replace(/\s*[—–-]\s*proposed,?\s*verify before use\.?$/i, "").trim() : null);
  const keg = strip(s.nmfc.keg);
  const can = strip(s.nmfc.can);
  const parts: string[] = [];
  if (keg) parts.push(`Kegs ${text(keg)}`);
  if (can) parts.push(`Cans ${text(can)}`);
  if (!parts.length) return null;
  return `${parts.join("; ")}${proposed ? " (proposed, verify before use)" : ""}`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const PAGE_FOOTER_WORD: Record<string, string> = { distributor: "Bill of lading", transfer: "Transfer bill of lading", retail: "Delivery receipt" };

/** Distributor / freight and transfer bill of lading (6.3). */
function BillOfLading({ s }: { s: ShipmentSnapshot }) {
  const number = numberWithRevision(s.number, s.revision);
  const stamp = stampFor(s);
  const title = s.type === "T" ? "TRANSFER BILL OF LADING" : "BILL OF LADING";
  const columns: Array<Column<SnapshotLine>> = [
    { label: "#", width: 16, render: (l) => String(l.lineNo) },
    { label: "SKU", width: 78, render: (l) => text(l.skuCode) },
    { label: "Description", render: (l) => text(l.description) },
    { label: "Package", width: 72, render: (l) => text(l.packageLabel) },
    { label: "Case UPC", width: 72, render: (l) => text(l.upcCase) },
    { label: "Lot", width: 66, render: (l) => text(l.lotCode) },
    { label: "Qty", width: 28, align: "right", render: (l) => formatQty(l.qty) },
    { label: "Unit lb", width: 38, align: "right", render: (l) => formatWeight(l.unitWeightLb) },
    { label: "Total lb", width: 48, align: "right", render: (l) => formatWeight(l.totalWeightLb) },
  ];
  const totals = (
    <>
      <View style={[styles.cell, { flex: 1 }]}>
        <Text style={styles.bold}>Totals: {shipmentTotals(s)}</Text>
      </View>
      <View style={[styles.cell, { width: 86, textAlign: "right" }]}>
        <Text style={styles.bold}>{formatWeight(s.totals.weightLb)} lb</Text>
      </View>
    </>
  );
  return (
    <Page size="LETTER" style={styles.page}>
      {stamp ? <Stamp word={stamp} /> : null}
      <Header issuer={s.shipper} title={title} number={number} subtitle={typeLabel(s.type)} meta={s.revision > 0 ? [`Revision ${s.revision} of ${text(s.number)}`] : []} />
      {s.pickup ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>WILL CALL {EM_DASH} picked up at origin</Text>
        </View>
      ) : null}
      <View style={styles.twoCol}>
        <Party label="Ship from" party={s.shipFrom} extra={[s.shipFrom.originCode ? `Origin code ${s.shipFrom.originCode}` : null]} />
        <Party label="Ship to" party={s.shipTo} />
      </View>
      <Fields
        items={[
          { label: "Scheduled date", value: formatDate(s.scheduledDate) },
          { label: "Actual date", value: formatDate(s.actualDate) },
          { label: "PO numbers", value: s.poNumbers.length ? s.poNumbers.map((p) => text(p)).join(", ") : null, span: 2 },
          { label: "Appointment", value: s.appointment },
          { label: "Carrier", value: s.carrier },
          { label: "Carrier phone", value: s.carrierPhone },
          { label: "Seal number", value: s.sealNumber },
          { label: "Trailer number", value: s.trailerNumber },
          { label: "Pallet count", value: s.palletCount != null ? formatQty(s.palletCount) : null },
          { label: "Pallet build", value: s.palletBuild, span: 2 },
          { label: "Freight class", value: s.freightClass },
          { label: "NMFC", value: nmfcText(s), span: 2 },
          { label: "Shipment type", value: typeLabel(s.type) },
        ]}
      />
      <Table columns={columns} rows={s.lines} totals={totals} />
      {s.fixedLines.length ? (
        <View style={{ marginBottom: 6 }}>
          {s.fixedLines.map((l, i) => (
            <Text key={i} style={styles.fixedLine}>
              {text(l, "")}
            </Text>
          ))}
        </View>
      ) : null}
      <Signatures blocks={[{ label: "Shipper" }, { label: "Carrier / Received by" }]} />
      {s.footer ? <Text style={styles.footerText}>{text(s.footer)}</Text> : null}
      <PageFooter left={`${PAGE_FOOTER_WORD[s.template] ?? "Bill of lading"} ${number}`} generatedAt={s.generatedAt} generatedBy={s.generatedBy} />
    </Page>
  );
}

/** Retail delivery receipt (6.4). */
function DeliveryReceipt({ s }: { s: ShipmentSnapshot }) {
  const number = numberWithRevision(s.number, s.revision);
  const stamp = stampFor(s);
  const columns: Array<Column<SnapshotLine>> = [
    { label: "#", width: 18, render: (l) => String(l.lineNo) },
    { label: "SKU", width: 80, render: (l) => text(l.skuCode) },
    { label: "Description", render: (l) => text(l.description) },
    { label: "Package", width: 100, render: (l) => text(l.packageLabel) },
    { label: "Lot", width: 80, render: (l) => text(l.lotCode) },
    { label: "Qty", width: 36, align: "right", render: (l) => formatQty(l.qty) },
  ];
  const totals = (
    <View style={[styles.cell, { flex: 1 }]}>
      <Text style={styles.bold}>Totals: {shipmentTotals(s)}</Text>
    </View>
  );
  const half = s.kegPickup?.halfIn ?? 0;
  const sixtel = s.kegPickup?.sixtelIn ?? 0;
  return (
    <Page size="LETTER" style={styles.page}>
      {stamp ? <Stamp word={stamp} /> : null}
      <Header issuer={s.shipper} title="DELIVERY RECEIPT" number={number} subtitle={typeLabel(s.type)} meta={s.revision > 0 ? [`Revision ${s.revision} of ${text(s.number)}`] : []} />
      {s.pickup ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>WILL CALL {EM_DASH} picked up at origin</Text>
        </View>
      ) : null}
      <View style={styles.twoCol}>
        <Party label="Ship from" party={s.shipFrom} />
        <Party label="Ship to" party={s.shipTo} />
      </View>
      <Fields
        items={[
          { label: "Scheduled date", value: formatDate(s.scheduledDate) },
          { label: "Actual date", value: formatDate(s.actualDate) },
          { label: "Delivery window", value: s.deliveryWindow },
          { label: "PO numbers", value: s.poNumbers.length ? s.poNumbers.map((p) => text(p)).join(", ") : null },
          { label: "Receiving instructions", value: s.receivingInstructions, span: 4 },
        ]}
      />
      <Table columns={columns} rows={s.lines} totals={totals} />
      <View wrap={false}>
        <Text style={styles.sectionTitle}>Empty kegs picked up</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
          <View style={styles.kegBox}>
            <Text>1/2 bbl</Text>
            <View style={styles.kegCount}>
              <Text style={styles.kegCountText}>{half > 0 ? formatQty(half) : " "}</Text>
            </View>
          </View>
          <View style={styles.kegBox}>
            <Text>1/6 bbl</Text>
            <View style={styles.kegCount}>
              <Text style={styles.kegCountText}>{sixtel > 0 ? formatQty(sixtel) : " "}</Text>
            </View>
          </View>
          <Text style={[styles.small, styles.muted]}>Count the empties collected at this stop; blank means none.</Text>
        </View>
      </View>
      <View wrap={false}>
        <Text style={styles.ack}>Quantities verified at delivery; alcoholic beverages received by a licensed entity.</Text>
        <Signatures blocks={[{ label: "Delivered by (driver)" }, { label: "Received by (account)" }]} />
      </View>
      {s.footer ? <Text style={styles.footerText}>{text(s.footer)}</Text> : null}
      <PageFooter left={`Delivery receipt ${number}`} generatedAt={s.generatedAt} generatedBy={s.generatedBy} />
    </Page>
  );
}

/** Warehouse-facing picking ticket (6.10), also used for a single shipment's pull sheet: no prices, no footer. */
function PickingTicket({ s, title }: { s: ShipmentSnapshot; title: "PICKING TICKET" | "PULL SHEET" }) {
  const number = numberWithRevision(s.number, s.revision);
  const stamp = stampFor(s);
  const columns: Array<Column<SnapshotLine>> = [
    { label: "", width: 18, render: () => <Tick /> },
    { label: "SKU", width: 80, render: (l) => text(l.skuCode) },
    { label: "Description", render: (l) => text(l.description) },
    { label: "Package", width: 100, render: (l) => text(l.packageLabel) },
    { label: "Lot", width: 80, render: (l) => text(l.lotCode) },
    { label: "Qty", width: 40, align: "right", render: (l) => formatQty(l.qty) },
  ];
  const totals = (
    <View style={[styles.cell, { flex: 1 }]}>
      <Text style={styles.bold}>Totals: {shipmentTotals(s)}</Text>
    </View>
  );
  const destination = [s.shipTo.name, s.shipTo.lines[0]].filter(Boolean).map((v) => text(v)).join(", ");
  return (
    <Page size="LETTER" style={styles.page}>
      {stamp ? <Stamp word={stamp} /> : null}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.muted}>{typeLabel(s.type)}{s.pickup ? ` ${EM_DASH} will call, picked up at origin` : ""}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.docNumber}>{number}</Text>
          <Text>Scheduled {formatDate(s.scheduledDate)}</Text>
        </View>
      </View>
      <Fields
        items={[
          { label: "Origin", value: `${text(s.shipFrom.name)}${s.shipFrom.originCode ? ` (${text(s.shipFrom.originCode)})` : ""}`, span: 2 },
          { label: "Scheduled date", value: formatDate(s.scheduledDate) },
          { label: "Pallet count", value: s.palletCount != null ? formatQty(s.palletCount) : null },
          { label: "Destination", value: destination, span: 2 },
          { label: "Pallet build", value: s.palletBuild, span: 2 },
          { label: "PO numbers", value: s.poNumbers.length ? s.poNumbers.map((p) => text(p)).join(", ") : null, span: 2 },
          { label: "Appointment", value: s.appointment },
          { label: "Carrier", value: s.carrier },
        ]}
      />
      <Table columns={columns} rows={s.lines} totals={totals} />
      {s.notes ? (
        <View style={{ marginBottom: 6 }}>
          <Text style={styles.sectionTitle}>Notes</Text>
          <Text>{text(s.notes)}</Text>
        </View>
      ) : null}
      <Signatures blocks={[{ label: "Picked by" }, { label: "Checked by" }]} />
      <PageFooter left={`${title === "PULL SHEET" ? "Pull sheet" : "Picking ticket"} ${number}`} generatedAt={s.generatedAt} generatedBy={s.generatedBy} />
    </Page>
  );
}

/** The day's master pull for one origin (5.2): aggregate by SKU and lot, then the stops. */
function PullSheetDay({ p }: { p: PullSheetSnapshot }) {
  type Agg = PullSheetSnapshot["aggregate"][number];
  const columns: Array<Column<Agg>> = [
    { label: "", width: 18, render: () => <Tick /> },
    { label: "SKU", width: 80, render: (r) => text(r.skuCode) },
    { label: "Description", render: (r) => text(r.description) },
    { label: "Lot", width: 90, render: (r) => text(r.lotCode) },
    { label: "Qty", width: 44, align: "right", render: (r) => formatQty(r.qty) },
  ];
  const totalQty = p.aggregate.reduce((n, r) => n + r.qty, 0);
  const totals = (
    <>
      <View style={[styles.cell, { flex: 1 }]}>
        <Text style={styles.bold}>
          {formatQty(p.aggregate.length)} SKU/lot line{p.aggregate.length === 1 ? "" : "s"}; {formatQty(p.stops.length)} stop{p.stops.length === 1 ? "" : "s"}
        </Text>
      </View>
      <View style={[styles.cell, { width: 44, textAlign: "right" }]}>
        <Text style={styles.bold}>{formatQty(totalQty)}</Text>
      </View>
    </>
  );
  const originLabel = `${text(p.origin)}${p.originCode ? ` (${text(p.originCode)})` : ""}`;
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>PULL SHEET</Text>
          <Text style={styles.muted}>Master pull for one origin and scheduled date; one picking ticket per stop follows.</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.docNumber}>{originLabel}</Text>
          <Text>{formatDate(p.scheduledDate)}</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Pull by SKU and lot</Text>
      <Table columns={columns} rows={p.aggregate} totals={totals} empty="No confirmed shipments for this origin and date" />
      <Text style={styles.sectionTitle}>Stops</Text>
      {p.stops.length === 0 ? <Text style={[styles.italic, styles.muted]}>No stops</Text> : null}
      {p.stops.map((stop, i) => (
        <View key={i} wrap={false}>
          <View style={styles.stopHeader}>
            <Text style={styles.bold}>
              Stop {i + 1} {EM_DASH} {text(stop.number, "draft")}
            </Text>
            <Text>{text(stop.destinationName)}</Text>
          </View>
          <View style={[styles.table, { borderTopWidth: 0, marginBottom: 2 }]}>
            {stop.lines.map((l, li) => (
              <View key={li} style={styles.tdRow}>
                <View style={[styles.cell, { width: 18 }]}>
                  <Tick />
                </View>
                <View style={[styles.cell, { width: 80 }]}>
                  <Text>{text(l.skuCode)}</Text>
                </View>
                <View style={[styles.cell, { flex: 1 }]}>
                  <Text>{text(l.lotCode)}</Text>
                </View>
                <View style={[styles.cell, { width: 44, textAlign: "right" }]}>
                  <Text>{formatQty(l.qty)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
      <PageFooter left={`Pull sheet ${originLabel} ${formatDate(p.scheduledDate)}`} generatedAt={p.generatedAt} generatedBy={p.generatedBy} />
    </Page>
  );
}

/** INV / NC invoice (7.x): no signature blocks, remit-to only when enabled, FOB wording for distributors, no arrows. */
function InvoiceDocument({ inv }: { inv: InvoiceSnapshot }) {
  const isDraft = inv.status === "draft" || !inv.number;
  const stamp = inv.status === "void" ? "VOID" : isDraft ? "DRAFT" : null;
  const title = inv.series === "NC" ? "NO-CHARGE INVOICE" : "INVOICE";
  const number = isDraft && !inv.number ? "DRAFT" : numberWithRevision(inv.number, inv.revision);
  const terms = inv.termsDays != null ? (inv.termsDays === 0 ? "Due on receipt" : `Net ${inv.termsDays}`) : null;
  const columns: Array<Column<InvoiceSnapshotLine>> = [
    { label: "#", width: 18, render: (l) => String(l.lineNo) },
    { label: "Description", render: (l) => text(l.description) },
    { label: "Lot", width: 80, render: (l) => text(l.lotCode, "") },
    { label: "Qty", width: 40, align: "right", render: (l) => formatQty(l.qty) },
    { label: "Unit price", width: 70, align: "right", render: (l) => formatMoney(l.unitPriceCents) },
    { label: "Amount", width: 80, align: "right", render: (l) => formatMoney(l.lineTotalCents) },
  ];
  const shipTo: PartyBlock = inv.shipTo ?? { name: "Will call", lines: [] };
  return (
    <Page size="LETTER" style={styles.page}>
      {stamp ? <Stamp word={stamp} /> : null}
      <Header
        issuer={inv.issuer}
        title={title}
        number={number}
        subtitle={inv.series === "NC" ? "Samples; nothing is owed" : null}
        meta={inv.revision > 0 ? [`Revision ${inv.revision} of ${text(inv.number)}`] : []}
      />
      <Fields
        items={[
          { label: "Invoice date", value: formatDate(inv.invoiceDate) },
          { label: "Due date", value: formatDate(inv.dueDate) },
          { label: "Terms", value: terms },
          { label: "Status", value: inv.status ? text(inv.status).replace(/^\w/, (c) => c.toUpperCase()) : null },
          { label: "Shipments", value: inv.shipmentNumbers.length ? inv.shipmentNumbers.map((n) => text(n)).join(", ") : null, span: 2 },
          { label: "PO numbers", value: inv.poNumbers.length ? inv.poNumbers.map((p) => text(p)).join(", ") : null, span: 2 },
        ]}
      />
      <View style={styles.twoCol}>
        <Party label="Bill to" party={inv.billTo} />
        <Party label="Ship to" party={shipTo} />
      </View>
      <View style={styles.table}>
        <View style={styles.thRow} wrap={false}>
          {columns.map((c, i) => (
            <View key={i} style={cellStyle(c)}>
              <Text style={styles.th}>{c.label}</Text>
            </View>
          ))}
        </View>
        {inv.lines.length === 0 ? (
          <View style={styles.tdRow}>
            <View style={[styles.cell, { flex: 1 }]}>
              <Text style={[styles.italic, styles.muted]}>No lines</Text>
            </View>
          </View>
        ) : null}
        {inv.lines.map((l, ri) =>
          l.kind === "info" ? (
            <View key={ri} style={styles.tdRow} wrap={false}>
              <View style={[styles.cell, { width: 18 }]}>
                <Text>{String(l.lineNo)}</Text>
              </View>
              <View style={[styles.cell, { flex: 1 }]}>
                <Text style={styles.italic}>{text(l.description)}</Text>
              </View>
            </View>
          ) : (
            <View key={ri} style={styles.tdRow} wrap={false}>
              {columns.map((c, ci) => (
                <View key={ci} style={cellStyle(c)}>
                  <Text>{c.render(l, ri)}</Text>
                </View>
              ))}
            </View>
          ),
        )}
        <View style={styles.totalsRow} wrap={false}>
          <View style={[styles.cell, { flex: 1 }]} />
          <View style={[styles.cell, { width: 150 }]}>
            <Text>Subtotal</Text>
            <Text>Keg deposit</Text>
            <Text style={styles.bold}>Total</Text>
          </View>
          <View style={[styles.cell, { width: 80, textAlign: "right" }]}>
            <Text>{formatMoney(inv.subtotalCents)}</Text>
            <Text>{formatMoney(inv.depositCents)}</Text>
            <Text style={styles.bold}>{formatMoney(inv.totalCents)}</Text>
          </View>
        </View>
      </View>
      {inv.fobWording ? <Text style={styles.bold}>{text(inv.fobWording)}</Text> : null}
      {inv.issuer.remitTo ? (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.sectionTitle}>Remit to</Text>
          <Text>{text(inv.issuer.remitTo)}</Text>
        </View>
      ) : null}
      <Text style={{ marginTop: 10 }}>Questions: {text(inv.issuer.arEmail)}</Text>
      <PageFooter left={`${title.charAt(0)}${title.slice(1).toLowerCase()} ${number}`} generatedAt={inv.generatedAt} generatedBy={inv.generatedBy} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function pagesFor(doc: SingleDocument): React.ReactElement {
  if (doc.kind === "invoice") return <InvoiceDocument inv={doc} />;
  if (doc.kind === "pull_sheet_day") return <PullSheetDay p={doc} />;
  if (doc.kind === "picking_ticket") return <PickingTicket s={doc} title="PICKING TICKET" />;
  if (doc.kind === "pull_sheet") return <PickingTicket s={doc} title="PULL SHEET" />;
  // kind "bol": the template is chosen by the destination kind (5.7)
  if (doc.template === "retail") return <DeliveryReceipt s={doc} />;
  return <BillOfLading s={doc} />;
}

function flatten(input: RenderInput): SingleDocument[] {
  if (input.kind === "pickup_pack") return input.invoice ? [input.bol, input.invoice] : [input.bol];
  if (input.kind === "batch") return input.documents;
  return [input];
}

function documentTitle(docs: SingleDocument[]): string {
  const first = docs[0];
  if (!first) return "Document";
  if (docs.length > 1) return `Documents (${docs.length})`;
  if (first.kind === "pull_sheet_day") return `Pull sheet ${clean(first.origin)} ${first.scheduledDate}`;
  if (first.kind === "invoice") return first.number ? clean(first.number) : "Draft invoice";
  return numberWithRevision(first.number, first.revision);
}

/** Render one or more snapshots into a single PDF. Throws when the input holds no documents. */
export async function renderDocument(input: RenderInput): Promise<Buffer> {
  const docs = flatten(input);
  if (docs.length === 0) throw new Error("Nothing to render");
  const element = (
    <Document title={documentTitle(docs)} creator="Leopard Mark Ops" producer="Leopard Mark Ops" language="en-US">
      {docs.map((d, i) => (
        <React.Fragment key={i}>{pagesFor(d)}</React.Fragment>
      ))}
    </Document>
  );
  return renderToBuffer(element);
}

registerRenderer(renderDocument);
