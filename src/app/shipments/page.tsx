import Link from "next/link";
import { Badge, Button, Card, Field, Flash, Input, Page, Select, StatusBadge, Table, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listOrigins } from "@/lib/domain/origins/service";
import { listShipments, type ShipmentStatus, type ShipmentType } from "@/lib/domain/shipments/service";
import { SHIPMENT_STATUSES, SHIPMENT_TYPES, TYPE_LABEL, isDriverOnly, shipmentNumber, todayIso } from "./labels";

const PAGE = 100;

export default async function ShipmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("shipment.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const origin = param(sp, "origin");
  const status = param(sp, "status") as ShipmentStatus | undefined;
  const type = param(sp, "type") as ShipmentType | undefined;
  const from = param(sp, "from");
  const to = param(sp, "to");
  const q = param(sp, "q");
  const destination = param(sp, "destination");
  const legacy = param(sp, "legacy") === "1";
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);
  const d = await getDb();
  const origins = await listOrigins(d, { includeInactive: true });
  const originName = new Map(origins.map((o) => [o.id, o.originCode ? `${o.originCode} ${o.name}` : o.name]));
  const rows = await listShipments(d, actor, {
    originWarehouseId: origin,
    status: SHIPMENT_STATUSES.includes(status as ShipmentStatus) ? status : undefined,
    type: SHIPMENT_TYPES.includes(type as ShipmentType) ? type : undefined,
    dateFrom: from,
    dateTo: to,
    q,
    destinationLocationId: destination,
    includeLegacy: legacy,
    limit: PAGE + 1,
    offset: (page - 1) * PAGE,
  });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const link = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ origin, status, type, from, to, q, destination })) if (v) u.set(k, v);
    if (legacy) u.set("legacy", "1");
    u.set("page", String(p));
    return `/shipments?${u.toString()}`;
  };
  const driverOnly = isDriverOnly(actor);
  const today = todayIso();

  return (
    <Page
      title="Shipments"
      subtitle={driverOnly ? "Stops assigned to you." : "One record per shipment: it carries the number, the dates, the account and the lots, and drives the documents, the invoice, the ledger and the keg balance."}
      actions={can(actor, "shipment.manage") ? <Button href="/shipments/new">New shipment</Button> : null}
    >
      <Flash {...flash} />
      <form className="grid gap-2 sm:grid-cols-6" role="search">
        <Select name="origin" defaultValue={origin ?? ""} aria-label="Origin">
          <option value="">All origins</option>
          {origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.originCode ? `${o.originCode} · ` : ""}
              {o.name}
              {o.active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {SHIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={type ?? ""} aria-label="Type">
          <option value="">Any type</option>
          {SHIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t} · {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Input name="from" type="date" defaultValue={from ?? ""} aria-label="Scheduled from" />
        <Input name="to" type="date" defaultValue={to ?? ""} aria-label="Scheduled to" />
        <div className="flex gap-2">
          <Input name="q" placeholder="Number or destination" defaultValue={q ?? ""} aria-label="Search" />
          <Button variant="secondary">Filter</Button>
        </div>
        {destination ? <input type="hidden" name="destination" value={destination} /> : null}
        <label className="flex items-center gap-2 text-sm sm:col-span-6">
          <input type="checkbox" name="legacy" value="1" defaultChecked={legacy} /> Include imported history (BOL Maker Log)
        </label>
      </form>

      <Card>
        <Table
          caption="Shipments"
          head={["Number", "Type", "Scheduled", "Actual", "Origin", "Destination", "Status"]}
          rows={shown.map(({ s, origin: o, destination: dest }) => [
            <Link key="n" href={`/shipments/${s.id}`} className="font-medium hover:underline">
              {shipmentNumber(s)}
              {s.legacy ? <Badge tone="neutral"> legacy</Badge> : null}
              {s.pickup ? <span className="ml-1 text-xs text-muted">will-call</span> : null}
            </Link>,
            <span key="t" title={TYPE_LABEL[s.type]}>
              {s.type} <span className="text-xs text-muted">{TYPE_LABEL[s.type]}</span>
            </span>,
            fmtDay(s.scheduledDate),
            fmtDay(s.actualDate),
            o.originCode ? `${o.originCode} · ${o.name}` : o.name,
            dest?.tradeName ?? (s.destinationWarehouseId ? (originName.get(s.destinationWarehouseId) ?? "origin") : (s.destinationText ?? "—")),
            <span key="s" className="flex items-center gap-1">
              <StatusBadge value={s.status} />
              {s.revision > 0 ? <Badge tone="info">R{s.revision}</Badge> : null}
            </span>,
          ])}
        />
        {(page > 1 || hasMore) && (
          <nav className="mt-3 flex justify-between text-sm" aria-label="Pagination">
            {page > 1 ? <Link href={link(page - 1)} className="text-accent hover:underline">Previous</Link> : <span />}
            {hasMore ? <Link href={link(page + 1)} className="text-accent hover:underline">Next</Link> : <span />}
          </nav>
        )}
      </Card>

      {!driverOnly ? (
        <Card title="Day print (one origin, one scheduled date)">
          <form action="/shipments/print" method="get" target="_blank" className="grid gap-2 sm:grid-cols-4">
            <Field label="Origin">
              <Select name="origin" required defaultValue={origin ?? ""}>
                <option value="" disabled>
                  Origin…
                </option>
                {origins
                  .filter((o) => o.active)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.originCode ? `${o.originCode} · ` : ""}
                      {o.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Scheduled date">
              <Input name="date" type="date" required defaultValue={from ?? today} />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <Button variant="secondary" name="kind" value="all">
                All documents (PDF)
              </Button>
              <Button variant="secondary" name="kind" value="pull_sheet">
                Pull sheet only (PDF)
              </Button>
            </div>
          </form>
          <p className="mt-1 text-xs text-muted">The warehouse gets one master pull sheet per origin per day; the driver one BOL per stop (5.2). Confirmed, staged, out and delivered shipments are included.</p>
        </Card>
      ) : null}
    </Page>
  );
}
