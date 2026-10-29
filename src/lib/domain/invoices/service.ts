/**
 * Invoices (decisions 7.1 to 7.10, 3.9, 3.10, 1.5, 7.6).
 *
 * fv-ops owns the INV sequence; samples use the NC series and never share an invoice with charged goods. A draft is
 * created when a D or S shipment to an account is confirmed; it is issued when the shipment is delivered, dated the
 * actual delivery or pickup date, with terms from the account override or the market rule. Sending and collection
 * stay manual (7.5 is open).
 */
import "@/lib/documents";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { authorize } from "@/lib/authz/authorize";
import { marketScopeFor, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import { type DbOrTx, withTx } from "@/lib/db/types";
import { BusinessError, StaleStateError } from "@/lib/errors";
import { getCompanySettings, nextDocNumber } from "@/lib/domain/settings/service";
import { renderPdf } from "@/lib/documents/render";
import type { InvoiceSnapshot, InvoiceSnapshotLine } from "@/lib/documents/types";

export type Invoice = typeof schema.invoice.$inferSelect;
export type InvoiceLine = typeof schema.invoiceLine.$inferSelect;

export const DISTRIBUTOR_FOB = "FOB brewery or designated warehouse";

interface Computed {
  lines: Array<Omit<InvoiceLine, "id" | "invoiceId">>;
  subtotalCents: number;
  depositCents: number;
  totalCents: number;
  fobWording: string | null;
  termsDays: number;
}

async function loadShipmentContext(db: DbOrTx, shipmentId: string) {
  const [s] = await db.select().from(schema.shipment).where(eq(schema.shipment.id, shipmentId));
  if (!s) throw new BusinessError("Shipment not found");
  if (!s.destinationLocationId) throw new BusinessError("Only shipments to an account are invoiced");
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, s.destinationLocationId));
  if (!loc) throw new BusinessError("Account not found");
  const [market] = await db.select().from(schema.market).where(eq(schema.market.id, loc.marketId));
  if (!market) throw new BusinessError("Market not found");
  return { s, loc, market };
}

