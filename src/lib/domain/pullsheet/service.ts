/**
 * End-of-day master pull sheet (R2-29). Each warehouse (Express Wine Delivery, Balmuth) gets one sheet per day for the
 * next day's confirmed shipments: the office downloads it from Shipments, End of day. Sending it by email at a set
 * local time is behind the company switch `autoSendPullSheets`, off by default, with the address and time on the
 * warehouse record. The transport (Gmail automated send) is not built: a send job waits honestly and the office is
 * told to download instead; nothing is ever emailed while the switch is off.
 */
import { and, eq } from "drizzle-orm";
import { recordAudit } from "@/lib/audit/record";
import { SYSTEM_ACTOR, type Actor } from "@/lib/authz/actor";
import * as schema from "@/lib/db/schema";
import type { Db, DbOrTx } from "@/lib/db/types";
import { renderDocument } from "@/lib/documents/pdf";
import { toPullSheetSnapshot } from "@/lib/documents/pull-sheet";
import { getCompanySettings } from "@/lib/domain/settings/service";
import { pullSheet } from "@/lib/domain/shipments/service";
import { openException } from "@/lib/exceptions/service";
import { NotBuiltError, gmail } from "@/lib/integrations/boundaries";

import { enqueueJob, ProviderUnavailableError, registerJobHandler } from "@/lib/jobs/queue";
import { marketDay } from "@/lib/format";

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
 * today, queue one send for tomorrow's sheet. Nothing is queued while the company switch is off.
 */
export async function schedulePullSheetSends(db: DbOrTx, now = new Date()) {
  const settings = await getCompanySettings(db);
  if (!settings.autoSendPullSheets) return { queued: 0, skipped: "switch_off" as const };
  let queued = 0;
  for (const w of await pullSheetWarehouses(db)) {
    if (!w.pullSheetEmail || !w.pullSheetSendTime) continue;
    if (localTime(w.tz, now) < w.pullSheetSendTime) continue;
    const date = nextDay(w.tz, now);
    const r = await enqueueJob(db, JOB_PULL_SHEET_SEND, { warehouseId: w.id, date, to: w.pullSheetEmail }, { dedupeKey: `${JOB_PULL_SHEET_SEND}:${w.id}:${date}`, maxAttempts: 3 });
    if (r.outcome === "queued") queued += 1;
  }
  return { queued, skipped: null };
}

registerJobHandler(JOB_PULL_SHEET_SEND, {
  /** Resumes only once an automated Gmail send exists; until then the job waits and the office downloads the sheet. */
  ready: () => false,
  run: async (db: Db, payload) => {
    const warehouseId = String(payload.warehouseId ?? "");
    const date = String(payload.date ?? "");
    const to = String(payload.to ?? "");
    const settings = await getCompanySettings(db);
    if (!settings.autoSendPullSheets) {
      await recordAudit(db, SYSTEM_ACTOR, { action: "pull_sheet.send_skipped", subjectType: "warehouse", subjectId: warehouseId, current: { date, to, reason: "Auto-send switched off before the job ran" } });
      return;
    }
    const sheet = await pullSheet(db, SYSTEM_ACTOR, warehouseId, date);
    const pdf = await renderDocument(toPullSheetSnapshot(sheet, "Leopard Mark Ops (scheduled)"));
    try {
      gmail.send();
    } catch (err) {
      if (err instanceof NotBuiltError) {
        await openException(db, SYSTEM_ACTOR, {
          category: "provider_unavailable",
          title: `Pull sheet for ${sheet.origin.originCode ?? sheet.origin.name} ${date} was not emailed`,
          cause: `Automated Gmail send is not built; the sheet (${pdf.length} bytes, ${sheet.stops.length} stops) is ready to download from Shipments, End of day.`,
          marketId: sheet.origin.marketId,
          ownerRole: "admin",
          nextAction: "Download the pull sheet and send it by hand, or switch auto-send off until the transport is built.",
          dedupeKey: `pull_sheet_not_sent:${warehouseId}:${date}`,
          links: [{ subjectType: "warehouse", subjectId: warehouseId }],
        });
        throw new ProviderUnavailableError(`Gmail automated send is not built; pull sheet for ${date} waits (download it instead)`);
      }
      throw err;
    }
  },
});
