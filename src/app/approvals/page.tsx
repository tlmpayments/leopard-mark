import Link from "next/link";
import { Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Table, fmtDate } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { APPROVAL_KIND_LABEL, APPROVAL_PURPOSE_LABEL, APPROVAL_STATE_LABEL, approvalCounts, listApprovals, type ApprovalItem, type ApprovalKind, type ApprovalState, type EmailPayload } from "@/lib/domain/approvals/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { gmailConfigured } from "@/lib/integrations/gmail/adapter";
import { senderAddress } from "@/lib/domain/approvals/email";
import { approveAction, generateSetupLinkAction, recordSendAction, rejectAction, releaseStuckAction } from "./actions";
import "@/lib/domain/collection";

const VIEWS: Record<string, { label: string; states: ApprovalState[] }> = {
  pending: { label: "Waiting", states: ["pending"] },
  approved: { label: "Approved, to send by hand", states: ["approved", "executing"] },
  failed: { label: "Failed", states: ["failed"] },
  done: { label: "Done", states: ["done"] },
  closed: { label: "Rejected and withdrawn", states: ["rejected", "withdrawn"] },
};

function subjectHref(item: ApprovalItem): string | null {
  switch (item.subjectType) {
    case "invoice":
      return `/invoices/${item.subjectId}`;
    case "customer_location":
      return `/locations/${item.subjectId}`;
    case "credit_memo":
      return item.locationId ? `/locations/${item.locationId}` : null;
    case "warehouse":
      return `/shipments/end-of-day`;
    case "order":
      return `/orders/${item.subjectId}`;
    default:
      return null;
  }
}

