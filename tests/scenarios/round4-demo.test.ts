/**
 * The demo seed with the in-memory Stripe stand-in (what `npm run demo` runs): the Round 4 state it leaves behind is
 * exactly what the services produce: a bank on file, a paid invoice with its receipt waiting, a mirror waiting for
 * approval, legacy Stripe objects on the matching screen, a two-part order and a drafted intake email.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";
import { seedDemo } from "@/lib/demo/seed";
import { setStripeGateway } from "@/lib/integrations/stripe/gateway";
import { createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
const saved = { key: process.env.STRIPE_SECRET_KEY, fake: process.env.FV_STRIPE_FAKE, env: process.env.FV_ENV, node: process.env.NODE_ENV };

beforeAll(async () => {
  delete process.env.STRIPE_SECRET_KEY;
  process.env.FV_STRIPE_FAKE = "true";
  process.env.FV_ENV = "test";
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  setStripeGateway(null);
  if (saved.key !== undefined) process.env.STRIPE_SECRET_KEY = saved.key;
  if (saved.fake === undefined) delete process.env.FV_STRIPE_FAKE;
  else process.env.FV_STRIPE_FAKE = saved.fake;
  if (saved.env === undefined) delete process.env.FV_ENV;
  else process.env.FV_ENV = saved.env;
  await close();
});

describe("Demo seed with the fake Stripe gateway", () => {
  it("walks the collection flow end to end and leaves the Round 4 screens populated", async () => {
    const r = await seedDemo(db);
    expect(r.seeded).toBe(true);
    const locations = await db.select().from(schema.customerLocation);
    const dogpatch = locations.find((l) => l.tradeName === "Dogpatch Bottle Shop")!;
    const silverlake = locations.find((l) => l.tradeName === "Silver Lake Wine")!;
    const echo = locations.find((l) => l.tradeName === "Echo Park Cantina")!;
    // Bank on file for Dogpatch, verified through the hosted page.
    const [rel] = await db.select().from(schema.paymentRelationship).where(eq(schema.paymentRelationship.locationId, dogpatch.id));
    expect(rel.setupState).toBe("method_usable");
    expect(rel.bankLast4).toBe("4242");
    // Dogpatch's September invoice is paid through a debit; the receipt waits for approval.
    const invoices = await db.select().from(schema.invoice).where(eq(schema.invoice.locationId, dogpatch.id));
    const paid = invoices.find((i) => i.status === "paid");
    expect(paid).toBeTruthy();
    expect(paid!.collectionState).toBe("paid");
    expect(paid!.stripeNumber).toBe(paid!.number);
    const items = await db.select().from(schema.approvalItem);
    expect(items.some((i) => i.subjectId === paid!.id && i.kind === "email" && i.purpose === "payment_receipt" && i.state === "pending")).toBe(true);
    // Silver Lake's pickup invoice has its Stripe copy waiting.
    const [sl] = await db.select().from(schema.invoice).where(eq(schema.invoice.locationId, silverlake.id));
    expect(items.some((i) => i.subjectId === sl.id && i.kind === "stripe_invoice" && i.state === "pending")).toBe(true);
    // The two-part Echo Park order: one confirmed shipment and one draft.
    const echoOrders = await db.select().from(schema.order).where(eq(schema.order.locationId, echo.id));
    const links = await db.select().from(schema.shipmentOrder);
    const twoPart = echoOrders.find((o) => links.filter((l) => l.orderId === o.id).length === 2);
    expect(twoPart).toBeTruthy();
    // The intake email from a known sender carries a draft with the account and two lines.
    const intake = (await db.select().from(schema.orderIntakeRequest)).find((i) => i.fromEmail === "alex@dogpatchbottles.demo")!;
    const draft = intake.parsed as { locationId: string | null; lines: Array<{ qty: number }>; poNumber: string | null };
    expect(draft.locationId).toBe(dogpatch.id);
    expect(draft.lines.map((l) => l.qty).sort()).toEqual([2, 5]);
    expect(draft.poNumber).toBe("4471");
    // The connection check bound the fake account; nothing claims a capability gate was proven.
    const [conn] = await db.select().from(schema.providerConnection).where(eq(schema.providerConnection.provider, "stripe"));
    expect(conn.credentialFingerprint).toBe("fake-gateway");
    expect((await db.select().from(schema.capabilityGate)).every((g) => g.status === "unproven")).toBe(true);
  });
});
