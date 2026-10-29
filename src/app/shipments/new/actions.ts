"use server";

import { runAction, str } from "@/lib/actions/helpers";
import { createShipment } from "@/lib/domain/shipments/service";
import { headerFromForm } from "../form";

export async function createShipmentAction(form: FormData) {
  const back = new URLSearchParams();
  if (str(form, "type")) back.set("type", str(form, "type"));
  if (str(form, "destinationLocationId")) back.set("locationId", str(form, "destinationLocationId"));
  return runAction(`/shipments/new?${back.toString()}`, async ({ db, actor }) => {
    const header = headerFromForm(form);
    const row = await createShipment(db, actor, header, []);
    return { ok: "Draft created. Add the lines, then confirm to assign the number.", redirectTo: `/shipments/${row.id}` };
  });
}
