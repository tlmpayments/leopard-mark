"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { applyCountSession, createCountSession, type CountLineInput } from "@/lib/domain/counts/service";
import { BusinessError } from "@/lib/errors";

const ROWS = 60;

export async function createCountSessionAction(form: FormData) {
  return runAction("/admin/counts/new", async ({ db, actor }) => {
    const lines: CountLineInput[] = [];
    for (let i = 0; i < ROWS; i += 1) {
      const skuId = opt(form, `sku:${i}`);
      const qtyText = opt(form, `qty:${i}`);
      const lotCode = opt(form, `lot:${i}`);
      if (!skuId && !qtyText && !lotCode) continue;
      if (!skuId) throw new BusinessError(`Row ${i + 1}: choose a SKU`, { field: "lines" });
      if (qtyText === null) throw new BusinessError(`Row ${i + 1}: enter the counted quantity (0 is allowed)`, { field: "lines" });
      lines.push({ skuId, lotCode, qty: Number(qtyText) });
    }
    const session = await createCountSession(db, actor, { warehouseId: str(form, "warehouseId"), countedOn: str(form, "countedOn"), countedBy: opt(form, "countedBy"), note: opt(form, "note"), lines });
    return { ok: "Count sheet saved as a draft; review it, then apply", redirectTo: `/admin/counts/${session.id}` };
  });
}

export async function applyCountSessionAction(form: FormData) {
  const id = str(form, "sessionId");
  return runAction(`/admin/counts/${id}`, async ({ db, actor }) => {
    const r = await applyCountSession(db, actor, id);
    return `Count applied: ${r.changes.length} SKU position(s) set to the counted totals`;
  });
}
