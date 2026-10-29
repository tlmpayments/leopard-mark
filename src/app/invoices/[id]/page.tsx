import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Badge, Button, Card, Empty, Field, Flash, Input, KV, Notice, Page, Select, StatusBadge, Table, fmtDate, fmtDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { formatCents } from "@/lib/domain/catalog/service";
import { getInvoice } from "@/lib/domain/invoices/service";
import { listShipments } from "@/lib/domain/shipments/service";
import { TYPE_LABEL, shipmentNumber, todayIso } from "../../shipments/labels";
import { addShipmentAction, issueInvoiceAction, markPaidAction, voidInvoiceAction } from "../actions";

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

  let candidates: Awaited<ReturnType<typeof listShipments>> = [];
  if (inv.status === "draft" && canIssue && inv.locationId) {
    const all = await listShipments(d, actor, { destinationLocationId: inv.locationId, limit: 200 });
    const onInvoice = new Set(shipments.map((s) => s.id));
    const pool = all.filter(({ s }) => ["confirmed", "staged", "out", "delivered"].includes(s.status) && (inv.series === "NC") === (s.type === "S") && !onInvoice.has(s.id));
    const ids = pool.map((p) => p.s.id);
    const taken = ids.length
      ? await d
          .select({ shipmentId: schema.invoiceShipment.shipmentId })
          .from(schema.invoiceShipment)
          .innerJoin(schema.invoice, eq(schema.invoice.id, schema.invoiceShipment.invoiceId))
          .where(and(inArray(schema.invoiceShipment.shipmentId, ids), ne(schema.invoice.status, "void"), ne(schema.invoice.status, "draft")))
      : [];
    const takenIds = new Set(taken.map((t) => t.shipmentId));
    candidates = pool.filter((p) => !takenIds.has(p.s.id));
  }

  return (
    <Page
      title={inv.number ?? `${inv.series} draft`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span>{location ? location.tradeName : "No account"}</span>
          <StatusBadge value={inv.status} />
          <Badge>{inv.series === "NC" ? "NC · samples, no charge" : "INV"}</Badge>
          {inv.legacy ? <Badge>Sales tab history{inv.legacyStatus ? `: ${inv.legacyStatus}` : ""}</Badge> : null}
        </span>
      }
      actions={
        <>
          <a href={`/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-card px-4 py-2.5 text-sm font-medium hover:bg-background">
            {inv.status === "draft" ? "Preview PDF (draft)" : "Invoice PDF"}
          </a>
          <Button href="/invoices" variant="secondary">
            All invoices
          </Button>
        </>
      }
    >
      <Flash {...flash} />
      {inv.status === "void" ? (
        <Notice tone="danger" title="Void.">
          {inv.voidReason} ({fmtDate(inv.voidedAt)})
        </Notice>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Invoice">
          <KV
            items={[
              ["Number", inv.number ?? "assigned when issued"],
              ["Account", location ? <Link key="l" href={`/locations/${location.id}`} className="underline">{location.tradeName}</Link> : "—"],
              ["Invoice date", fmtDay(inv.invoiceDate)],
              ["Due date", fmtDay(inv.dueDate)],
              ["Terms", inv.termsDays != null ? `Net ${inv.termsDays}` : "market rule at issue"],
              ["FOB", inv.fobWording ?? "—"],
              ["Subtotal", formatCents(inv.subtotalCents)],
              ["Deposit", formatCents(inv.depositCents)],
              ["Total", <strong key="t">{formatCents(inv.totalCents)}</strong>],
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
            <ul className="divide-y divide-line text-sm">
              {shipments.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <Link href={`/shipments/${s.id}`} className="underline">
                      {shipmentNumber(s)}
                    </Link>{" "}
                    <span className="text-xs text-muted">
                      {s.type} {TYPE_LABEL[s.type]} · scheduled {fmtDay(s.scheduledDate)}
                      {s.actualDate ? ` · delivered ${fmtDay(s.actualDate)}` : ""}
                      {s.poNumbers?.length ? ` · PO ${s.poNumbers.join(", ")}` : ""}
                    </span>
                  </span>
                  <StatusBadge value={s.status} />
                </li>
              ))}
            </ul>
          )}
          {inv.status === "draft" && canIssue ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-accent">Add a shipment to this draft (same account, same week, 7.2)</summary>
              {candidates.length === 0 ? (
                <p className="mt-1 text-xs text-muted">No other confirmed or delivered shipment of this account is free to join.</p>
              ) : (
                <form action={addShipmentAction} className="mt-2 flex flex-wrap gap-2">
                  <input type="hidden" name="invoiceId" value={inv.id} />
                  <Select name="shipmentId" required defaultValue="" className="max-w-md" aria-label="Shipment">
                    <option value="" disabled>
                      Shipment…
                    </option>
                    {candidates.map(({ s }) => (
                      <option key={s.id} value={s.id}>
                        {shipmentNumber(s)} · {fmtDay(s.scheduledDate)} · {s.status}
                      </option>
                    ))}
                  </Select>
                  <Button small variant="secondary">
                    Add
                  </Button>
                </form>
              )}
            </details>
          ) : null}
        </Card>
      </div>

      <Card title="Lines">
        <Table
          caption="Invoice lines"
          head={["#", "Kind", "Description", "Lot", "Qty", "Unit", "Total"]}
          rows={lines.map((l) => [
            String(l.lineNo),
            LINE_KIND[l.kind] ?? l.kind,
            l.description,
            l.lotCode ?? "—",
            l.kind === "info" ? "" : String(l.qty),
            l.kind === "info" ? "" : formatCents(l.unitPriceCents),
            l.kind === "info" ? "" : formatCents(l.lineTotalCents),
          ])}
        />
        {inv.status === "draft" ? <p className="mt-2 text-xs text-muted">Draft lines are recomputed from the shipments at issue: prices captured at confirmation, deposit per the market rule or the account&apos;s deposit mode (3.10), MicroStar information lines for distributors (7.8).</p> : null}
      </Card>

      {(canIssue || canVoid) && inv.status !== "void" && inv.status !== "paid" ? (
        <Card title="Actions">
          <div className="grid gap-4 md:grid-cols-3">
            {inv.status === "draft" && canIssue ? (
              <form action={issueInvoiceAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Issue now</div>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Invoice date" hint="Normally the actual delivery or pickup date; delivery issues the draft on its own (7.4).">
                  <Input name="invoiceDate" type="date" required defaultValue={shipments.find((s) => s.actualDate)?.actualDate ?? today} />
                </Field>
                <Button small>Issue {inv.series}</Button>
              </form>
            ) : null}
            {inv.status === "issued" && canIssue ? (
              <form action={markPaidAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Mark paid</div>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Note" hint="How it was paid, reference (collection stays outside fv-ops, 7.5).">
                  <Input name="note" placeholder="e.g. ACH 2026-11-20 ref 1234" />
                </Field>
                <Button small variant="secondary">
                  Mark paid
                </Button>
              </form>
            ) : null}
            {canVoid ? (
              <form action={voidInvoiceAction} className="space-y-2 rounded-lg border border-line p-3">
                <div className="text-sm font-medium">Void</div>
                <input type="hidden" name="invoiceId" value={inv.id} />
                <Field label="Reason (required)">
                  <Input name="reason" required />
                </Field>
                <Button small variant="danger">
                  Void invoice
                </Button>
                <p className="text-xs text-muted">The number is kept as a gap; a paid invoice is never voided (issue a credit instead).</p>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="Documents">
        {documents.length === 0 ? (
          <Empty>The invoice document is stored at issue; a draft previews live from the PDF link above.</Empty>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between py-2">
                <span>
                  Invoice {inv.number} {doc.revision > 0 ? <Badge tone="info">R{doc.revision}</Badge> : null}
                  <span className="block text-xs text-muted">
                    {fmtDate(doc.createdAt)}
                    {doc.hasPdf ? "" : " · rendered on request"}
                  </span>
                </span>
                {documents[0]?.id === doc.id ? (
                  <a href={`/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-accent underline">
                    Open PDF
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