/** Lines, deposit and totals for the shipments on an invoice (3.10, 7.3, 7.7, 7.8). */
async function compute(db: DbOrTx, invoiceLocationId: string, shipmentIds: string[], series: "INV" | "NC"): Promise<Computed> {
  const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, invoiceLocationId));
  if (!loc) throw new BusinessError("Account not found");
  const [market] = await db.select().from(schema.market).where(eq(schema.market.id, loc.marketId));
  if (!market) throw new BusinessError("Market not found");
  const lines: Computed["lines"] = [];
  let n = 0;
  let subtotal = 0;
  let kegs = 0;
  let halfKegs = 0;
  let sixtelKegs = 0;
  for (const sid of shipmentIds) {
    const rows = await db
      .select({ l: schema.shipmentLine, sku: schema.sku, pos: schema.posItem, s: schema.shipment })
      .from(schema.shipmentLine)
      .innerJoin(schema.shipment, eq(schema.shipment.id, schema.shipmentLine.shipmentId))
      .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
      .leftJoin(schema.posItem, eq(schema.posItem.id, schema.shipmentLine.posItemId))
      .where(eq(schema.shipmentLine.shipmentId, sid))
      .orderBy(asc(schema.shipmentLine.lineNo));
    for (const { l, sku, pos, s } of rows) {
      n += 1;
      if (sku) {
        const unit = series === "NC" ? 0 : (l.unitPriceCents ?? 0);
        const total = unit * l.qty;
        subtotal += total;
        if (sku.kegsPerUnit > 0) {
          kegs += l.qty * sku.kegsPerUnit;
          if (sku.packageKind === "keg_half") halfKegs += l.qty;
          if (sku.packageKind === "keg_sixtel") sixtelKegs += l.qty;
        }
        lines.push({ lineNo: n, kind: "beer", shipmentLineId: l.id, skuId: sku.id, description: `${sku.brand} ${sku.name}${s.number ? ` (${s.number})` : ""}`, lotCode: l.lotCode, qty: l.qty, unitPriceCents: unit, lineTotalCents: total });
      } else if (pos) {
        lines.push({ lineNo: n, kind: "pos", shipmentLineId: l.id, skuId: null, description: `${pos.name} (no charge)`, lotCode: null, qty: l.qty, unitPriceCents: 0, lineTotalCents: 0 });
      }
    }
  }
  const isDistributor = loc.kind === "distributor";
  let deposit = 0;
  if (series === "INV" && kegs > 0) {
    const perKeg = loc.depositMode === "none" || loc.depositMode === "floating" ? 0 : loc.depositCentsOverride ?? (isDistributor ? market.distributorKegDepositCents : market.retailKegDepositCents);
    if (perKeg > 0) {
      deposit = perKeg * kegs;
      n += 1;
      lines.push({ lineNo: n, kind: "deposit", shipmentLineId: null, skuId: null, description: `Keg deposit (${kegs} keg${kegs === 1 ? "" : "s"} at ${(perKeg / 100).toFixed(2)})`, lotCode: null, qty: kegs, unitPriceCents: perKeg, lineTotalCents: deposit });
    }
  }
  if (isDistributor && kegs > 0) {
    n += 1;
    lines.push({ lineNo: n, kind: "info", shipmentLineId: null, skuId: null, description: `MicroStar kegs shipped: ${halfKegs} half barrel, ${sixtelKegs} sixtel. Deposit billed by MicroStar to the distributor.`, lotCode: null, qty: 0, unitPriceCents: 0, lineTotalCents: 0 });
  }
  if (loc.depositMode === "floating" && kegs > 0) {
    n += 1;
    lines.push({ lineNo: n, kind: "info", shipmentLineId: null, skuId: null, description: "Floating keg deposit on file; no per-keg deposit charged.", lotCode: null, qty: 0, unitPriceCents: 0, lineTotalCents: 0 });
  }
  return { lines, subtotalCents: subtotal, depositCents: deposit, totalCents: subtotal + deposit, fobWording: isDistributor ? DISTRIBUTOR_FOB : null, termsDays: loc.termsDaysOverride ?? market.termsDays };
}

async function writeLines(db: DbOrTx, invoiceId: string, c: Computed) {
  await db.delete(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, invoiceId));
  for (const l of c.lines) await db.insert(schema.invoiceLine).values({ ...l, invoiceId });
  await db.update(schema.invoice).set({ subtotalCents: c.subtotalCents, depositCents: c.depositCents, totalCents: c.totalCents, fobWording: c.fobWording, termsDays: c.termsDays, updatedAt: new Date() }).where(eq(schema.invoice.id, invoiceId));
}

/** Called inside the confirmation transaction. One draft per shipment by default (7.2); samples always on their own NC draft (7.3). */
export async function createDraftInvoiceForShipment(db: DbOrTx, actor: Actor, shipmentId: string) {
  const { s, loc } = await loadShipmentContext(db, shipmentId);
  const linked = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.shipmentId, shipmentId));
  if (linked.length) return linked[0].invoiceId;
  const series: "INV" | "NC" = s.type === "S" ? "NC" : "INV";
  const [inv] = await db
    .insert(schema.invoice)
    .values({ series, locationId: loc.id, marketId: loc.marketId, status: "draft", createdByEmployeeId: actor.employeeId })
    .returning();
  await db.insert(schema.invoiceShipment).values({ invoiceId: inv.id, shipmentId });
  await writeLines(db, inv.id, await compute(db, loc.id, [shipmentId], series));
  await recordAudit(db, actor, { action: "invoice.draft", subjectType: "invoice", subjectId: inv.id, current: { series, shipmentId }, marketId: loc.marketId });
  return inv.id;
}

/**
 * Add a delivered-or-confirmed shipment to an open draft for the same account within the same week (7.2). Samples
 * never join a charged invoice (7.3).
 */
