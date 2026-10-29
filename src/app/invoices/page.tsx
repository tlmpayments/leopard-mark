import Link from "next/link";
import { Badge, Button, Card, Flash, Input, Page, Select, StatusBadge, Table, fmtDay } from "@/components/ui";
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
    <Page title="Invoices" subtitle="fv-ops owns the INV and NC sequences (7.1, 7.3). A draft is created when a shipment is confirmed and issued when it is delivered, dated the actual date (7.4). Sending and collection stay manual (7.5).">
      <Flash {...flash} />
      <form className="grid gap-2 sm:grid-cols-5" role="search">
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
        <Input name="q" defaultValue={q ?? ""} placeholder="Invoice number" aria-label="Invoice number" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="legacy" value="1" defaultChecked={legacy} /> Include Sales tab history
        </label>
        {location ? <input type="hidden" name="location" value={location} /> : null}
        <Button variant="secondary">Filter</Button>
      </form>
      <Card>
        <Table
          caption="Invoices"
          head={["Number", "Account", "Invoice date", "Due", "Total", "Status"]}
          rows={shown.map(({ inv, location: loc }) => [
            <Link key="n" href={`/invoices/${inv.id}`} className="font-medium hover:underline">
              {inv.number ?? `${inv.series} draft`}
              {inv.legacy ? <Badge> legacy</Badge> : null}
            </Link>,
            loc ? (
              <Link key="l" href={`/locations/${loc.id}`} className="hover:underline">
                {loc.tradeName}
              </Link>
            ) : (
              "—"
            ),
            fmtDay(inv.invoiceDate),
            fmtDay(inv.dueDate),
            formatCents(inv.totalCents),
            <span key="s" className="flex items-center gap-1">
              <StatusBadge value={inv.status} />
              {inv.legacyStatus ? <span className="text-xs text-muted">{inv.legacyStatus}</span> : null}
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
    </Page>
  );
}
