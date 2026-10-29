import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Table, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { getCompanySettings, listFreightLanes, listPosItems } from "@/lib/domain/settings/service";
import { updateSettingsAction, upsertFreightLaneAction, upsertPosItemAction } from "./actions";

const usd = (c: number | null | undefined) => (c == null ? "" : `$${(c / 100).toFixed(2)}`);
const plain = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("settings.manage");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [settings, posItems, lanes] = await Promise.all([getCompanySettings(d), listPosItems(d, { includeInactive: true }), listFreightLanes(d)]);
  const canCatalog = can(actor, "catalog.manage");

  return (
    <Page title="Company settings" subtitle={<span>Owner only (6.2). The shipper block, office address, footers, fixed lines, NMFC and the marking convention print on every new document. Last saved {fmtDate(settings.updatedAt)}.</span>}>
      <Flash {...flash} />
      <form action={updateSettingsAction} className="space-y-4">
        <Card title="Shipper (6.1)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Legal name">
              <Input name="legalName" required defaultValue={settings.legalName} />
            </Field>
            <Field label="DBA (as posted with CA ABC)">
              <Input name="dba" required defaultValue={settings.dba} />
            </Field>
            <Field label="Office address line 1">
              <Input name="officeLine1" defaultValue={settings.officeLine1 ?? ""} />
            </Field>
            <Field label="Address line 2">
              <Input name="officeLine2" defaultValue={settings.officeLine2 ?? ""} />
            </Field>
            <Field label="City">
              <Input name="officeCity" defaultValue={settings.officeCity ?? ""} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="State">
                <Input name="officeState" defaultValue={settings.officeState ?? ""} maxLength={2} className="uppercase" />
              </Field>
              <Field label="Postal code">
                <Input name="officePostalCode" defaultValue={settings.officePostalCode ?? ""} />
              </Field>
            </div>
            <Field label="Office phone">
              <Input name="officePhone" defaultValue={settings.officePhone ?? ""} />
            </Field>
            <Field label="AR sender email (7.9)">
              <Input name="arEmail" type="email" required defaultValue={settings.arEmail} />
            </Field>
          </div>
        </Card>
        <Card title="Document wording (6.3, 6.4)">
          <div className="grid gap-3">
            <Field label="Retail footer (delivery receipt)">
              <Textarea name="retailFooter" rows={2} defaultValue={settings.retailFooter ?? ""} />
            </Field>
            <Field label="Distributor footer (keg deposit and CRV wording)" hint="Placeholder until the owner's example arrives (6.4).">
              <Textarea name="distributorFooter" rows={3} defaultValue={settings.distributorFooter ?? ""} />
            </Field>
            <Field label="Fixed lines on freight documents (one per line)" hint="For example the keep-cold line.">
              <Textarea name="fixedLines" rows={3} defaultValue={(settings.fixedLines ?? []).join("\n")} />
            </Field>
          </div>
        </Card>
        <Card title="Freight classification (6.6)">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="NMFC, beer in kegs">
              <Input name="nmfcKeg" defaultValue={settings.nmfcKeg ?? ""} />
            </Field>
            <Field label="NMFC, beer in cans">
              <Input name="nmfcCan" defaultValue={settings.nmfcCan ?? ""} />
            </Field>
            <Field label="Status" hint="Printed on distributor documents only once approved.">
              <Select name="nmfcStatus" defaultValue={settings.nmfcStatus}>
                <option value="proposed">Proposed (for sign-off)</option>
                <option value="approved">Approved</option>
              </Select>
            </Field>
          </div>
          <p className="mt-2 text-sm">
            Current: <StatusBadge value={settings.nmfcStatus} />
          </p>
        </Card>
        <Card title="Packaging marking convention (4.7)">
          <Textarea name="markingConvention" rows={4} defaultValue={settings.markingConvention ?? ""} aria-label="Marking convention" />
          <p className="mt-1 text-xs text-muted">Printed on the packaging report page for the office and the hosts.</p>
        </Card>
        <Card title="Remit-to on invoices (7.9)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="printRemitTo" defaultChecked={settings.printRemitTo} /> Print remit-to details on invoices (off by default)
          </label>
          <Field label="Remit-to text">
            <Textarea name="remitTo" rows={2} defaultValue={settings.remitTo ?? ""} />
          </Field>
        </Card>
        <Card title="Freight and collections">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fuel surcharge, % of lane freight" hint="Added as its own line on distributor invoices that use a freight lane. Per-unit delivery charges (Martignetti) already include fuel.">
              <Input name="fuelSurchargePct" type="number" step="0.01" min={0} max={200} defaultValue={Number(settings.fuelSurchargePct)} />
            </Field>
            <Field label="Retail collections threshold ($)" hint="A retail account with this much or more overdue opens a collections case. Any overdue distributor invoice opens one.">
              <Input name="collectionsThreshold" inputMode="decimal" defaultValue={plain(settings.collectionsThresholdCents)} />
            </Field>
          </div>
        </Card>
        <Card title="End-of-day pull sheets (R2-29)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autoSendPullSheets" defaultChecked={settings.autoSendPullSheets} /> Email each warehouse its next-day pull sheet at the time set on the warehouse (off by default)
          </label>
          <p className="mt-1 text-xs text-muted">Off: the office downloads the sheet from Shipments, End of day. On: a send is queued daily per warehouse with an address and time; the email transport is not built yet, so sends wait and open a case rather than pretending.</p>
        </Card>
        <div>
          <Button>Save settings</Button>
        </div>
      </form>

      <Card title="Freight lanes (R2-52)">
        <Table
          caption="Freight lanes"
          head={["Code", "Lane", "1 pallet (min)", "2 to 4, per pallet", "5 to 8, per pallet", "9 or more (truckload)", "Active"]}
          align={["left", "left", "right", "right", "right", "right", "left"]}
          rows={lanes.map((l) => [<span key="c" className="font-mono text-xs">{l.code}</span>, l.name, usd(l.minCents), usd(l.tier2to4Cents), usd(l.tier5to8Cents), usd(l.truckloadCents), l.active ? <Badge key="a" tone="good">active</Badge> : <Badge key="a">inactive</Badge>])}
          empty="No freight lanes yet."
        />
        <form action={upsertFreightLaneAction} className="mt-3 grid gap-2 sm:grid-cols-7">
          <Input name="code" required placeholder="Code (CT)" className="uppercase" aria-label="Lane code" />
          <Input name="name" required placeholder="Lane name" aria-label="Lane name" />
          <Input name="min" required inputMode="decimal" placeholder="Min $" aria-label="Minimum, one pallet" />
          <Input name="tier2to4" required inputMode="decimal" placeholder="2-4 $/pallet" aria-label="2 to 4 pallets, per pallet" />
          <Input name="tier5to8" required inputMode="decimal" placeholder="5-8 $/pallet" aria-label="5 to 8 pallets, per pallet" />
          <Input name="truckload" required inputMode="decimal" placeholder="Truckload $" aria-label="Truckload" />
          <Button small variant="secondary">
            Add or update
          </Button>
        </form>
        <Notice tone="info">An account uses a lane when its freight is set to &quot;lane&quot; on the account page. Freight passes through at cost with no markup; the fuel surcharge above is added on its own line. An existing code is updated in place.</Notice>
      </Card>

      <Card title="POS items (3.6)">
        <Table
          caption="POS items"
          head={["Code", "Name", "Price charged", "Unit cost", "Active"]}
          align={["left", "left", "right", "right", "left"]}
          rows={posItems.map((p) => [<span key="c" className="font-mono text-xs">{p.code}</span>, p.name, usd(p.priceCents) || "not charged", usd(p.unitCostCents) || "not set", p.active ? <Badge key="a" tone="good">active</Badge> : <Badge key="a">inactive</Badge>])}
        />
        {canCatalog ? (
          <form action={upsertPosItemAction} className="mt-3 grid gap-2 sm:grid-cols-6">
            <Input name="code" required placeholder="Code (e.g. TAPHANDLE-STD)" className="uppercase" aria-label="Code" />
            <Input name="name" required placeholder="Name" aria-label="Name" />
            <Input name="price" inputMode="decimal" placeholder="Price $ (blank = free)" aria-label="Price charged" />
            <Input name="unitCost" inputMode="decimal" placeholder="Unit cost $" aria-label="Unit cost" />
            <Select name="active" defaultValue="on" aria-label="Active">
              <option value="on">Active</option>
              <option value="off">Inactive</option>
            </Select>
            <Button small variant="secondary">
              Add or update
            </Button>
          </form>
        ) : null}
        <Notice tone="info">POS items ship on a line without a lot or a ledger effect (3.6, 8.8). A price is charged on the invoice (never on a no-charge invoice); the unit cost counts toward the account&apos;s spend either way. An existing code is updated in place, so enter the price and cost again when you change the name.</Notice>
      </Card>
    </Page>
  );
}
