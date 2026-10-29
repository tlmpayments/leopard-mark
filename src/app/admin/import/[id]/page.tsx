import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Button, Card, Flash, KV, Notice, Page, StatusBadge, Table, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { getRun, type EntityReport, type FieldChange, type Flag } from "@/lib/import";
import { applyRunAction, discardRunAction } from "../actions";

const FLAG_ENTITY_LABEL: Record<string, string> = {
  workbook: "Workbook",
  origin: "Origins",
  sku: "SKUs",
  price: "Prices",
  person: "People",
  account: "Accounts",
  batch: "Batches",
  lot: "Lots",
  shipment: "Legacy shipments",
  invoice: "Legacy invoices",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return v.toISOString();
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function Changes({ changes }: { changes: FieldChange[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {changes.map((c, i) => (
        <li key={i}>
          <span className="font-medium">{c.field}</span>: {show(c.from)} <span className="text-muted">to</span> {show(c.to)}
        </li>
      ))}
    </ul>
  );
}

function Details({ summary, children, open = false }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border border-line">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{summary}</summary>
      <div className="border-t border-line px-3 py-2">{children}</div>
    </details>
  );
}

function EntityCreates({ e }: { e: EntityReport }) {
  if (e.creates.length === 0) return null;
  return (
    <Details summary={`${e.label}: ${e.creates.length} to create`}>
      <ul className="columns-1 gap-4 text-sm sm:columns-2 lg:columns-3">
        {e.creates.map((c) => (
          <li key={c.id} className="break-inside-avoid py-0.5">
            {c.label}
            {c.detail ? <span className="block text-xs text-muted">{c.detail}</span> : null}
          </li>
        ))}
      </ul>
    </Details>
  );
}

function EntityUpdates({ e }: { e: EntityReport }) {
  if (e.updates.length === 0) return null;
  return (
    <Details summary={`${e.label}: ${e.updates.length} to update`}>
      <Table caption={`${e.label} updates`} head={["Row", "Changes"]} rows={e.updates.map((u) => [<span key="l" className="font-medium">{u.label}</span>, <Changes key="c" changes={u.changes} />])} />
    </Details>
  );
}

function FlagGroups({ flags }: { flags: Flag[] }) {
  const groups = new Map<string, Flag[]>();
  for (const f of flags) {
    if (!groups.has(f.entity)) groups.set(f.entity, []);
    groups.get(f.entity)!.push(f);
  }
  if (groups.size === 0) return <Notice tone="good">Nothing flagged.</Notice>;
  return (
    <div className="space-y-2">
      {Array.from(groups.entries()).map(([entity, items]) => (
        <Details key={entity} summary={`${FLAG_ENTITY_LABEL[entity] ?? entity}: ${items.length}`}>
          <Table caption={`${entity} flags`} head={["Row", "Note"]} rows={items.map((f) => [<span key="k" className="font-medium">{f.key}</span>, f.message])} />
        </Details>
      ))}
    </div>
  );
}

export default async function ImportRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requireAction("import.dry_run");
  const { id } = await params;
  const run = /^[0-9a-f-]{36}$/i.test(id) ? await getRun(await getDb(), id) : null;
  if (!run) notFound();
  const flash = await flashFrom(searchParams);
  const report = run.diff.report;
  const canApply = can(actor, "import.apply");
  const isDryRun = run.status === "dry_run";
  const applied = run.summary.applied;
  return (
    <Page
      title={`Import run: ${run.source}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge value={run.status} />
          <span>dry run {fmtDate(run.createdAt)}</span>
          {run.appliedAt ? <span>applied {fmtDate(run.appliedAt)}</span> : null}
        </span>
      }
      actions={
        <Button href="/admin/import" variant="secondary">
          All runs
        </Button>
      }
    >
      <Flash {...flash} />
      {report.missingTabs.length ? <Notice tone="warn" title="Tabs missing from this export:">{report.missingTabs.join(", ")}. Their entities were not read; the rest of the diff stands.</Notice> : null}
      <Card title="Summary">
        <KV
          items={[
            ["To create", String(report.totals.creates)],
            ["To update", String(report.totals.updates)],
            ["Unchanged", String(report.totals.unchanged)],
            ["Left untouched", String(report.totals.skipped)],
            ["Flagged", String(report.flags.length)],
            ["Excluded rows", String(report.excluded.length)],
            ["Lots with unconfirmed quantities", `${report.unconfirmedLots} (one exception each after apply)`],
            ["Applied", applied ? `${applied.creates} created, ${applied.updates} updated, ${applied.exceptionsOpened} exception(s) opened` : isDryRun ? "not yet" : run.status],
          ]}
        />
        <div className="mt-3">
          <Table
            caption="Counts per entity"
            head={["Entity", "Create", "Update", "Unchanged", "Untouched"]}
            rows={report.entities.map((e) => [e.label, String(e.creates.length), String(e.updates.length), String(e.unchanged), String(e.skipped.length)])}
          />
        </div>
        {isDryRun ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {canApply ? (
              <form action={applyRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <Button>Apply this import</Button>
              </form>
            ) : (
              <p className="self-center text-sm text-muted">Only the Owner applies an import (10.3). Share this page for approval.</p>
            )}
            <form action={discardRunAction}>
              <input type="hidden" name="runId" value={run.id} />
              <Button variant="secondary">Discard</Button>
            </form>
          </div>
        ) : null}
        {isDryRun ? <p className="mt-2 text-xs text-muted">Applying writes everything above in one transaction, upserting by id and never deleting. Each written row gets an audit event under this run id (9.8). The diff is recomputed at apply time, so changes made in fv-ops since this dry run are respected.</p> : null}
      </Card>
      <Card title="Flagged for review">
        <FlagGroups flags={report.flags} />
      </Card>
      <Card title="To update">
        {report.totals.updates === 0 ? <Notice>Nothing to update.</Notice> : <div className="space-y-2">{report.entities.map((e) => <EntityUpdates key={e.entity} e={e} />)}</div>}
      </Card>
      <Card title="To create">
        {report.totals.creates === 0 ? <Notice>Nothing to create.</Notice> : <div className="space-y-2">{report.entities.map((e) => <EntityCreates key={e.entity} e={e} />)}</div>}
      </Card>
      {report.totals.skipped > 0 ? (
        <Card title="Left untouched">
          <Table caption="Rows left untouched" head={["Entity", "Row", "Why"]} rows={report.entities.flatMap((e) => e.skipped.map((s) => [e.label, s.label, s.reason]))} />
        </Card>
      ) : null}
      <Card title="Excluded rows">
        {report.excluded.length === 0 ? <Notice>No rows excluded.</Notice> : <Table caption="Excluded rows" head={["Tab", "Row", "Reason"]} rows={report.excluded.map((x) => [FLAG_ENTITY_LABEL[x.entity] ?? x.entity, x.key, x.reason])} />}
      </Card>
    </Page>
  );
}
