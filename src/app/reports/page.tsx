import { Badge, Card, Notice, Page } from "@/components/ui";
import { requireActor } from "@/lib/auth/current";

export default async function Placeholder() {
  await requireActor();
  return (
    <Page title="Management intelligence" subtitle={<span>Phase 6 <Badge tone="warn">NOT BUILT IN THIS REVISION</Badge></span>}>
      <Card>
        <p className="text-sm">Sales/account/operational/financial visibility and automation/manual-effort measures. D31 metric definitions are unselected — nothing here fabricates revenue, dormancy or automation figures.</p>
      </Card>
      <Notice tone="info">The domain records this phase writes already exist as bounded skeleton tables so that phase-1 views can say &ldquo;none yet&rdquo; truthfully. See docs/IMPLEMENTATION_STATUS.md.</Notice>
    </Page>
  );
}
