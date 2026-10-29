/**
 * Small helpers shared by the document route handlers: an inline application/pdf response, a safe filename, and the
 * UUID guard that turns a malformed id into a 404 instead of a Postgres cast error.
 */
import type { Actor } from "@/lib/authz/actor";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Keep filenames to ASCII letters, digits, dots, dashes and underscores so Content-Disposition stays simple. */
export function safeFilename(parts: Array<string | null | undefined>, ext = "pdf"): string {
  const stem = parts
    .filter((p): p is string => Boolean(p && p.trim()))
    .join("-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  return `${stem || "document"}.${ext}`;
}

/** The PDF bytes as an inline response (opens in the browser; "Save as" keeps the filename). */
export function pdfResponse(pdf: Buffer | Uint8Array, filename: string): Response {
  // A fresh Uint8Array copy is typed over a plain ArrayBuffer, which is what the Response body type expects.
  const body = new Uint8Array(pdf);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function textResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/** Driver / Service only: an actor whose every grant is driver_service sees assigned stops alone (spec §8, item 8). */
export function isDriverOnly(actor: Actor): boolean {
  return actor.kind === "employee" && actor.grants.length > 0 && actor.grants.every((g) => g.role === "driver_service");
}
