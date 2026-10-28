import { Badge, Card, Notice, Page } from "@/components/ui";
import { requireActor } from "@/lib/auth/current";

export default async function Placeholder() {
  await requireActor();
  return (
    <Page title="Kegs & service" subtitle={<span>Phase 4 <Badge tone="warn">NOT BUILT IN THIS REVISION</Badge></span>}>
      <Card>
        <p className="text-sm">Count-based keg custody and $35 deposits, returns and validated credit entitlement (U17 next-finalized application by Stripe), discrepancies, and the cleaning clock (roughly biweekly with the next delivery; D26 unselected).</p>
      </Card>
      <Notice tone="info">The domain records this phase writes already exist as bounded skeleton tables so that phase-1 views can say &ldquo;none yet&rdquo; truthfully. See docs/IMPLEMENTATION_STATUS.md.</Notice>
    </Page>
  );
}
