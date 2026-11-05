/**
 * Stripe refuses a due date in the past on an invoice it does not charge itself (seen on the preview, Nov 4: a Net 0
 * invoice approved in the afternoon was due at noon UTC that day). The copy is due at the end of its due day in Pacific
 * time, or at the end of today once that day has passed.
 */
import { describe, expect, it } from "vitest";
import { stripeDueTimestamp } from "@/lib/domain/collection/invoices";

const iso = (ts: number) => new Date(ts * 1000).toISOString();

describe("the due date on the Stripe copy", () => {
  it("a Net 0 invoice approved in the afternoon is due at the end of today, Pacific time", () => {
    const now = new Date("2026-11-05T00:32:00Z"); // Nov 4, 4:32 pm Pacific
    expect(iso(stripeDueTimestamp("2026-11-04", now))).toBe("2026-11-05T07:59:00.000Z"); // Nov 4, 11:59 pm PST
  });

  it("a future due date keeps its own day", () => {
    const now = new Date("2026-11-05T00:32:00Z");
    expect(iso(stripeDueTimestamp("2026-12-04", now))).toBe("2026-12-05T07:59:00.000Z");
  });

  it("an invoice approved after its due day has passed is due at the end of today", () => {
    const now = new Date("2026-11-20T18:00:00Z"); // Nov 20, 10 am Pacific
    expect(iso(stripeDueTimestamp("2026-11-04", now))).toBe("2026-11-21T07:59:00.000Z");
  });

  it("in the last minute of the day it moves to the end of tomorrow, and it follows daylight saving time", () => {
    expect(iso(stripeDueTimestamp("2026-11-04", new Date("2026-11-05T07:58:30Z")))).toBe("2026-11-06T07:59:00.000Z");
    expect(iso(stripeDueTimestamp("2026-07-01", new Date("2026-06-15T12:00:00Z")))).toBe("2026-07-02T06:59:00.000Z"); // PDT
  });

  it("is the same all day, so a retry repeats the request exactly", () => {
    const a = stripeDueTimestamp("2026-11-04", new Date("2026-11-04T16:00:00Z"));
    const b = stripeDueTimestamp("2026-11-04", new Date("2026-11-05T05:00:00Z"));
    expect(a).toBe(b);
  });
});
