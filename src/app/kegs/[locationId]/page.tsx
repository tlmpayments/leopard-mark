import Link from "next/link";
import { notFound } from "next/navigation";
import { inArray } from "drizzle-orm";
import { Badge, Button, Card, Flash, KV, Page, Table, fmtDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { getLocation } from "@/lib/domain/customers/service";
import { kegBalances, kegHistory } from "@/lib/domain/kegs/service";
import { todayIso } from "../../shipments/labels";
import { KegEventForm } from "../keg-event-form";

export default async function KegAccountPage({ params, searchParams }: { params: Promise<{ locationId: string }>; searchParams: SearchParams }) {
  const { locationId } = await params;
  const d = await getDb();
  const detail = /^[0-9a-f-]{36}$/i.test(locationId) ? await getLocation(d, locationId) : null;
  if (!detail) notFound();
  const loc = detail.location;
  const actor = await requireAction("keg.view", loc.marketId);
  const flash = await flashFrom(searchParams);
  const [balance] = await kegBalances(d, actor, { locationId });
  const events = await kegHistory(d, locationId, 200);
  const shipmentIds = events.map((e) => e.shipmentId).filter((x): x is string => Boolean(x));
  const shipments = shipmentIds.length ? await d.select({ id: schema.shipment.id, number: schema.shipment.number }).from(schema.shipment).where(inArray(schema.shipment.id, shipmentIds)) : [];
  const numberOf = new Map(shipments.map((s) => [s.id, s.number]));
  const canRecord = can(actor, "keg.record", { marketId: loc.marketId });

  return (
    <Page
      title={`Kegs at ${loc.tradeName}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <Link href={`/locations/${loc.id}`} className="underline">
            Account page
          </Link>
          <Badge>{detail.market?.code}</Badge>
          <Badge>{loc.kind}</Badge>
        </span>
      }
      actions={
        <Button href="/kegs" variant="secondary">
          All balances
        </Button>
      }
    >
      <Flash {...flash} />
      <Card title="Balance">
        <KV
          items={[
            ["1/2 bbl out at the account", <strong key="h">{balance?.halfBalance ?? 0}</strong>],
            ["1/6 bbl out at the account", <strong key="s">{balance?.sixtelBalance ?? 0}</strong>],
            ["1/2 bbl delivered / returned", balance ? `${balance.halfOut} / ${balance.halfIn}` : "0 / 0"],
            ["1/6 bbl delivered / returned", balance ? `${balance.sixtelOut} / ${balance.sixtelIn}` : "0 / 0"],
            ["Last event", fmtDay(balance?.lastEventOn)],
            ["Deposit mode", loc.depositMode.replace(/_/g, " ")],
          ]}
        />
      </Card>
      <Card title="History">
        <Table
          caption="Keg events"
          head={["Date", "Kind", "Shipment", "1/2 out", "1/6 out", "1/2 in", "1/6 in", "Note"]}
          rows={events.map((e) => [
            fmtDay(e.on),
            e.kind,
            e.shipmentId ? (
              <Link key="s" href={`/shipments/${e.shipmentId}`} className="underline">
                {numberOf.get(e.shipmentId) ?? "shipment"}
              </Link>
            ) : (
              "—"
            ),
            String(e.halfOut),
            String(e.sixtelOut),
            String(e.halfIn),
            String(e.sixtelIn),
            e.note ?? "—",
          ])}
        />
      </Card>
      {canRecord ? (
        <Card title="Record an opening balance, adjustment or pickup">
          <KegEventForm locations={[]} locationId={loc.id} returnTo={`/kegs/${loc.id}`} today={todayIso()} />
        </Card>
      ) : null}
    </Page>
  );
}
