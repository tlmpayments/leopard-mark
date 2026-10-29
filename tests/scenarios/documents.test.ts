/**
 * Documents — acceptance item 6 of docs/SHIPMENTS_SPEC.md: every template renders from its snapshot, a voided
 * shipment's BOL prints VOID, a regenerated BOL prints R1, a pickup pack holds both documents, and batch print
 * returns one PDF for an origin and date. The route handlers are exercised with the session and database swapped
 * for the test fixture.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "@/lib/documents/pdf";
import type { Actor } from "@/lib/authz/actor";
import type { Action } from "@/lib/authz/actions";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { clean, formatDate, formatMoney, formatQty, formatWeight, renderDocument } from "@/lib/documents/pdf";
import { toPullSheetSnapshot } from "@/lib/documents/pull-sheet";
import { hasRenderer } from "@/lib/documents/render";
import type { InvoiceSnapshot, ShipmentSnapshot } from "@/lib/documents/types";
import { createOrigin, updateOrigin } from "@/lib/domain/origins/service";
import { recordPackagingReport } from "@/lib/domain/lots/service";
import { buildShipmentSnapshot, confirmShipment, createShipment, deliverShipment, getShipment, latestDocument, pullSheet, regenerateShipmentDocuments, updateShipmentHeader, voidShipment } from "@/lib/domain/shipments/service";
import { buildInvoiceSnapshot, latestInvoiceDocument } from "@/lib/domain/invoices/service";
import { createTestDb } from "../support/db";
import { buildFixture, makeLocation, type Fixture } from "../support/fixtures";

// The route handlers read the session through requireAction and the database through getDb; both are swapped for
// the fixture here. Authorization itself still runs for real.
const mocks = vi.hoisted(() => ({ actor: null as Actor | null, db: null as unknown }));
vi.mock("@/lib/auth/current", () => ({
  requireAction: async (action: Action, marketId?: string | null) => {
    if (!mocks.actor) throw new Error("No actor in the test session");
    authorize(mocks.actor, action, { marketId });
    return mocks.actor;
  },
}));
vi.mock("@/lib/db/client", () => ({ getDb: async () => mocks.db }));

import { GET as shipmentDocumentGET } from "@/app/shipments/[id]/documents/[kind]/route";
import { GET as invoicePdfGET } from "@/app/invoices/[id]/pdf/route";
import { GET as printGET } from "@/app/shipments/print/route";

let db: Db;
let close: () => Promise<void>;
let f: Fixture;
let lotHalf: string;
let lotSixtel: string;
let retail: typeof schema.customerLocation.$inferSelect;
let distributor: typeof schema.customerLocation.$inferSelect;
let tapHandle: typeof schema.posItem.$inferSelect;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  mocks.db = db;
  f = await buildFixture(db);
  mocks.actor = f.admin;
  await updateOrigin(db, f.owner, f.warehouse.id, { originCode: "EBB", kind: "brewery", lotFacilityCode: "01", addressLine1: "1001 Canal Blvd", addressCity: "Richmond", addressState: "CA", addressPostalCode: "94804" });
  await createOrigin(db, f.owner, { name: "Express Wine Delivery", kind: "warehouse", marketId: f.market.id, originCode: "EWD" });
  lotHalf = (await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "SLG", packagingDate: "2026-10-06", runCode: "1", quantities: [{ skuId: f.skus.sunlightHalf.id, qty: 24 }, { skuId: f.skus.sunlightCase.id, qty: 40 }] })).id;
  lotSixtel = (await recordPackagingReport(db, f.admin, { facilityWarehouseId: f.warehouse.id, brandCode: "CNT", packagingDate: "2026-10-07", runCode: "1", quantities: [{ skuId: f.skus.cantinescaSixtel.id, qty: 20 }, { skuId: f.skus.cantinescaCase.id, qty: 50 }] })).id;
  retail = (await makeLocation(db, f.sales, f.market.id, "Retail Tavern")).location;
  distributor = (await makeLocation(db, f.sales, f.market.id, "Big Distributor Inc")).location;
  await db.update(schema.customerLocation).set({ kind: "distributor", fulfilment: "pickup" }).where(eq(schema.customerLocation.id, distributor.id));
  [tapHandle] = await db.select().from(schema.posItem).where(eq(schema.posItem.code, "TAPHANDLE-STD"));
});
afterAll(() => close());

function header(over: Partial<Parameters<typeof createShipment>[2]> = {}) {
  return { type: "D" as const, originWarehouseId: f.warehouse.id, destinationLocationId: retail.id, scheduledDate: "2026-11-05", ...over };
}

function expectPdf(buf: Buffer) {
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(buf.length).toBeGreaterThan(500);
}

/** Page objects are plain dictionaries in the file even when streams are compressed. */
function pageCount(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
}

