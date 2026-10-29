import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionPanel, Button, Card, Code, Columns, Empty, Field, Flash, Input, KV, Notice, RecordPage, StatusBadge, Struck, Table, Tabs, fmtDate, fmtDay } from "@/components/ui";
import { LIST_WIDTHS } from "@/components/widths";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { formatCents } from "@/lib/domain/catalog/service";
import { PAY_BY_LABEL } from "@/lib/domain/customers/shipping";
import { creditMemosForInvoice, getInvoice } from "@/lib/domain/invoices/service";
import { TYPE_LABEL, shipmentNumber, todayIso } from "../../shipments/labels";
import { issueCreditMemoAction, issueInvoiceAction, markPaidAction, voidCreditMemoAction, voidInvoiceAction } from "../actions";

const LINE_KIND: Record<string, string> = { beer: "Beer", deposit: "Deposit", pos: "POS", info: "Info" };

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
            <ActionPanel label="Mark paid" variant="primary">
              <form action={markPaidAction} className="space-y-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Note" hint="How it was paid, reference (collection stays outside the system, 7.5).">
                  <Input name="note" placeholder="e.g. ACH 2026-11-20 ref 1234" />
                </Field>
                <Button small>Mark paid</Button>
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
              ["Paid", inv.paidAt ? fmtDate(inv.paidAt) : "—"],
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
      <Tabs
        tabs={[
          { id: "lines", label: "Lines", count: lines.length, content: invoiceTab },
          { id: "documents", label: "Documents", count: documents.length, content: documentsTab },
          { id: "credits", label: "Credits", count: credits.length, content: creditsTab },
        ]}
      />
    </RecordPage>
  );
}
