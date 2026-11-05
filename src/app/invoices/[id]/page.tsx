import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";
import { ActionPanel, Button, Card, Code, Columns, Empty, Field, Flash, Input, KV, Notice, RecordPage, Select, StatusBadge, Struck, Table, Tabs, fmtDate, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { PAY_BY_LABEL } from "@/lib/domain/customers/shipping";
import { creditMemosForInvoice, getInvoice } from "@/lib/domain/invoices/service";
import { COLLECTION_STATE_LABEL, PAYMENT_KIND_LABEL, debitEligibility, invoiceRecipients, mirrorable, paymentsForInvoice } from "@/lib/domain/collection";
import { approvalsForSubject, APPROVAL_KIND_LABEL, APPROVAL_STATE_LABEL } from "@/lib/domain/approvals/service";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { stripeConfigured } from "@/lib/integrations/stripe/adapter";
import { TYPE_LABEL, shipmentNumber, todayIso } from "../../shipments/labels";
import { emailInvoiceAction, issueCreditMemoAction, issueInvoiceAction, mirrorInvoiceAction, rePresentAction, recordPaymentReceivedAction, voidCreditMemoAction, voidInvoiceAction } from "../actions";

const LINE_KIND: Record<string, string> = { beer: "Beer", deposit: "Deposit", pos: "POS", info: "Info", freight: "Freight" };

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const d = await getDb();
  const detail = /^[0-9a-f-]{36}$/i.test(id) ? await getInvoice(d, id) : null;
  if (!detail) notFound();
  const { invoice: inv, lines, location, shipments, documents } = detail;
  const actor = await requireAction("invoice.view", inv.marketId);
  const flash = await flashFrom(searchParams);
  const canIssue = can(actor, "invoice.issue", { marketId: inv.marketId }) && !inv.legacy;
  const canVoid = can(actor, "invoice.void", { marketId: inv.marketId }) && !inv.legacy;
  const today = todayIso();

  const canCredit = can(actor, "credit.issue", { marketId: inv.marketId }) && !inv.legacy && (inv.status === "issued" || inv.status === "paid");
  const credits = await creditMemosForInvoice(d, inv.id);
  const creditedCents = credits.filter((c) => c.status === "issued").reduce((n, c) => n + c.amountCents, 0);
  // Round 4: Stripe as the money ledger. Payments, the Stripe copy, what is queued for approval.
  const [payments, approvals, settings, recipients, eligibility] = await Promise.all([paymentsForInvoice(d, inv.id), approvalsForSubject(d, "invoice", inv.id), getCompanySettings(d), inv.locationId ? invoiceRecipients(d, inv.locationId) : Promise.resolve([] as string[]), debitEligibility(d, inv)]);
  const paidCents = payments.filter((p) => p.state === "succeeded").reduce((n, p) => n + p.amountCents, 0);
  const openCents = Math.max(0, inv.totalCents - creditedCents - paidCents);
  const activeApprovals = approvals.filter((a) => a.state === "pending" || a.state === "approved" || a.state === "executing" || a.state === "failed");
  const canMirror = canIssue && stripeConfigured() && mirrorable(inv) && !inv.stripeInvoiceId && !activeApprovals.some((a) => a.kind === "stripe_invoice");

  const invoiceTab = (
    <>
      <Table
        caption="Invoice lines"
        head={["#", "Kind", "Description", "Lot", "Qty", "Unit", "Total"]}
        widths={["2.5rem", "5rem", undefined, LIST_WIDTHS.number, LIST_WIDTHS.qty, LIST_WIDTHS.money, LIST_WIDTHS.money]}
        align={["right", "left", "left", "left", "right", "right", "right"]}
        empty="No lines; they are computed from the shipments at issue."
        rows={lines.map((l) => [
          String(l.lineNo),
          LINE_KIND[l.kind] ?? l.kind,
          l.description,
          l.lotCode ? <Code key="c">{l.lotCode}</Code> : "—",
          l.kind === "info" ? "" : String(l.qty),
          l.kind === "info" ? "" : formatCents(l.unitPriceCents),
          l.kind === "info" ? "" : formatCents(l.lineTotalCents),
        ])}
      />
      <dl className="ml-auto mt-3 grid w-72 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        <dt className="text-ink-2">Subtotal</dt>
        <dd className="text-right tabular-nums">{formatCents(inv.subtotalCents)}</dd>
        <dt className="text-ink-2">Keg deposit</dt>
        <dd className="text-right tabular-nums">{formatCents(inv.depositCents)}</dd>
        <dt className="border-t border-rule pt-1 font-semibold">Total</dt>
        <dd className="border-t border-rule pt-1 text-right font-semibold tabular-nums">{formatCents(inv.totalCents)}</dd>
        {creditedCents > 0 ? (
          <>
            <dt className="text-ink-2">Credited</dt>
            <dd className="text-right tabular-nums">{formatCents(-creditedCents)}</dd>
            <dt className="text-ink-2">Net</dt>
            <dd className="text-right tabular-nums">{formatCents(inv.totalCents - creditedCents)}</dd>
          </>
        ) : null}
      </dl>
      {inv.status === "draft" ? <p className="mt-2 text-xs text-ink-3">Draft lines are recomputed at issue from what was delivered: prices captured at confirmation, refused or damaged units left off (R2-8, R2-9), deposit per the market rule or the account&apos;s deposit mode (3.10), MicroStar information lines for distributors (7.8).</p> : null}
    </>
  );

  const creditsTab = (
    <>
      <Table
        caption="Credit memos"
        head={["Number", "Date", "Reason", "Amount"]}
        widths={[LIST_WIDTHS.number, LIST_WIDTHS.date, undefined, LIST_WIDTHS.money]}
        align={["left", "left", "left", "right"]}
        empty="No credit memo against this invoice."
        rows={credits.map((c) => [
          c.status === "void" ? <Struck key="n">{c.number}</Struck> : <span key="n" className="font-display">{c.number}</span>,
          fmtDay(c.memoDate),
          c.status === "void" ? `${c.reason} (void: ${c.voidReason})` : c.reason,
          formatCents(c.amountCents),
        ])}
      />
      {canCredit && credits.some((c) => c.status === "issued") ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-navy">Void a credit memo</summary>
          <form action={voidCreditMemoAction} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="invoiceId" value={inv.id} />
            <Field label="Credit memo">
              <select name="creditMemoId" required defaultValue="" className="h-9 rounded-sm border border-rule bg-paper px-2 text-sm" aria-label="Credit memo">
                <option value="" disabled>
                  Credit memo
                </option>
                {credits
                  .filter((c) => c.status === "issued")
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number} {formatCents(c.amountCents)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Reason (required)">
              <Input name="reason" required />
            </Field>
            <Button small variant="danger">
              Void credit memo
            </Button>
          </form>
        </details>
      ) : null}
    </>
  );

  const paymentsTab = (
    <>
      <Table
        caption="Payments"
        head={["Date", "Kind", "State", "Reference", "Amount"]}
        widths={[LIST_WIDTHS.date, "11rem", LIST_WIDTHS.status, undefined, LIST_WIDTHS.money]}
        align={["left", "left", "left", "left", "right"]}
        empty={inv.status === "paid" ? "Paid before payments were recorded here." : "No payment yet."}
        rows={payments.map((p) => [fmtDate(p.occurredAt), PAYMENT_KIND_LABEL[p.kind], <StatusBadge key="s" value={p.state} />, [p.reference, p.failureCode ? `${p.failureCode}: ${p.failureMessage ?? ""}` : null, p.note].filter(Boolean).join("; ") || "—", formatCents(p.amountCents)])}
      />
      {approvals.length ? (
        <Table
          caption="Queued for approval"
          head={["Requested", "Kind", "Title", "State"]}
          widths={[LIST_WIDTHS.date, "9rem", undefined, LIST_WIDTHS.status]}
          rows={approvals.map((a) => [
            fmtDate(a.createdAt),
            APPROVAL_KIND_LABEL[a.kind],
            <Link key="t" href={`/approvals?view=${a.state === "pending" ? "pending" : a.state === "done" ? "done" : a.state === "failed" ? "failed" : a.state === "approved" || a.state === "executing" ? "approved" : "closed"}&focus=${a.id}`} className="text-navy hover:underline">
              {a.title}
            </Link>,
            <StatusBadge key="s" value={a.state} title={APPROVAL_STATE_LABEL[a.state]} />,
          ])}
        />
      ) : null}
    </>
  );

  const stripeCard = (
    <Card title="Collection (Stripe)">
      {!stripeConfigured() ? (
        <p className="text-sm text-ink-2">Stripe is not connected on this deployment; collection stays by hand.</p>
      ) : inv.series === "NC" ? (
        <p className="text-sm text-ink-2">No charge; nothing to collect.</p>
      ) : (
        <>
          <KV
            items={[
              ["Stripe copy", inv.stripeInvoiceId ? <span key="s">{inv.stripeNumber ?? inv.stripeInvoiceId}{inv.stripeNumber && inv.stripeNumber !== inv.number ? <span className="ml-1 text-xs text-ink-3">(Stripe&apos;s own number; the portal number is in its memo)</span> : null} <span className="ml-2 text-xs text-ink-3">{inv.stripeStatus ?? ""}</span></span> : activeApprovals.some((a) => a.kind === "stripe_invoice") ? "queued for approval" : inv.status === "draft" ? "mirrored once issued and delivered" : !settings.stripeMirrorInvoices ? "mirroring is switched off (Company settings)" : inv.payBy !== "stripe" ? `none (pays by ${inv.payBy ?? "an unset channel"}; the portal PDF is the invoice)` : "not mirrored"],
              ["Collection", <span key="c">{COLLECTION_STATE_LABEL[inv.collectionState] ?? inv.collectionState}{inv.debitScheduledOn && inv.collectionState === "scheduled" ? `, debit on ${fmtDay(inv.debitScheduledOn)}${inv.debitScheduledOn !== inv.dueDate ? " (next business day after the due date)" : ""}` : ""}</span>],
              ["Pay online", inv.hostedInvoiceUrl ? <a key="h" href={inv.hostedInvoiceUrl} target="_blank" rel="noopener" className="text-navy hover:underline">hosted page</a> : "—"],
              ["Open balance", formatCents(openCents)],
              ...(inv.payBy === "stripe" ? [["Debit", eligibility.ok ? `bank on file; ${eligibility.autoDebit ? "runs on the debit date without approval (account switch)" : "each debit waits for approval"}` : eligibility.reason ?? ""] as [string, React.ReactNode]] : []),
              ...(inv.failureCode ? [["Last return", `${inv.failureCode}: ${inv.failureMessage ?? ""} (${fmtDate(inv.failedAt)})`] as [string, React.ReactNode]] : []),
            ]}
          />
          {inv.mirrorError ? <p className="mt-2 text-xs text-ink-3">Stripe would not take the portal number: {inv.mirrorError}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {canMirror ? (
              <form action={mirrorInvoiceAction}>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Button small variant="secondary">
                  Mirror into Stripe now
                </Button>
              </form>
            ) : null}
            {canIssue && inv.collectionState === "failed" ? (
              <form action={rePresentAction} className="flex items-end gap-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Input name="reason" required placeholder="Why present it again (customer confirmed funds)" aria-label="Reason" />
                <Button small variant="secondary">
                  Re-present the debit
                </Button>
              </form>
            ) : null}
          </div>
          <p className="mt-3 text-xs text-ink-3">The portal invoice is the official one. Stripe holds a copy under the same number so the due-date debit has something to collect against and the hosted page shows the right amount; Stripe emails nothing (the Owner&apos;s rule).</p>
        </>
      )}
    </Card>
  );

  const documentsTab =
    documents.length === 0 ? (
      <Empty>The invoice document is stored at issue; a draft previews live from the PDF link above.</Empty>
    ) : (
      <ul className="divide-y divide-rule-soft text-sm">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center justify-between py-2">
            <span>
              Invoice <span className="font-display tabular-nums">{inv.number}</span> {doc.revision > 0 ? <span className="ml-1.5 text-[11px] text-ink-3">R{doc.revision}</span> : null}
              <span className="block text-xs text-ink-3">
                {fmtDate(doc.createdAt)}
                {doc.hasPdf ? "" : ", rendered on request"}
              </span>
            </span>
            {documents[0]?.id === doc.id ? (
              <a href={`/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-navy hover:underline">
                Open PDF
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    );

  return (
    <RecordPage
      number={inv.number ?? `${inv.series} draft`}
      status={<StatusBadge value={inv.status} />}
      meta={
        <>
          <span>{location ? <Link href={`/locations/${location.id}`} className="text-navy hover:underline">{location.tradeName}</Link> : "No account"}</span>
          <span className="text-ink-3">{inv.series === "NC" ? "NC, samples, no charge" : "INV"}</span>
          {inv.legacy ? <span className="text-ink-3">Sales tab history{inv.legacyStatus ? `: ${inv.legacyStatus}` : ""}</span> : null}
          {inv.invoiceDate ? <span>dated {fmtDay(inv.invoiceDate)}</span> : null}
          <span className="tabular-nums">{formatCents(inv.totalCents)}</span>
        </>
      }
      actions={
        <>
          <Button href={`/invoices/${inv.id}/pdf`} variant="secondary">
            {inv.status === "draft" ? "Preview PDF (draft)" : "Invoice PDF"}
          </Button>
          {inv.status === "draft" && canIssue ? (
            <ActionPanel label={`Issue ${inv.series}`} variant="primary">
              <form action={issueInvoiceAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Invoice date" hint="Normally the actual delivery or pickup date; delivery issues the draft on its own (7.4).">
                  <Input name="invoiceDate" type="date" required defaultValue={shipments.find((s) => s.actualDate)?.actualDate ?? today} />
                </Field>
                <Button small>Issue {inv.series}</Button>
              </form>
            </ActionPanel>
          ) : null}
          {inv.status === "issued" && canIssue ? (
            <ActionPanel label="Record payment" variant="primary">
              <form action={recordPaymentReceivedAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="How it arrived" hint={inv.payBy === "stripe" ? "A Stripe debit records itself when it settles; use this for a check or transfer that arrived instead." : "Fintech remittance, check or EFT, recorded by hand (S4)."}>
                  <Select name="kind" defaultValue={inv.payBy === "fintech" ? "fintech" : inv.payBy === "check" ? "check" : "eft"}>
                    <option value="fintech">Fintech</option>
                    <option value="check">Check</option>
                    <option value="eft">EFT / wire / MarginEdge ACH</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Amount (dollars)" hint={`Open balance ${formatCents(openCents)}; leave blank for the full balance. A short or over payment opens a case.`}>
                  <Input name="amount" type="number" step="0.01" min="0.01" inputMode="decimal" />
                </Field>
                <Field label="Received on">
                  <Input name="receivedOn" type="date" defaultValue={today} />
                </Field>
                <Field label="Reference">
                  <Input name="reference" placeholder="check number, remittance id" />
                </Field>
                <Field label="Note">
                  <Input name="note" />
                </Field>
                <Button small>Record payment</Button>
              </form>
            </ActionPanel>
          ) : null}
          {(inv.status === "issued" || inv.status === "paid") && canIssue && inv.locationId ? (
            <ActionPanel label="Email invoice" variant="secondary">
              <form action={emailInvoiceAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="To" hint="Queued for approval; sent from orders@ with the PDF attached and the pay-online link when there is one.">
                  <Input name="to" defaultValue={recipients.join(", ")} placeholder="ap@customer.com" />
                </Field>
                <Field label="Note to the customer">
                  <Input name="note" />
                </Field>
                <Button small variant="secondary">
                  Queue the email
                </Button>
              </form>
            </ActionPanel>
          ) : null}
          {canCredit ? (
            <ActionPanel label="Credit memo" variant="secondary">
              <form action={issueCreditMemoAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Amount (dollars)" hint={`Against ${inv.number}; credits so far ${formatCents(creditedCents)} of ${formatCents(inv.totalCents)}.`}>
                  <Input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" />
                </Field>
                <Field label="Date">
                  <Input name="memoDate" type="date" required defaultValue={today} />
                </Field>
                <Field label="Reason (required)">
                  <Input name="reason" required placeholder="e.g. short-dated kegs, agreed with the buyer" />
                </Field>
                <Button small>Issue CM</Button>
                <p className="text-xs text-ink-3">Own CM series; Owner or back office only (R2-14). The invoice itself never changes.</p>
              </form>
            </ActionPanel>
          ) : null}
          {canVoid && inv.status !== "void" && inv.status !== "paid" ? (
            <ActionPanel label="Void" variant="danger">
              <form action={voidInvoiceAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Reason (required)">
                  <Input name="reason" required />
                </Field>
                <Button small variant="danger">
                  Void invoice
                </Button>
                <p className="text-xs text-ink-3">The number is kept as a gap; a paid invoice is never voided (issue a credit instead).</p>
              </form>
            </ActionPanel>
          ) : null}
        </>
      }
    >
      <Flash {...flash} />
      {inv.status === "void" ? (
        <Notice tone="danger" title="Void.">
          {inv.voidReason} ({fmtDate(inv.voidedAt)})
        </Notice>
      ) : null}
      <Columns>
        <Card title="Invoice">
          <KV
            items={[
              ["Number", inv.number ?? "assigned when issued"],
              ["Account", location ? <Link key="l" href={`/locations/${location.id}`} className="text-navy hover:underline">{location.tradeName}</Link> : "—"],
              ["Invoice date", fmtDay(inv.invoiceDate)],
              ["Due date", fmtDay(inv.dueDate)],
              ["Terms", inv.termsDays != null ? `Net ${inv.termsDays}` : "market rule at issue"],
              ["FOB", inv.fobWording ?? "—"],
              ["Pays by", inv.payBy ? PAY_BY_LABEL[inv.payBy] : location?.payBy ? `${PAY_BY_LABEL[location.payBy as keyof typeof PAY_BY_LABEL] ?? location.payBy} (account setting, copied at issue)` : "not set on the account"],
              ["Issued", inv.issuedAt ? fmtDate(inv.issuedAt) : "—"],
              ["Paid", inv.paidAt ? `${fmtDate(inv.paidAt)}${inv.paidVia ? ` (${PAYMENT_KIND_LABEL[inv.paidVia as keyof typeof PAYMENT_KIND_LABEL] ?? inv.paidVia}${inv.paidReference ? ` ${inv.paidReference}` : ""})` : ""}` : "—"],
              ["Notes", inv.notes ? <span key="n" className="whitespace-pre-line">{inv.notes}</span> : "—"],
            ]}
          />
        </Card>
        <Card title="Shipments on this invoice">
          {shipments.length === 0 ? (
            <Empty>No shipment linked.</Empty>
          ) : (
            <ul className="divide-y divide-rule-soft text-sm">
              {shipments.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <Link href={`/shipments/${s.id}`} className="font-display text-navy hover:underline">
                      {shipmentNumber(s)}
                    </Link>{" "}
                    <span className="text-xs text-ink-3">
                      {s.type} {TYPE_LABEL[s.type]}, scheduled {fmtDay(s.scheduledDate)}
                      {s.actualDate ? `, delivered ${fmtDay(s.actualDate)}` : ""}
                      {s.poNumbers?.length ? `, PO ${s.poNumbers.join(", ")}` : ""}
                    </span>
                  </span>
                  <StatusBadge value={s.status} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-3">One invoice per delivery (R2-15).</p>
        </Card>
      </Columns>
      {stripeCard}
      <Tabs
        tabs={[
          { id: "lines", label: "Lines", count: lines.length, content: invoiceTab },
          { id: "payments", label: "Payments", count: payments.length + approvals.length, content: paymentsTab },
          { id: "documents", label: "Documents", count: documents.length, content: documentsTab },
          { id: "credits", label: "Credits", count: credits.length, content: creditsTab },
        ]}
      />
    </RecordPage>
  );
}
