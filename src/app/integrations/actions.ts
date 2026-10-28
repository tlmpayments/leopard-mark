"use server";

import { recordAudit } from "@/lib/audit/record";
import { runAction, str } from "@/lib/actions/helpers";
import { authorize } from "@/lib/authz/authorize";
import { BusinessError } from "@/lib/errors";
import { recordGateStatus, type GateStatus } from "@/lib/integrations/gates";
import { providerStatuses, recordActivation, type Provider } from "@/lib/integrations/registry";
import { checkStripeConnection } from "@/lib/integrations/stripe/adapter";

export async function checkStripeAction() {
  return runAction("/integrations", async ({ db, actor }) => {
    authorize(actor, "integration.manage");
    const r = await checkStripeConnection(db);
    await recordAudit(db, actor, { action: "stripe.connection_check", subjectType: "provider", subjectId: "stripe", current: { ok: r.ok, accountId: r.detail.accountId ?? null, environment: r.detail.environment ?? null } });
    return r.ok ? `Stripe reachable (${String(r.detail.environment)} mode, account ${String(r.detail.accountId)}). Waiting work resumed. Connectivity is not capability acceptance.` : `Stripe not connected: ${String(r.detail.reason ?? r.detail.error)}`;
  });
}

export async function recordGateAction(form: FormData) {
  return runAction("/integrations", async ({ db, actor }) => {
    await recordGateStatus(db, actor, str(form, "gateId"), str(form, "status") as GateStatus, str(form, "evidence"));
    return "Gate status recorded (with evidence). This does not activate anything by itself.";
  });
}

/** Explicit activation act: only meaningful while the connection is verified; recorded with evidence and audit. */
export async function activationAction(form: FormData) {
  return runAction("/integrations", async ({ db, actor }) => {
    authorize(actor, "integration.manage");
    const provider = str(form, "provider") as Provider;
    const accepted = str(form, "accepted") === "true";
    const status = (await providerStatuses(db)).find((s) => s.provider === provider);
    if (!status) throw new BusinessError("Unknown provider");
    if (accepted) {
      if (status.connection !== "ok") throw new BusinessError("Acceptance for live use needs a currently verified connection.");
      if (!str(form, "evidence")) throw new BusinessError("Evidence / approval reference is required", { field: "evidence" });
      if (status.capability === "unproven") throw new BusinessError("No capability gate is demonstrated yet; acceptance for live use would misrepresent readiness.");
    }
    await recordActivation(db, provider, accepted);
    await recordAudit(db, actor, { action: accepted ? "integration.accept_live" : "integration.withdraw_live", subjectType: "provider", subjectId: provider, current: { accepted, capability: status.capability, environment: status.environment }, reason: str(form, "evidence") || null });
    return accepted ? "Recorded as accepted for live use (explicit act; revert any time)." : "Live acceptance withdrawn.";
  });
}
