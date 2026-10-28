"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { recordNoticeOutcome, reissueNotice, type NoticeOutcome } from "@/lib/domain/notices/service";

function safeReturn(form: FormData) {
  const r = str(form, "returnTo");
  return r.startsWith("/") && !r.startsWith("//") ? r : "/admin/notices";
}

export async function noticeOutcomeAction(form: FormData) {
  return runAction(safeReturn(form), async ({ db, actor }) => {
    const outcome = str(form, "outcome") as NoticeOutcome;
    if (!["sent", "failed", "unknown"].includes(outcome)) throw new Error("Choose an outcome");
    const row = await recordNoticeOutcome(db, actor, { noticeId: str(form, "noticeId"), outcome, sentVia: str(form, "sentVia"), evidence: str(form, "evidence"), recipientEmail: opt(form, "recipientEmail") });
    return outcome === "sent" ? `Recorded as sent to ${row.recipientEmail} (staff evidence, not provider confirmation)` : outcome === "failed" ? "Recorded as failed; follow-up case opened" : "Recorded as unknown; establish delivery before re-sending";
  });
}

export async function reissueNoticeAction(form: FormData) {
  return runAction(safeReturn(form), async ({ db, actor }) => {
    const row = await reissueNotice(db, actor, str(form, "noticeId"), { recipientEmail: opt(form, "recipientEmail") ?? undefined, reason: str(form, "reason") });
    return `Version ${row.version} issued for the manual sender; the previous version is kept as history`;
  });
}
