import Link from "next/link";
import { Button, Card, Flash, Page, Select, StatusBadge, Table, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listCountSessions } from "@/lib/domain/counts/service";
import { listOrigins } from "@/lib/domain/origins/service";

export default async function CountsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("count.record");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const warehouseId = param(sp, "origin");
  const d = await getDb();
  const [origins, sessions] = await Promise.all([listOrigins(d, { includeInactive: true }), listCountSessions(d, { warehouseId })]);
  return (
    <Page title="Stock counts" subtitle="A count sheet per origin captures SKU totals and lot codes (8.1, 8.2). Applying it sets on hand to the counted total; the ledger starts from evidence, not from the workbook (1.6)." actions={<Button href="/admin/counts/new">New count sheet</Button>}>
      <Flash {...flash} />
      <form className="flex flex-wrap gap-2" role="search">
        <Select name="origin" defaultValue={warehouseId ?? ""} aria-label="Origin" className="max-w-xs">
          <option value="">All origins</option>
          {origins.map((o) => (
            <option key={o.id} value={o.id}>
              {o.originCode ? `${o.originCode} · ` : ""}
              {o.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary">Filter</Button>
      </form>
      <Card>
        <Table
          caption="Count sessions"
          head={["Counted on", "Origin", "Counted by", "Status", "Applied", "Note"]}
          rows={sessions.map(({ s, warehouse }) => [
            <Link key="d" href={`/admin/counts/${s.id}`} className="font-medium hover:underline">
              {fmtDay(s.countedOn)}
            </Link>,
            `${warehouse.originCode ? warehouse.originCode + " · " : ""}${warehouse.name}`,
            s.countedBy ?? "—",
            <StatusBadge key="s" value={s.status} />,
            s.appliedAt ? fmtDate(s.appliedAt) : "—",
            s.note ?? "—",
          ])}
        />
      </Card>
    </Page>
  );
}
