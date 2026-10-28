import { Badge, Card, Notice, Page } from "@/components/ui";
import { requireActor } from "@/lib/auth/current";

export default async function Placeholder() {
  await requireActor();
  return (
    <Page title="Finance" subtitle={<span>Phase 3 <Badge tone="warn">NOT BUILT IN THIS REVISION</Badge></span>}>
      <Card>
        <p className="text-sm">Stripe delivery-day invoices with delivery+30 due dates, collection permission at day 30, ACH outcomes and causal payment-failure holds, FinTech/external receipts, credits, reconciliation and the accountant-selected QBO handoff (one writer per effect).</p>
      </Card>
      <Notice tone="info">The domain records this phase writes already exist as bounded skeleton tables so that phase-1 views can say &ldquo;none yet&rdquo; truthfully. See docs/IMPLEMENTATION_STATUS.md.</Notice>
    </Page>
  );
}