export async function addShipmentToInvoice(db: DbOrTx, actor: Actor, invoiceId: string, shipmentId: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  authorize(actor, "invoice.issue", { marketId: inv.marketId });
  if (inv.status !== "draft") throw new BusinessError("Only a draft invoice can take another shipment");
  const { s, loc } = await loadShipmentContext(db, shipmentId);
  if (loc.id !== inv.locationId) throw new BusinessError("The shipment belongs to a different account");
  if ((s.type === "S") !== (inv.series === "NC")) throw new BusinessError("Samples never share an invoice with charged goods (7.3)");
  return withTx(db, async (tx) => {
    const current = await tx.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, invoiceId));
    const existingShipments = current.length ? await tx.select().from(schema.shipment).where(inArray(schema.shipment.id, current.map((c) => c.shipmentId))) : [];
    for (const e of existingShipments) {
      const a = new Date(e.scheduledDate + "T00:00:00Z").getTime();
      const b = new Date(s.scheduledDate + "T00:00:00Z").getTime();
      if (Math.abs(a - b) > 7 * 86_400_000) throw new BusinessError("Shipments on one invoice must fall within the same week (7.2)");
    }
    const other = await tx.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.shipmentId, shipmentId));
    for (const o of other) {
      const [oi] = await tx.select().from(schema.invoice).where(eq(schema.invoice.id, o.invoiceId));
      if (oi && oi.status === "draft" && oi.id !== invoiceId) {
        await tx.delete(schema.invoiceShipment).where(and(eq(schema.invoiceShipment.invoiceId, oi.id), eq(schema.invoiceShipment.shipmentId, shipmentId)));
        const remaining = await tx.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, oi.id));
        if (remaining.length === 0) await tx.update(schema.invoice).set({ status: "void", voidReason: "Merged into another draft", voidedAt: new Date(), voidedByEmployeeId: actor.employeeId }).where(eq(schema.invoice.id, oi.id));
        else await writeLines(tx, oi.id, await compute(tx, oi.locationId!, remaining.map((r) => r.shipmentId), oi.series));
      } else if (oi && oi.status !== "void") throw new BusinessError(`Shipment is already on ${oi.number ?? "another invoice"}`);
    }
    await tx.insert(schema.invoiceShipment).values({ invoiceId, shipmentId }).onConflictDoNothing();
    const all = await tx.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, invoiceId));
    await writeLines(tx, invoiceId, await compute(tx, inv.locationId!, all.map((a) => a.shipmentId), inv.series));
    await recordAudit(tx, actor, { action: "invoice.add_shipment", subjectType: "invoice", subjectId: invoiceId, current: { shipmentId }, marketId: inv.marketId });
    return invoiceId;
  });
}

/** Called inside the delivery transaction: the draft becomes an issued invoice dated the actual date (7.4). */
export async function issueInvoiceForShipment(db: DbOrTx, actor: Actor, shipmentId: string, actualDate: string) {
  const links = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.shipmentId, shipmentId));
  let invoiceId = links[0]?.invoiceId;
  if (!invoiceId) invoiceId = await createDraftInvoiceForShipment(db, actor, shipmentId);
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv || inv.status !== "draft") return inv ?? null;
  const all = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, invoiceId));
  const shipments = await db.select().from(schema.shipment).where(inArray(schema.shipment.id, all.map((a) => a.shipmentId)));
  // Issue only once every shipment on the draft is delivered (the shipment being delivered is updated before this call).
  if (shipments.some((s) => s.status !== "delivered" && s.id !== shipmentId)) return inv;
  return issueInvoice(db, actor, invoiceId, actualDate);
}

