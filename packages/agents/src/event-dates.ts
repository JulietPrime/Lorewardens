import type { CanonContext, CanonDate, Character, DateUnit, Finding, TextChunk } from "@lorewardens/core";
import {
  ageAt,
  coarsestCommon,
  compareCanonDates,
  elapsedBetween,
  makeFinding,
  parseCanonDate,
} from "@lorewardens/core";
import {
  firstMatchIndex,
  mentionsSubject,
  namesOf,
  SEQUENCE_CUES_AFTER,
  SEQUENCE_CUES_BEFORE,
  sentences,
} from "./lexical.js";
import {
  buildRefs,
  firstMentionIndex,
  keywordRefCount,
  mentionScore,
  mentionsEvent,
  type EventRef,
} from "./timeline.js";

// ---------------------------------------------------------------------------
// Timeline date and age checks.
//
// Closes the increment-1 known limit: the timeline agent previously checked
// sequence (order cues) only. These checks use the writer-confirmable canon
// dates `TimelineEvent.date` and `Character.birthDate` (strict
// `YYYY | YYYY-MM | YYYY-MM-DD`, parsed by core's parseCanonDate). Three new
// finding types, all `agent: timeline`, `category: timeline`:
//
// - `date-contradiction` — the passage mentions a dated event and asserts a
//   conflicting year, month or season.
// - `duration-contradiction` — the passage asserts an elapsed time or order
//   between two dated events that contradicts the canon dates (wrong amount
//   or reversed direction).
// - `impossible-age` — an asserted age contradicts the character's
//   birthDate plus the date of a mentioned event (beyond tolerance, outside
//   the plausible 0-150 range, or negative).
//
// COMPARISON RULES (binding):
// - Only parseable-dated events participate. Undated canon is silent and
//   existing (undated) behavior stays byte-identical: with no dated events
//   and no dated characters in context, this module returns [] immediately.
// - A fuzzy-precision event is treated as undated even if it carries a
//   date string; fuzzy means the writer explicitly left the timing loose.
// - Date comparisons happen at the COARSEST common granularity: a year-only
//   canon date is never contradicted by a month or season assertion (year
//   vs. month compares years only).
// - Duration units must be representable on both canon dates: day units
//   compare exactly; month/year units flag when the asserted amount differs
//   from the calendar difference by >= 1.
// - A direction reversal ("A ... after ... B" when canon has A before B) is
//   a duration-contradiction even when the asserted amount matches.
// - Age tolerance is +-1 whenever the comparison granularity is coarser
//   than day (birthday rounding: with month or year precision the exact day
//   of birth is unresolved, so an exact-year mismatch can still be
//   rounding). At day precision on both sides the computed age is exact and
//   the tolerance is 0. An asserted age against a negative computed age is
//   always flagged; a computed age above 150 is always flagged.
// - Locked canon escalates like the existing locked-event path: a
//   contradicted locked TimelineEvent (or locked Character, for age checks)
//   yields major severity / 0.95 confidence / gentle minimum strictness.
//
// Closed lexical tables (small, documented, deterministic): month names,
// meteorological season months (spring Mar-May, summer Jun-Aug,
// autumn Sep-Nov, winter Dec-Feb; "fall" aliases autumn), duration cue
// words, word numbers up to ninety-nine, and age-assertion cue patterns.
// Every loop below is a single pass over a short list (cues, matches,
// mentions) - no unbounded recursion.
//
// NOTE: importing from ./timeline.js while timeline.ts imports this module
// is safe because both sides only use function declarations (hoisted) and
// types; there are no module-initialization-time dependencies.
// ---------------------------------------------------------------------------

const MONTH_NAMES: readonly string[] = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_NUMBERS: ReadonlyMap<string, number> = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4], ["may", 5], ["june", 6],
  ["july", 7], ["august", 8], ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

// Meteorological seasons. A season assertion conflicts with a canon date
// only when the canon month is parseable and falls outside the season.
const SEASON_MONTHS: ReadonlyMap<string, readonly number[]> = new Map([
  ["spring", [3, 4, 5]],
  ["summer", [6, 7, 8]],
  ["autumn", [9, 10, 11]],
  ["fall", [9, 10, 11]],
  ["winter", [12, 1, 2]],
]);

