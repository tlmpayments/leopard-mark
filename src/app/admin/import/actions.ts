"use server";

import { runAction, str } from "@/lib/actions/helpers";
import { BusinessError } from "@/lib/errors";
import { applyRun, discardRun, dryRun } from "@/lib/import";

/** Upload an .xlsx export of the TLM Master File and store a dry run for review (import.dry_run). */
export async function uploadWorkbookAction(form: FormData) {
  return runAction("/admin/import", async ({ db, actor }) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new BusinessError("Choose the .xlsx export of the TLM Master File", { field: "file" });
    const bytes = Buffer.from(await file.arrayBuffer());
    const r = await dryRun(db, actor, { fileName: file.name, bytes });
    return {
      ok: `Dry run complete: ${r.report.totals.creates} to create, ${r.report.totals.updates} to update, ${r.report.totals.unchanged} unchanged, ${r.report.flags.length} flagged. Review, then apply.`,
      redirectTo: `/admin/import/${r.run.id}`,
    };
  });
}

/** Apply a reviewed dry run: Owner only (import.apply). */
export async function applyRunAction(form: FormData) {
  const id = str(form, "runId");
  return runAction(`/admin/import/${id}`, async ({ db, actor }) => {
    const r = await applyRun(db, actor, id);
    return `Import applied: ${r.result.creates} created, ${r.result.updates} updated, ${r.result.unchanged} unchanged, ${r.result.exceptionsOpened} lot exception(s) opened`;
  });
}

export async function discardRunAction(form: FormData) {
  const id = str(form, "runId");
  return runAction("/admin/import", async ({ db, actor }) => {
    await discardRun(db, actor, id);
    return "Dry run discarded; nothing was written";
  });
}
