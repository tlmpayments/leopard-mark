import Link from "next/link";
import { Button, FilterBar, Flash, Input, Num, Page, Select, StatusBadge, Struck, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { listInvoices, type Invoice } from "@/lib/domain/invoices/service";

const PAGE = 100;
const STATUSES: Invoice["status"][] = ["draft", "issued", "paid", "void"];

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("invoice.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const status = param(sp, "status") as Invoice["status"] | undefined;
  const series = param(sp, "series") as "INV" | "NC" | undefined;
  const q = param(sp, "q");
  const location = param(sp, "location");
  const legacy = param(sp, "legacy") === "1";
  const page = Math.max(1, Number(param(sp, "page") ?? 1) || 1);
  const d = await getDb();
  const rows = await listInvoices(d, actor, {
    status: STATUSES.includes(status as Invoice["status"]) ? status : undefined,
    series: series === "INV" || series === "NC" ? series : undefined,
    q,
    locationId: location,
    includeLegacy: legacy,
    limit: PAGE + 1,
    offset: (page - 1) * PAGE,
  });
  const hasMore = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const link = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ status, series, q, location })) if (v) u.set(k, v);
    if (legacy) u.set("legacy", "1");
    u.set("page", String(p));
    return `/invoices?${u.toString()}`;
  };

  return (
    <Page title="Invoices" subtitle="INV and NC sequences are owned here (7.1, 7.3): a draft opens when a shipment is confirmed and is issued at delivery, dated the actual date (7.4). Sending and collection stay manual (7.5).">
      <Flash {...flash} />
      <FilterBar>
        <Select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </Select>
        <Select name="series" defaultValue={series ?? ""} aria-label="Series">
          <option value="">INV and NC</option>
          <option value="INV">INV (charged)</option>
          <option value="NC">NC (samples, no charge)</option>
        </Select>
        <Input name="q" defaultValue={q ?? ""} placeholder="Invoice number" aria-label="Invoice number" className="w-44" />
        <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
          <input type="checkbox" name="legacy" value="1" defaultChecked={legacy} /> Sales tab history
        </label>
        {location ? <input type="hidden" name="location" value={location} /> : null}
        <Button variant="secondary" small>
          Filter
        </Button>
      </FilterBar>
      <div>
        <Table
          caption="Invoices"
          head={["Number", "Account", "Invoice date", "Due", "Total", "Status"]}
          widths={[LIST_WIDTHS.number, undefined, LIST_WIDTHS.date, LIST_WIDTHS.date, LIST_WIDTHS.money, LIST_WIDTHS.status]}
          align={["left", "left", "left", "left", "right", "left"]}
          empty="No invoices match this filter."
          rows={shown.map(({ inv, location: loc }) => [
            <Link key="n" href={`/invoices/${inv.id}`} className="whitespace-nowrap font-medium text-navy hover:underline">
              <Struck when={inv.status === "void"}>{inv.number ?? `${inv.series} draft`}</Struck>
              {inv.legacy ? <span className="ml-1.5 text-[11px] text-ink-3">legacy</span> : null}
            </Link>,
            loc ? (
              <Link key="l" href={`/locations/${loc.id}`} className="hover:underline">
                {loc.tradeName}
              </Link>
            ) : (
              "—"
            ),
            <span key="d1" className="whitespace-nowrap">{fmtDay(inv.invoiceDate)}</span>,
            <span key="d2" className="whitespace-nowrap">{fmtDay(inv.dueDate)}</span>,
            <Num key="t">{formatCents(inv.totalCents)}</Num>,
            <span key="s" className="flex items-center gap-2">
              <StatusBadge value={inv.status} />
              {inv.legacyStatus ? <span className="text-[11px] text-ink-3">{inv.legacyStatus}</span> : null}
            </span>,
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
