import { Page } from "@/components/ui";
import { WorkQueue } from "@/components/work-queue";
import { param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";

export default async function ExceptionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("exception.view");
  const sp = await searchParams;
  return (
    <Page title="Exceptions" subtitle="One incident, linked consequences. Owner, state, next action, waiting party, review point, history.">
      <WorkQueue db={await getDb()} actor={actor} basePath="/admin/exceptions" title="Open cases" params={{ category: param(sp, "category"), owner: param(sp, "owner"), state: param(sp, "state"), market: param(sp, "market"), locationId: param(sp, "locationId") }} />
    </Page>
  );
}
