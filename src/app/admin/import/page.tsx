import Link from "next/link";
import { Button, Card, Field, Flash, Input, Notice, Page, StatusBadge, Table, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listRuns } from "@/lib/import";
import { uploadWorkbookAction } from "./actions";

export default async function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("import.dry_run");
  const flash = await flashFrom(searchParams);
  const runs = await listRuns(await getDb());
  const canApply = can(actor, "import.apply");
  return (
    <Page title="Import from the workbook" subtitle="Upload an .xlsx export of the TLM Master File. The dry run compares every tab with fv-ops and shows what would be created or updated; nothing is written until the Owner applies it (decisions 10.2, 10.3).">
      <Flash {...flash} />
      <Card title="New dry run">
        <form action={uploadWorkbookAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Workbook export (.xlsx)" hint="In Google Sheets: File, Download, Microsoft Excel. Tabs read: Customer Accounts, Accounts, Location Information, SKU Master, Product Information, Commodities, Reps (names only), Production, Packaged Products, BOL Maker Log, Sales.">
              <Input type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
            </Field>
          </div>
          <Button>Run dry run</Button>
        </form>
        {!canApply ? <p className="mt-3 text-xs text-muted">You can review dry runs; applying one is an Owner action.</p> : null}
      </Card>
      <Card title="Runs">
        {runs.length === 0 ? (
          <Notice>No runs yet. Upload the workbook export to see the first diff.</Notice>
        ) : (
          <Table
            caption="Import runs"
            head={["Started", "File", "Status", "Create", "Update", "Unchanged", "Flagged", "Applied"]}
            rows={runs.map((r) => [
              <Link key="l" href={`/admin/import/${r.id}`} className="font-medium hover:underline">
                {fmtDate(r.createdAt)}
              </Link>,
              r.source,
              <StatusBadge key="s" value={r.status} />,
              String(r.summary?.totals?.creates ?? "—"),
              String(r.summary?.totals?.updates ?? "—"),
              String(r.summary?.totals?.unchanged ?? "—"),
              String(r.summary?.flags ?? "—"),
              r.appliedAt ? fmtDate(r.appliedAt) : "—",
            ])}
          />
        )}
      </Card>
      <Card title="How the import treats the workbook">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>Rows are matched by the same deterministic ids the October 28 load used, so existing accounts, origins, SKUs and prices show as unchanged or updated, never as new.</li>
          <li>Values the office typed in fv-ops are never blanked: a cell that is empty in the workbook leaves the field alone. Closed accounts stay closed.</li>
          <li>Legacy history (BOL Maker Log, Sales, Production) is written as delivered shipments, issued invoices, batches and lots; it never touches the stock ledger or the keg balances.</li>
          <li>People come in by name only: no PIN, no email, no sign-in until the Owner provides one (9.1, 9.2).</li>
        </ul>
      </Card>
    </Page>
  );
}
