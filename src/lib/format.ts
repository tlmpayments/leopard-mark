/**
 * Presentation helpers with no React dependency: state → label/tone/glyph
 * (UX-04, AC31) and market-timezone dates (UX-10, AC35). Kept apart from the
 * components so they can be unit-tested and reused by server code.
 */
export type Tone = "neutral" | "good" | "warn" | "danger" | "info";
/** Non-color cue so state is never communicated by color alone (UX-04, AC31). */
export const toneGlyph: Record<Tone, string> = { neutral: "○", good: "●", warn: "◐", danger: "✕", info: "i" };

/**
 * Explicit state → presentation mapping (UX-04). Keys are the actual states the
 * application produces; anything unknown renders neutral with its raw label
 * rather than guessing from substrings.
 */
export const STATUS_PRESENTATION: Record<string, { label: string; tone: Tone }> = {
  // readiness conditions
  satisfied: { label: "Satisfied", tone: "good" },
  blocked: { label: "Blocked", tone: "danger" },
  unresolved: { label: "Owner decision needed", tone: "warn" },
  pending: { label: "Action needed", tone: "warn" },
  releasable: { label: "Releasable", tone: "good" },
  "not releasable": { label: "Not releasable", tone: "warn" },
  // location / license / payment
  active: { label: "Active", tone: "good" },
  inactive: { label: "Inactive", tone: "warn" },
  closed: { label: "Closed", tone: "danger" },
  unverified: { label: "Not verified", tone: "warn" },
  pending_review: { label: "Pending review", tone: "warn" },
  verified: { label: "Verified", tone: "good" },
  rejected: { label: "Rejected", tone: "danger" },
  not_applicable: { label: "Recorded not applicable", tone: "neutral" },
  unselected: { label: "Unselected", tone: "warn" },
  selected: { label: "Selected", tone: "good" },
  stripe_ach: { label: "Stripe ACH", tone: "info" },
  fintech: { label: "FinTech", tone: "info" },
  not_requested: { label: "Not requested", tone: "neutral" },
  requested: { label: "Requested", tone: "warn" },
  pending_verification: { label: "Pending verification", tone: "warn" },
  method_usable: { label: "Usable", tone: "good" },
  unusable: { label: "Unusable", tone: "danger" },
  revoked: { label: "Revoked", tone: "danger" },
  unknown: { label: "Unknown", tone: "warn" },
  // orders / demand
  submitted: { label: "Recorded", tone: "info" },
  partially_fulfilled: { label: "Partly delivered", tone: "info" },
  fulfilled: { label: "Delivered", tone: "good" },
  cancelled: { label: "Cancelled", tone: "danger" },
  meets: { label: "Meets $90", tone: "good" },
  below: { label: "Below $90", tone: "warn" },
  depends_on_unselected_D11: { label: "Depends on D11", tone: "warn" },
  applied: { label: "Applied", tone: "good" },
  recorded_unselected_policy: { label: "Recorded (policy unselected)", tone: "warn" },
  // exceptions
  open: { label: "Open", tone: "warn" },
  acknowledged: { label: "Acknowledged", tone: "info" },
  assigned: { label: "Assigned", tone: "info" },
  waiting: { label: "Waiting", tone: "warn" },
  resolved: { label: "Resolved", tone: "good" },
  // notices / jobs / provider references
  intended: { label: "Intended", tone: "neutral" },
  manual_pending: { label: "To send (manual)", tone: "warn" },
  sent: { label: "Sent (recorded)", tone: "good" },
  failed: { label: "Failed", tone: "danger" },
  superseded: { label: "Superseded", tone: "neutral" },
  queued: { label: "Queued", tone: "info" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "good" },
  established: { label: "Established", tone: "good" },
  stale: { label: "Stale — re-verify", tone: "warn" },
  // standing / samples
  defined: { label: "Defined", tone: "good" },
  paused: { label: "Paused", tone: "warn" },
  ended: { label: "Ended", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "info" },
  corrected: { label: "Corrected", tone: "neutral" },
  returned_sellable: { label: "Returned (sellable)", tone: "good" },
  returned_damaged: { label: "Returned (damaged)", tone: "danger" },
  // integration states / gates
  not_implemented: { label: "NOT IMPLEMENTED", tone: "neutral" },
  implemented_not_connected: { label: "IMPLEMENTED / NOT CONNECTED", tone: "warn" },
  connected_test_mode: { label: "CONNECTED / TEST MODE", tone: "info" },
  connected_capability_unverified: { label: "CONNECTED / CAPABILITY UNVERIFIED", tone: "warn" },
  accepted_for_live_use: { label: "ACCEPTED FOR LIVE USE", tone: "good" },
  live_degraded_or_disconnected: { label: "LIVE / DEGRADED OR DISCONNECTED", tone: "danger" },
  unproven: { label: "Unproven", tone: "warn" },
  demonstrated: { label: "Demonstrated", tone: "good" },
  temporary_control_approved: { label: "Temporary control approved", tone: "info" },
  not_applicable_yet: { label: "Not applicable yet", tone: "neutral" },
  // connection facts
  no_check: { label: "Untested", tone: "warn" },
  ok: { label: "Verified", tone: "good" },
  // occurrences
  generated: { label: "Generated", tone: "good" },
  generated_partial: { label: "Generated (lines skipped)", tone: "warn" },
  skipped_archived_sku: { label: "Skipped — products archived", tone: "warn" },
  skipped_closed: { label: "Skipped — location not active", tone: "warn" },
  skipped_policy: { label: "Skipped — held (per D13)", tone: "warn" },
  skipped_policy_incomplete: { label: "Skipped — D13 incomplete", tone: "warn" },
  // job outcomes
  retry: { label: "Retrying", tone: "warn" },
  skipped: { label: "Skipped", tone: "neutral" },
  lost_claim: { label: "Lost claim", tone: "warn" },
  // shipments (SHIPMENTS_SPEC §2 state machine)
  draft: { label: "Draft", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "info" },
  staged: { label: "Staged", tone: "info" },
  out: { label: "Out", tone: "info" },
  delivered: { label: "Delivered", tone: "good" },
  voided: { label: "Voided", tone: "danger" },
  // invoices
  issued: { label: "Issued", tone: "info" },
  paid: { label: "Paid", tone: "good" },
  void: { label: "Void", tone: "danger" },
  // brew batches
  scheduled: { label: "Scheduled", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  complete: { label: "Complete", tone: "good" },
  destroyed: { label: "Destroyed", tone: "danger" },
  // NMFC
  proposed: { label: "Proposed", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
};

export function presentStatus(value: string): { label: string; tone: Tone; glyph: string } {
  const key = value.toLowerCase();
  const p = STATUS_PRESENTATION[key] ?? STATUS_PRESENTATION[value];
  if (p) return { ...p, glyph: toneGlyph[p.tone] };
  return { label: value.replace(/_/g, " "), tone: "neutral", glyph: toneGlyph.neutral };
}

/** Default operational timezone when no market is known (company office). */
export const DEFAULT_TZ = "America/Los_Angeles";

const TZ_ABBR: Record<string, string> = { "America/Los_Angeles": "PT", "America/New_York": "ET", "America/Denver": "MT", "America/Chicago": "CT", "America/Phoenix": "MST" };

/** Timestamp in the market's timezone, labelled when it is not the default (UX-10). */
export function fmtDate(d: Date | string | null | undefined, tz: string = DEFAULT_TZ) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  const text = date.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return tz === DEFAULT_TZ ? text : `${text} ${TZ_ABBR[tz] ?? tz}`;
}

/** Calendar date (YYYY-MM-DD) of a timestamp in a market's timezone. */
export function marketDay(d: Date, tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Date-only business facts stay as the date they were entered — never shifted through a timezone. */
export function fmtDay(d: string | null | undefined) {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function ago(d: Date, now = new Date()): string {
  const ms = now.getTime() - d.getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}
