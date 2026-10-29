/**
 * Order cutoffs and delivery days per origin (Round 3, from the operations question list).
 *
 * Each origin has a latest local time an order can reach it (Balmuth 2:30 p.m., Express Wine Delivery 3:30 p.m.,
 * Radford noon Pacific the day before) for a shipment `leadDays` later, and optionally the weekdays it delivers or
 * releases (the SoCal driver Wednesday and Thursday; Express Wine Delivery Tuesday and Thursday). Orders may change
 * until that cutoff; cancelling is allowed any time. Every cutoff is kept in Pacific time, the office's clock.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/types";

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface OriginCutoff {
  orderCutoff: string | null;
  leadDays: number;
  deliveryDays: string[] | null;
  timezone: string;
}

/** Local calendar date (YYYY-MM-DD), time (HH:MM) and weekday for an instant in a time zone. */
export function localParts(at: Date, timezone: string): { date: string; hhmm: string; weekday: Weekday } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}`, weekday: parts.weekday as Weekday };
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(isoDate: string): Weekday {
  return WEEKDAYS[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

/** "14:30" to "2:30 p.m." */
export function formatCutoff(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "p.m." : "a.m.";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function isDeliveryDay(isoDate: string, days: string[] | null): boolean {
  const wd = weekdayOf(isoDate);
  if (days && days.length) return days.includes(wd);
  return wd !== "Sat" && wd !== "Sun";
}

/**
 * The earliest date an order placed now can ship from the origin: today plus the lead days, one more day once the
 * cutoff has passed, then forward to the next delivery day.
 */
export function nextShipDate(o: OriginCutoff, now: Date = new Date()): string {
  const local = localParts(now, o.timezone);
  let lead = Math.max(0, o.leadDays);
  if (o.orderCutoff && local.hhmm > o.orderCutoff) lead += 1;
  let d = addDays(local.date, lead);
  for (let i = 0; i < 14 && !isDeliveryDay(d, o.deliveryDays); i += 1) d = addDays(d, 1);
  return d;
}

/** The local date on which changes close for a shipment scheduled on `scheduledDate`, and whether that moment has passed. */
export function changeDeadline(o: OriginCutoff, scheduledDate: string, now: Date = new Date()): { date: string; time: string | null; passed: boolean } {
  const date = addDays(scheduledDate, -Math.max(0, o.leadDays));
  const local = localParts(now, o.timezone);
  const passed = local.date > date || (local.date === date && (o.orderCutoff ? local.hhmm > o.orderCutoff : false));
  return { date, time: o.orderCutoff, passed };
}

/** Cutoff settings for an origin, with its market's time zone. */
export async function originCutoff(db: DbOrTx, warehouseId: string | null): Promise<(OriginCutoff & { originCode: string | null; name: string }) | null> {
  if (!warehouseId) return null;
  const [w] = await db.select().from(schema.warehouse).where(eq(schema.warehouse.id, warehouseId));
  if (!w) return null;
  return {
    orderCutoff: w.orderCutoff,
    leadDays: w.leadDays,
    deliveryDays: w.deliveryDays,
    // Every cutoff is kept in Pacific time, the office's clock (Radford's is "noon Pacific the day before").
    timezone: "America/Los_Angeles",
    originCode: w.originCode,
    name: w.name,
  };
}

/** One line for the order screen, e.g. "WLA ships next on Wed Nov 4; order by 2:30 p.m. Pacific for next-day." */
export function cutoffHint(o: OriginCutoff & { originCode: string | null; name: string }, now: Date = new Date()): string {
  const next = nextShipDate(o, now);
  const label = o.originCode ? o.originCode : o.name;
  const day = new Date(`${next}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const days = o.deliveryDays && o.deliveryDays.length ? ` Delivers ${o.deliveryDays.join(", ")}.` : "";
  const cut = o.orderCutoff ? ` Order by ${formatCutoff(o.orderCutoff)} Pacific${o.leadDays > 1 ? `, ${o.leadDays} days ahead` : o.leadDays === 1 ? " the day before" : " the same day"}.` : "";
  return `${label} can ship next on ${day}.${cut}${days}`;
}
