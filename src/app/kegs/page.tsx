import Link from "next/link";
import { Button, Card, FilterBar, Flash, Notice, Num, Page, Select, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listLocations } from "@/lib/domain/customers/service";
import { kegBalances } from "@/lib/domain/kegs/service";
import { visibleMarkets } from "@/lib/domain/markets/service";
import { todayIso } from "../shipments/labels";
import { KegEventForm } from "./keg-event-form";

export default async function KegsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("keg.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const marketId = param(sp, "market");
  const onlyOpen = param(sp, "open") !== "0";
  const d = await getDb();
  const [markets, balances] = await Promise.all([visibleMarkets(d, actor, ["owner", "admin", "accounting", "sales"]), kegBalances(d, actor, { marketId, onlyOpen })]);
  const marketCode = new Map(markets.map((m) => [m.id, m.code]));
  const canRecord = can(actor, "keg.record");
  const locations = canRecord ? (await listLocations(d, actor)).filter((l) => l.loc.status !== "closed" && can(actor, "keg.record", { marketId: l.loc.marketId })) : [];
  const totals = balances.reduce((t, b) => ({ half: t.half + b.halfBalance, sixtel: t.sixtel + b.sixtelBalance }), { half: 0, sixtel: 0 });

  return (
    <Page title="Keg balances" subtitle="Per account by size, counts only (8.4): balance = kegs out minus kegs in. Deliveries and empties collected at the stop post automatically; opening balances and adjustments are entered here.">
      <Flash {...flash} />
      <FilterBar>
        <Select name="market" defaultValue={marketId ?? ""} aria-label="Market">
          <option value="">All markets</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
        <Select name="open" defaultValue={onlyOpen ? "1" : "0"} aria-label="Which accounts">
          <option value="1">Only open balances</option>
          <option value="0">Every account with keg events</option>
        </Select>
        <Button variant="secondary" small>
          Filter
        </Button>
        <span className="ml-auto text-xs text-ink-3">
          {balances.length} account{balances.length === 1 ? "" : "s"}, {totals.half} × 1/2 bbl and {totals.sixtel} × 1/6 bbl out
        </span>
      </FilterBar>
      <Table
        caption="Keg balances by account"
        head={["Account", "Market", "Kind", "1/2 out", "1/2 in", "1/2 balance", "1/6 out", "1/6 in", "1/6 balance", "Last event"]}
        widths={[LIST_WIDTHS.number, "6rem", LIST_WIDTHS.type, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.qty, LIST_WIDTHS.date]}
        align={["left", "left", "left", "right", "right", "right", "right", "right", "right", "left"]}
        empty="No keg balances yet; opening counts are entered below."
        rows={balances.map((b) => [
          <Link key="a" href={`/kegs/${b.locationId}`} className="font-medium text-navy hover:underline">
            {b.tradeName}
          </Link>,
          marketCode.get(b.marketId) ?? "",
          b.kind,
          <Num key="ho">{String(b.halfOut)}</Num>,
          <Num key="hi">{String(b.halfIn)}</Num>,
          <Num key="hb" className="font-semibold">{String(b.halfBalance)}</Num>,
          <Num key="so">{String(b.sixtelOut)}</Num>,
          <Num key="si">{String(b.sixtelIn)}</Num>,
          <Num key="sb" className="font-semibold">{String(b.sixtelBalance)}</Num>,
          <span key="d" className="whitespace-nowrap">{fmtDay(b.lastEventOn)}</span>,
        ])}
      />
      <p className="text-xs text-ink-3">Distributors remit keg deposits to MicroStar; retail accounts carry the $35 per-keg deposit on the invoice (3.10). The monthly MicroStar outbound report is the next tab under Kegs (R2-35). Counts only, no serial numbers; a floating deposit on file is recorded on the account (R2-13).</p>
      {canRecord ? (
        <Card title="Record an opening balance or adjustment">
          <KegEventForm locations={locations.map((l) => ({ id: l.loc.id, label: `${l.loc.tradeName} (${l.market.code})` }))} returnTo="/kegs" today={todayIso()} />
          <Notice tone="info">Balances start at zero at cut-over (8.5); enter each account&apos;s opening count from the keg sheet. Adjustments above a quantity need approval (8.7): record the approver in the note.</Notice>
        </Card>
      ) : null}
    </Page>
  );
}
