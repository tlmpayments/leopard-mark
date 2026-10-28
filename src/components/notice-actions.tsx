import { Button, Input, Select } from "@/components/ui";
import { noticeOutcomeAction, reissueNoticeAction } from "@/app/admin/notices/actions";

/**
 * Manual-process controls for one notice (UX-08): record sent/failed/unknown
 * with how and evidence, or re-issue a new version with a corrected recipient.
 */
export function NoticeActions({ noticeId, state, returnTo, recipientEmail }: { noticeId: string; state: string; returnTo: string; recipientEmail: string | null }) {
  const pending = state === "manual_pending" || state === "intended";
  return (
    <div className="mt-1 space-y-1">
      {pending ? (
        <form action={noticeOutcomeAction} className="flex flex-wrap items-end gap-2 text-xs">
          <input type="hidden" name="noticeId" value={noticeId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Select name="outcome" defaultValue="sent" className="max-w-[9rem]" aria-label="Outcome">
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="unknown">Unknown</option>
          </Select>
          {!recipientEmail ? <Input name="recipientEmail" type="email" placeholder="Recipient email" className="max-w-[14rem]" aria-label="Recipient email" /> : null}
          <Input name="sentVia" placeholder="How (e.g. Gmail ops@)" className="max-w-[12rem]" aria-label="How it was sent" required />
          <Input name="evidence" placeholder="Evidence (message id / time / what failed)" className="max-w-[18rem]" aria-label="Evidence" required />
          <Button small variant="secondary">Record outcome</Button>
        </form>
      ) : null}
      {state === "failed" || state === "unknown" || state === "sent" ? (
        <form action={reissueNoticeAction} className="flex flex-wrap items-end gap-2 text-xs">
          <input type="hidden" name="noticeId" value={noticeId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input name="recipientEmail" type="email" placeholder={recipientEmail ?? "Recipient email"} className="max-w-[14rem]" aria-label="New recipient email" />
          <Input name="reason" placeholder="Why re-issue?" className="max-w-[14rem]" aria-label="Reason" required />
          <Button small variant="ghost">Re-issue as new version</Button>
        </form>
      ) : null}
    </div>
  );
}
