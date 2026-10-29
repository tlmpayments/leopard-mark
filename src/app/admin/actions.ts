"use server";

import { setEmployeePin } from "@/lib/domain/employees/credentials";
import { BusinessError } from "@/lib/errors";
import { num, opt, runAction, str } from "@/lib/actions/helpers";
import type { Role } from "@/lib/authz/actor";
import { adminReleaseReservation, adminRequeueReservation, recordStockMovement, recordTransferDeparture, recordTransferReceipt, type StockMovementKind } from "@/lib/domain/allocation/service";
import { archiveSku, createSku, setMarketPrice, type PackageKind } from "@/lib/domain/catalog/service";
import { grantRole, offboardEmployee, provisionEmployee, recordEmailRename, revokeGrant, setEmployeeEnabled } from "@/lib/domain/employees/service";
import { convertIntakeToOrder, markIntakeIncomplete, recordIntakeRequest } from "@/lib/domain/intake/service";
import { confirmSellerContext, createMarket, createWarehouse } from "@/lib/domain/markets/service";
import { addExceptionNote, reopenException, transitionException, type ExceptionState } from "@/lib/exceptions/service";
import { runDueJobs } from "@/lib/jobs/queue";
import "@/lib/integrations/stripe/adapter";
import "@/lib/domain/pullsheet/service"; // registers the pull sheet send handler (R2-29)

// --- exceptions ---
export async function transitionExceptionAction(form: FormData) {
  const id = str(form, "caseId");
  return runAction(`/admin/exceptions/${id}`, async ({ db, actor }) => {
    const ownerRole = opt(form, "ownerRole") as Role | null;
    await transitionException(db, actor, {
      caseId: id,
      state: str(form, "state") as ExceptionState,
      note: opt(form, "note") ?? undefined,
      ownerRole: ownerRole ?? undefined,
      ownerEmployeeId: opt(form, "ownerEmployeeId") ?? undefined,
      nextAction: opt(form, "nextAction") ?? undefined,
      waitingParty: opt(form, "waitingParty") ?? undefined,
      reviewAt: opt(form, "reviewAt") ? new Date(str(form, "reviewAt")) : undefined,
      resolution: opt(form, "resolution") ?? undefined,
      severity: opt(form, "severity") ?? undefined,
    });
    return "Case updated";
  });
}

export async function reopenExceptionAction(form: FormData) {
  const id = str(form, "caseId");
  return runAction(`/admin/exceptions/${id}`, async ({ db, actor }) => {
    await reopenException(db, actor, id, str(form, "note"));
    return "Case reopened";
  });
}

export async function noteExceptionAction(form: FormData) {
  const id = str(form, "caseId");
  return runAction(`/admin/exceptions/${id}`, async ({ db, actor }) => {
    await addExceptionNote(db, actor, id, str(form, "body"));
    return "Note added";
  });
}

// --- employees ---
export async function provisionEmployeeAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    const role = str(form, "role") as Role;
    const pin = str(form, "pin");
    const r = await provisionEmployee(db, actor, { displayName: str(form, "displayName"), email: str(form, "email"), grants: role ? [{ role, marketId: opt(form, "marketId") }] : [] });
    if (pin) {
      await setEmployeePin(db, actor, r.employee.id, pin, { reason: "temporary PIN at provisioning", mustChange: true });
      return "Employee provisioned with a temporary PIN; they choose their own at first sign-in";
    }
    return "Employee provisioned; set a temporary PIN under Manage so they can sign in";
  });
}
export async function setPinAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    const pin = str(form, "pin");
    if (pin !== str(form, "pinAgain")) throw new BusinessError("The two entries of the temporary PIN differ.", { field: "pinAgain" });
    await setEmployeePin(db, actor, str(form, "employeeId"), pin, { reason: str(form, "reason") || "temporary PIN set from the access page", mustChange: true });
    return "Temporary PIN set; every existing session for that person was signed out and they must choose their own PIN at the next sign-in";
  });
}
export async function grantRoleAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    await grantRole(db, actor, str(form, "employeeId"), str(form, "role") as Role, opt(form, "marketId"));
    return "Grant added";
  });
}
export async function revokeGrantAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    await revokeGrant(db, actor, str(form, "grantId"), str(form, "reason") || "revoked");
    return "Grant revoked (history retained)";
  });
}
export async function setEnabledAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    const enabled = str(form, "enabled") === "true";
    await setEmployeeEnabled(db, actor, str(form, "employeeId"), enabled, str(form, "reason") || (enabled ? "re-enabled" : "disabled"));
    return enabled ? "Employee enabled" : "Employee disabled — existing sessions lose business use immediately";
  });
}
export async function offboardAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    const r = await offboardEmployee(db, actor, str(form, "employeeId"), str(form, "reason"));
    return `Offboarded: ${r.revokedGrants} grant(s) revoked, identity retired, sessions ended. The email can now be provisioned for a new person.`;
  });
}
export async function renameEmailAction(form: FormData) {
  return runAction("/admin/employees", async ({ db, actor }) => {
    await recordEmailRename(db, actor, str(form, "employeeId"), str(form, "email"));
    return "Email rename recorded; identity and history preserved";
  });
}

