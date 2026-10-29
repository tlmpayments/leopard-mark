import { Flash, Page } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { visibleMarkets } from "@/lib/domain/markets/service";
import { createLocationFormAction } from "../actions";
import { LocationForm } from "./location-form";

export default async function NewLocationPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("location.create");
  const markets = await visibleMarkets(await getDb(), actor, ["owner", "admin", "sales"]);
  const flash = await flashFrom(searchParams);
  return (
    <Page title="New account" subtitle="The minimum is the trade name, a delivery address, one contact and the market (R2-20). The ABC license is checked before the first retail delivery; everything else is optional and can follow." wide={false}>
      <Flash {...flash} />
      <LocationForm markets={markets.map((m) => ({ id: m.id, name: m.name, code: m.code }))} action={createLocationFormAction} />
    </Page>
  );
}