async function bodyOf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

describe("Formatting rules (§4)", () => {
  it("writes money, dates, quantities and weights the way the office reads them, and never prints an arrow", () => {
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(-250)).toBe("-$2.50");
    expect(formatDate("2026-11-05")).toBe("Nov 5, 2026");
    expect(formatDate("2026-01-31")).toBe("Jan 31, 2026");
    expect(formatDate(null)).toBe("—");
    expect(formatQty(12000)).toBe("12,000");
    expect(formatWeight(2172)).toBe("2,172.00");
    expect(formatWeight(58.5)).toBe("58.50");
    expect(clean("Richmond → Oakland")).toBe("Richmond to Oakland");
    expect(clean("dock ⟶ truck ➜ bar")).toBe("dock to truck to bar");
  });
});

describe("Acceptance 6 — documents render for each template", () => {
  let retailId: string;
  let distId: string;
  let retailSnapshot: ShipmentSnapshot;
  let distSnapshot: ShipmentSnapshot;
  let invSnapshot: InvoiceSnapshot;
  let distInvoiceId: string;

  it("stores PDF bytes with the snapshot at confirmation once the renderer is registered", async () => {
    expect(hasRenderer()).toBe(true);
    const s = await createShipment(db, f.admin, header({ deliveryWindow: "Tue to Thu, 10:00 to 14:00", receivingInstructions: "Back door; ring twice" }), [
      { skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 2 },
      { skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 },
      { skuId: f.skus.cantinescaCase.id, lotId: lotSixtel, qty: 3 },
      { posItemId: tapHandle.id, qty: 2 },
    ]);
    retailId = s.id;
    const confirmed = await confirmShipment(db, f.admin, s.id);
    expect(confirmed.number).toBe("EBB-D-261105-001");
    const bol = await latestDocument(db, s.id, "bol");
    expect(bol).not.toBeNull();
    expect(bol!.pdf).not.toBeNull();
    expectPdf(Buffer.from(bol!.pdf!));
    const ticket = await latestDocument(db, s.id, "picking_ticket");
    expect(ticket?.pdf).not.toBeNull();
    expectPdf(Buffer.from(ticket!.pdf!));
  });

  it("renders the retail delivery receipt and its picking ticket", async () => {
    retailSnapshot = await buildShipmentSnapshot(db, retailId, "bol", "Test");
    expect(retailSnapshot.template).toBe("retail");
    expect(retailSnapshot.kegPickup).toEqual({ halfIn: 0, sixtelIn: 0 });
    expectPdf(await renderDocument(retailSnapshot));
    expectPdf(await renderDocument(await buildShipmentSnapshot(db, retailId, "picking_ticket", "Test")));
    expectPdf(await renderDocument(await buildShipmentSnapshot(db, retailId, "pull_sheet", "Test")));
  });

  it("renders the distributor bill of lading for a will-call pickup with PO, carrier, pallet and NMFC fields", async () => {
    const s = await createShipment(
      db,
      f.admin,
      header({ destinationLocationId: distributor.id, pickup: true, poNumbers: ["TLM2002", "TLM2003"], appointment: "Thu 8:00 to 10:00", carrier: "Owner truck", carrierPhone: "415-555-0101", trailerNumber: "TR-88", palletCount: 2, palletBuild: "1 pallet kegs; 1 pallet mixed cases", freightClass: "70" }),
      [
        { skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 4 },
        { skuId: f.skus.cantinescaCase.id, lotId: lotSixtel, qty: 10 },
      ],
    );
    distId = s.id;
    const c = await confirmShipment(db, f.admin, s.id);
    expect(c.template).toBe("distributor");
    distSnapshot = await buildShipmentSnapshot(db, distId, "bol", "Test");
    expect(distSnapshot.pickup).toBe(true);
    expect(distSnapshot.nmfc?.status).toBe("proposed");
    expect(distSnapshot.fixedLines.length).toBeGreaterThan(0);
    expectPdf(await renderDocument(distSnapshot));
  });

  it("renders a transfer bill of lading", async () => {
    const [ewd] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.originCode, "EWD"));
    const t = await createShipment(db, f.admin, { type: "T", originWarehouseId: f.warehouse.id, destinationWarehouseId: ewd.id, scheduledDate: "2026-11-05" }, [{ skuId: f.skus.sunlightHalf.id, lotId: lotHalf, qty: 1 }]);
    await confirmShipment(db, f.admin, t.id);
    const snap = await buildShipmentSnapshot(db, t.id, "bol", "Test");
    expect(snap.template).toBe("transfer");
    expect(snap.type).toBe("T");
    expectPdf(await renderDocument(snap));
  });

  it("renders a draft invoice, an issued INV invoice and an NC invoice", async () => {
    const draftInvoice = (await getShipment(db, retailId))!.invoices[0];
    expect(draftInvoice.status).toBe("draft");
    const draftSnap = await buildInvoiceSnapshot(db, draftInvoice.id, "Test");
    expect(draftSnap.number).toBeNull();
    expectPdf(await renderDocument(draftSnap));

    await deliverShipment(db, f.admin, retailId, { actualDate: "2026-11-06", kegPickup: { halfIn: 1, sixtelIn: 0 } });
    const issued = (await getShipment(db, retailId))!.invoices[0];
    expect(issued.status).toBe("issued");
    const stored = await latestInvoiceDocument(db, issued.id);
    expect(stored?.pdf).not.toBeNull();
    expectPdf(Buffer.from(stored!.pdf!));
    invSnapshot = stored!.snapshot as InvoiceSnapshot;
    expect(invSnapshot.series).toBe("INV");
    expect(invSnapshot.lines.some((l) => l.kind === "deposit")).toBe(true);
    expectPdf(await renderDocument(invSnapshot));

    const sample = await createShipment(db, f.admin, header({ type: "S", scheduledDate: "2026-11-07" }), [{ skuId: f.skus.cantinescaCase.id, lotId: lotSixtel, qty: 1 }]);
    await confirmShipment(db, f.admin, sample.id);
    await deliverShipment(db, f.admin, sample.id, { actualDate: "2026-11-07" });
    const nc = (await getShipment(db, sample.id))!.invoices[0];
    const ncSnap = await buildInvoiceSnapshot(db, nc.id, "Test");
    expect(ncSnap.series).toBe("NC");
    expect(ncSnap.totalCents).toBe(0);
    expectPdf(await renderDocument(ncSnap));
  });

  it("packs the bill of lading and the invoice into one PDF with at least two pages", async () => {
    await deliverShipment(db, f.admin, distId, { actualDate: "2026-11-05" });
    const inv = (await getShipment(db, distId))!.invoices[0];
    distInvoiceId = inv.id;
    const invSnap = (await latestInvoiceDocument(db, inv.id))!.snapshot as InvoiceSnapshot;
    expect(invSnap.fobWording).toBe("FOB brewery or designated warehouse");
    expect(invSnap.shipTo?.name).toMatch(/Will call/);
    const pack = await renderDocument({ kind: "pickup_pack", bol: distSnapshot, invoice: invSnap });
    expectPdf(pack);
    expect(pageCount(pack)).toBeGreaterThanOrEqual(2);
    expect(pageCount(await renderDocument({ kind: "pickup_pack", bol: distSnapshot, invoice: null }))).toBe(1);
  });

  it("prints VOID on a voided shipment's BOL and R1 on a regenerated one", async () => {
    const v = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-08" }), [{ skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 }]);
    await confirmShipment(db, f.admin, v.id);
    await voidShipment(db, f.admin, v.id, "Customer cancelled");
    const doc = (await latestDocument(db, v.id, "bol"))!;
    expect(doc.revision).toBe(1);
    const snap = doc.snapshot as ShipmentSnapshot;
    expect(snap.voided).toBe(true);
    expect(snap.revision).toBe(1);
    expect(doc.pdf).not.toBeNull();
    expectPdf(await renderDocument(snap));

    const r = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-08" }), [{ skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 }]);
    await confirmShipment(db, f.admin, r.id);
    await updateShipmentHeader(db, f.admin, r.id, { carrier: "Owner truck", palletCount: 1 });
    const r1 = (await latestDocument(db, r.id, "bol"))!;
    expect(r1.revision).toBe(1);
    expect((r1.snapshot as ShipmentSnapshot).revision).toBe(1);
    expectPdf(Buffer.from(r1.pdf!));
    await regenerateShipmentDocuments(db, f.admin, r.id, "Reprint for the dock");
    const r2 = (await latestDocument(db, r.id, "picking_ticket"))!;
    expect(r2.revision).toBe(2);
    expectPdf(await renderDocument(r2.snapshot as ShipmentSnapshot));
  });

  it("renders the day's pull sheet and a batch of every document for an origin and date", async () => {
    const sheet = await pullSheet(db, f.admin, f.warehouse.id, "2026-11-05");
    expect(sheet.stops.length).toBe(3);
    const pull = toPullSheetSnapshot(sheet, "Test");
    expect(pull.kind).toBe("pull_sheet_day");
    expect(pull.aggregate.find((a) => a.skuCode === "SUN-HALF")?.qty).toBe(7);
    expectPdf(await renderDocument(pull));
    const batch = await renderDocument({ kind: "batch", documents: [pull, retailSnapshot, distSnapshot, invSnapshot] });
    expectPdf(batch);
    expect(pageCount(batch)).toBeGreaterThanOrEqual(4);
    await expect(renderDocument({ kind: "batch", documents: [] })).rejects.toThrow(/Nothing to render/);
  });

  describe("route handlers", () => {
    it("serves the latest BOL, picking ticket and pickup pack for a shipment, and 404s where there is none", async () => {
      for (const kind of ["bol", "picking_ticket", "pickup_pack"] as const) {
        const res = await shipmentDocumentGET(new NextRequest(`http://ops.test/shipments/${distId}/documents/${kind}`), { params: Promise.resolve({ id: distId, kind }) });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/pdf");
        expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="EBB-D-261105-002.*\.pdf"$/);
        const body = await bodyOf(res);
        expectPdf(body);
        if (kind === "pickup_pack") expect(pageCount(body)).toBeGreaterThanOrEqual(2);
      }
      const draft = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-09" }), [{ skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 }]);
      expect((await shipmentDocumentGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: draft.id, kind: "bol" }) })).status).toBe(404);
      expect((await shipmentDocumentGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: distId, kind: "invoice" }) })).status).toBe(404);
      expect((await shipmentDocumentGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: "not-a-uuid", kind: "bol" }) })).status).toBe(404);
      expect((await shipmentDocumentGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000", kind: "bol" }) })).status).toBe(404);
    });

    it("renders a stored document from its snapshot when the PDF bytes are missing", async () => {
      const doc = (await latestDocument(db, distId, "picking_ticket"))!;
      await db.update(schema.shipmentDocument).set({ pdf: null }).where(eq(schema.shipmentDocument.id, doc.id));
      const res = await shipmentDocumentGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: distId, kind: "picking_ticket" }) });
      expect(res.status).toBe(200);
      expectPdf(await bodyOf(res));
    });

    it("serves the invoice PDF: stored when issued, live with a DRAFT stamp for a draft", async () => {
      const issued = await invoicePdfGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: distInvoiceId }) });
      expect(issued.status).toBe(200);
      expect(issued.headers.get("content-disposition")).toMatch(/INV26\d+-invoice\.pdf/);
      expectPdf(await bodyOf(issued));
      const d = await createShipment(db, f.admin, header({ scheduledDate: "2026-11-09" }), [{ skuId: f.skus.cantinescaSixtel.id, lotId: lotSixtel, qty: 1 }]);
      await confirmShipment(db, f.admin, d.id);
      const draft = (await getShipment(db, d.id))!.invoices[0];
      expect(draft.status).toBe("draft");
      expect(await latestInvoiceDocument(db, draft.id)).toBeNull();
      const res = await invoicePdfGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: draft.id }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toBe('inline; filename="INV-draft-invoice.pdf"');
      expectPdf(await bodyOf(res));
      expect((await invoicePdfGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) })).status).toBe(404);
    });

    it("batch-prints an origin and date as one PDF, validates its query, and keeps drivers and other markets out", async () => {
      const url = (q: string) => new NextRequest(`http://ops.test/shipments/print?${q}`);
      const all = await printGET(url(`origin=${f.warehouse.id}&date=2026-11-05&kind=all`));
      expect(all.status).toBe(200);
      expect(all.headers.get("content-disposition")).toBe('inline; filename="EBB-2026-11-05-documents.pdf"');
      const body = await bodyOf(all);
      expectPdf(body);
      // Pull sheet + (BOL + picking ticket) for each of the three stops.
      expect(pageCount(body)).toBeGreaterThanOrEqual(7);
      expect(pageCount(await bodyOf(await printGET(url(`origin=${f.warehouse.id}&date=2026-11-05&kind=pull_sheet`))))).toBe(1);
      expect(pageCount(await bodyOf(await printGET(url(`origin=${f.warehouse.id}&date=2026-11-05&kind=bol`))))).toBeGreaterThanOrEqual(3);
      expect(pageCount(await bodyOf(await printGET(url(`origin=${f.warehouse.id}&date=2026-11-05`))))).toBeGreaterThanOrEqual(7);
      expect((await printGET(url(`origin=${f.warehouse.id}&date=2026-11-05&kind=invoice`))).status).toBe(400);
      expect((await printGET(url(`origin=${f.warehouse.id}&date=11/05/2026`))).status).toBe(400);
      expect((await printGET(url(`origin=nope&date=2026-11-05`))).status).toBe(400);
      expect((await printGET(url(`origin=00000000-0000-4000-8000-000000000000&date=2026-11-05`))).status).toBe(404);
      // A date with nothing confirmed still returns the (empty) pull sheet on "all" and 404 for per-shipment kinds.
      expect((await printGET(url(`origin=${f.warehouse.id}&date=2026-12-24&kind=bol`))).status).toBe(404);
      expect((await printGET(url(`origin=${f.warehouse.id}&date=2026-12-24&kind=all`))).status).toBe(200);
      mocks.actor = f.driver;
      expect((await printGET(url(`origin=${f.warehouse.id}&date=2026-11-05`))).status).toBe(403);
      expect((await shipmentDocumentGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: distId, kind: "bol" }) })).status).toBe(403);
      mocks.actor = f.sales2;
      await expect(printGET(url(`origin=${f.warehouse.id}&date=2026-11-05`))).rejects.toThrow(/Not authorized/);
      await expect(invoicePdfGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: distInvoiceId }) })).rejects.toThrow(/Not authorized/);
      mocks.actor = f.sales;
      expect((await invoicePdfGET(new NextRequest("http://ops.test/x"), { params: Promise.resolve({ id: distInvoiceId }) })).status).toBe(200);
      mocks.actor = f.admin;
    });
  });
});