const SEASON_CANONICAL: ReadonlyMap<string, string> = new Map([["fall", "autumn"]]);

// Word numbers up to ninety-nine, and the compound forms twenty-one ..
// ninety-nine. Larger numbers stay outside the table: digits cover them,
// and the checks below only need ages, durations and years of realistic size.
const WORD_UNITS: ReadonlyMap<string, number> = new Map([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14], ["fifteen", 15],
  ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19],
]);

const WORD_TENS: ReadonlyMap<string, number> = new Map([
  ["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50],
  ["sixty", 60], ["seventy", 70], ["eighty", 80], ["ninety", 90],
]);

const COMPOUND_UNITS = [...WORD_UNITS.keys()].filter((w) => w !== "zero" && w !== "ten");

const NUMBER_RE = new RegExp(
  `\\b(?:(\\d{1,4})|(${[...WORD_UNITS.keys()].join("|")})` +
    `|(${[...WORD_TENS.keys()].join("|")})(?:[-\\s](${COMPOUND_UNITS.join("|")}))?)\\b`,
  "gi",
);

const MONTH_RE = new RegExp(`\\b(${[...MONTH_NUMBERS.keys()].join("|")})\\b`, "gi");
const SEASON_RE = /\b(spring|summer|autumn|fall|winter)\b/gi;

// Age-assertion cue patterns (closed): "<N> years old", "<N> years of age",
// "aged <N>", "at age <N>", "at the age of <N>".
const AGE_SUFFIX_PATTERNS: readonly RegExp[] = [/^\s+years?\s+old\b/i, /^\s+years?\s+of\s+age\b/i];
const AGE_PREFIX_PATTERNS: readonly RegExp[] = [
  /\baged\s+$/i,
  /\bat\s+age\s+$/i,
  /\bat\s+the\s+age\s+of\s+$/i,
];

// Elapsed-time cue words: a number immediately followed by a unit word
// ("three years", "5 days"). Only the three canon date units participate;
// unit must match both sides of the comparison. (Larger time vocabulary is
// future work, documented in the data model doc.)
const DURATION_UNIT_RE = /\b(days?|months?|years?)\b/gi;

// Year-assertion frames: a 3- or 4-digit number framed as a calendar year
// ("in 1191", "by the year 1190", "since 1188"). Bare 4-digit numbers also
// count ("May 1191").
const YEAR_FRAME_PREFIX = /\b(?:in|of|by|since|until|from|before|after)\s+(?:the\s+year\s+)?$/i;

// Month/season assertion frames. Months need a preposition frame or a
// following day/year number ("in March", "March 12, 1191") so that adjectival
// uses ("the March offensive") stay silent. Seasons additionally accept the
// determiner frame ("that winter", "the fall of 1190") because season words
// are commonly used with determiners; bare verbs like "walls fall" do not
// match the frame.
const MONTH_FRAME_PREFIX = /\b(?:in|of|by|since|until|during|early|late|mid)\s+$/i;
const MONTH_FOLLOWED_BY_NUMBER = /^\s+\d{1,4}\b/;
const SEASON_FRAME_PREFIX =
  /\b(?:in|the|that|this|of|by|during|since|until|early|late|mid|all|next|last|every)\s+$/i;

interface NumberHit {
  value: number;
  start: number;
  end: number;
}

interface DateAssertion {
  kind: "year" | "month" | "season";
  value: number | string; // year number, month number (1-12), or canonical season key
  start: number;
  end: number;
}

interface AgeAssertion {
  value: number;
  start: number;
  end: number;
}

interface DurationHit {
  amount: number;
  unit: DateUnit;
  start: number;
  end: number;
}

interface DatedRef {
  ref: EventRef;
  date: CanonDate;
}

/** All numbers in `text` as positioned hits, digits and word numbers 0-99. */
function scanNumbers(text: string): NumberHit[] {
  const hits: NumberHit[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    let value: number;
    if (m[1] !== undefined) value = Number(m[1]);
    else if (m[2] !== undefined) value = WORD_UNITS.get(m[2].toLowerCase()) ?? 0;
    else {
      value = WORD_TENS.get(m[3].toLowerCase()) ?? 0;
      if (m[4] !== undefined) value += WORD_UNITS.get(m[4].toLowerCase()) ?? 0;
    }
    hits.push({ value, start, end });
  }
  return hits;
}

/** Ages asserted with the closed cue patterns above, as positioned hits. */
function scanAgeAssertions(text: string, numberHits: NumberHit[]): AgeAssertion[] {
  const out: AgeAssertion[] = [];
  for (const hit of numberHits) {
    const after = text.slice(hit.end);
    const before = text.slice(0, hit.start);
    const isAge =
      AGE_SUFFIX_PATTERNS.some((re) => re.test(after)) || AGE_PREFIX_PATTERNS.some((re) => re.test(before));
    if (isAge) out.push({ value: hit.value, start: hit.start, end: hit.end });
  }
  return out;
}

/**
 * Year assertions: bare 4-digit numbers, or 3-digit numbers inside a year
 * frame. Numbers already consumed by an age assertion ("1190 years old")
 * are masked so they are not read as years too.
 */
function scanYearAssertions(text: string, numberHits: NumberHit[], ageSpans: { start: number; end: number }[]): DateAssertion[] {
  const out: DateAssertion[] = [];
  for (const hit of numberHits) {
    const digits = text.slice(hit.start, hit.end);
    if (!/^\d{3,4}$/.test(digits)) continue;
    if (ageSpans.some((span) => hit.start >= span.start && hit.end <= span.end)) continue;
    const bareYear = /^\d{4}$/.test(digits);
    const framed = YEAR_FRAME_PREFIX.test(text.slice(Math.max(0, hit.start - 16), hit.start));
    if (bareYear || framed) out.push({ kind: "year", value: hit.value, start: hit.start, end: hit.end });
  }
  return out;
}

function scanMonthAssertions(text: string): DateAssertion[] {
  const out: DateAssertion[] = [];
  for (const m of text.matchAll(MONTH_RE)) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 8);
    const framed = MONTH_FRAME_PREFIX.test(before) || MONTH_FOLLOWED_BY_NUMBER.test(after);
    if (framed) {
      out.push({ kind: "month", value: MONTH_NUMBERS.get(m[1].toLowerCase())!, start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

function scanSeasonAssertions(text: string): DateAssertion[] {
  const out: DateAssertion[] = [];
  for (const m of text.matchAll(SEASON_RE)) {
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (SEASON_FRAME_PREFIX.test(before)) {
      const key = m[1].toLowerCase();
      out.push({ kind: "season", value: SEASON_CANONICAL.get(key) ?? key, start: m.index, end: m.index + m[0].length });
    }
  }
  return out;
}

function scanDateAssertions(text: string): DateAssertion[] {
  const numberHits = scanNumbers(text);
  const ageSpans = scanAgeAssertions(text, numberHits).map((a) => ({ start: a.start, end: a.end }));
  return [
    ...scanYearAssertions(text, numberHits, ageSpans),
    ...scanMonthAssertions(text),
    ...scanSeasonAssertions(text),
  ];
}

/**
 * Elapsed-time cues: a number directly attached to a day/month/year unit
 * ("three years", "5 days"). "<N> years old" / "of age" are ages, not
 * durations, and are masked. The number must end within 3 characters of the
 * unit ("three-year" hyphenated counts; "three whole years" does not).
 */
function scanDurationHits(text: string, numberHits: NumberHit[]): DurationHit[] {
  const out: DurationHit[] = [];
  for (const m of text.matchAll(DURATION_UNIT_RE)) {
    const unitWord = m[1].toLowerCase();
    const unit: DateUnit = unitWord.startsWith("day") ? "day" : unitWord.startsWith("month") ? "month" : "year";
    const after = text.slice(m.index + m[0].length);
    if (/^\s+(?:old\b|of\s+age\b)/i.test(after)) continue; // age pattern, not duration
    let best: NumberHit | undefined;
    for (const n of numberHits) {
      if (n.end <= m.index && m.index - n.end <= 3) {
        if (!best || n.end > best.end) best = n;
      }
    }
    if (!best) continue;
    out.push({ amount: best.value, unit, start: best.start, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Conflicts between one date assertion and one canon date, under the
 * coarsest-common-granularity rule: a year-only canon date never conflicts
 * with month/season assertions, an unparsed canon month never conflicts
 * with month/season assertions.
 */
function dateConflictOf(assertion: DateAssertion, date: CanonDate): boolean {
  switch (assertion.kind) {
    case "year":
      return assertion.value !== date.year;
    case "month":
      return date.month !== undefined && assertion.value !== date.month;
    case "season":
      return date.month !== undefined && !SEASON_MONTHS.get(String(assertion.value))!.includes(date.month);
  }
}

function assertedTextOf(assertion: DateAssertion): string {
  if (assertion.kind === "year") return `the year ${assertion.value}`;
  if (assertion.kind === "month") return MONTH_NAMES[assertion.value as number];
  return `the ${assertion.value}`;
}

function formatCanonDate(date: CanonDate): string {
  const month = date.month;
  if (month === undefined) return String(date.year);
  const day = date.day;
  if (day === undefined) return `${MONTH_NAMES[month]} ${date.year}`;
  return `${day} ${MONTH_NAMES[month]} ${date.year}`;
}

function nearestOf<T extends { idx: number }>(items: T[], position: number): T | undefined {
  let best: T | undefined;
  for (const item of items) {
    const dist = Math.abs(item.idx - position);
    if (!best || dist < Math.abs(best.idx - position) || (dist === Math.abs(best.idx - position) && item.idx < best.idx)) {
      best = item;
    }
  }
  return best;
}

/**
 * Local span helper with the same semantics as timeline.ts's cueBetween.
 * Deliberately NOT imported from timeline.ts: that function is another
 * builder's region (lane contract), so this module keeps its own copy.
 */
function cueInRange(text: string, cues: readonly string[], from: number, to: number): boolean {
  const lower = text.toLowerCase();
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return cues.some((cue) => {
    const idx = lower.indexOf(cue);
    return idx >= lo && idx + cue.length <= hi;
  });
}

/** Confirmed events with a parseable, non-fuzzy canon date. */
function datedRefsOf(refs: EventRef[]): DatedRef[] {
  const out: DatedRef[] = [];
  for (const ref of refs) {
    if (ref.event.precision === "fuzzy") continue;
    const date = parseCanonDate(ref.event.date);
    if (!date) continue;
    out.push({ ref, date });
  }
  return out;
}

/**
 * Date/age findings for one chunk. Pure and deterministic; undated canon
 * stays byte-identical (immediate []).
 */
export function eventDateFindings(chunk: TextChunk, context: CanonContext): Finding[] {
  const refs = buildRefs(context);
  const dated = datedRefsOf(refs);
  const ageCharacters: { character: Character; birth: CanonDate }[] = [];
  for (const character of context.characters) {
    const birth = parseCanonDate(character.birthDate);
    if (character.status === "confirmed" && birth) ageCharacters.push({ character, birth });
  }
  if (dated.length === 0 && ageCharacters.length === 0) return [];

  const counts = keywordRefCount(refs);
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences(chunk.text)) {
    const mentionedDated = dated
      .map((d) => ({ d, idx: firstMentionIndex(sentence.text, d.ref) }))
      .filter((m) => m.idx !== -1 && mentionsEvent(sentence.text, m.d.ref, counts));

    // ---- date-contradiction: asserted year/month/season vs canon date ----
    for (const assertion of scanDateAssertions(sentence.text)) {
      const anchor = nearestOf(mentionedDated, assertion.start);
      if (!anchor) continue;
      if (!dateConflictOf(assertion, anchor.d.date)) continue;
      const key = `date:${anchor.d.ref.event.id}:${assertion.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const locked = anchor.d.ref.event.locked;
      const event = anchor.d.ref.event;
      findings.push(
        makeFinding({
          agent: "timeline",
          category: "timeline",
          type: "date-contradiction",
          severity: locked ? "major" : "minor",
          confidence: locked ? 0.95 : 0.8,
          minStrictness: locked ? "gentle" : "standard",
          message:
            `Passage dates "${event.description}" to ${assertedTextOf(assertion)}, ` +
            `but canon dates event '${event.id}' to ${formatCanonDate(anchor.d.date)}.`,
          quote: sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + sentence.start,
            endOffset: chunk.span.startOffset + sentence.end,
          },
          canonRefs: [event.id],
          suggestion:
            "Timeline proposal (advisory): confirm the intended date with the writer; " +
            "either update the event's canon date or revise the passage.",
        }),
      );
    }

    // ---- duration-contradiction: asserted elapsed time / order vs canon dates ----
    if (mentionedDated.length >= 2) {
      const [x, y] = [...mentionedDated]
        .sort((a, b) => mentionScore(sentence.text, b.d.ref) - mentionScore(sentence.text, a.d.ref))
        .slice(0, 2);
      const lo = Math.min(x.idx, y.idx);
      const hi = Math.max(x.idx, y.idx);
      for (const hit of scanDurationHits(sentence.text, scanNumbers(sentence.text))) {
        if (hit.start < lo || hit.end > hi) continue; // duration must sit between the two mentions
        const assertedPQ = cueInRange(sentence.text, SEQUENCE_CUES_BEFORE, x.idx, y.idx)
          ? true
          : cueInRange(sentence.text, SEQUENCE_CUES_AFTER, x.idx, y.idx)
            ? false
            : undefined;
        if (assertedPQ === undefined) continue; // no order assertion; a bare gap is not checked
        const p = x.idx <= y.idx ? x : y;
        const q = p === x ? y : x;
        const canonCompare = compareCanonDates(p.d.date, q.d.date);
        const key = `duration:${p.d.ref.event.id}|${q.d.ref.event.id}`;
        if (seen.has(key)) continue;
        if (canonCompare !== 0 && assertedPQ !== canonCompare < 0) {
          // Direction reversal: flagged even when the asserted amount matches.
          seen.add(key);
          const first = p.d.ref.event.order <= q.d.ref.event.order ? p : q;
          const second = first === p ? q : p;
          findings.push(
            makeFinding({
              agent: "timeline",
              category: "timeline",
              type: "duration-contradiction",
              severity: p.d.ref.event.locked || q.d.ref.event.locked ? "major" : "minor",
              confidence: p.d.ref.event.locked || q.d.ref.event.locked ? 0.95 : 0.8,
              minStrictness: p.d.ref.event.locked || q.d.ref.event.locked ? "gentle" : "standard",
              message:
                `Passage asserts "${p.d.ref.event.description}" came ${assertedPQ ? "before" : "after"} ` +
                `"${q.d.ref.event.description}", but canon dates (events '${p.d.ref.event.id}', ` +
                `'${q.d.ref.event.id}') put them the other way round.`,
              quote: sentence.text,
              location: {
                file: chunk.span.file,
                startOffset: chunk.span.startOffset + sentence.start,
                endOffset: chunk.span.startOffset + sentence.end,
              },
              canonRefs: [first.d.ref.event.id, second.d.ref.event.id],
              suggestion:
                "Timeline proposal (advisory): confirm the intended order and elapsed time with the writer; " +
                "either adjust the events' canon dates or revise the passage.",
            }),
          );
          continue;
        }
        const earlier = canonCompare <= 0 ? p : q;
        const later = earlier === p ? q : p;
        const gap = elapsedBetween(earlier.d.date, later.d.date, hit.unit);
        if (gap === undefined) continue; // unit not representable on both canon dates
        const amountOff =
          hit.unit === "day" ? hit.amount !== gap : Math.abs(hit.amount - gap) >= 1;
        if (!amountOff) continue;
        seen.add(key);
        const first = p.d.ref.event.order <= q.d.ref.event.order ? p : q;
        const second = first === p ? q : p;
        const unitNoun = hit.unit;
        findings.push(
          makeFinding({
            agent: "timeline",
            category: "timeline",
            type: "duration-contradiction",
            severity: p.d.ref.event.locked || q.d.ref.event.locked ? "major" : "minor",
            confidence: p.d.ref.event.locked || q.d.ref.event.locked ? 0.95 : 0.8,
            minStrictness: p.d.ref.event.locked || q.d.ref.event.locked ? "gentle" : "standard",
            message:
              `Passage asserts ${hit.amount} ${unitNoun}${hit.amount === 1 ? "" : "s"} between ` +
              `"${p.d.ref.event.description}" and "${q.d.ref.event.description}", but canon dates ` +
              `(events '${p.d.ref.event.id}', '${q.d.ref.event.id}') are ` +
              `${gap} ${unitNoun}${gap === 1 ? "" : "s"} apart.`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [first.d.ref.event.id, second.d.ref.event.id],
            suggestion:
              "Timeline proposal (advisory): confirm the intended elapsed time with the writer; " +
              "either adjust the events' canon dates or revise the passage.",
          }),
        );
      }
    }

    // ---- impossible-age: asserted age vs birthDate + dated event ----
    const ageAssertions = scanAgeAssertions(sentence.text, scanNumbers(sentence.text));
    if (ageAssertions.length > 0) {
      const mentionedChars = ageCharacters
        .map((c) => ({ ...c, idx: firstMatchIndex(sentence.text, namesOf(c.character)) }))
        .filter((c) => c.idx !== -1 && mentionsSubject(sentence.text, namesOf(c.character)));
      for (const age of ageAssertions) {
        const char = nearestOf(mentionedChars, age.start);
        const ev = nearestOf(mentionedDated, age.start);
        if (!char || !ev) continue; // age needs both a named character and a dated event nearby
        const computed = ageAt(char.birth, ev.d.date);
        const tolerance = coarsestCommon(char.birth, ev.d.date) === "day" ? 0 : 1;
        const name = char.character.name;
        const birthRaw = char.character.birthDate;
        const eventId = ev.d.ref.event.id;
        const eventDateText = formatCanonDate(ev.d.date);
        const key = `age:${char.character.id}:${eventId}`;
        if (seen.has(key)) continue;
        let finding: Parameters<typeof makeFinding>[0] | undefined;
        if (computed < 0) {
          finding = {
            agent: "timeline",
            category: "timeline",
            type: "impossible-age",
            severity: "major",
            confidence: char.character.locked ? 0.95 : 0.9,
            minStrictness: char.character.locked ? "gentle" : "standard",
            message:
              `Passage asserts ${name} is ${age.value} here, but birthDate '${birthRaw}' is after the date ` +
              `of event '${eventId}' (${eventDateText}): ${name} would not be born yet.`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [eventId, char.character.id],
            suggestion:
              "Timeline proposal (advisory): confirm the birth date and the event date with the writer; " +
              "either update canon or revise the passage.",
          };
        } else if (Math.abs(age.value - computed) > tolerance) {
          finding = {
            agent: "timeline",
            category: "timeline",
            type: "impossible-age",
            severity: char.character.locked ? "major" : "minor",
            confidence: char.character.locked ? 0.95 : 0.8,
            minStrictness: char.character.locked ? "gentle" : "standard",
            message:
              `Passage asserts ${name} is ${age.value} here, but birthDate '${birthRaw}' and the date of ` +
              `event '${eventId}' (${eventDateText}) put ${name} at about ${computed}.`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [eventId, char.character.id],
            suggestion:
              "Timeline proposal (advisory): confirm the birth date, the event date, or the character's age " +
              "with the writer; either update canon or revise the passage.",
          };
        } else if (computed > 150) {
          finding = {
            agent: "timeline",
            category: "timeline",
            type: "impossible-age",
            severity: char.character.locked ? "major" : "minor",
            confidence: char.character.locked ? 0.95 : 0.8,
            minStrictness: char.character.locked ? "gentle" : "standard",
            message:
              `Canon dates put ${name} at ${computed} at the time of event '${eventId}', ` +
              `which is outside the plausible age range (0-150).`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [eventId, char.character.id],
            suggestion:
              "Timeline proposal (advisory): confirm the birth date and the event date with the writer; " +
              "either update canon or revise the passage.",
          };
        }
        if (finding) {
          seen.add(key);
          findings.push(makeFinding(finding));
        }
      }
    }
  }

  return findings;
}
