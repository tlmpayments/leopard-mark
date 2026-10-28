import Link from "next/link";
import { NoticeActions } from "@/components/notice-actions";
import { Button, Card, Flash, Page, StatusBadge, fmtDate } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { NOTICE_PURPOSE_LABEL, listNotices, noticeSubjectLabel } from "@/lib/domain/notices/service";

/**
 * Manual single-sender work queue (UX-08 / REV-18): what to send, to whom,
 * with what content; record the outcome with evidence; re-issue when needed.
 * No automatic sender exists while D32/IG04 stays unselected.
 */
export default async function NoticesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("notice.view");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const view = param(sp, "view") ?? "pending";
  const focus = param(sp, "focus");
  const d = await getDb();
  const states = view === "pending" ? ["manual_pending", "intended"] : view === "problems" ? ["failed", "unknown"] : view === "sent" ? ["sent"] : undefined;
  const rows = await listNotices(d, actor, { states, limit: 200 });
  const subjects = await Promise.all(rows.map((r) => noticeSubjectLabel(d, r.n)));
  const canRecord = can(actor, "notice.record_outcome");
  const tab = (key: string, label: string) => (
    <Link key={key} href={`/admin/notices?view=${key}`} aria-current={view === key ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm ${view === key ? "bg-accent text-white" : "bg-line/60"}`}>
      {label}
    </Link>
  );
  return (
    <Page title="Customer notices" subtitle="Manual single-sender process (D32/IG04 unselected): a person sends each notice from the company mailbox and records the outcome here with evidence. Nothing is sent automatically.">
      <Flash {...flash} />
      <nav aria-label="Notice views" className="flex flex-wrap gap-2">
        {tab("pending", "To send")}
        {tab("problems", "Failed / unknown")}
        {tab("sent", "Sent")}
        {tab("all", "All")}
      </nav>
      <Card title={`${rows.length} notice(s)`}>
        {rows.length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : null}
        <ul className="divide-y divide-line">
          {rows.map(({ n, loc }, i) => {
            const content = (n.content ?? {}) as { subject?: string; summary?: string; lines?: Array<{ sku: string; qty: number }> };
            return (
              <li key={n.id} id={n.id} className={`py-3 ${focus === n.id ? "bg-warn-soft/40" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {NOTICE_PURPOSE_LABEL[n.purpose] ?? n.purpose} · v{n.version} ·{" "}
                      <Link href={subjects[i].href} className="underline">
                        {subjects[i].label}
                      </Link>
                      {loc && subjects[i].label !== loc.tradeName ? <span className="text-muted"> · {loc.tradeName}</span> : null}
                    </div>
                    <div className="text-xs text-muted">
                      To: {n.recipientEmail ?? <span className="text-danger">no recipient email — add one on the account or when recording</span>} · created {fmtDate(n.createdAt)}
                    </div>
                  </div>
                  <StatusBadge value={n.state} />
                </div>
                <details className="mt-1 text-sm">
                  <summary className="cursor-pointer text-accent">Content to send</summary>
                  <div className="mt-1 rounded-lg bg-background p-2 text-sm">
                    {content.subject ? (
                      <p>
                        <strong>Subject:</strong> {content.subject}
                      </p>
                    ) : null}
                    <p>{content.summary}</p>
                    {content.lines?.length ? (
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {content.lines.map((l, j) => (
                          <li key={j}>
                            {l.sku} × {l.qty}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </details>
                {n.outcomeNote ? (
                  <p className="mt-1 text-xs text-muted">
                    Outcome: {n.outcomeNote} — via {n.sentVia}, recorded {fmtDate(n.outcomeRecordedAt)}. {n.state === "sent" ? "Staff evidence; not provider-confirmed delivery." : ""}
                  </p>
                ) : null}
                {canRecord ? <NoticeActions noticeId={n.id} state={n.state} returnTo={`/admin/notices?view=${view}`} recipientEmail={n.recipientEmail} /> : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <div>
        <Button href="/integrations" variant="secondary">
          Provider status (Gmail transport is boundary-only)
        </Button>
      </div>
    </Page>
  );
}
