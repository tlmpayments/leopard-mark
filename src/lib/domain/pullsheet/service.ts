/**
 * End-of-day master pull sheet (R2-29). Each warehouse (Express Wine Delivery, Balmuth) gets one sheet per day for the
 * next day's confirmed shipments: the office downloads it from Shipments, End of day. Sending it by email at a set
 * local time is behind the company switch `autoSendPullSheets`, off by default, with the address and time on the
 * warehouse record. Round 4: the send is an approval item from operations@ (the Owner's rule: nothing goes out on its
 * own); it leaves through Gmail once approved while `sendEmailAutomatically` is on, otherwise a person sends it by hand.
 */
import { and, eq } from "drizzle-orm";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { pullSheet } from "@/lib/domain/shipments/service";
import { requestApproval, type EmailPayload } from "@/lib/domain/approvals/service";
import { marketDay } from "@/lib/format";

/** Kept for the job history: pre-Round-4 send jobs carried this kind. */
export const JOB_PULL_SHEET_SEND = "pull_sheet.send";

/** The calendar day after `now` in the market's timezone: the day the warehouse pulls for. */
export function nextDay(tz: string, now = new Date()): string {
  const today = marketDay(now, tz);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Local wall-clock HH:MM in the market's timezone. */
export function localTime(tz: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/** Warehouses (not breweries) that receive an end-of-day sheet, with their market's timezone. */
export async function pullSheetWarehouses(db: DbOrTx) {
  const rows = await db
    .select({ w: schema.warehouse, tz: schema.market.timezone, marketCode: schema.market.code })
    .from(schema.warehouse)
    .leftJoin(schema.market, eq(schema.market.id, schema.warehouse.marketId))
    .where(and(eq(schema.warehouse.active, true), eq(schema.warehouse.kind, "warehouse")))
    .orderBy(schema.warehouse.name);
  return rows.map((r) => ({ ...r.w, tz: r.tz ?? "America/Los_Angeles", marketCode: r.marketCode ?? null }));
}

/** The sheet for one warehouse and day (what the Download button renders). */
export async function endOfDaySheet(db: DbOrTx, actor: Actor, warehouseId: string, date: string) {
  return pullSheet(db, actor, warehouseId, date);
}

/**
 * Called by the cron run: for each warehouse with an address and a send time, once its local send time has passed
 * today, queue one approval item (an email from operations@ with tomorrow's sheet attached). Nothing is queued while
 * the company switch is off, and nothing leaves until a person approves it.
 */
export async function schedulePullSheetSends(db: DbOrTx, now = new Date()) {
  const settings = await getCompanySettings(db);
  if (!settings.autoSendPullSheets) return { queued: 0, skipped: "switch_off" as const };
  let queued = 0;
  for (const w of await pullSheetWarehouses(db)) {
    if (!w.pullSheetEmail || !w.pullSheetSendTime) continue;
    if (localTime(w.tz, now) < w.pullSheetSendTime) continue;
    const date = nextDay(w.tz, now);
    const sheet = await pullSheet(db, SYSTEM_ACTOR, w.id, date);
    if (!sheet.stops.length) continue; // nothing to pull tomorrow; no empty sheet goes out
    const payload: EmailPayload = {
      to: [w.pullSheetEmail],
      subject: `${settings.dba} pull sheet for ${date} (${w.originCode ?? w.name})`,
      body: [`Hello,`, "", `Attached is tomorrow's pull sheet for ${w.name}: ${sheet.stops.length} stop${sheet.stops.length === 1 ? "" : "s"} on ${date}.`, "", "Thank you,", settings.dba, settings.operationsSenderAddress].join("\n"),
      attachments: [{ kind: "pull_sheet", warehouseId: w.id, date }],
    };
    const r = await requestApproval(db, SYSTEM_ACTOR, {
      kind: "email",
      purpose: "pull_sheet",
      sender: "operations@",
      title: `Pull sheet ${date} to ${w.originCode ?? w.name} (${sheet.stops.length} stops)`,
      summary: `To ${w.pullSheetEmail}; PDF attached.`,
      payload: payload as unknown as Record<string, unknown>,
      subjectType: "warehouse",
      subjectId: w.id,
      marketId: w.marketId,
      dedupeKey: `pull_sheet:${w.id}:${date}`,
    });
    if (r.created) queued += 1;
  }
  return { queued, skipped: null };
}