// --- markets / warehouses / stock ---
export async function createMarketAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    await createMarket(db, actor, { code: str(form, "code"), name: str(form, "name"), timezone: opt(form, "timezone") ?? undefined });
    return "Market created";
  });
}
export async function createWarehouseAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    await createWarehouse(db, actor, { marketId: str(form, "marketId"), name: str(form, "name"), addressText: opt(form, "addressText") ?? undefined, isPrimary: str(form, "isPrimary") === "on", fulfillmentContact: opt(form, "fulfillmentContact") ?? undefined });
    return "Warehouse created";
  });
}
export async function confirmSellerAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    await confirmSellerContext(db, actor, str(form, "marketId"), str(form, "note"));
    return "Seller context confirmed (D33) for this market";
  });
}
export async function stockMovementAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    const kind = str(form, "kind") as StockMovementKind;
    const qty = num(form, "qty");
    // Damage is entered as a count of damaged units; the service enforces direction by kind regardless of what the form sends.
    const qtyDelta = kind === "damage" ? -Math.abs(qty) : qty;
    await recordStockMovement(db, actor, { warehouseId: str(form, "warehouseId"), skuId: str(form, "skuId"), kind, qtyDelta, evidence: str(form, "evidence") });
    return qtyDelta > 0 ? "Stock evidence recorded; waiting demand re-filled oldest first" : "Stock evidence recorded; any shortfall against reservations is now an owned case";
  });
}
export async function transferDepartureAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    await recordTransferDeparture(db, actor, { fromWarehouseId: str(form, "fromWarehouseId"), toWarehouseId: str(form, "toWarehouseId"), skuId: str(form, "skuId"), qty: num(form, "qty"), evidence: str(form, "evidence") });
    return "Transfer departed: units are in transit at the destination (not available anywhere) until receipt";
  });
}
export async function transferReceiptAction(form: FormData) {
  return runAction("/admin/markets", async ({ db, actor }) => {
    await recordTransferReceipt(db, actor, { toWarehouseId: str(form, "toWarehouseId"), skuId: str(form, "skuId"), qty: num(form, "qty"), evidence: str(form, "evidence") });
    return "Transfer received: units are on hand; retained demand re-filled oldest first";
  });
}
export async function requeueReservationAction(form: FormData) {
  return runAction(`/orders/${str(form, "orderId")}`, async ({ db, actor }) => {
    await adminRequeueReservation(db, actor, str(form, "reservationId"), str(form, "reason") || "re-queued by Admin");
    return "Displaced demand re-queued into the normal oldest-first refill";
  });
}
export async function releaseReservationAction(form: FormData) {
  return runAction(`/orders/${str(form, "orderId")}`, async ({ db, actor }) => {
    await adminReleaseReservation(db, actor, str(form, "reservationId"), str(form, "reason"));
    return "Reservation released; demand retained as unmet with displacement note";
  });
}

// --- catalog / prices ---
export async function createSkuAction(form: FormData) {
  return runAction("/admin/catalog", async ({ db, actor }) => {
    await createSku(db, actor, { code: str(form, "code"), name: str(form, "name"), brand: str(form, "brand"), packageKind: str(form, "packageKind") as PackageKind, sellingUnit: str(form, "sellingUnit"), weightLb: opt(form, "weightLb") });
    return "SKU created";
  });
}
export async function archiveSkuAction(form: FormData) {
  return runAction("/admin/catalog", async ({ db, actor }) => {
    await archiveSku(db, actor, str(form, "skuId"), str(form, "reason") || "archived");
    return "SKU archived (historical only)";
  });
}
export async function setPriceAction(form: FormData) {
  return runAction("/admin/catalog", async ({ db, actor }) => {
    await setMarketPrice(db, actor, { marketId: str(form, "marketId"), skuId: str(form, "skuId"), priceCents: Math.round(num(form, "price") * 100), reason: opt(form, "reason") ?? undefined });
    return "Market price set with effective dating";
  });
}

// --- intake ---
export async function recordIntakeAction(form: FormData) {
  return runAction("/admin/intake", async ({ db, actor }) => {
    await recordIntakeRequest(db, actor, { fromEmail: opt(form, "fromEmail"), subject: opt(form, "subject"), body: str(form, "body"), marketId: opt(form, "marketId") });
    return "Email demand recorded for review";
  });
}
export async function convertIntakeAction(form: FormData) {
  const id = str(form, "intakeId");
  return runAction("/admin/intake", async ({ db, actor }) => {
    const lines: Array<{ skuId: string; qty: number }> = [];
    for (const [k, v] of form.entries()) if (k.startsWith("qty:") && typeof v === "string" && Number(v) > 0) lines.push({ skuId: k.slice(4), qty: Number(v) });
    const decision = str(form, "shortfallDecision");
    const res = await convertIntakeToOrder(db, actor, {
      intakeId: id,
      locationId: str(form, "locationId"),
      lines,
      requestedDate: opt(form, "requestedDate"),
      shortfallDecision: decision === "ship_available" || decision === "hold" ? decision : null,
      shortfallReason: opt(form, "shortfallReason"),
    });
    return { ok: `Converted to ${res.order.orderNumber}`, redirectTo: `/orders/${res.order.id}` };
  });
}
export async function intakeIncompleteAction(form: FormData) {
  return runAction("/admin/intake", async ({ db, actor }) => {
    await markIntakeIncomplete(db, actor, str(form, "intakeId"), str(form, "missing"));
    return "Marked incomplete; clarify essentials only";
  });
}

// --- jobs ---
export async function runJobsAction() {
  return runAction("/integrations", async ({ db, actor }) => {
    const { authorize } = await import("@/lib/authz/authorize");
    authorize(actor, "integration.manage");
    const results = await runDueJobs(db, { limit: 50, workerId: `manual-${actor.employeeId}` });
    return `Ran ${results.length} job(s): ${results.map((r) => `${r.kind}=${r.outcome}`).join(", ") || "none due"}`;
  });
}
