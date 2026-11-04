"use server";

import { eq } from "drizzle-orm";
import { opt, runAction, str } from "@/lib/actions/helpers";
import { authorize } from "@/lib/authz/authorize";
import * as schema from "@/lib/db/schema";
import { BusinessError } from "@/lib/errors";
import { approveItem, getApproval, recordManualSend, rejectItem } from "@/lib/domain/approvals/service";
import { setupLinkFor } from "@/lib/domain/approvals/email";
import { runDueJobs } from "@/lib/jobs/queue";
import "@/lib/domain/collection";

function back(form: FormData) {
  return opt(form, "returnTo") ?? "/approvals";
}

/** The same view, scrolled to and outlined on one item. */
function focused(path: string, itemId: string) {
  const base = path.replace(/([?&])focus=[^&]*&?/, "$1").replace(/[?&]$/, "");
  return `${base}${base.includes("?") ? "&" : "?"}focus=${itemId}`;
}

export async function approveAction(form: FormData) {
  return runAction(back(form), async ({ db, actor }) => {
    const item = await approveItem(db, actor, str(form, "itemId"), opt(form, "note"));
    // An email sent by hand: land on the item in the "by hand" view, where its text and the record form are.
    if (item.transport === "manual") return { ok: `Approved. ${item.kind === "email" ? "Send it by hand and record the outcome below." : ""}`, redirectTo: `/approvals?view=approved&focus=${item.id}` };
    // Run the queue now so the person sees the result rather than waiting for the next cron tick.
    await runDueJobs(db, { limit: 10, workerId: `approve-${actor.employeeId ?? "owner"}` });
    const after = await getApproval(db, item.id);
    const state = after?.item.state;
    if (state === "done") return { ok: "Approved and done.", redirectTo: `/approvals?view=done&focus=${item.id}` };
    if (state === "failed") return { ok: `Approved, but it failed: ${after?.item.lastError ?? "see the item"}`, redirectTo: `/approvals?view=failed&focus=${item.id}` };
    return "Approved; it runs from the queue and the result shows here.";
  });
}

export async function rejectAction(form: FormData) {
  return runAction(back(form), async ({ db, actor }) => {
    await rejectItem(db, actor, str(form, "itemId"), str(form, "reason"));
    return "Rejected; kept on record.";
  });
}

export async function recordSendAction(form: FormData) {
  return runAction(back(form), async ({ db, actor }) => {
    const outcome = str(form, "outcome") === "failed" ? "failed" : "sent";
    await recordManualSend(db, actor, str(form, "itemId"), { outcome, sentVia: str(form, "sentVia"), evidence: str(form, "evidence") });
    return outcome === "sent" ? "Recorded as sent by hand." : "Recorded as failed.";
  });
}

/** For a bank setup email sent by hand: generate the hosted link now so the person can paste it. */
export async function generateSetupLinkAction(form: FormData) {
  return runAction(back(form), async ({ db, actor }) => {
    const row = await getApproval(db, str(form, "itemId"));
    if (!row) throw new BusinessError("Item not found");
    authorize(actor, "approval.decide", { marketId: row.item.marketId });
    if (row.item.kind !== "email" || row.item.purpose !== "payment_setup_link") throw new BusinessError("This item carries no setup link");
    const url = await setupLinkFor(db, row.item);
    if (!url) throw new BusinessError("No link could be generated");
    return { ok: "Setup link generated; it is shown on the item (bearer link, send only to the payer).", redirectTo: focused(back(form), row.item.id) };
  });
}

/** Mark a stuck executing item back to approved (a worker died mid-run) so it can run again. */
export async function releaseStuckAction(form: FormData) {
  return runAction(back(form), async ({ db, actor }) => {
    const row = await getApproval(db, str(form, "itemId"));
    if (!row) throw new BusinessError("Item not found");
    authorize(actor, "approval.decide", { marketId: row.item.marketId });
    if (row.item.state !== "executing") throw new BusinessError("Only a running item is released");
    if (row.item.updatedAt.getTime() > Date.now() - 15 * 60_000) throw new BusinessError("It started less than 15 minutes ago; give it time");
    await db.update(schema.approvalItem).set({ state: "failed", lastError: "Released by hand after running for more than 15 minutes; the provider effect is unknown", updatedAt: new Date() }).where(eq(schema.approvalItem.id, row.item.id));
    return "Marked failed so it can be checked and approved again.";
  });
}
