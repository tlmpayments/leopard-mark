import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { ActionPanel, Button, Card, Code, Columns, Empty, Field, Flash, Input, KV, Notice, RecordPage, Select, StatusBadge, Table, Tabs, Textarea, fmtDate, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { formatCents, listSkus } from "@/lib/domain/catalog/service";
import { lotPickerOptions } from "@/lib/domain/lots/service";
import { originLabel } from "@/lib/domain/origins/service";
import { getShipment } from "@/lib/domain/shipments/service";
import { listPosItems } from "@/lib/domain/settings/service";
import { TYPE_LABEL, isDriverOnly, todayIso } from "../labels";
import { confirmAction, correctDeliveryAction, deliverAction, outAction, receiveAction, regenerateAction, saveLinesAction, saveLogisticsAction, stageAction, voidAction } from "./actions";

const DOC_LABEL: Record<string, string> = { bol: "Bill of lading", picking_ticket: "Picking ticket", pickup_pack: "Pickup pack", delivery_pack: "Delivery pack", pull_sheet: "Pull sheet", invoice: "Invoice" };
const EDITABLE_LINES = ["draft", "confirmed", "staged"];
const EDITABLE_HEADER = ["draft", "confirmed", "staged", "out"];

export default async function ShipmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const d = await getDb();
  const detail = /^[0-9a-f-]{36}$/i.test(id) ? await getShipment(d, id) : null;
  if (!detail) notFound();
  const { shipment: s, origin, destination, destinationWarehouse, lines, allocations, documents, invoices, kegPickup, receipt, orders } = detail;
  const actor = await requireAction("shipment.view", s.marketId);
  if (isDriverOnly(actor) && s.driverEmployeeId !== actor.employeeId) notFound();
  const flash = await flashFrom(searchParams);

  const canManage = can(actor, "shipment.manage", { marketId: s.marketId }) && !s.legacy;
  const canConfirm = can(actor, "shipment.confirm", { marketId: s.marketId }) && !s.legacy;
  const canDeliver = can(actor, "shipment.deliver", { marketId: s.marketId }) && !s.legacy;
  const canVoid = can(actor, "shipment.void", { marketId: s.marketId }) && !s.legacy;
  const canReceive = can(actor, "shipment.receive", { marketId: destinationWarehouse?.marketId ?? s.marketId });
  const editLines = canManage && EDITABLE_LINES.includes(s.status);
  const editHeader = canManage && EDITABLE_HEADER.includes(s.status);

  const [skus, lots, posItems] = editLines ? await Promise.all([listSkus(d), lotPickerOptions(d), listPosItems(d)]) : [await listSkus(d), [], []];
  const activeSkus = skus.filter((x) => !x.archivedAt);
  const skuById = new Map(skus.map((x) => [x.id, x]));
  const [servedBy] = destination?.servedByLocationId ? await d.select({ tradeName: schema.customerLocation.tradeName }).from(schema.customerLocation).where(eq(schema.customerLocation.id, destination.servedByLocationId)) : [];
  const peopleIds = [s.createdByEmployeeId, s.confirmedByEmployeeId, s.deliveredByEmployeeId, s.voidedByEmployeeId, s.driverEmployeeId, receipt?.receivedByEmployeeId].filter((x): x is string => Boolean(x));
  const people = peopleIds.length ? await d.select({ id: schema.employee.id, displayName: schema.employee.displayName }).from(schema.employee).where(inArray(schema.employee.id, peopleIds)) : [];
  const nameOf = (eid: string | null | undefined) => (eid ? (people.find((p) => p.id === eid)?.displayName ?? "—") : "—");
  const drivers = editHeader
    ? Array.from(
        new Map(
          (
            await d
              .select({ id: schema.employee.id, displayName: schema.employee.displayName })
              .from(schema.roleGrant)
              .innerJoin(schema.employee, eq(schema.employee.id, schema.roleGrant.employeeId))
              .where(and(eq(schema.roleGrant.role, "driver_service"), isNull(schema.roleGrant.revokedAt), eq(schema.employee.enabled, true)))
          ).map((r) => [r.id, r]),
        ).values(),
      )
    : [];
  const receiptLines = receipt
    ? await d
        .select({ l: schema.shipmentReceiptLine, sku: schema.sku })
        .from(schema.shipmentReceiptLine)
        .innerJoin(schema.sku, eq(schema.sku.id, schema.shipmentReceiptLine.skuId))
        .where(eq(schema.shipmentReceiptLine.receiptId, receipt.id))
    : [];
  const history = await d.select().from(schema.auditEvent).where(and(eq(schema.auditEvent.subjectType, "shipment"), eq(schema.auditEvent.subjectId, s.id))).orderBy(desc(schema.auditEvent.at)).limit(30);
  const historyPeople = history.map((h) => h.actorEmployeeId).filter((x): x is string => Boolean(x) && !people.some((p) => p.id === x));
  const morePeople = historyPeople.length ? await d.select({ id: schema.employee.id, displayName: schema.employee.displayName }).from(schema.employee).where(inArray(schema.employee.id, historyPeople)) : [];
  const anyName = (eid: string | null) => (eid ? (people.find((p) => p.id === eid)?.displayName ?? morePeople.find((p) => p.id === eid)?.displayName ?? "—") : "System");

  const destinationLabel = destination ? destination.tradeName : destinationWarehouse ? originLabel(destinationWarehouse) : (s.destinationText ?? "—");
  const delivered = s.status === "delivered";
  const outcomeFields = (prefix: string, defaults: "planned" | "recorded") =>
    lines
      .filter((l) => l.line.skuId)
      .map(({ line, sku }) => (
        <fieldset key={line.id} className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] items-end gap-x-2 gap-y-1 border-b border-rule-soft pb-1.5">
          <legend className="sr-only">{sku?.code}</legend>
          <span className="truncate text-xs text-ink">
            {sku?.code} <span className="text-ink-3">of {line.qty}</span>
          </span>
          <Input name={`${prefix}delivered:${line.id}`} type="number" min={0} max={line.qty} step={1} defaultValue={defaults === "recorded" ? (line.deliveredQty ?? line.qty) : line.qty} className="text-right" aria-label={`${sku?.code} kept`} />
          <Input name={`${prefix}refused:${line.id}`} type="number" min={0} max={line.qty} step={1} defaultValue={defaults === "recorded" ? line.refusedQty : 0} className="text-right" aria-label={`${sku?.code} refused`} />
          <Input name={`${prefix}damaged:${line.id}`} type="number" min={0} max={line.qty} step={1} defaultValue={defaults === "recorded" ? line.damagedQty : 0} className="text-right" aria-label={`${sku?.code} damaged`} />
          <Input name={`${prefix}damageReason:${line.id}`} placeholder="Damage reason (when damaged)" defaultValue={defaults === "recorded" ? (line.damageReason ?? "") : ""} className="col-span-4" aria-label={`${sku?.code} damage reason`} />
        </fieldset>
      ));
  const servedWarning = Boolean(s.type === "D" && destination?.servedByLocationId && destination.kind !== "distributor");
  const today = todayIso();
  const expectedBySku = new Map<string, number>();
  for (const l of lines) if (l.line.skuId) expectedBySku.set(l.line.skuId, (expectedBySku.get(l.line.skuId) ?? 0) + l.line.qty);
  const rowCount = Math.max(10, lines.length + 2);
  const lotBrands = Array.from(new Set(lots.map((l) => l.brandCode)));
  const latestByKind = new Map<string, (typeof documents)[number]>();
  for (const doc of documents) if (!latestByKind.has(doc.kind)) latestByKind.set(doc.kind, doc);
  const docHref = (kind: string) => `/shipments/${s.id}/documents/${kind}`;
  const liveInvoices = invoices.filter((i) => i.status !== "void");
  const totals = lines.reduce((acc, { line, sku }) => ({ qty: acc.qty + line.qty, kegs: acc.kegs + (sku && (sku.packageKind === "keg_half" || sku.packageKind === "keg_sixtel") ? line.qty : 0) }), { qty: 0, kegs: 0 });

  const linesTable = (
    <>
      <Table
        caption="Shipment lines"
        head={delivered ? ["#", "SKU / POS", "Description", "Lot", "Shipped", "Kept", "Refused", "Damaged", "Unit price"] : ["#", "SKU / POS", "Description", "Lot", "Qty", "Unit price", "Weight lb", "Lot reason"]}
        widths={delivered ? ["2.5rem", LIST_WIDTHS.code, undefined, LIST_WIDTHS.number, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.money] : ["2.5rem", LIST_WIDTHS.code, undefined, LIST_WIDTHS.number, LIST_WIDTHS.qty, LIST_WIDTHS.money, LIST_WIDTHS.qty, "16rem"]}
        align={delivered ? ["right", "left", "left", "left", "right", "right", "right", "right", "right"] : ["right", "left", "left", "left", "right", "right", "right", "left"]}
        empty="No lines yet."
        rows={lines.map(({ line, sku, pos, lot }) => {
          const lotCell = lot ? (
            <Link key="l" href={`/lots/${lot.id}`} className="text-navy hover:underline">
              <Code>{lot.lotCode}</Code>
              {!lot.quantitiesKnown ? <span className="ml-1.5 text-[11px] text-ink-3">quantities unconfirmed</span> : null}
            </Link>
          ) : (
            <Code key="nl">{line.lotCode ?? (sku ? "no lot" : "—")}</Code>
          );
          const head = [String(line.lineNo), <Code key="c">{sku?.code ?? pos?.code ?? "—"}</Code>, sku ? `${sku.brand} ${sku.name}` : pos ? `${pos.name} (POS)` : "—", lotCell];
          if (delivered)
            return [
              ...head,
              String(line.qty),
              String(line.deliveredQty ?? line.qty),
              line.refusedQty ? <span key="r" className="font-semibold">{line.refusedQty}</span> : "0",
              line.damagedQty ? (
                <span key="d" className="font-semibold" title={line.damageReason ?? undefined}>
                  {line.damagedQty}
                </span>
              ) : (
                "0"
              ),
              line.unitPriceCents != null ? formatCents(line.unitPriceCents) : "—",
            ];
          return [...head, String(line.qty), line.unitPriceCents != null ? formatCents(line.unitPriceCents) : "—", line.weightLb ?? "—", line.lotReason ?? "—"];
        })}
      />
      {delivered && lines.some((l) => l.line.damagedQty) ? (
        <p className="mt-2 text-xs text-ink-3">Damaged: {lines.filter((l) => l.line.damagedQty).map((l) => `${l.sku?.code ?? ""} ${l.line.damagedQty} (${l.line.damageReason ?? "no reason"})`).join("; ")}. Written off at the origin with the reason; nothing invoiced (R2-9).</p>
      ) : null}
      {delivered && lines.some((l) => l.line.refusedQty) ? <p className="mt-1 text-xs text-ink-3">Refused units never left the origin&apos;s stock and stay an open line on the order (R2-8).</p> : null}
      {lines.length ? (
        <p className="mt-2 text-xs text-ink-3">
          {totals.qty} units{totals.kegs ? `, ${totals.kegs} kegs` : ""}
        </p>
      ) : null}
      {editLines ? (
        <details className="mt-4" open={lines.length === 0}>
          <summary className="cursor-pointer text-sm text-navy">{lines.length ? "Edit lines (replaces all lines)" : "Add lines"}</summary>
          <form action={saveLinesAction} className="mt-3 space-y-3">
            <input type="hidden" name="shipmentId" value={s.id} />
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead>
                  <tr className="text-left font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">
                    <th className="py-1 pr-2 font-semibold">SKU</th>
                    <th className="py-1 pr-2 font-semibold">Lot</th>
                    <th className="py-1 pr-2 font-semibold">POS item</th>
                    <th className="py-1 pr-2 font-semibold">Qty</th>
                    <th className="py-1 font-semibold">Lot reason (4.6)</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: rowCount }, (_, i) => {
                    const existing = lines[i]?.line;
                    return (
                      <tr key={i} className="align-top">
                        <td className="py-1 pr-2">
                          <Select name={`sku:${i}`} defaultValue={existing?.skuId ?? ""} aria-label={`Row ${i + 1} SKU`}>
                            <option value="">—</option>
                            {activeSkus.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.code} {x.brand} {x.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-1 pr-2">
                          <Select name={`lot:${i}`} defaultValue={existing?.lotId ?? ""} aria-label={`Row ${i + 1} lot`}>
                            <option value="">no lot</option>
                            {lotBrands.map((b) => (
                              <optgroup key={b} label={b}>
                                {lots
                                  .filter((l) => l.brandCode === b)
                                  .map((l) => (
                                    <option key={l.lotId} value={l.lotId}>
                                      {l.lotCode} {l.facilityName} {fmtDay(l.packagingDate)}
                                      {l.quantitiesKnown ? "" : " (quantities unconfirmed)"}
                                    </option>
                                  ))}
                              </optgroup>
                            ))}
                          </Select>
                        </td>
                        <td className="py-1 pr-2">
                          <Select name={`pos:${i}`} defaultValue={existing?.posItemId ?? ""} aria-label={`Row ${i + 1} POS item`}>
                            <option value="">—</option>
                            {posItems.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.code} {p.name}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-1 pr-2">
                          <Input name={`qty:${i}`} type="number" min={1} step={1} inputMode="numeric" defaultValue={existing?.qty ?? ""} className="w-20 text-right" aria-label={`Row ${i + 1} quantity`} />
                        </td>
                        <td className="py-1">
                          <Input name={`reason:${i}`} defaultValue={existing?.lotReason ?? ""} placeholder="Only when the lot's quantities are unconfirmed" aria-label={`Row ${i + 1} lot reason`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button small>Save lines</Button>
              <span className="text-xs text-ink-3">Blank rows are ignored. A row is a SKU with its lot, or a POS item (no lot, no price). {s.status !== "draft" ? "Saving after confirmation re-allocates stock and regenerates the documents with the next revision mark." : ""}</span>
            </div>
          </form>
        </details>
      ) : null}
    </>
  );

  const documentsTab = (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        {documents.length === 0 ? (
          <Empty>Documents exist from confirmation onward.</Empty>
        ) : (
          <ul className="divide-y divide-rule-soft text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span>
                  {DOC_LABEL[doc.kind] ?? doc.kind} <span className="font-display tabular-nums">{doc.number ?? ""}</span>
                  {doc.revision > 0 ? <span className="ml-1.5 text-[11px] text-ink-3">R{doc.revision}</span> : null}
                  <span className="block text-xs text-ink-3">
                    {fmtDate(doc.createdAt)}
                    {doc.hasPdf ? "" : ", rendered on request"}
                  </span>
                </span>
                {latestByKind.get(doc.kind)?.id === doc.id && (doc.kind === "bol" || doc.kind === "picking_ticket") ? (
                  <a href={docHref(doc.kind)} target="_blank" rel="noopener" className="text-navy hover:underline">
                    Open PDF (latest)
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {latestByKind.has("bol") && destination ? (
          <p className="mt-3 flex flex-wrap gap-x-4 text-sm">
            {s.pickup ? (
              <a href={docHref("pickup_pack")} target="_blank" rel="noopener" className="text-navy hover:underline">
                Pickup pack (BOL followed by the invoice, one PDF)
              </a>
            ) : (
              <a href={docHref("delivery_pack")} target="_blank" rel="noopener" className="text-navy hover:underline">
                Delivery pack ({destination.invoiceOnReceipt ? "BOL followed by the invoice; the account takes its invoice on receipt, R2-30" : "BOL; this account does not take the invoice on receipt"})
              </a>
            )}
          </p>
        ) : null}
      </div>
      <div>
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Invoices</div>
        {invoices.length ? (
          <ul className="divide-y divide-rule-soft text-sm">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <span className="flex items-baseline gap-3">
                  <Link href={`/invoices/${inv.id}`} className="font-display text-navy hover:underline">
                    {inv.number ?? `${inv.series} draft`}
                  </Link>
                  <StatusBadge value={inv.status} />
                  {inv.totalCents ? <span className="tabular-nums text-ink-2">{formatCents(inv.totalCents)}</span> : null}
                </span>
                {inv.status !== "void" ? (
                  <a href={`/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-xs text-navy hover:underline">
                    PDF
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (s.type === "D" || s.type === "S") && destination && s.status !== "draft" && liveInvoices.length === 0 ? (
          <Empty>No live invoice for this shipment.</Empty>
        ) : (
          <Empty>{s.type === "T" ? "Transfers are not invoiced." : "The invoice draft opens at confirmation."}</Empty>
        )}
      </div>
    </div>
  );

  const relatedTab = (
    <div className="grid gap-8 lg:grid-cols-3">
      <div>
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Active allocations at the origin</div>
        {allocations.length === 0 ? (
          <Empty>None; allocations exist from confirmation to delivery or void.</Empty>
        ) : (
          <ul className="text-sm">
            {allocations.map((a) => (
              <li key={a.id} className="flex justify-between border-b border-rule-soft py-1">
                <Code>{skuById.get(a.skuId)?.code ?? a.skuId}</Code>
                <span className="tabular-nums">{a.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Linked orders</div>
        {orders.length === 0 ? (
          <Empty>No orders linked; a shipment can stand alone.</Empty>
        ) : (
          <ul className="text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex justify-between border-b border-rule-soft py-1">
                <Link href={`/orders/${o.id}`} className="text-navy hover:underline">
                  {o.orderNumber}
                </Link>
                <StatusBadge value={o.demandState} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-2">Kegs and receipt</div>
        {kegPickup ? (
          <p className="text-sm">
            Empties collected at the stop: {kegPickup.halfIn} × 1/2 bbl, {kegPickup.sixtelIn} × 1/6 bbl
            {destination ? (
              <>
                {" "}
                <Link href={`/kegs/${destination.id}`} className="text-navy hover:underline">
                  (keg balance)
                </Link>
              </>
            ) : null}
          </p>
        ) : destination && (s.type === "D" || s.type === "S") ? (
          <p className="text-sm">
            <Link href={`/kegs/${destination.id}`} className="text-navy hover:underline">
              Keg balance for {destination.tradeName}
            </Link>
          </p>
        ) : (
          <Empty>No keg movement on this shipment.</Empty>
        )}
        {receipt ? (
          <div className="mt-3 text-sm">
            <p>
              Received {fmtDay(receipt.receivedOn)} by {nameOf(receipt.receivedByEmployeeId)}
              {receipt.discrepancyNote ? `, ${receipt.discrepancyNote}` : ""}
            </p>
            <ul>
              {receiptLines.map(({ l, sku }) => (
                <li key={l.id} className="flex justify-between border-b border-rule-soft py-1">
                  <Code>{sku.code}</Code>
                  <span className="tabular-nums">
                    expected {l.qtyExpected}, received {l.qtyReceived}
                    {l.qtyExpected !== l.qtyReceived ? <span className="ml-1.5 font-semibold text-ink">discrepancy</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );

  const historyTab = (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <KV
          columns={1}
          items={[
            ["Created", `${nameOf(s.createdByEmployeeId)}, ${fmtDate(s.createdAt)}`],
            ["Confirmed", s.confirmedAt ? `${nameOf(s.confirmedByEmployeeId)}, ${fmtDate(s.confirmedAt)}` : "—"],
            ["Delivered", s.deliveredAt ? `${nameOf(s.deliveredByEmployeeId)}, ${fmtDate(s.deliveredAt)}` : "—"],
            ["Voided", s.voidedAt ? `${nameOf(s.voidedByEmployeeId)}, ${fmtDate(s.voidedAt)}` : "—"],
          ]}
        />
      </div>
      <div className="lg:col-span-2">
        {history.length ? (
          <ul className="divide-y divide-rule-soft text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                <span>
                  <span className="font-medium">{h.action.replace("shipment.", "").replace(/_/g, " ")}</span>
                  {h.reason ? <span className="text-ink-2">, {h.reason}</span> : null}
                </span>
                <span className="text-xs text-ink-3">
                  {anyName(h.actorEmployeeId)}, {fmtDate(h.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No history recorded.</Empty>
        )}
      </div>
    </div>
  );

  const editTab = editHeader ? (
    <form action={saveLogisticsAction} className="grid max-w-4xl gap-x-6 gap-y-3 sm:grid-cols-2">
      <input type="hidden" name="shipmentId" value={s.id} />
      <Field label="Scheduled date" hint={s.status === "draft" ? "Drives the number at confirmation." : "The number keeps its original date (5.12)."}>
        <Input name="scheduledDate" type="date" required defaultValue={s.scheduledDate ?? ""} />
      </Field>
      <Field label="Driver">
        <Select name="driverEmployeeId" defaultValue={s.driverEmployeeId ?? ""}>
          <option value="">Unassigned</option>
          {drivers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.displayName}
            </option>
          ))}
          {s.driverEmployeeId && !drivers.some((e) => e.id === s.driverEmployeeId) ? <option value={s.driverEmployeeId}>{nameOf(s.driverEmployeeId)} (no current driver grant)</option> : null}
        </Select>
      </Field>
      {s.status === "draft" ? (
        <>
          <Field label="Override reason" hint="Required when the account is served by a distributor (2.6).">
            <Input name="overrideReason" defaultValue={s.overrideReason ?? ""} />
          </Field>
          <Field label="Will-call">
            <input type="hidden" name="pickupField" value="1" />
            <label className="flex h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="pickup" defaultChecked={s.pickup} /> Picked up at the origin
            </label>
          </Field>
          {s.type === "S" && !destination ? (
            <Field label="Person / event">
              <Input name="destinationText" defaultValue={s.destinationText ?? ""} />
            </Field>
          ) : null}
        </>
      ) : null}
      <Field label="PO numbers (comma separated)">
        <Input name="poNumbers" defaultValue={s.poNumbers?.join(", ") ?? ""} />
      </Field>
      <Field label="Appointment">
        <Input name="appointment" defaultValue={s.appointment ?? ""} />
      </Field>
      <Field label="Carrier">
        <Input name="carrier" defaultValue={s.carrier ?? ""} />
      </Field>
      <Field label="Carrier phone">
        <Input name="carrierPhone" defaultValue={s.carrierPhone ?? ""} />
      </Field>
      <Field label="Seal number">
        <Input name="sealNumber" defaultValue={s.sealNumber ?? ""} />
      </Field>
      <Field label="Trailer number">
        <Input name="trailerNumber" defaultValue={s.trailerNumber ?? ""} />
      </Field>
      <Field label="Pallet count">
        <Input name="palletCount" type="number" min={0} step={1} defaultValue={s.palletCount ?? ""} />
      </Field>
      <Field label="Pallet build">
        <Input name="palletBuild" defaultValue={s.palletBuild ?? ""} />
      </Field>
      <Field label="Freight class">
        <Input name="freightClass" defaultValue={s.freightClass ?? ""} />
      </Field>
      <Field label="Delivery window">
        <Input name="deliveryWindow" defaultValue={s.deliveryWindow ?? ""} />
      </Field>
      <Field label="Receiving instructions">
        <Textarea name="receivingInstructions" rows={2} defaultValue={s.receivingInstructions ?? ""} />
      </Field>
      <Field label="Notes">
        <Textarea name="notes" rows={2} defaultValue={s.notes ?? ""} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button small>Save</Button>
        <span className="text-xs text-ink-3">{s.status !== "draft" ? "Route (type, origin, destination) cannot change after confirmation; void and re-create instead. Documents regenerate with the next revision." : ""}</span>
      </div>
    </form>
  ) : null;

  const tabs = [
    { id: "lines", label: "Lines", count: lines.length, content: linesTable },
    { id: "documents", label: "Documents", count: documents.length + invoices.length, content: documentsTab },
    { id: "related", label: "Allocations, orders and kegs", content: relatedTab },
    ...(editTab ? [{ id: "edit", label: s.status === "draft" ? "Edit header" : "Edit logistics", content: editTab }] : []),
    { id: "history", label: "History", count: history.length, content: historyTab },
  ];

  return (
    <RecordPage
      number={s.number ?? "Draft"}
      status={
        <span className="flex items-center gap-3">
          <StatusBadge value={s.status} />
          {s.revision > 0 ? <span className="text-[12px] text-ink-3">R{s.revision}</span> : null}
        </span>
      }
      meta={
        <>
          <span>
            {s.type} {TYPE_LABEL[s.type]}
            {s.pickup ? ", will-call" : ""}
          </span>
          <span className="text-ink-3">{s.template} template</span>
          {s.legacy ? <span className="text-ink-3">imported history</span> : null}
          <span>
            {originLabel(origin)} to {destinationLabel}
          </span>
          <span>{s.scheduledDate ? `scheduled ${fmtDay(s.scheduledDate)}` : "scheduled date set at confirmation"}</span>
          {orders.length ? (
            <span>
              for{" "}
              {orders.map((o, i) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="font-display text-navy hover:underline">
                  {i ? ", " : ""}
                  {o.orderNumber}
                </Link>
              ))}
            </span>
          ) : null}
        </>
      }
      actions={
        <>
          {latestByKind.has("bol") ? (
            <Button href={docHref("bol")} variant="secondary">
              BOL PDF
            </Button>
          ) : null}
          {latestByKind.has("picking_ticket") ? (
            <Button href={docHref("picking_ticket")} variant="secondary">
              Picking ticket PDF
            </Button>
          ) : null}
          {s.status === "draft" && canConfirm ? (
            <ActionPanel label="Confirm" variant="primary">
              <form action={confirmAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Scheduled date" hint="Numbers the shipment, allocates stock, stores the BOL and picking ticket (R2-3).">
                  <Input name="scheduledDate" type="date" required defaultValue={s.scheduledDate ?? today} />
                </Field>
                <Button small>Confirm (assign number)</Button>
              </form>
            </ActionPanel>
          ) : null}
          {s.status === "confirmed" && canManage ? (
            <form action={stageAction}>
              <input type="hidden" name="shipmentId" value={s.id} />
              <Button variant="secondary">Mark staged</Button>
            </form>
          ) : null}
          {(s.status === "confirmed" || s.status === "staged") && canManage ? (
            <form action={outAction}>
              <input type="hidden" name="shipmentId" value={s.id} />
              <Button variant="secondary">Mark out</Button>
            </form>
          ) : null}
          {["confirmed", "staged", "out"].includes(s.status) && canDeliver ? (
            <ActionPanel label="Deliver" variant="primary">
              <form action={deliverAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Actual date" hint={isDriverOnly(actor) ? "Today, unless the office says otherwise." : "The office sets the actual date (5.11)."}>
                  <Input name="actualDate" type="date" required defaultValue={today} />
                </Field>
                {s.type !== "T" && lines.some((l) => l.line.skuId) ? (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-x-2 font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">
                      <span>Line</span>
                      <span className="text-right">Kept</span>
                      <span className="text-right">Refused</span>
                      <span className="text-right">Damaged</span>
                    </div>
                    <input type="hidden" name="perLine" value="1" />
                    {outcomeFields("", "planned")}
                    <p className="text-xs text-ink-3">Kept + refused + damaged = shipped. Refused goes back to the origin&apos;s stock; damaged is written off with the reason (R2-8, R2-9).</p>
                  </div>
                ) : null}
                {s.type !== "T" && destination ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Empty 1/2 bbl collected">
                      <Input name="halfIn" type="number" min={0} step={1} defaultValue={0} className="text-right" />
                    </Field>
                    <Field label="Empty 1/6 bbl collected">
                      <Input name="sixtelIn" type="number" min={0} step={1} defaultValue={0} className="text-right" />
                    </Field>
                  </div>
                ) : null}
                <Field label="Note">
                  <Input name="note" placeholder="Optional" />
                </Field>
                <Button small>Mark delivered</Button>
                <p className="text-xs text-ink-3">Stock leaves the origin for what was kept{s.type === "T" ? "; it sits in transit at the destination until received" : "; the keg balance moves and the invoice is issued for the delivered quantities, dated the actual date"}. The number never changes.</p>
              </form>
            </ActionPanel>
          ) : null}
          {delivered && s.type !== "T" && canManage && lines.some((l) => l.line.skuId) ? (
            <ActionPanel label="Correct delivery">
              <form action={correctDeliveryAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_3.5rem] gap-x-2 font-display text-[10.5px] uppercase tracking-[0.12em] text-ink-2">
                  <span>Line</span>
                  <span className="text-right">Kept</span>
                  <span className="text-right">Refused</span>
                  <span className="text-right">Damaged</span>
                </div>
                {outcomeFields("", "recorded")}
                <Field label="Reason (required)">
                  <Input name="reason" required placeholder="e.g. driver keyed 5, the buyer kept 6" />
                </Field>
                <Button small variant="secondary">
                  Correct
                </Button>
                <p className="text-xs text-ink-3">Office correction after the driver&apos;s record (R2-38): stock, keg balance and the invoice are recomputed under the same numbers; refused if the invoice is already paid.</p>
              </form>
            </ActionPanel>
          ) : null}
          {s.type === "T" && s.status === "delivered" && !receipt && canReceive ? (
            <ActionPanel label="Record receipt" variant="primary">
              <form action={receiveAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Received on">
                  <Input name="receivedOn" type="date" required defaultValue={today} />
                </Field>
                {Array.from(expectedBySku.entries()).map(([skuId, qty]) => (
                  <Field key={skuId} label={`${skuById.get(skuId)?.code ?? skuId} (expected ${qty})`}>
                    <Input name={`recv:${skuId}`} type="number" min={0} step={1} defaultValue={qty} className="text-right" />
                  </Field>
                ))}
                <Field label="Discrepancy note">
                  <Input name="note" placeholder="Optional" />
                </Field>
                <Button small>Record receipt</Button>
                <p className="text-xs text-ink-3">In transit becomes on hand at {destinationWarehouse?.name ?? "the destination"}; a short or over count raises a receiving discrepancy for Admin.</p>
              </form>
            </ActionPanel>
          ) : null}
          {s.number && s.status !== "voided" && canManage ? (
            <ActionPanel label="Regenerate">
              <form action={regenerateAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Why (required)">
                  <Input name="reason" required placeholder="e.g. Carrier changed after printing" />
                </Field>
                <Button small variant="secondary">
                  Regenerate (next revision)
                </Button>
              </form>
            </ActionPanel>
          ) : null}
          {s.status !== "delivered" && s.status !== "voided" && canVoid ? (
            <ActionPanel label="Void" variant="danger">
              <form action={voidAction} className="space-y-2">
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Reason (required)">
                  <Input name="reason" required />
                </Field>
                {orders.length ? (
                  <Field label="The order" hint="Reopen keeps the demand reserved for a new shipment; cancel releases it (R2-7).">
                    <Select name="order" defaultValue="reopen">
                      <option value="reopen">Return to open</option>
                      <option value="cancel">Cancel the order</option>
                    </Select>
                  </Field>
                ) : null}
                <Button small variant="danger">
                  Void shipment
                </Button>
                <p className="text-xs text-ink-3">Stock is released, the draft invoice is voided and the number is kept as a gap (5.4).</p>
              </form>
            </ActionPanel>
          ) : null}
        </>
      }
    >
      <Flash {...flash} />
      {s.status === "voided" ? (
        <Notice tone="danger" title="Voided.">
          {s.voidReason} ({nameOf(s.voidedByEmployeeId)}, {fmtDate(s.voidedAt)}). The number stays as a permanent gap (5.4).
        </Notice>
      ) : null}
      {servedWarning ? (
        <Notice tone={s.overrideReason ? "info" : "warn"} title="Served account.">
          {destination?.tradeName} is served by {servedBy?.tradeName ?? "a distributor"}. {s.overrideReason ? `Direct shipment with override reason: ${s.overrideReason}` : "A direct shipment needs an override reason before confirmation (2.6)."}
        </Notice>
      ) : null}
      {s.status === "draft" && lines.some((l) => l.line.skuId && !l.line.lotId) ? <Notice tone="warn">Every beer line needs a lot chosen from the list before confirmation (4.1).</Notice> : null}

      <Columns>
        <Card title="Route and dates">
          <KV
            items={[
              ["Number", s.number ?? "Assigned at confirmation"],
              ["Type", `${s.type} ${TYPE_LABEL[s.type]}${s.pickup ? " (will-call)" : ""}`],
              ["Origin", originLabel(origin)],
              ["Destination", destination ? <Link key="d" href={`/locations/${destination.id}`} className="text-navy hover:underline">{destination.tradeName}</Link> : destinationLabel],
              ["Destination kind", destination ? destination.kind : destinationWarehouse ? destinationWarehouse.kind : s.destinationText ? "free text" : "—"],
              ["Scheduled", fmtDay(s.scheduledDate)],
              ["Actual", fmtDay(s.actualDate)],
              ["Driver", nameOf(s.driverEmployeeId)],
              ["Template", s.template],
              ["Override reason", s.overrideReason],
            ]}
          />
        </Card>
        <Card title="Logistics">
          <KV
            items={[
              ["PO numbers", s.poNumbers?.length ? s.poNumbers.join(", ") : "—"],
              ["Appointment", s.appointment],
              ["Carrier", [s.carrier, s.carrierPhone].filter(Boolean).join(", ") || "—"],
              ["Seal / trailer", [s.sealNumber, s.trailerNumber].filter(Boolean).join(" / ") || "—"],
              ["Pallets", s.palletCount != null ? String(s.palletCount) : "—"],
              ["Pallet build", s.palletBuild],
              ["Freight class", s.freightClass],
              ["Delivery window", s.deliveryWindow],
              ["Receiving instructions", s.receivingInstructions],
              ["Notes", s.notes ? <span key="n" className="whitespace-pre-line">{s.notes}</span> : "—"],
            ]}
          />
        </Card>
      </Columns>

      <Tabs tabs={tabs} />
    </RecordPage>
  );
}
