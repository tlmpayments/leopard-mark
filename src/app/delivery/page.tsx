import { Badge, Card, Notice, Page } from "@/components/ui";
import { requireActor } from "@/lib/auth/current";

export default async function Placeholder() {
  await requireActor();
  return (
    <Page title="Delivery" subtitle={<span>Phase 2 <Badge tone="warn">NOT BUILT IN THIS REVISION</Badge></span>}>
      <Card>
        <p className="text-sm">Scheduling queue, tentative planning, released commitments, warehouse load, BOL generation (no prices), OptimoRoute handoff, driver actuals, POD custody, route close.</p>
      </Card>
      <Notice tone="info">The domain records this phase writes already exist as bounded skeleton tables so that phase-1 views can say &ldquo;none yet&rdquo; truthfully. See docs/IMPLEMENTATION_STATUS.md.</Notice>
    </Page>
  );
}