export async function issueInvoice(db: DbOrTx, actor: Actor, invoiceId: string, invoiceDate: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  authorize(actor, "invoice.issue", { marketId: inv.marketId });
  if (inv.status !== "draft") throw new StaleStateError(`Invoice is already ${inv.status}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) throw new BusinessError("Invoice date must be YYYY-MM-DD", { field: "invoiceDate" });
  return withTx(db, async (tx) => {
    const all = await tx.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, invoiceId));
    const c = await compute(tx, inv.locationId!, all.map((a) => a.shipmentId), inv.series);
    await writeLines(tx, invoiceId, c);
    const year = Number(invoiceDate.slice(0, 4));
    const number = await nextDocNumber(tx, inv.series, year);
    const due = new Date(invoiceDate + "T00:00:00Z");
    due.setUTCDate(due.getUTCDate() + c.termsDays);
    const [row] = await tx
      .update(schema.invoice)
      .set({ number, status: "issued", invoiceDate, dueDate: due.toISOString().slice(0, 10), termsDays: c.termsDays, issuedAt: new Date(), issuedByEmployeeId: actor.employeeId, updatedAt: new Date() })
      .where(and(eq(schema.invoice.id, invoiceId), eq(schema.invoice.status, "draft")))
      .returning();
    if (!row) throw new StaleStateError("Invoice was issued by someone else a moment ago");
    await storeInvoiceDocument(tx, actor, invoiceId);
    await recordAudit(tx, actor, { action: "invoice.issue", subjectType: "invoice", subjectId: invoiceId, prior: { status: "draft" }, current: { status: "issued", number, invoiceDate, totalCents: c.totalCents }, marketId: inv.marketId });
    return row;
  });
}

export async function voidInvoice(db: DbOrTx, actor: Actor, invoiceId: string, reason: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  authorize(actor, "invoice.void", { marketId: inv.marketId });
  if (inv.status === "void") throw new StaleStateError("Invoice is already void");
  if (inv.status === "paid") throw new BusinessError("A paid invoice cannot be voided; issue a credit instead");
  if (!reason.trim()) throw new BusinessError("A reason is required", { field: "reason" });
  const [row] = await db
    .update(schema.invoice)
    .set({ status: "void", voidReason: reason.trim(), voidedAt: new Date(), voidedByEmployeeId: actor.employeeId, updatedAt: new Date() })
    .where(eq(schema.invoice.id, invoiceId))
    .returning();
  await recordAudit(db, actor, { action: "invoice.void", subjectType: "invoice", subjectId: invoiceId, prior: { status: inv.status, number: inv.number }, current: { status: "void" }, reason: reason.trim(), marketId: inv.marketId });
  return row;
}

/** Called when a shipment is voided: its draft invoice is voided too; an issued one is left for a person to decide. */
export async function voidDraftInvoicesForShipment(db: DbOrTx, actor: Actor, shipmentId: string, reason: string) {
  const links = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.shipmentId, shipmentId));
  for (const l of links) {
    const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, l.invoiceId));
    if (inv && inv.status === "draft") {
      await db.update(schema.invoice).set({ status: "void", voidReason: reason, voidedAt: new Date(), voidedByEmployeeId: actor.employeeId, updatedAt: new Date() }).where(eq(schema.invoice.id, inv.id));
      await recordAudit(db, actor, { action: "invoice.void", subjectType: "invoice", subjectId: inv.id, prior: { status: "draft" }, current: { status: "void" }, reason, marketId: inv.marketId });
    }
  }
}

/** Manual payment status while collection stays outside fv-ops (7.5 open). */
export async function markInvoicePaid(db: DbOrTx, actor: Actor, invoiceId: string, note: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  authorize(actor, "invoice.issue", { marketId: inv.marketId });
  if (inv.status !== "issued") throw new StaleStateError(`Only an issued invoice can be marked paid (this one is ${inv.status})`);
  const [row] = await db.update(schema.invoice).set({ status: "paid", paidAt: new Date(), notes: note ? `${inv.notes ? inv.notes + "\n" : ""}${note}` : inv.notes, updatedAt: new Date() }).where(eq(schema.invoice.id, invoiceId)).returning();
  await recordAudit(db, actor, { action: "invoice.paid", subjectType: "invoice", subjectId: invoiceId, prior: { status: "issued" }, current: { status: "paid", note }, marketId: inv.marketId });
  return row;
}

// ---------------------------------------------------------------------------
// Snapshot and document
// ---------------------------------------------------------------------------

export async function buildInvoiceSnapshot(db: DbOrTx, invoiceId: string, generatedBy: string): Promise<InvoiceSnapshot> {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) throw new BusinessError("Invoice not found");
  const settings = await getCompanySettings(db);
  const lines = await db.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLine.lineNo));
  const links = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, invoiceId));
  const shipments = links.length ? await db.select().from(schema.shipment).where(inArray(schema.shipment.id, links.map((l) => l.shipmentId))) : [];
  let billTo: InvoiceSnapshot["billTo"] = { name: "—", lines: [] };
  let shipTo: InvoiceSnapshot["shipTo"] = null;
  if (inv.locationId) {
    const [loc] = await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId));
    const addrs = await db
      .select({ la: schema.locationAddress, a: schema.address })
      .from(schema.locationAddress)
      .innerJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
      .where(and(eq(schema.locationAddress.locationId, inv.locationId), eq(schema.locationAddress.current, true)));
    const fmt = (a: typeof schema.address.$inferSelect) => [a.line1, a.line2 ?? "", `${a.city}, ${a.state} ${a.postalCode}`].filter((l) => l && l.trim());
    const billing = addrs.find((x) => x.la.kind === "billing")?.a;
    const delivery = addrs.find((x) => x.la.kind === "delivery")?.a;
    const [lic] = await db.select().from(schema.licenseVerification).where(and(eq(schema.licenseVerification.locationId, inv.locationId), eq(schema.licenseVerification.current, true)));
    const ap = await db
      .select({ c: schema.contact })
      .from(schema.locationContact)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.locationContact.contactId))
      .where(and(eq(schema.locationContact.locationId, inv.locationId), eq(schema.locationContact.receivesInvoices, true), eq(schema.locationContact.current, true)))
      .limit(1);
    billTo = { name: loc?.tradeName ?? "—", legalName: loc?.legalName ?? null, lines: billing ? fmt(billing) : delivery ? fmt(delivery) : [], license: lic?.licenseNumber ?? null, contact: ap[0]?.c.email ?? null };
    shipTo = delivery ? { name: loc?.tradeName ?? "—", lines: fmt(delivery) } : null;
    if (shipments.some((s) => s.pickup)) shipTo = { name: "Will call (picked up at origin)", lines: [] };
  }
  const officeLines = [settings.officeLine1, settings.officeLine2, [settings.officeCity, [settings.officeState, settings.officePostalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter((l): l is string => Boolean(l && l.trim()));
  const snapLines: InvoiceSnapshotLine[] = lines.map((l) => ({ lineNo: l.lineNo, kind: l.kind as InvoiceSnapshotLine["kind"], description: l.description, lotCode: l.lotCode, qty: l.qty, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents }));
  return {
    version: 1,
    kind: "invoice",
    number: inv.number,
    series: inv.series,
    status: inv.status,
    revision: 0,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    termsDays: inv.termsDays,
    issuer: { legalName: settings.legalName, dba: settings.dba, lines: officeLines, arEmail: settings.arEmail, remitTo: settings.printRemitTo ? settings.remitTo : null },
    billTo,
    shipTo,
    shipmentNumbers: shipments.map((s) => s.number).filter((n): n is string => Boolean(n)),
    poNumbers: Array.from(new Set(shipments.flatMap((s) => s.poNumbers ?? []))),
    fobWording: inv.fobWording,
    lines: snapLines,
    subtotalCents: inv.subtotalCents,
    depositCents: inv.depositCents,
    totalCents: inv.totalCents,
    notes: inv.notes,
    generatedAt: new Date().toISOString(),
    generatedBy,
  };
}

export async function storeInvoiceDocument(db: DbOrTx, actor: Actor, invoiceId: string) {
  const snapshot = await buildInvoiceSnapshot(db, invoiceId, actor.displayName);
  let pdf: Buffer | null = null;
  try {
    pdf = await renderPdf(snapshot);
  } catch (err) {
    await recordAudit(db, actor, { action: "document.render_failed", subjectType: "invoice", subjectId: invoiceId, current: { error: err instanceof Error ? err.message : String(err) } });
  }
  const prior = await db.select({ revision: schema.shipmentDocument.revision }).from(schema.shipmentDocument).where(and(eq(schema.shipmentDocument.invoiceId, invoiceId), eq(schema.shipmentDocument.kind, "invoice"))).orderBy(desc(schema.shipmentDocument.revision)).limit(1);
  const revision = prior[0] ? prior[0].revision + 1 : 0;
  const [doc] = await db.insert(schema.shipmentDocument).values({ invoiceId, kind: "invoice", revision, number: snapshot.number, snapshot: { ...snapshot, revision }, pdf, createdByEmployeeId: actor.employeeId }).returning({ id: schema.shipmentDocument.id, revision: schema.shipmentDocument.revision });
  return doc;
}

export async function latestInvoiceDocument(db: DbOrTx, invoiceId: string) {
  const [row] = await db.select().from(schema.shipmentDocument).where(and(eq(schema.shipmentDocument.invoiceId, invoiceId), eq(schema.shipmentDocument.kind, "invoice"))).orderBy(desc(schema.shipmentDocument.revision)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface InvoiceFilter {
  status?: Invoice["status"];
  locationId?: string;
  series?: "INV" | "NC";
  includeLegacy?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listInvoices(db: DbOrTx, actor: Actor, f: InvoiceFilter = {}) {
  const scope = marketScopeFor(actor, ["owner", "admin", "accounting", "sales"]);
  const conds = [];
  if (actor.kind !== "system" && !actor.grants.some((g) => g.role === "owner") && scope !== "all") {
    if (scope.length === 0) return [];
    conds.push(inArray(schema.invoice.marketId, scope));
  }
  if (f.status) conds.push(eq(schema.invoice.status, f.status));
  if (f.locationId) conds.push(eq(schema.invoice.locationId, f.locationId));
  if (f.series) conds.push(eq(schema.invoice.series, f.series));
  if (!f.includeLegacy) conds.push(eq(schema.invoice.legacy, false));
  if (f.q) conds.push(sql`${schema.invoice.number} ilike ${"%" + f.q + "%"}`);
  return db
    .select({ inv: schema.invoice, location: schema.customerLocation })
    .from(schema.invoice)
    .leftJoin(schema.customerLocation, eq(schema.customerLocation.id, schema.invoice.locationId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.invoice.invoiceDate), desc(schema.invoice.createdAt))
    .limit(f.limit ?? 200)
    .offset(f.offset ?? 0);
}

export async function getInvoice(db: DbOrTx, invoiceId: string) {
  const [inv] = await db.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId));
  if (!inv) return null;
  const lines = await db.select().from(schema.invoiceLine).where(eq(schema.invoiceLine.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLine.lineNo));
  const [location] = inv.locationId ? await db.select().from(schema.customerLocation).where(eq(schema.customerLocation.id, inv.locationId)) : [];
  const links = await db.select().from(schema.invoiceShipment).where(eq(schema.invoiceShipment.invoiceId, invoiceId));
  const shipments = links.length ? await db.select().from(schema.shipment).where(inArray(schema.shipment.id, links.map((l) => l.shipmentId))) : [];
  const documents = await db
    .select({ id: schema.shipmentDocument.id, revision: schema.shipmentDocument.revision, createdAt: schema.shipmentDocument.createdAt, hasPdf: sql<boolean>`${schema.shipmentDocument.pdf} is not null` })
    .from(schema.shipmentDocument)
    .where(and(eq(schema.shipmentDocument.invoiceId, invoiceId), eq(schema.shipmentDocument.kind, "invoice")))
    .orderBy(desc(schema.shipmentDocument.revision));
  return { invoice: inv, lines, location: location ?? null, shipments, documents };
}

/** Open drafts for the same account that a newly confirmed shipment could join (7.2). */
export async function openDraftsForLocation(db: DbOrTx, locationId: string, series: "INV" | "NC") {
  return db.select().from(schema.invoice).where(and(eq(schema.invoice.locationId, locationId), eq(schema.invoice.status, "draft"), eq(schema.invoice.series, series), isNull(schema.invoice.number)));
}
