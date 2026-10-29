import { Badge, Button, Card, Field, Flash, Input, Notice, Page, Select, StatusBadge, Table, Textarea, fmtDate } from "@/components/ui";
import { flashFrom, type SearchParams } from "@/lib/actions/helpers";
import { requireAction } from "@/lib/auth/current";
import { can } from "@/lib/authz/authorize";
import { getDb } from "@/lib/db/client";
import { getCompanySettings, listPosItems } from "@/lib/domain/settings/service";
import { updateSettingsAction, upsertPosItemAction } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAction("settings.manage");
  const flash = await flashFrom(searchParams);
  const d = await getDb();
  const [settings, posItems] = await Promise.all([getCompanySettings(d), listPosItems(d, { includeInactive: true })]);
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

      <Card title="POS items (3.6)">
        <Table
          caption="POS items"
          head={["Code", "Name", "Active"]}
          rows={posItems.map((p) => [<span key="c" className="font-mono text-xs">{p.code}</span>, p.name, p.active ? <Badge key="a" tone="good">active</Badge> : <Badge key="a">inactive</Badge>])}
        />
        {canCatalog ? (
          <form action={upsertPosItemAction} className="mt-3 grid gap-2 sm:grid-cols-4">
            <Input name="code" required placeholder="Code (e.g. TAPHANDLE-STD)" className="uppercase" aria-label="Code" />
            <Input name="name" required placeholder="Name" aria-label="Name" />
            <Select name="active" defaultValue="on" aria-label="Active">
              <option value="on">Active</option>
              <option value="off">Inactive</option>
            </Select>
            <Button small variant="secondary">
              Add or update
            </Button>
          </form>
        ) : null}
        <Notice tone="info">POS items ship on a line without a lot, a price or a ledger effect (3.6, 8.8). An existing code is updated in place.</Notice>
      </Card>
    </Page>
  );
}
