"use server";

import { recordAudit } from "@/lib/audit/record";
import { runAction, str } from "@/lib/actions/helpers";
import { authorize } from "@/lib/authz/authorize";
import { BusinessError } from "@/lib/errors";
import { recordGateStatus, type GateStatus } from "@/lib/integrations/gates";
import { providerStatuses, recordActivation, type Provider } from "@/lib/integrations/registry";
import { checkStripeConnection } from "@/lib/integrations/stripe/adapter";
import { checkGmailConnection } from "@/lib/integrations/gmail/adapter";
import { disconnectMailbox } from "@/lib/integrations/gmail/connection";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { importStripeCustomersForMatching, importStripeInvoicesForMatching, syncPayouts } from "@/lib/domain/collection";

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

export async function checkGmailAction() {
  return runAction("/integrations", async ({ db, actor }) => {
    authorize(actor, "integration.manage");
    const settings = await getCompanySettings(db);
    const r = await checkGmailConnection(db, settings.intakeMailboxAddress);
    await recordAudit(db, actor, { action: "gmail.connection_check", subjectType: "provider", subjectId: "gmail", current: { ok: r.ok, mailbox: settings.intakeMailboxAddress } });
    return r.ok ? `Gmail reachable as ${settings.intakeMailboxAddress} (${String(r.detail.messagesTotal)} messages in the mailbox). Reading starts when the intake switch is on; sending when the send switch is on.` : `Gmail not connected: ${String(r.detail.reason ?? r.detail.error)}`;
  });
}

export async function importStripeMatchesAction() {
  return runAction("/admin/stripe-matches", async ({ db, actor }) => {
    const r = await importStripeCustomersForMatching(db, actor);
    const i = await importStripeInvoicesForMatching(db, actor);
    return `${r.imported} Stripe customer(s) without a portal account imported (${r.suggested} with a suggested match); ${i.imported} open or recent Stripe invoice(s) the portal did not create (${i.suggested} with a suggested invoice). Confirm each one below.`;
  });
}

export async function syncPayoutsAction() {
  return runAction("/finance", async ({ db, actor }) => {
    authorize(actor, "integration.manage");
    const r = await syncPayouts(db);
    return `${r.payouts} payout(s) and ${r.transactions} balance transaction(s) pulled from Stripe.`;
  });
}

export async function disconnectMailboxAction(form: FormData) {
  return runAction("/integrations", async ({ db, actor }) => {
    const mailbox = String(form.get("mailbox") ?? "");
    const r = await disconnectMailbox(db, actor, mailbox, String(form.get("reason") ?? ""));
    return r.revoked ? `${mailbox} disconnected; Google revoked the sign-in.` : `${mailbox} disconnected here. Google did not confirm the revocation; remove the portal's access under that mailbox's Google Account, Security, Third-party connections.`;
  });
}
