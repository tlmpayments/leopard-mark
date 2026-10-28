import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { receiveStripeWebhook } from "@/lib/integrations/stripe/adapter";

/**
 * Stripe webhook endpoint. Verifies the signature and records the event
 * idempotently. Phase 1 defers financial consequences (no invoice/payment
 * module yet); nothing here mutates business state.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  try {
    const result = await receiveStripeWebhook((await getDb()), raw, req.headers.get("stripe-signature"));
    return NextResponse.json({ received: true, ...result });
  } catch (err) {
    return new NextResponse(err instanceof Error ? err.message : "Webhook error", { status: 400 });
  }
}
