import Link from "next/link";
import { Button, Code, FilterBar, Flash, Input, Notice, Page, Select, StatusBadge, Table, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { originLabel } from "@/lib/domain/origins/service";
import { endOfDaySheet, nextDay, pullSheetWarehouses } from "@/lib/domain/pullsheet/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { TYPE_LABEL, isDriverOnly, shipmentNumber } from "../labels";

/**
 * End of day (R2-29): the master pull sheet each warehouse needs for tomorrow, aggregated by SKU and lot with the
 * stops beneath, and the Download button for the PDF (plus the whole day's documents). Auto-send by email is behind
 * the company switch; its state is shown here plainly.
 */
export default async function EndOfDayPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("shipment.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const warehouses = await pullSheetWarehouses(d);
  const settings = await getCompanySettings(d);
  const chosen = warehouses.find((w) => w.id === param(sp, "warehouse")) ?? warehouses.find((w) => w.isPrimary) ?? warehouses[0] ?? null;
  const date = param(sp, "date") ?? (chosen ? nextDay(chosen.tz) : nextDay("America/Los_Angeles"));
  const sheet = chosen && !isDriverOnly(actor) ? await endOfDaySheet(d, actor, chosen.id, date) : null;
  const download = chosen ? `/shipments/print?origin=${chosen.id}&date=${date}&kind=pull_sheet` : null;
  const downloadAll = chosen ? `/shipments/print?origin=${chosen.id}&date=${date}&kind=all` : null;

  return (
    <Page
      title="End of day"
      actions={
        sheet && sheet.stops.length ? (
          <>
            <Button href={download!}>Download pull sheet</Button>
            <Button href={downloadAll!} variant="secondary">
              All documents for the day
            </Button>
          </>
        ) : null
      }
    >
      <Flash {...flash} />
      <FilterBar>
        <Select name="warehouse" defaultValue={chosen?.id ?? ""} aria-label="Warehouse">
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {originLabel(w)}
            </option>
          ))}
        </Select>
        <Input name="date" type="date" defaultValue={date} aria-label="Pull for" />
        <Button variant="secondary" small>
          Show
        </Button>
        <span className="text-xs text-ink-3">Defaults to tomorrow at the warehouse&apos;s local date.</span>
      </FilterBar>
      {!chosen ? <Notice tone="warn">No active warehouse of kind warehouse is set up (Admin: Markets &amp; stock). Breweries do not receive an end-of-day sheet.</Notice> : null}
      {sheet ? (
        <>
          <p className="text-sm text-ink-2">
            {originLabel(sheet.origin)}, pulling for {fmtDay(date)}: {sheet.stops.length} stop{sheet.stops.length === 1 ? "" : "s"}, {sheet.aggregate.reduce((n, a) => n + a.qty, 0)} units.
          </p>
          <Table
            caption="Master pull"
            head={["SKU", "Description", "Lot", "Qty"]}
            widths={[LIST_WIDTHS.code, undefined, LIST_WIDTHS.number, LIST_WIDTHS.qty]}
            align={["left", "left", "left", "right"]}
            empty="Nothing confirmed for this warehouse and day yet."
            rows={sheet.aggregate.map((a) => [<Code key="c">{a.skuCode}</Code>, a.description, a.lotCode ? <Code key="l">{a.lotCode}</Code> : "—", String(a.qty)])}
          />
          <Table
            caption="Stops"
            head={["Shipment", "Type", "Destination", "Lines", "Status"]}
            widths={[LIST_WIDTHS.number, LIST_WIDTHS.type, undefined, "22rem", LIST_WIDTHS.status]}
            empty="No stops."
            rows={sheet.stops.map((s) => [
              <Link key="n" href={`/shipments/${s.shipment.id}`} className="font-display text-navy hover:underline">
                {shipmentNumber(s.shipment)}
              </Link>,
              `${s.shipment.type} ${TYPE_LABEL[s.shipment.type]}${s.shipment.pickup ? ", will-call" : ""}`,
              s.destinationName,
              s.lines.map((l) => `${l.skuCode} ${l.qty}`).join(", "),
              <StatusBadge key="s" value={s.shipment.status} />,
            ])}
          />
        </>
      ) : null}
      {chosen ? (
        <div className="border-t border-rule pt-3 text-sm text-ink-2">
          <span className="font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-2">Auto-send</span>
          <p className="mt-1">
            {settings.autoSendPullSheets
              ? chosen.pullSheetEmail && chosen.pullSheetSendTime
                ? `On: ${originLabel(chosen)} is sent its sheet for the next day at ${chosen.pullSheetSendTime} local to ${chosen.pullSheetEmail}. The email transport is not built yet, so each scheduled send waits and opens a case; download the sheet here meanwhile.`
                : `On for the company, but ${originLabel(chosen)} has no send address or time yet (Admin: Markets & stock, edit the warehouse).`
              : "Off (Company settings). Nothing is emailed; the warehouse gets the sheet from the Download button."}
          </p>
        </div>
      ) : null}
    </Page>
  );
}
