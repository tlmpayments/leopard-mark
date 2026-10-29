import type { Actor } from "@/lib/authz/actor";
import type { ShipmentStatus, ShipmentType } from "@/lib/domain/shipments/service";

/**
 * Driver / Service only: every grant is driver_service, so only assigned stops are visible (spec §3, §8 item 8).
 * Same predicate as listShipments, so a dev-fixture sign-in as a driver behaves like the real one.
 */
export function isDriverOnly(actor: Actor): boolean {
  return actor.kind !== "system" && actor.grants.length > 0 && actor.grants.every((g) => g.role === "driver_service");
}

/** Presentation constants shared by the shipment pages (no React, no database). */

export const TYPE_LABEL: Record<ShipmentType, string> = { D: "Delivery", T: "Transfer", S: "Samples" };

export const SHIPMENT_STATUSES: ShipmentStatus[] = ["draft", "confirmed", "staged", "out", "delivered", "voided"];

export const SHIPMENT_TYPES: ShipmentType[] = ["D", "T", "S"];

/** Number as printed: "draft" until confirmation; "R<n>" after the number once documents were regenerated (5.3, 5.4). */
export function shipmentNumber(s: { number: string | null; revision: number }): string {
  if (!s.number) return "draft";
  return s.revision > 0 ? `${s.number} R${s.revision}` : s.number;
}

/** Today's calendar date as YYYY-MM-DD in the company timezone (date inputs default to it). */
export function todayIso(tz = "America/Los_Angeles"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Comma- or newline-separated PO numbers from one input. */
export function splitList(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Round 3: the carriers in use, offered as a picklist; any other carrier can still be typed. */
export const CARRIERS = ["Own driver", "Express Wine Delivery", "Orange Courier", "Distributor pickup", "LTL carrier"] as const;
