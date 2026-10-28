import { Badge, Card, Notice, Page } from "@/components/ui";
import { requireActor } from "@/lib/auth/current";

export default async function Placeholder() {
  await requireActor();
  return (
    <Page title="Customer self-service" subtitle={<span>Phase 5 <Badge tone="warn">DEFERRED [F]</Badge></span>}>
      <Card>
        <p className="text-sm">DEFERRED [F]. Lightweight secure products/prices/reorder/standing/invoices/payment/kegs. Broader portal and magic-link design is not authorized; necessary Stripe-hosted setup/documents remain available now (SD03/IG10).</p>
      </Card>
      <Notice tone="info">The domain records this phase writes already exist as bounded skeleton tables so that phase-1 views can say &ldquo;none yet&rdquo; truthfully. See docs/IMPLEMENTATION_STATUS.md.</Notice>
    </Page>
  );
}
