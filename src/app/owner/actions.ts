"use server";

import { opt, runAction, str } from "@/lib/actions/helpers";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runPolicyFollowThrough } from "@/lib/policy/followthrough";
import { recordSelection, withdrawProductionSelection, withdrawSelection } from "@/lib/policy/policy";
import { fieldSpecs } from "@/lib/policy/schema";

/** Build the selection object from typed form fields (sel:<key>) or, for decisions without a structured schema, from a JSON textarea. */
async function selectionFromForm(decisionId: string, form: FormData): Promise<Record<string, unknown>> {
  const [decision] = await (await getDb()).select().from(schema.decision).where(eq(schema.decision.id, decisionId));
  const specs = fieldSpecs(decision?.selectionSchema ?? null);
  if (specs.length === 0) {
    const raw = str(form, "selectionJson");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error("Selection must be valid JSON");
    }
  }
  const out: Record<string, unknown> = {};
  for (const spec of specs) {
    if (spec.type.kind === "string_list") {
      const values = form.getAll(`sel:${spec.key}`).filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (values.length) out[spec.key] = values.length === 1 && values[0].includes(",") ? values[0].split(",").map((s) => s.trim()) : values;
      continue;
    }
    const v = str(form, `sel:${spec.key}`);
    if (v !== "") out[spec.key] = v;
  }
  return out;
}

export async function recordSelectionAction(form: FormData) {
  const id = str(form, "decisionId");
  return runAction(`/owner/decisions/${id}`, async ({ db, actor }) => {
    const kind = str(form, "kind") === "test" ? "test" : "production";
    const selection = await selectionFromForm(id, form);
    const marketIds = form.getAll("marketIds").filter((v): v is string => typeof v === "string" && v.length > 0);
    const effectiveFrom = opt(form, "effectiveFrom") ? new Date(str(form, "effectiveFrom")) : new Date();
    const { row, validation } = await recordSelection(db, actor, {
      decisionId: id,
      kind,
      selection,
      scope: str(form, "scope") || (marketIds.length ? `${marketIds.length} market(s)` : "all markets"),
      marketIds: marketIds.length ? marketIds : null,
      effectiveFrom,
      note: opt(form, "note") ?? undefined,
    });
    const follow = kind === "production" ? await runPolicyFollowThrough(db, actor, id, row.marketIds) : null;
    const unresolved = validation.missingKeys.length ? ` Unresolved parts stay inactive: ${validation.missingKeys.join(", ")}.` : "";
    return kind === "production"
      ? `Production selection recorded for ${row.scope}, effective ${row.effectiveFrom.toISOString().slice(0, 10)}.${unresolved}${follow ? ` ${follow}.` : ""}`
      : `TEST selection recorded (labelled; never production policy).${unresolved}`;
  });
}

export async function withdrawSelectionAction(form: FormData) {
  const id = str(form, "decisionId");
  return runAction(`/owner/decisions/${id}`, async ({ db, actor }) => {
    const selectionId = opt(form, "selectionId");
    const reason = str(form, "reason") || "withdrawn by Owner";
    if (selectionId) {
      const row = await withdrawSelection(db, actor, selectionId, reason);
      const follow = row.kind === "production" ? await runPolicyFollowThrough(db, actor, id, row.marketIds) : null;
      return `Selection for ${row.scope} withdrawn; other selections keep applying (history retained).${follow ? ` ${follow}.` : ""}`;
    }
    const n = await withdrawProductionSelection(db, actor, id, reason);
    const follow = await runPolicyFollowThrough(db, actor, id, null);
    return `${n} production selection(s) withdrawn; decision is unselected again (history retained).${follow ? ` ${follow}.` : ""}`;
  });
}
