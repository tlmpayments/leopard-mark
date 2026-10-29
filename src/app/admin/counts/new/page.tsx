import { Button, Card, Field, Flash, Input, Notice, Page, Select } from "@/components/ui";
import { flashFrom, param, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import { listSkus } from "@/lib/domain/catalog/service";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
import { todayIso } from "../../../shipments/labels";
import { createCountSessionAction } from "../actions";

const ROWS = 15;

export default async function NewCountPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("count.record");
  const sp = await searchParams;
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [origins, skus] = await Promise.all([listOrigins(d), listSkus(d)]);
  const activeSkus = skus.filter((s) => !s.archivedAt);
  return (
    <Page title="New count sheet" subtitle="One origin, one date. One row per SKU and lot code; the same SKU may appear on several rows (one per lot). Blank rows are ignored.">
      <Flash {...flash} />
      <form action={createCountSessionAction} className="space-y-4">
        <Card title="Count">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Origin">
              <Select name="warehouseId" required defaultValue={param(sp, "origin") ?? ""}>
                <option value="" disabled>
                  Origin…
                </option>
                {origins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {originLabel(o)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Counted on">
              <Input name="countedOn" type="date" required defaultValue={todayIso()} />
            </Field>
            <Field label="Counted by">
              <Input name="countedBy" defaultValue={actor.displayName} />
            </Field>
            <Field label="Note">
              <Input name="note" placeholder="e.g. Cold box and dock, host sheet attached" />
            </Field>
          </div>
        </Card>
        <Card title="Lines">
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-2 py-1">SKU</th>
                  <th className="px-2 py-1">Lot code (optional)</th>
                  <th className="px-2 py-1">Counted qty</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: ROWS }, (_, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1">
                      <Select name={`sku:${i}`} defaultValue="" aria-label={`Row ${i + 1} SKU`}>
                        <option value="">—</option>
                        {activeSkus.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} — {s.brand} {s.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-2 py-1">
                      <Input name={`lot:${i}`} placeholder="01CNT2610071" className="uppercase" aria-label={`Row ${i + 1} lot code`} />
                    </td>
                    <td className="px-2 py-1">
                      <Input name={`qty:${i}`} type="number" min={0} step={1} inputMode="numeric" className="w-28" aria-label={`Row ${i + 1} quantity`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notice tone="info">Lot codes are validated (facility, brand, yymmdd, run) and kept on the lines for later per-lot balances (4.1). Applying the sheet sets on hand per SKU to the sum of its rows.</Notice>
        </Card>
        <div className="flex gap-2">
          <Button>Save draft</Button>
          <Button href="/admin/counts" variant="secondary">
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
