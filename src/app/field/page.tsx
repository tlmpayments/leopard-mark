import { Card, Notice, Page, StateLine } from "@/components/ui";
import { requireAction } from "@/lib/auth/current";

/** Driver/Service home: only assigned execution context exists here, and none is built yet (phase 2). No route-wide customer or commercial data (REV-11/AC03). */
export default async function FieldPage() {
  await requireAction("field.view_assigned");
  return (
    <Page title="My route" subtitle="Assigned stops, receiving instructions, BOL, keg pickups and service tasks appear here once phase 2 is built.">
      <Card title="Today">
        <StateLine kind="provider_unavailable">Nothing is assigned to you. Route assignment and field capture are not built in this revision (phase 2), so this is an honest empty state — not a quiet day.</StateLine>
      </Card>
      <Notice tone="info">What phase 2 adds: stop order, receiving windows, current BOL, keg balance, accepted/refused/damaged capture, signature and photos. It requires the OptimoRoute capability gates (§49) to be demonstrated before first field use.</Notice>
    </Page>
  );
}
