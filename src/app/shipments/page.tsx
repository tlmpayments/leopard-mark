import Link from "next/link";
import { Button, FilterBar, Flash, Input, Page, Select, StatusBadge, Struck, Table, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listOrigins } from "@/lib/domain/origins/service";
import { listShipments, type ShipmentStatus, type ShipmentType } from "@/lib/domain/shipments/service";
import { LIST_WIDTHS } from "@/components/widths";
import { SHIPMENT_STATUSES, SHIPMENT_TYPES, TYPE_LABEL, isDriverOnly, todayIso } from "./labels";

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
  // The day print (one origin, one scheduled date) takes the origin and the from-date of the current filter.
  const printOrigin = origin && origins.some((o) => o.id === origin && o.active) ? origin : null;
  const printDate = from ?? today;
  const printHref = (kind: "all" | "pull_sheet") => (printOrigin ? `/shipments/print?origin=${printOrigin}&date=${printDate}&kind=${kind}` : null);

  return (
    <Page
      title="Shipments"
      subtitle={driverOnly ? "Stops assigned to you." : "One record per shipment: number, dates, account and lots; it drives the documents, the invoice, the ledger and the keg balance."}
      actions={
        <>
          {!driverOnly && printHref("all") ? (
            <>
              <Button href={printHref("pull_sheet")!} variant="secondary" small>
                Pull sheet {fmtDay(printDate)} (PDF)
              </Button>
              <Button href={printHref("all")!} variant="secondary" small>
                Day documents (PDF)
              </Button>
            </>
          ) : !driverOnly ? (
            <span className="text-xs text-ink-3">Day print: filter by origin and from-date.</span>
          ) : null}
          {can(actor, "shipment.manage") ? (
            <Button href="/shipments/new" small variant="secondary">
              New transfer
            </Button>
          ) : null}
        </>
      }
    >
      <Flash {...flash} />
      <FilterBar>
        <Select name="origin" defaultValue={origin ?? ""} aria-label="Origin" className="w-auto min-w-40">
          <option value="">All origins</option>
          {origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.originCode ? `${o.originCode} ` : ""}
              {o.name}
              {o.active ? "" : " (inactive)"}
            </option>
          ))}
        </Select>
        <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="w-auto">
          <option value="">Any status</option>
          {SHIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
        <Select name="type" defaultValue={type ?? ""} aria-label="Type" className="w-auto">
          <option value="">Any type</option>
          {SHIPMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t} {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Input name="from" type="date" defaultValue={from ?? ""} aria-label="Scheduled from" className="w-auto" />
        <span className="text-xs text-ink-3">to</span>
        <Input name="to" type="date" defaultValue={to ?? ""} aria-label="Scheduled to" className="w-auto" />
        <Input name="q" placeholder="Number or destination" defaultValue={q ?? ""} aria-label="Search" className="w-48" />
        {destination ? <input type="hidden" name="destination" value={destination} /> : null}
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input type="checkbox" name="legacy" value="1" defaultChecked={legacy} /> Imported history
        </label>
        <Button variant="secondary" small>
          Filter
        </Button>
      </FilterBar>

      <div>
        <Table
          caption="Shipments"
          head={["Number", "Type", "Scheduled", "Actual", "Origin", "Destination", "Status"]}
          widths={[LIST_WIDTHS.number, LIST_WIDTHS.type, LIST_WIDTHS.date, LIST_WIDTHS.date, LIST_WIDTHS.code, undefined, LIST_WIDTHS.status]}
          empty="No shipments match this filter."
          rows={shown.map(({ s, origin: o, destination: dest }) => [
            <Link key="n" href={`/shipments/${s.id}`} className="whitespace-nowrap font-medium text-navy hover:underline">
              <Struck when={s.status === "voided"}>{s.number ?? "draft"}</Struck>
              {s.legacy ? <span className="ml-1.5 text-[11px] text-ink-3">legacy</span> : null}
              {s.pickup ? <span className="ml-1.5 text-[11px] text-ink-3">will-call</span> : null}
              {s.revision > 0 ? <span className="ml-1.5 text-[11px] text-ink-3">R{s.revision}</span> : null}
            </Link>,
            <span key="t" title={TYPE_LABEL[s.type]} className="whitespace-nowrap">
              {s.type} <span className="text-ink-3">{TYPE_LABEL[s.type]}</span>
            </span>,
            <span key="sd" className="whitespace-nowrap">{fmtDay(s.scheduledDate)}</span>,
            <span key="ad" className="whitespace-nowrap">{fmtDay(s.actualDate)}</span>,
            <span key="o" title={o.name} className="whitespace-nowrap">
              {o.originCode ?? o.name}
            </span>,
            <span key="d" className="block max-w-[32ch] truncate" title={dest?.tradeName ?? undefined}>
              {dest?.tradeName ?? (s.destinationWarehouseId ? (originName.get(s.destinationWarehouseId) ?? "origin") : (s.destinationText ?? "—"))}
            </span>,
            <StatusBadge key="s" value={s.status} />,
          ])}
        />
        {(page > 1 || hasMore) && (
          <nav className="mt-3 flex justify-between text-sm" aria-label="Pagination">
            {page > 1 ? <Link href={link(page - 1)} className="text-navy hover:underline">Previous</Link> : <span />}
            {hasMore ? <Link href={link(page + 1)} className="text-navy hover:underline">Next</Link> : <span />}
          </nav>
        )}
      </div>
    </Page>
  );
}
