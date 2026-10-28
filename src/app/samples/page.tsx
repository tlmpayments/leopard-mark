import { Badge, Button, Card, DEFAULT_TZ, Field, Flash, Input, Page, Select, StatusBadge, Table, marketDay } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { listSkus } from "@/lib/domain/catalog/service";
import { listEmployees } from "@/lib/domain/employees/service";
import { visibleMarkets } from "@/lib/domain/markets/service";
import { listSamples } from "@/lib/domain/samples/service";
import { correctSampleAction, recordSampleAction, returnSampleAction } from "./actions";

export default async function SamplesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("sample.record");
  const d = await getDb();
  const flash = await flashFrom(searchParams);
  const [markets, skus, samples] = await Promise.all([visibleMarkets(d, actor, ["owner", "admin", "sales"]), listSkus(d), listSamples(d, actor)]);
  const isAdmin = can(actor, "stock.record");
  const employees = isAdmin ? await listEmployees(d) : [];
  // Default to today in the rep's market (a single-market rep); mixed-market staff get the company default and pick the market.
  const today = marketDay(new Date(), markets.length === 1 ? markets[0].timezone : DEFAULT_TZ);
  return (
    <Page title="Samples" subtitle="Samples consume the same allocation as orders. Record rep, market, SKU, quantity and the actual date; notes optional.">
      <Flash {...flash} />
      <Card title="Record a sample withdrawal">
        <form action={recordSampleAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Market">
            <Select name="marketId" required defaultValue={markets.length === 1 ? markets[0].id : ""}>
              <option value="" disabled>
                Choose…
              </option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Product">
            <Select name="skuId" required defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {skus.filter((s) => !s.archivedAt).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.brand} {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Quantity">
            <Input name="qty" type="number" min={1} required inputMode="numeric" />
          </Field>
          <Field label="Actual date">
            <Input name="withdrawnOn" type="date" required defaultValue={today} />
          </Field>
          {isAdmin ? (
            <Field label="Rep (Admin may record for others)">
              <Select name="repEmployeeId" defaultValue={actor.employeeId ?? ""}>
                {employees.filter((e) => e.enabled).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Notes (optional)">
            <Input name="notes" />
          </Field>
          <div className="flex items-end">
            <Button>Record</Button>
          </div>
        </form>
      </Card>
      <Card title="Recent samples">
        <Table
          head={["Date", "Rep", "Product", "Qty", "State", ""]}
          rows={samples.map(({ s, sku, rep }) => [
            s.withdrawnOn,
            rep.displayName,
            `${sku.brand} ${sku.name}`,
            String(s.qty),
            <StatusBadge key="s" value={s.state} />,
            s.state === "withdrawn" ? (
              <details key="a">
                <summary className="cursor-pointer text-xs text-accent">Correct / return</summary>
                <form action={correctSampleAction} className="mt-1 flex gap-1">
                  <input type="hidden" name="sampleId" value={s.id} />
                  <Input name="qty" type="number" min={0} defaultValue={s.qty} className="w-20" />
                  <Input name="reason" placeholder="Reason" required />
                  <Button small variant="secondary">Correct</Button>
                </form>
                {isAdmin ? (
                  <form action={returnSampleAction} className="mt-1 flex gap-1">
                    <input type="hidden" name="sampleId" value={s.id} />
                    <Select name="condition" defaultValue="sellable">
                      <option value="sellable">Returned sellable</option>
                      <option value="damaged">Returned damaged</option>
                    </Select>
                    <Input name="evidence" placeholder="Evidence" required />
                    <Button small variant="secondary">Return</Button>
                  </form>
                ) : null}
              </details>
            ) : (
              <Badge key="b">{s.correctedOfId ? "correction" : ""}</Badge>
            ),
          ])}
        />
      </Card>
    </Page>
  );
}
