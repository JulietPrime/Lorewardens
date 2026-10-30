// ---------------------------------------------------------------------------
// Canon date parsing and pure date math.
//
// Canon dates are writer-confirmed strings in strict `YYYY | YYYY-MM |
// YYYY-MM-DD` form (see TimelineEvent.date / Character.birthDate in
// types.ts). Parsing is deliberately strict: anything that does not match
// the format or fails calendar sanity is treated as absent, so malformed
// input degrades to silence instead of wrong findings. Every function here
// is pure and offline.
// ---------------------------------------------------------------------------

export type DateGranularity = "year" | "month" | "day";

export type DateUnit = "year" | "month" | "day";

export interface CanonDate {
  year: number;
  month?: number; // 1-12
  day?: number; // 1..daysInMonth(year, month)
  precision: DateGranularity;
}

const CANON_DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return lengths[month - 1];
}

/**
 * Strict parse: `YYYY | YYYY-MM | YYYY-MM-DD` plus calendar sanity (month
 * 1-12, day within the month, leap-aware February). Returns undefined on any
 * mismatch — including empty/undefined input — never throws.
 */
export function parseCanonDate(value: string | undefined | null): CanonDate | undefined {
  if (value === undefined || value === null) return undefined;
  if (!CANON_DATE_PATTERN.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (month !== undefined) {
    if (month < 1 || month > 12) return undefined;
    if (day !== undefined && (day < 1 || day > daysInMonth(year, month))) return undefined;
  }
  return {
    year,
    ...(month !== undefined ? { month } : {}),
    ...(day !== undefined ? { day } : {}),
    precision: day !== undefined ? "day" : month !== undefined ? "month" : "year",
  };
}

/** Coarsest precision the string expresses; undefined when unparseable. */
export function granularityOf(value: string | undefined | null): DateGranularity | undefined {
  return parseCanonDate(value)?.precision;
}

/** The coarser of two granularities (comparisons happen at the coarsest
 *  common granularity: a year-only date is never contradicted by a month
 *  or season assertion). */
export function coarsestCommon(a: CanonDate, b: CanonDate): DateGranularity {
  return a.precision === "year" || b.precision === "year"
    ? "year"
    : a.precision === "month" || b.precision === "month"
      ? "month"
      : "day";
}

/** Full-precision comparison (a minus b): negative when a is earlier,
 *  positive when a is later, 0 when identical at the shared precision. */
export function compareCanonDates(a: CanonDate, b: CanonDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== undefined && b.month !== undefined && a.month !== b.month) return a.month - b.month;
  if (a.day !== undefined && b.day !== undefined && a.day !== b.day) return a.day - b.day;
  return 0;
}

/**
 * Signed elapsed amount from `a` to `b` in `unit` (b minus a). Returns
 * undefined when either date lacks the precision the unit needs (a month or
 * day unit requires that field on both sides), so callers stay silent
 * instead of guessing.
 */
export function elapsedBetween(a: CanonDate, b: CanonDate, unit: DateUnit): number | undefined {
  if (unit === "year") return b.year - a.year;
  if (a.month === undefined || b.month === undefined) return undefined;
  if (unit === "month") return b.year * 12 + b.month - (a.year * 12 + a.month);
  if (a.day === undefined || b.day === undefined) return undefined;
  const utcA = Date.UTC(a.year, a.month - 1, a.day);
  const utcB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((utcB - utcA) / 86_400_000);
}

/**
 * Whole years lived from `birth` to `at`, computed at the coarsest
 * precision the two dates share. Birthday rounding (a possible off-by-one
 * when the day of birth is unresolved) is handled by the caller's
 * tolerance, not here.
 */
export function ageAt(birth: CanonDate, at: CanonDate): number {
  let age = at.year - birth.year;
  if (birth.month !== undefined && at.month !== undefined) {
    const beforeBirthday =
      at.month < birth.month ||
      (at.month === birth.month &&
        birth.day !== undefined &&
        at.day !== undefined &&
        at.day < birth.day);
    if (beforeBirthday) age -= 1;
  }
  return age;
}