/**
 * The approval queue (Round 4): everything that would leave the company, waiting for a person. Approve runs the effect
 * from the job queue (Stripe) or hands the email to Gmail when the switch is on; otherwise the person sends it by hand
 * and records the outcome here. Rejected and withdrawn items stay on record.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("approval.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const view = param(sp, "view") ?? "pending";
  const kindFilter = param(sp, "kind") as ApprovalKind | undefined;
  const focus = param(sp, "focus");
  const d = await getDb();
  const [rows, counts, settings] = await Promise.all([listApprovals(d, actor, { states: VIEWS[view]?.states ?? VIEWS.pending.states, kinds: kindFilter ? [kindFilter] : undefined }), approvalCounts(d), getCompanySettings(d)]);
  const canDecide = can(actor, "approval.decide");
  const returnTo = `/approvals?view=${view}${kindFilter ? `&kind=${kindFilter}` : ""}`;
  const emailAuto = settings.sendEmailAutomatically && gmailConfigured();
  const tab = (key: string, label: string, count?: number) => (
    <Link key={key} href={`/approvals?view=${key}${kindFilter ? `&kind=${kindFilter}` : ""}`} aria-current={view === key ? "page" : undefined} className={`px-3 py-1 text-sm ${view === key ? "bg-navy text-paper" : "border border-rule text-ink"}`}>
      {label}
      {count ? <span className="ml-1 tabular-nums">{count}</span> : null}
    </Link>
  );

  return (
    <Page
      title="Approvals"
      subtitle="Nothing leaves the company on its own. Every email, Stripe invoice, debit and credit note waits here for a person; approved items run from the queue, or are sent by hand and recorded."
      actions={
        <form method="get" className="flex items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <Select name="kind" defaultValue={kindFilter ?? ""} aria-label="Kind">
            <option value="">All kinds</option>
            {(Object.keys(APPROVAL_KIND_LABEL) as ApprovalKind[]).map((k) => (
              <option key={k} value={k}>
                {APPROVAL_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
          <Button small variant="secondary">
            Filter
          </Button>
        </form>
      }
    >
      <Flash {...flash} />
      <nav aria-label="Approval views" className="flex flex-wrap gap-2">
        {tab("pending", "Waiting", counts.pending)}
        {tab("approved", "Approved, by hand", counts.approved + counts.executing)}
        {tab("failed", "Failed", counts.failed)}
        {tab("done", "Done")}
        {tab("closed", "Rejected and withdrawn")}
      </nav>
      {!emailAuto ? (
        <Notice tone="info" title="Emails are sent by hand.">
          Automatic sending is {settings.sendEmailAutomatically ? "switched on but Gmail is not connected" : "switched off"} (Company settings). An approved email shows its text and attachments here; a person sends it from {settings.customerSenderAddress} or {settings.operationsSenderAddress} and records the outcome.
        </Notice>
      ) : null}
      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">Nothing here.</p>
        </Card>
      ) : null}
      {rows.map(({ item, location }) => {
        const href = subjectHref(item);
        const payload = item.kind === "email" ? (item.payload as unknown as EmailPayload) : null;
        const result = (item.result ?? {}) as Record<string, unknown>;
        const manualEmail = item.kind === "email" && (item.state === "approved" || item.state === "pending") && (item.transport === "manual" || !emailAuto);
        return (
          <Card key={item.id} id={item.id} className={focus === item.id ? "ring-1 ring-navy" : ""}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm">
                  <span className="font-display text-[11px] uppercase tracking-[0.14em] text-ink-2">{APPROVAL_KIND_LABEL[item.kind]}</span>
                  <span className="mx-2 text-ink-3">·</span>
                  <span className="font-medium">{item.title}</span>
                </div>
                <div className="mt-1 text-xs text-ink-3">
                  {APPROVAL_PURPOSE_LABEL[item.purpose] ?? item.purpose} · from {item.sender === "stripe" ? "Stripe" : senderAddress(item.sender, settings)} · requested {fmtDate(item.createdAt)}
                  {item.autoApproved ? " · approved by company policy" : ""}
                  {location ? (
                    <>
                      {" · "}
                      <Link href={`/locations/${location.id}`} className="text-navy hover:underline">
                        {location.tradeName}
                      </Link>
                    </>
                  ) : null}
                  {href ? (
                    <>
                      {" · "}
                      <Link href={href} className="text-navy hover:underline">
                        open {item.subjectType.replace(/_/g, " ")}
                      </Link>
                    </>
                  ) : null}
                </div>
                {item.summary ? <p className="mt-1 text-sm text-ink-2">{item.summary}</p> : null}
              </div>
              <div className="flex items-center gap-3">
                {item.amountCents != null ? <span className="tabular-nums text-sm">{formatCents(item.amountCents)}</span> : null}
                <StatusBadge value={item.state} title={APPROVAL_STATE_LABEL[item.state]} />
              </div>
            </div>
            {payload ? (
              <details className="mt-2 text-sm" open={manualEmail}>
                <summary className="cursor-pointer text-navy">Message</summary>
                <div className="mt-1 border border-rule-soft bg-paper p-3 text-sm">
                  <p>
                    <span className="text-ink-3">To:</span> {payload.to.join(", ")}
                    {payload.cc?.length ? (
                      <>
                        {" "}
                        <span className="text-ink-3">Cc:</span> {payload.cc.join(", ")}
                      </>
                    ) : null}
                  </p>
                  <p>
                    <span className="text-ink-3">Subject:</span> {payload.subject}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans">{typeof result.setupUrl === "string" ? payload.body.replace("{setup_link}", result.setupUrl) : payload.body}</pre>
                  {payload.attachments?.length ? (
                    <p className="mt-2 text-xs text-ink-3">
                      Attachments:{" "}
                      {payload.attachments.map((a, i) => (
                        <span key={i}>
                          {i ? ", " : ""}
                          {a.kind === "invoice_pdf" ? (
                            <a href={`/invoices/${a.invoiceId}/pdf`} target="_blank" rel="noopener" className="text-navy hover:underline">
                              invoice PDF
                            </a>
                          ) : a.kind === "pull_sheet" ? (
                            <a href={`/shipments/end-of-day?warehouse=${a.warehouseId}&date=${a.date}`} className="text-navy hover:underline">
                              pull sheet {a.date}
                            </a>
                          ) : (
                            "document"
                          )}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {payload.setupLink && typeof result.setupUrl !== "string" ? (
                    <p className="mt-2 text-xs text-ink-3">The bank setup link is generated when this is sent{manualEmail && canDecide ? "; generate it below to paste it into your email" : ""}.</p>
                  ) : null}
                </div>
              </details>
            ) : null}
            {item.kind !== "email" ? (
              <p className="mt-2 text-xs text-ink-3">
                {item.kind === "stripe_debit" ? "Approving runs the ACH debit against the bank on file; Stripe reports the result in a few business days." : item.kind === "stripe_invoice" ? "Approving creates the Stripe copy under the portal's number; Stripe emails nothing." : "Approving creates the Stripe credit note against the mirrored invoice."}
              </p>
            ) : null}
            {Object.keys(result).length && item.state === "done" ? <p className="mt-2 text-xs text-ink-3">Result: {Object.entries(result).filter(([k]) => k !== "setupUrl").map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ")}</p> : null}
            {item.lastError ? <p className="mt-2 text-sm text-ink">Error: {item.lastError}</p> : null}
            {item.decidedAt ? (
              <p className="mt-1 text-xs text-ink-3">
                {APPROVAL_STATE_LABEL[item.state]} {fmtDate(item.decidedAt)}
                {item.decisionNote ? `: ${item.decisionNote}` : ""}
              </p>
            ) : null}
            {canDecide && (item.state === "pending" || item.state === "failed") ? (
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <form action={approveAction} className="flex items-end gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Button small>{item.state === "failed" ? "Approve again (retry)" : "Approve"}</Button>
                </form>
                <form action={rejectAction} className="flex items-end gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Input name="reason" required placeholder="Reason to reject" aria-label="Reason to reject" />
                  <Button small variant="danger">
                    Reject
                  </Button>
                </form>
              </div>
            ) : null}
            {canDecide && manualEmail ? (
              <div className="mt-3 border-t border-rule-soft pt-3">
                {payload?.setupLink && typeof result.setupUrl !== "string" ? (
                  <form action={generateSetupLinkAction} className="mb-2">
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <Button small variant="secondary">
                      Generate the bank setup link
                    </Button>
                  </form>
                ) : null}
                <form action={recordSendAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Field label="Sent by hand">
                    <Select name="outcome" defaultValue="sent" aria-label="Outcome">
                      <option value="sent">Sent</option>
                      <option value="failed">Could not send</option>
                    </Select>
                  </Field>
                  <Field label="How">
                    <Input name="sentVia" required defaultValue={`Gmail from ${senderAddress(item.sender, settings)}`} />
                  </Field>
                  <Field label="Evidence">
                    <Input name="evidence" required placeholder="message id, time, or what failed" />
                  </Field>
                  <Button small variant="secondary">
                    Record
                  </Button>
                </form>
              </div>
            ) : null}
            {canDecide && item.state === "executing" ? (
              <form action={releaseStuckAction} className="mt-2">
                <input type="hidden" name="itemId" value={item.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button small variant="ghost">
                  Running since {fmtDate(item.updatedAt)}; release if stuck
                </Button>
              </form>
            ) : null}
          </Card>
        );
      })}
      {view === "done" && rows.length ? (
        <Table
          caption="Done, most recent first"
          head={["When", "Kind", "Title", "Amount"]}
          widths={[LIST_WIDTHS.date, "9rem", undefined, LIST_WIDTHS.money]}
          align={["left", "left", "left", "right"]}
          rows={rows.slice(0, 50).map(({ item }) => [fmtDate(item.executedAt ?? item.updatedAt), APPROVAL_KIND_LABEL[item.kind], item.title, item.amountCents != null ? formatCents(item.amountCents) : ""])}
        />
      ) : null}
    </Page>
  );
}
