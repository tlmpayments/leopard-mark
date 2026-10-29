/**
 * Apply an import plan inside one transaction (SHIPMENTS_SPEC §5): upsert by id, never delete, audit every row that
 * changes (`import.location` style events with the run id as correlation id), open the lot_quantities_unconfirmed
 * exception once per lot whose quantities are unknown, and write one `import.run` event. Idempotent: the plan is
 * recomputed against the database at apply time, so a second apply finds nothing to do.
 */
import { eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { recordAudit } from "@/lib/audit/record";
import type { Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Tx } from "@/lib/db/types";
import { openException } from "@/lib/exceptions/service";
import type { ChildOp, EntityName, ImportPlan, Row, RowPlan } from "./diff";

const ENTITY_TABLE: Record<EntityName, { table: PgTable; name: string; idColumn: string; action: string }> = {
  markets: { table: schema.market, name: "market", idColumn: "id", action: "import.market" },
  origins: { table: schema.warehouse, name: "warehouse", idColumn: "id", action: "import.origin" },
  employees: { table: schema.employee, name: "employee", idColumn: "id", action: "import.person" },
  skus: { table: schema.sku, name: "sku", idColumn: "id", action: "import.sku" },
  aliases: { table: schema.skuAlias, name: "sku_alias", idColumn: "alias", action: "import.sku_alias" },
  prices: { table: schema.marketPrice, name: "market_price", idColumn: "id", action: "import.price" },
  accounts: { table: schema.customerLocation, name: "customer_location", idColumn: "id", action: "import.location" },
  batches: { table: schema.brewBatch, name: "brew_batch", idColumn: "id", action: "import.batch" },
  lots: { table: schema.lot, name: "lot", idColumn: "id", action: "import.lot" },
  shipments: { table: schema.shipment, name: "shipment", idColumn: "id", action: "import.shipment" },
  invoices: { table: schema.invoice, name: "invoice", idColumn: "id", action: "import.invoice" },
  links: { table: schema.invoiceShipment, name: "invoice_shipment", idColumn: "invoiceId", action: "import.invoice_link" },
};

const CHILD_TABLE: Record<string, { table: PgTable; idColumn: string }> = {
  address: { table: schema.address, idColumn: "id" },
  location_address: { table: schema.locationAddress, idColumn: "id" },
  contact: { table: schema.contact, idColumn: "id" },
  location_contact: { table: schema.locationContact, idColumn: "id" },
  license_verification: { table: schema.licenseVerification, idColumn: "id" },
  payment_relationship: { table: schema.paymentRelationship, idColumn: "id" },
  cleaning_obligation: { table: schema.cleaningObligation, idColumn: "id" },
  role_grant: { table: schema.roleGrant, idColumn: "id" },
  lot_sku_qty: { table: schema.lotSkuQty, idColumn: "id" },
  shipment_line: { table: schema.shipmentLine, idColumn: "id" },
  shipment_keg_pickup: { table: schema.shipmentKegPickup, idColumn: "shipmentId" },
  invoice_line: { table: schema.invoiceLine, idColumn: "id" },
};

function column(table: PgTable, name: string): PgColumn {
  const col = (getTableColumns(table) as Record<string, PgColumn>)[name];
  if (!col) throw new Error(`Import: table has no column ${name}`);
  return col;
}

async function runChild(tx: Tx, op: ChildOp) {
  const t = CHILD_TABLE[op.table];
  if (!t) throw new Error(`Import: unknown child table ${op.table}`);
  const idCol = column(t.table, t.idColumn);
  if (op.action === "insert") {
    await tx.insert(t.table).values(op.row as never).onConflictDoNothing();
    return;
  }
  if (op.action === "update") {
    if (!op.id || !op.set || Object.keys(op.set).length === 0) return;
    await tx.update(t.table).set(op.set as never).where(eq(idCol, op.id));
    return;
  }
  const target = (op.conflictOn ?? [t.idColumn]).map((c) => column(t.table, c));
  const set = op.set && Object.keys(op.set).length ? op.set : op.row;
  await tx
    .insert(t.table)
    .values(op.row as never)
    .onConflictDoUpdate({ target, set: set as never });
}

export interface ApplyResult {
  creates: number;
  updates: number;
  unchanged: number;
  skipped: number;
  exceptionsOpened: number;
  perEntity: Record<string, { create: number; update: number }>;
}

/** Execute a plan. The caller supplies the transaction and the run id used as the audit correlation id. */
export async function applyPlan(tx: Tx, actor: Actor, plan: ImportPlan, runId: string): Promise<ApplyResult> {
  const result: ApplyResult = { creates: 0, updates: 0, unchanged: 0, skipped: 0, exceptionsOpened: 0, perEntity: {} };
  const bump = (entity: string, k: "create" | "update") => {
    result.perEntity[entity] ??= { create: 0, update: 0 };
    result.perEntity[entity][k] += 1;
  };
  for (const row of plan.rows) {
    if (row.action === "unchanged") {
      result.unchanged += 1;
      continue;
    }
    if (row.action === "skip") {
      result.skipped += 1;
      continue;
    }
    await applyRow(tx, actor, row, runId);
    if (row.action === "create") {
      result.creates += 1;
      bump(row.entity, "create");
    } else {
      result.updates += 1;
      bump(row.entity, "update");
    }
  }
  for (const u of plan.unconfirmedLots) {
    const r = await openException(tx, actor, {
      category: "lot_quantities_unconfirmed",
      title: `Lot ${u.lotCode}: quantities not yet confirmed by the host`,
      cause: "The lot was imported from the BOL log or the Production tab without packaged quantities per SKU (decisions 1.4, 4.6).",
      marketId: u.marketId,
      ownerRole: "admin",
      nextAction: `Ask ${u.facilityName} for the packaging sheet and confirm quantities on the lot.`,
      dedupeKey: `lot_quantities_unconfirmed:${u.lotId}`,
      links: [{ subjectType: "lot", subjectId: u.lotId }],
    });
    if (r.created) result.exceptionsOpened += 1;
  }
  return result;
}

async function applyRow(tx: Tx, actor: Actor, row: RowPlan, runId: string) {
  const t = ENTITY_TABLE[row.entity];
  if (row.entity === "links") {
    await tx.insert(schema.invoiceShipment).values(row.insert as never).onConflictDoNothing();
  } else if (row.action === "create") {
    await tx.insert(t.table).values(row.insert as never).onConflictDoNothing();
  } else if (row.set && Object.keys(row.set).length) {
    const set: Row = { ...row.set };
    if ("updatedAt" in getTableColumns(t.table)) set.updatedAt = new Date();
    await tx.update(t.table).set(set as never).where(eq(column(t.table, t.idColumn), row.id));
  }
  for (const child of row.children) await runChild(tx, child);
  await recordAudit(tx, actor, {
    action: t.action,
    subjectType: t.name,
    subjectId: row.id,
    prior: row.action === "update" ? Object.fromEntries(row.changes.map((c) => [c.field, c.from])) : null,
    current: row.action === "create" ? sanitize(row.insert ?? {}) : Object.fromEntries(row.changes.map((c) => [c.field, c.to])),
    reason: `Import from the TLM Master File (${row.action})`,
    correlationId: runId,
    marketId: row.marketId ?? null,
  });
}

/** Audit payloads stay compact: large legacy payloads are summarised, never copied twice. */
function sanitize(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "legacyPayload" && v && typeof v === "object") out[k] = "(stored on the row)";
    else out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}
