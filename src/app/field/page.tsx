import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { Button, Code, Empty, Field, Flash, Input, Notice, Page, StatusBadge, fmtDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listShipments } from "@/lib/domain/shipments/service";
import { deliverAction } from "../shipments/[id]/actions";
import { isDriverOnly, shipmentNumber, todayIso } from "../shipments/labels";

/**
 * The driver's phone page (R2-38): the stops assigned to this person that are not yet delivered, oldest first, each
 * with what to drop, the receiving notes, and one form to mark it delivered with what the account kept, refused or
 * had damaged, and the empties collected. The office sees the same list for every driver and corrects afterwards
 * from the shipment page. No commercial data: no prices, no other accounts (REV-11).
 */
export default async function FieldPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("field.view_assigned");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const driver = isDriverOnly(actor);
  const all = await listShipments(d, actor, { limit: 200 });
  const stops = all
    .filter(({ s }) => ["confirmed", "staged", "out"].includes(s.status) && (driver ? s.driverEmployeeId === actor.employeeId : Boolean(s.driverEmployeeId)) && !s.pickup)
    .sort((a, b) => (a.s.scheduledDate ?? "").localeCompare(b.s.scheduledDate ?? "") || (a.s.number ?? "").localeCompare(b.s.number ?? ""));
  const ids = stops.map((x) => x.s.id);
  const lines = ids.length
    ? await d
        .select({ line: schema.shipmentLine, sku: schema.sku, pos: schema.posItem })
        .from(schema.shipmentLine)
        .leftJoin(schema.sku, eq(schema.sku.id, schema.shipmentLine.skuId))
        .leftJoin(schema.posItem, eq(schema.posItem.id, schema.shipmentLine.posItemId))
        .where(inArray(schema.shipmentLine.shipmentId, ids))
        .orderBy(schema.shipmentLine.lineNo)
    : [];
  const addresses = stops.length
    ? await d
        .select({ locationId: schema.locationAddress.locationId, a: schema.address })
        .from(schema.locationAddress)
        .innerJoin(schema.address, eq(schema.address.id, schema.locationAddress.addressId))
        .where(and(inArray(schema.locationAddress.locationId, stops.map((x) => x.s.destinationLocationId).filter((x): x is string => Boolean(x))), eq(schema.locationAddress.kind, "delivery"), eq(schema.locationAddress.current, true)))
    : [];
  const drivers = !driver && stops.length ? await d.select({ id: schema.employee.id, displayName: schema.employee.displayName }).from(schema.employee).where(inArray(schema.employee.id, stops.map((x) => x.s.driverEmployeeId).filter((x): x is string => Boolean(x)))) : [];
  const today = todayIso();
  const canDeliver = (marketId: string | null) => can(actor, "shipment.deliver", { marketId });

  return (
    <Page title={driver ? "My stops" : "Stops on the road"} subtitle={driver ? "Your assigned stops, oldest first. Mark each delivered as you go; the office corrects afterwards if anything was keyed wrong." : "Every stop assigned to a driver and not yet delivered. Drivers mark their own from the phone."} wide={false}>
      <Flash {...flash} />
      {stops.length === 0 ? <Empty>{driver ? "Nothing is assigned to you right now." : "No stops are out with a driver."}</Empty> : null}
      {stops.map(({ s, destination, origin }) => {
        const mine = lines.filter((l) => l.line.shipmentId === s.id);
        const addr = addresses.find((a) => a.locationId === s.destinationLocationId)?.a;
        const kegs = mine.some((l) => l.sku?.kegsPerUnit);
        const beerLines = mine.filter((l) => l.line.skuId);
        return (
          <section key={s.id} className="border-t border-rule pt-4" aria-labelledby={`stop-${s.id}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`stop-${s.id}`} className="text-base font-semibold text-ink">
                {destination?.tradeName ?? s.destinationText ?? "—"}
              </h2>
              <span className="flex items-center gap-3 text-xs text-ink-2">
                <Link href={`/shipments/${s.id}`} className="font-display text-navy hover:underline">
                  {shipmentNumber(s)}
                </Link>
                <StatusBadge value={s.status} />
                <span>{fmtDay(s.scheduledDate)}</span>
              </span>
            </div>
            <p className="mt-1 text-sm text-ink-2">
              {addr ? `${addr.line1}${addr.line2 ? `, ${addr.line2}` : ""}, ${addr.city}` : "No delivery address on file."}
              {destination?.deliveryInstructions ? ` ${destination.deliveryInstructions}` : ""}
              {destination?.receivingRestrictions ? ` ${destination.receivingRestrictions}` : ""}
              {!driver && s.driverEmployeeId ? ` Driver: ${drivers.find((x) => x.id === s.driverEmployeeId)?.displayName ?? "—"}.` : ""}
              {origin ? ` From ${origin.originCode ?? origin.name}.` : ""}
            </p>
            <ul className="mt-2 divide-y divide-rule-soft text-sm">
              {mine.map(({ line, sku, pos }) => (
                <li key={line.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    {sku ? `${sku.brand} ${sku.name}` : pos ? `${pos.name} (POS)` : "—"}
                    {line.lotCode ? (
                      <span className="ml-2">
                        <Code>{line.lotCode}</Code>
                      </span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{line.qty}</span>
                </li>
              ))}
            </ul>
            {canDeliver(s.marketId) ? (
              <details className="mt-3">
                <summary className="inline-flex h-11 cursor-pointer list-none items-center bg-navy px-4 text-sm font-medium text-paper [&::-webkit-details-marker]:hidden">Mark delivered</summary>
                <form action={deliverAction} className="mt-3 space-y-3">
                  <input type="hidden" name="shipmentId" value={s.id} />
                  <input type="hidden" name="returnTo" value="/field" />
                  <Field label="Delivered on">
                    <Input name="actualDate" type="date" required defaultValue={today} />
                  </Field>
                  {beerLines.length ? (
                    <div className="space-y-2">
                      <input type="hidden" name="perLine" value="1" />
                      <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem] gap-x-2 font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">
                        <span>Line</span>
                        <span className="text-right">Kept</span>
                        <span className="text-right">Refused</span>
                        <span className="text-right">Damaged</span>
                      </div>
                      {beerLines.map(({ line, sku }) => (
                        <fieldset key={line.id} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem_4rem] items-center gap-x-2 gap-y-1 border-b border-rule-soft pb-2">
                          <legend className="sr-only">{sku?.code}</legend>
                          <span className="truncate text-sm">
                            {sku?.code} <span className="text-xs text-ink-3">of {line.qty}</span>
                          </span>
                          <Input name={`delivered:${line.id}`} type="number" min={0} max={line.qty} step={1} inputMode="numeric" defaultValue={line.qty} className="h-11 text-right" aria-label={`${sku?.code} kept`} />
                          <Input name={`refused:${line.id}`} type="number" min={0} max={line.qty} step={1} inputMode="numeric" defaultValue={0} className="h-11 text-right" aria-label={`${sku?.code} refused`} />
                          <Input name={`damaged:${line.id}`} type="number" min={0} max={line.qty} step={1} inputMode="numeric" defaultValue={0} className="h-11 text-right" aria-label={`${sku?.code} damaged`} />
                          <Input name={`damageReason:${line.id}`} placeholder="Damage reason (if any)" className="col-span-4 h-11" aria-label={`${sku?.code} damage reason`} />
                        </fieldset>
                      ))}
                      <p className="text-xs text-ink-3">Kept + refused + damaged must equal the quantity on the BOL.</p>
                    </div>
                  ) : null}
                  {s.type !== "T" && destination && kegs ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Empty 1/2 bbl collected">
                        <Input name="halfIn" type="number" min={0} step={1} inputMode="numeric" defaultValue={0} className="h-11 text-right" />
                      </Field>
                      <Field label="Empty 1/6 bbl collected">
                        <Input name="sixtelIn" type="number" min={0} step={1} inputMode="numeric" defaultValue={0} className="h-11 text-right" />
                      </Field>
                    </div>
                  ) : null}
                  <Field label="Note">
                    <Input name="note" placeholder="Optional" className="h-11" />
                  </Field>
                  <Button>Delivered</Button>
                </form>
              </details>
            ) : null}
          </section>
        );
      })}
      {driver ? <Notice tone="info">You see only stops assigned to you. The BOL for each stop is on the shipment page.</Notice> : null}
    </Page>
  );
}
