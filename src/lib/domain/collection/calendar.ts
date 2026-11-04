/**
 * Business days for the due-date debit (Owner, Nov 4, 2026): a due date on a weekend or a Federal Reserve bank
 * holiday debits on the next business day. The ACH network does not settle on those days either, so a debit sent
 * then would only wait.
 */

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  // month 1-12; weekday 0=Sun; n>0 = nth from the start, n<0 = nth from the end
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    return iso(new Date(Date.UTC(year, month - 1, 1 + offset + (n - 1) * 7)));
  }
  const last = new Date(Date.UTC(year, month, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return iso(new Date(Date.UTC(year, month - 1, last.getUTCDate() - back + (n + 1) * 7)));
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A fixed-date holiday observed on the nearest weekday when it falls on a weekend (Federal Reserve rule: Saturday is not moved; Sunday moves to Monday). */
function observed(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return iso(d);
}

const cache = new Map<number, Set<string>>();

/** Federal Reserve bank holidays for a year (the ACH network is closed). */
export function bankHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const set = new Set<string>([
    observed(year, 1, 1), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Presidents' Day
    nthWeekday(year, 5, 1, -1), // Memorial Day
    observed(year, 6, 19), // Juneteenth
    observed(year, 7, 4), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(year, 11, 11), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(year, 12, 25), // Christmas
  ]);
  cache.set(year, set);
  return set;
}

export function isBusinessDay(isoDate: string): boolean {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return !bankHolidays(d.getUTCFullYear()).has(isoDate);
}

/** The date itself when it is a business day, otherwise the next one. */
export function nextBusinessDayOnOrAfter(isoDate: string): string {
  let d = isoDate;
  for (let i = 0; i < 10 && !isBusinessDay(d); i += 1) {
    const n = new Date(`${d}T12:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
  }
  return d;
}

/** Business days from one date to another (exclusive of the start, inclusive of the end). */
export function addBusinessDays(isoDate: string, days: number): string {
  let d = isoDate;
  let left = days;
  while (left > 0) {
    const n = new Date(`${d}T12:00:00Z`);
    n.setUTCDate(n.getUTCDate() + 1);
    d = n.toISOString().slice(0, 10);
    if (isBusinessDay(d)) left -= 1;
  }
  return d;
}
