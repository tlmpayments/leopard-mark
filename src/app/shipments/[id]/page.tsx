import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { Badge, Button, Card, Empty, Field, Flash, Input, KV, Notice, Page, Select, StatusBadge, Table, Textarea, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { formatCents, listSkus } from "@/lib/domain/catalog/service";
import { lotPickerOptions } from "@/lib/domain/lots/service";
import { getShipment } from "@/lib/domain/shipments/service";
import { listPosItems } from "@/lib/domain/settings/service";
import { TYPE_LABEL, isDriverOnly, shipmentNumber, todayIso } from "../labels";
import { confirmAction, deliverAction, outAction, receiveAction, regenerateAction, saveLinesAction, saveLogisticsAction, stageAction, voidAction } from "./actions";

const DOC_LABEL: Record<string, string> = { bol: "Bill of lading", picking_ticket: "Picking ticket", pickup_pack: "Pickup pack", pull_sheet: "Pull sheet", invoice: "Invoice" };
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

  const destinationLabel = destination ? destination.tradeName : destinationWarehouse ? `${destinationWarehouse.originCode ? destinationWarehouse.originCode + " · " : ""}${destinationWarehouse.name}` : (s.destinationText ?? "—");
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

  return (
    <Page
      title={`Shipment ${shipmentNumber(s)}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>
            {s.type} · {TYPE_LABEL[s.type]}
            {s.pickup ? " · will-call" : ""}
          </span>
          <StatusBadge value={s.status} />
          {s.revision > 0 ? <Badge tone="info">R{s.revision}</Badge> : null}
          {s.legacy ? <Badge>imported history</Badge> : null}
          <Badge>{s.template}</Badge>
        </span>
      }
      actions={
        <>
          {latestByKind.has("bol") ? (
            <a href={docHref("bol")} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-medium hover:bg-background">
              BOL (PDF)
            </a>
          ) : null}
          {latestByKind.has("picking_ticket") ? (
            <a href={docHref("picking_ticket")} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-medium hover:bg-background">
              Picking ticket (PDF)
            </a>
          ) : null}
          <Button href="/shipments" variant="secondary">
            All shipments
          </Button>
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
        <Notice tone={s.overrideReason ? "info" : "warn"} title="Served account:">
          {destination?.tradeName} is served by {servedBy?.tradeName ?? "a distributor"}. {s.overrideReason ? `Direct shipment with override reason: ${s.overrideReason}` : "A direct shipment needs an override reason before confirmation (2.6)."}
        </Notice>
      ) : null}
      {s.status === "draft" && lines.some((l) => l.line.skuId && !l.line.lotId) ? <Notice tone="warn">Every beer line needs a lot chosen from the list before confirmation (4.1).</Notice> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Route and dates">
          <KV
            items={[
              ["Number", shipmentNumber(s)],
              ["Type", `${s.type} · ${TYPE_LABEL[s.type]}${s.pickup ? " (will-call)" : ""}`],
              ["Origin", origin ? `${origin.originCode ? origin.originCode + " · " : ""}${origin.name}` : "—"],
              ["Destination", destination ? <Link key="d" href={`/locations/${destination.id}`} className="underline">{destination.tradeName}</Link> : destinationLabel],
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
              ["Carrier", [s.carrier, s.carrierPhone].filter(Boolean).join(" · ") || "—"],
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
      </div>

      <Card title="Lines">
        <Table
          caption="Shipment lines"
          head={["#", "SKU / POS", "Description", "Lot", "Qty", "Unit price", "Weight lb", "Lot reason"]}
          rows={lines.map(({ line, sku, pos, lot }) => [
            String(line.lineNo),
            <span key="c" className="font-mono text-xs">
              {sku?.code ?? pos?.code ?? "—"}
            </span>,
            sku ? `${sku.brand} ${sku.name}` : pos ? `${pos.name} (POS)` : "—",
            lot ? (
              <Link key="l" href={`/lots/${lot.id}`} className="underline">
                {lot.lotCode}
                {!lot.quantitiesKnown ? <Badge tone="warn"> quantities unconfirmed</Badge> : null}
              </Link>
            ) : (
              line.lotCode ?? (sku ? <Badge key="nl" tone="warn">no lot</Badge> : "—")
            ),
            String(line.qty),
            line.unitPriceCents != null ? formatCents(line.unitPriceCents) : "—",
            line.weightLb ?? "—",
            line.lotReason ?? "—",
          ])}
        />
        {editLines ? (
          <details className="mt-3" open={lines.length === 0}>
            <summary className="cursor-pointer text-sm text-accent">{lines.length ? "Edit lines (replaces all lines)" : "Add lines"}</summary>
            <form action={saveLinesAction} className="mt-2 space-y-2">
              <input type="hidden" name="shipmentId" value={s.id} />
              <div className="-mx-4 overflow-x-auto sm:mx-0">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-muted">
                      <th className="px-2 py-1">SKU</th>
                      <th className="px-2 py-1">Lot</th>
                      <th className="px-2 py-1">POS item</th>
                      <th className="px-2 py-1">Qty</th>
                      <th className="px-2 py-1">Lot reason (4.6)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: rowCount }, (_, i) => {
                      const existing = lines[i]?.line;
                      return (
                        <tr key={i} className="align-top">
                          <td className="px-2 py-1">
                            <Select name={`sku:${i}`} defaultValue={existing?.skuId ?? ""} aria-label={`Row ${i + 1} SKU`}>
                              <option value="">—</option>
                              {activeSkus.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.code} — {x.brand} {x.name}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select name={`lot:${i}`} defaultValue={existing?.lotId ?? ""} aria-label={`Row ${i + 1} lot`}>
                              <option value="">— no lot —</option>
                              {lotBrands.map((b) => (
                                <optgroup key={b} label={b}>
                                  {lots
                                    .filter((l) => l.brandCode === b)
                                    .map((l) => (
                                      <option key={l.lotId} value={l.lotId}>
                                        {l.lotCode} · {l.facilityName} · {fmtDay(l.packagingDate)}
                                        {l.quantitiesKnown ? "" : " (quantities unconfirmed)"}
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Select name={`pos:${i}`} defaultValue={existing?.posItemId ?? ""} aria-label={`Row ${i + 1} POS item`}>
                              <option value="">—</option>
                              {posItems.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.code} · {p.name}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Input name={`qty:${i}`} type="number" min={1} step={1} inputMode="numeric" defaultValue={existing?.qty ?? ""} className="w-24" aria-label={`Row ${i + 1} quantity`} />
                          </td>
                          <td className="px-2 py-1">
                            <Input name={`reason:${i}`} defaultValue={existing?.lotReason ?? ""} placeholder="Only when the lot's quantities are unconfirmed" aria-label={`Row ${i + 1} lot reason`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button small>Save lines</Button>
                <span className="text-xs text-muted">Blank rows are ignored. A row is a SKU with its lot, or a POS item (no lot, no price). {s.status !== "draft" ? "Saving after confirmation re-allocates stock and regenerates the documents with the next revision mark." : ""}</span>
              </div>
            </form>
          </details>
        ) : null}
      </Card>

      {(canConfirm || canManage || canDeliver || canVoid || canReceive) && !s.legacy ? (
        <Card title="Actions">
          <div className="flex flex-wrap gap-2">
            {s.status === "draft" && canConfirm ? (
              <form action={confirmAction}>
                <input type="hidden" name="shipmentId" value={s.id} />
                <Button>Confirm (assign number)</Button>
              </form>
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
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {["confirmed", "staged", "out"].includes(s.status) && canDeliver ? (
              <form action={deliverAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Deliver (office sets the actual date, 5.11)</div>
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Actual date">
                  <Input name="actualDate" type="date" required defaultValue={today} />
                </Field>
                {s.type !== "T" && destination ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Empty 1/2 bbl collected">
                      <Input name="halfIn" type="number" min={0} step={1} defaultValue={0} />
                    </Field>
                    <Field label="Empty 1/6 bbl collected">
                      <Input name="sixtelIn" type="number" min={0} step={1} defaultValue={0} />
                    </Field>
                  </div>
                ) : null}
                <Field label="Note">
                  <Input name="note" placeholder="Optional" />
                </Field>
                <Button small>Mark delivered</Button>
                <p className="text-xs text-muted">Allocations are consumed, stock leaves the origin per line{s.type === "T" ? " and sits in transit at the destination until received" : ", the keg balance moves and the invoice is issued dated the actual date"}. The number never changes.</p>
              </form>
            ) : null}
            {s.status !== "delivered" && s.status !== "voided" && canVoid ? (
              <form action={voidAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Void</div>
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Reason (required)">
                  <Input name="reason" required />
                </Field>
                <Button small variant="danger">
                  Void shipment
                </Button>
                <p className="text-xs text-muted">Allocations are released, the draft invoice is voided and the number is kept as a gap (5.4).</p>
              </form>
            ) : null}
            {s.number && s.status !== "voided" && canManage ? (
              <form action={regenerateAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Regenerate documents</div>
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Why (required)">
                  <Input name="reason" required placeholder="e.g. Carrier changed after printing" />
                </Field>
                <Button small variant="secondary">
                  Regenerate (next revision)
                </Button>
              </form>
            ) : null}
            {s.type === "T" && s.status === "delivered" && !receipt && canReceive ? (
              <form action={receiveAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Receive transfer at {destinationWarehouse?.name ?? "the destination"} (5.8)</div>
                <input type="hidden" name="shipmentId" value={s.id} />
                <Field label="Received on">
                  <Input name="receivedOn" type="date" required defaultValue={today} />
                </Field>
                {Array.from(expectedBySku.entries()).map(([skuId, qty]) => (
                  <Field key={skuId} label={`${skuById.get(skuId)?.code ?? skuId} (expected ${qty})`}>
                    <Input name={`recv:${skuId}`} type="number" min={0} step={1} defaultValue={qty} />
                  </Field>
                ))}
                <Field label="Discrepancy note">
                  <Input name="note" placeholder="Optional" />
                </Field>
                <Button small>Record receipt</Button>
                <p className="text-xs text-muted">In transit becomes on hand; a short or over count raises a receiving discrepancy for Admin.</p>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}

      {editHeader ? (
        <Card title={s.status === "draft" ? "Edit header" : "Edit logistics (documents regenerate with the next revision)"}>
          <form action={saveLogisticsAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="shipmentId" value={s.id} />
            <Field label="Scheduled date" hint={s.status === "draft" ? "Drives the number at confirmation." : "The number keeps its original date (5.12)."}>
              <Input name="scheduledDate" type="date" required defaultValue={s.scheduledDate} />
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
                  <label className="flex min-h-11 items-center gap-2 text-sm">
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
            <div className="sm:col-span-2">
              <Button small>Save</Button>
              {s.status !== "draft" ? <span className="ml-2 text-xs text-muted">Route (type, origin, destination) cannot change after confirmation; void and re-create instead.</span> : null}
            </div>
          </form>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Documents">
          {documents.length === 0 ? (
            <Empty>Documents exist from confirmation onward (6.7).</Empty>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {documents.map((doc) => (
                <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {DOC_LABEL[doc.kind] ?? doc.kind} {doc.number ?? ""} {doc.revision > 0 ? <Badge tone="info">R{doc.revision}</Badge> : null}
                    <span className="block text-xs text-muted">
                      {fmtDate(doc.createdAt)}
                      {doc.hasPdf ? "" : " · rendered on request"}
                    </span>
                  </span>
                  {latestByKind.get(doc.kind)?.id === doc.id && (doc.kind === "bol" || doc.kind === "picking_ticket") ? (
                    <a href={docHref(doc.kind)} target="_blank" rel="noopener" className="text-accent underline">
                      Open PDF (latest)
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {latestByKind.has("bol") && destination ? (
            <p className="mt-2 text-sm">
              <a href={docHref("pickup_pack")} target="_blank" rel="noopener" className="text-accent underline">
                Pickup pack (BOL followed by the invoice, one PDF)
              </a>
            </p>
          ) : null}
          {invoices.length ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="mb-1 text-xs uppercase tracking-wide text-muted">Invoices</div>
              <ul className="space-y-1 text-sm">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={`/invoices/${inv.id}`} className="underline">
                        {inv.number ?? `${inv.series} draft`}
                      </Link>{" "}
                      <StatusBadge value={inv.status} /> {inv.totalCents ? <span className="text-xs text-muted">{formatCents(inv.totalCents)}</span> : null}
                    </span>
                    {inv.status !== "void" ? (
                      <a href={`/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-xs text-accent underline">
                        PDF
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (s.type === "D" || s.type === "S") && destination && s.status !== "draft" && liveInvoices.length === 0 ? (
            <p className="mt-2 text-xs text-muted">No live invoice for this shipment.</p>
          ) : null}
        </Card>
        <Card title="Allocations, orders and kegs">
          <div className="text-xs uppercase tracking-wide text-muted">Active allocations at the origin</div>
          {allocations.length === 0 ? <p className="text-sm text-muted">None (allocations exist from confirmation to delivery or void).</p> : <ul className="text-sm">{allocations.map((a) => <li key={a.id}>{skuById.get(a.skuId)?.code ?? a.skuId}: {a.qty}</li>)}</ul>}
          <div className="mt-3 text-xs uppercase tracking-wide text-muted">Linked orders</div>
          {orders.length === 0 ? (
            <p className="text-sm text-muted">No orders linked (a shipment can stand alone, 5.1).</p>
          ) : (
            <ul className="text-sm">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="underline">
                    {o.orderNumber}
                  </Link>{" "}
                  <StatusBadge value={o.demandState} />
                </li>
              ))}
            </ul>
          )}
          {kegPickup ? (
            <>
              <div className="mt-3 text-xs uppercase tracking-wide text-muted">Empties collected at the stop</div>
              <p className="text-sm">
                {kegPickup.halfIn} × 1/2 bbl, {kegPickup.sixtelIn} × 1/6 bbl
                {destination ? (
                  <>
                    {" "}
                    · <Link href={`/kegs/${destination.id}`} className="underline">keg balance</Link>
                  </>
                ) : null}
              </p>
            </>
          ) : destination && (s.type === "D" || s.type === "S") ? (
            <p className="mt-3 text-sm">
              <Link href={`/kegs/${destination.id}`} className="underline">
                Keg balance for {destination.tradeName}
              </Link>
            </p>
          ) : null}
          {receipt ? (
            <>
              <div className="mt-3 text-xs uppercase tracking-wide text-muted">Receiving confirmation</div>
              <p className="text-sm">
                Received {fmtDay(receipt.receivedOn)} by {nameOf(receipt.receivedByEmployeeId)}
                {receipt.discrepancyNote ? ` · ${receipt.discrepancyNote}` : ""}
              </p>
              <ul className="text-sm">
                {receiptLines.map(({ l, sku }) => (
                  <li key={l.id}>
                    {sku.code}: expected {l.qtyExpected}, received {l.qtyReceived} {l.qtyExpected !== l.qtyReceived ? <Badge tone="warn">discrepancy</Badge> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      </div>

      <Card title="History">
        <KV
          items={[
            ["Created", `${nameOf(s.createdByEmployeeId)} · ${fmtDate(s.createdAt)}`],
            ["Confirmed", s.confirmedAt ? `${nameOf(s.confirmedByEmployeeId)} · ${fmtDate(s.confirmedAt)}` : "—"],
            ["Delivered", s.deliveredAt ? `${nameOf(s.deliveredByEmployeeId)} · ${fmtDate(s.deliveredAt)}` : "—"],
            ["Voided", s.voidedAt ? `${nameOf(s.voidedByEmployeeId)} · ${fmtDate(s.voidedAt)}` : "—"],
          ]}
        />
        {history.length ? (
          <ul className="mt-3 divide-y divide-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1">
                <span>
                  <span className="font-medium">{h.action.replace("shipment.", "").replace(/_/g, " ")}</span>
                  {h.reason ? <span className="text-muted"> · {h.reason}</span> : null}
                </span>
                <span className="text-xs text-muted">
                  {anyName(h.actorEmployeeId)} · {fmtDate(h.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
    </Page>
  );
}
