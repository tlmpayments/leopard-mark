import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { Button, Card, Field, Flash, Input, Page, Select, Textarea } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { listOrigins, originLabel } from "@/lib/domain/origins/service";
import { CARRIERS, TYPE_LABEL, todayIso } from "../labels";
import { createShipmentAction } from "./actions";

/** Transfers only (R2-1): a delivery or samples shipment is drafted by its order. */
export default async function NewShipmentPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAction("shipment.manage");
  const flash = await flashFrom(searchParams);
  const type = "T" as const;
  const d = await getDb();
  const origins = await listOrigins(d);
  const sortedOrigins = [...origins].sort((a, b) => (a.originCode ? 0 : 1) - (b.originCode ? 0 : 1) || a.name.localeCompare(b.name));
  const drivers = Array.from(
    new Map(
      (
        await d
          .select({ id: schema.employee.id, displayName: schema.employee.displayName })
          .from(schema.roleGrant)
          .innerJoin(schema.employee, eq(schema.employee.id, schema.roleGrant.employeeId))
          .where(and(eq(schema.roleGrant.role, "driver_service"), isNull(schema.roleGrant.revokedAt), eq(schema.employee.enabled, true)))
      ).map((r) => [r.id, r]),
    ).values(),
  ).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const today = todayIso();

  return (
    <Page
      title="New transfer"
      subtitle="Stock moving between origins. A draft first: lines are added on the shipment page, and the number is assigned at confirmation (5.3). Deliveries and samples start from an order (R2-1)."
      wide={false}
      actions={
        <Link href="/orders/new" className="text-sm text-navy hover:underline">
          Delivery or samples: new order
        </Link>
      }
    >
      <Flash {...flash} />
      <form action={createShipmentAction} className="space-y-8">
        <Card title="Route">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Type" hint="Only transfers are created here; a delivery (D) or samples (S) shipment is drafted by its order.">
              <input type="hidden" name="type" value={type} />
              <div className="flex h-9 items-center text-sm font-medium">
                {type} {TYPE_LABEL[type]}
              </div>
            </Field>
            <Field label="Origin" hint="A code is required for the number (2.2).">
              <Select name="originWarehouseId" required defaultValue="">
                <option value="" disabled>
                  Origin
                </option>
                {sortedOrigins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {originLabel(o)}
                    {o.originCode ? "" : " (no code)"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Scheduled date" hint="The number uses origin and scheduled date; a later actual date never renumbers (5.12).">
              <Input name="scheduledDate" type="date" required defaultValue={today} />
            </Field>
            <Field label="Destination origin">
              <Select name="destinationWarehouseId" required defaultValue="">
                <option value="" disabled>
                  Origin
                </option>
                {sortedOrigins.map((o) => (
                  <option key={o.id} value={o.id}>
                    {originLabel(o)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Driver" hint="The driver sees only assigned stops.">
              <Select name="driverEmployeeId" defaultValue="">
                <option value="">Unassigned</option>
                {drivers.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.displayName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Logistics (optional; editable after confirmation)">
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
            <Field label="Appointment">
              <Input name="appointment" placeholder="e.g. Tue 10:00 to 11:00, dock 4" />
            </Field>
            <Field label="Carrier" hint="Pick one or type another.">
              <Input name="carrier" list="carrier-options" />
              <datalist id="carrier-options">
                {CARRIERS.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field label="Carrier phone">
              <Input name="carrierPhone" />
            </Field>
            <Field label="Freight class">
              <Input name="freightClass" placeholder="e.g. 65" />
            </Field>
            <Field label="Seal number">
              <Input name="sealNumber" />
            </Field>
            <Field label="Trailer number">
              <Input name="trailerNumber" />
            </Field>
            <Field label="Pallet count" hint="Editable (5.9).">
              <Input name="palletCount" type="number" min={0} step={1} className="text-right" />
            </Field>
            <div className="sm:col-span-3">
              <Field label="Pallet build">
                <Input name="palletBuild" placeholder="e.g. 2 pallets: 40 cs each, kegs loose" />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Receiving instructions (retail)">
                <Textarea name="receivingInstructions" rows={2} />
              </Field>
            </div>
            <div className="sm:col-span-3">
              <Field label="Notes">
                <Textarea name="notes" rows={2} />
              </Field>
            </div>
          </div>
        </Card>
        <div className="flex items-center gap-2 border-t border-rule pt-4">
          <Button>Create draft</Button>
          <Button href="/shipments" variant="ghost">
            Cancel
          </Button>
        </div>
      </form>
    </Page>
  );
}
