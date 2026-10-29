"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { recordKegEvent } from "@/lib/domain/kegs/service";

export async function recordKegEventAction(form: FormData) {
  const locationId = str(form, "locationId");
  const returnTo = str(form, "returnTo") || (locationId ? `/kegs/${locationId}` : "/kegs");
  return runAction(returnTo, async ({ db, actor }) => {
    const n = (key: string) => (opt(form, key) ? Number(str(form, key)) : 0);
    const kind = str(form, "kind");
    await recordKegEvent(db, actor, {
      locationId,
      on: str(form, "on"),
      kind: kind === "opening" || kind === "pickup" ? kind : "adjustment",
      halfOut: n("halfOut"),
      sixtelOut: n("sixtelOut"),
      halfIn: n("halfIn"),
      sixtelIn: n("sixtelIn"),
      note: str(form, "note"),
    });
    return "Keg event recorded";
  });
}
