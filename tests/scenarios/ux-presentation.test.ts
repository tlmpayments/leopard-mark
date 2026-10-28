import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/authz/authorize";
import { BusinessError, ConfigurationError, StaleStateError } from "@/lib/errors";
import { DEFAULT_TZ, STATUS_PRESENTATION, ago, fmtDate, fmtDay, marketDay, presentStatus, toneGlyph } from "@/lib/format";
import { safeErrorMessage } from "@/lib/actions/helpers";

/**
 * UX-04 / AC31 (state presentation is an explicit mapping with a non-color
 * cue), UX-10 / AC35 (market timezone and date-only facts) and UX-10 / AC36
 * (technical errors never reach the person verbatim). Pure functions: no
 * database, no browser.
 */
describe("UX-04 / AC31 — status presentation", () => {
  it("every application state maps to a plain label, a tone and a glyph; unknown values render neutral with the raw label, never a guessed tone", () => {
    for (const [state, p] of Object.entries(STATUS_PRESENTATION)) {
      const shown = presentStatus(state);
      expect(shown.label).toBe(p.label);
      expect(shown.tone).toBe(p.tone);
      expect(shown.glyph).toBe(toneGlyph[p.tone]);
      expect(shown.label).not.toMatch(/_/);
    }
    expect(presentStatus("SATISFIED")).toMatchObject({ label: "Satisfied", tone: "good" });
    expect(presentStatus("some_new_state")).toEqual({ label: "some new state", tone: "neutral", glyph: toneGlyph.neutral });
    // A state that merely contains "ok"/"fail" is not colored by substring.
    expect(presentStatus("failover_pending").tone).toBe("neutral");
  });

  it("each tone has a distinct glyph so state is never conveyed by color alone", () => {
    const glyphs = Object.values(toneGlyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    expect(presentStatus("blocked").glyph).not.toBe(presentStatus("satisfied").glyph);
  });
});

describe("UX-10 / AC35 — market timezone", () => {
  // 07:30Z on 8 March 2026: 11:30 PM PST on 7 March in California; already 3:30 AM EDT on 8 March in Massachusetts
  // (US daylight time began at 2:00 AM Eastern that morning, so 2:00–2:59 AM never happened there).
  const instant = new Date("2026-03-08T07:30:00Z");

  it("the same instant is a different calendar day in California and Massachusetts around midnight", () => {
    expect(marketDay(instant, "America/Los_Angeles")).toBe("2026-03-07");
    expect(marketDay(instant, "America/New_York")).toBe("2026-03-08");
    expect(marketDay(instant)).toBe(marketDay(instant, DEFAULT_TZ));
  });

  it("timestamps render in the market's zone and are labelled when it is not the company default", () => {
    expect(fmtDate(instant, "America/Los_Angeles")).toBe("Mar 7, 11:30 PM");
    expect(fmtDate(instant, "America/New_York")).toBe("Mar 8, 3:30 AM ET");
    expect(fmtDate("2026-03-08T07:30:00Z", "America/New_York")).toBe("Mar 8, 3:30 AM ET");
    expect(fmtDate(null)).toBe("—");
    expect(fmtDate("not a date")).toBe("—");
  });

  it("DST transition: one minute apart across the Eastern change reads 1:59 AM then 3:00 AM; California is still on standard time until 10:00Z", () => {
    expect(fmtDate(new Date("2026-03-08T06:59:00Z"), "America/New_York")).toBe("Mar 8, 1:59 AM ET");
    expect(fmtDate(new Date("2026-03-08T07:00:00Z"), "America/New_York")).toBe("Mar 8, 3:00 AM ET");
    expect(fmtDate(new Date("2026-03-08T09:59:00Z"), "America/Los_Angeles")).toBe("Mar 8, 1:59 AM");
    expect(fmtDate(new Date("2026-03-08T10:00:00Z"), "America/Los_Angeles")).toBe("Mar 8, 3:00 AM");
    const later = new Date(instant.getTime() + 3_600_000);
    expect(fmtDate(later, "America/Los_Angeles")).toBe("Mar 8, 12:30 AM");
    expect(marketDay(later, "America/Los_Angeles")).toBe("2026-03-08");
    expect(marketDay(later, "America/New_York")).toBe("2026-03-08");
  });

  it("date-only business facts (requested dates, license decisions, sample dates) are shown as entered — never shifted through a timezone", () => {
    expect(fmtDay("2026-09-17")).toBe("Sep 17, 2026");
    expect(fmtDay("2026-01-01")).toBe("Jan 1, 2026");
    expect(fmtDay(null)).toBe("—");
    expect(fmtDay("tbd")).toBe("tbd");
  });

  it("relative ages are coarse and monotonic", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    expect(ago(new Date("2026-09-17T11:59:30Z"), now)).toBe("1 min");
    expect(ago(new Date("2026-09-17T09:00:00Z"), now)).toBe("3 h");
    expect(ago(new Date("2026-09-10T12:00:00Z"), now)).toBe("7 d");
  });
});

describe("UX-10 / AC36 — technical errors are never shown verbatim", () => {
  it("business, stale-state, configuration and authorization refusals are shown as written", () => {
    expect(safeErrorMessage(new BusinessError("Quantities must be positive whole numbers", { field: "lines" })).message).toBe("Quantities must be positive whole numbers");
    expect(safeErrorMessage(new StaleStateError("NC-000001 is cancelled; it cannot be amended")).message).toMatch(/cannot be amended/);
    expect(safeErrorMessage(new ConfigurationError("FV_ENV must be one of …")).message).toMatch(/FV_ENV/);
    const auth = safeErrorMessage(new AuthorizationError("order.cancel_undelivered"));
    expect(auth.message).toBe("Not permitted: order.cancel_undelivered");
    expect(auth.reference).toBeUndefined();
  });

  it("a database or programming error is replaced by a reference; the raw detail goes to the server log only", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = new Error('duplicate key value violates unique constraint "reservation_pkey" DETAIL: Key (id)=(abc) already exists');
      raw.name = "PostgresError";
      const shown = safeErrorMessage(raw);
      expect(shown.reference).toMatch(/^[0-9a-f]{8}$/);
      expect(shown.message).toContain(`reference ${shown.reference}`);
      expect(shown.message).toContain("Nothing was changed");
      expect(shown.message).not.toMatch(/duplicate key|constraint|reservation_pkey|PostgresError|abc/);
      expect(spy).toHaveBeenCalledTimes(1);
      const logged = String(spy.mock.calls[0][0]);
      expect(logged).toContain(shown.reference);
      expect(logged).toContain("reservation_pkey");
      // Non-Error throwables get the same treatment.
      const other = safeErrorMessage("ECONNREFUSED 127.0.0.1:5432");
      expect(other.message).not.toContain("ECONNREFUSED");
      expect(other.reference).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
