# add-timeline-date-and-age-checks: Timeline date fields + date/age math

> GOVERNING SPEC: pinned artifact `5c875a88f23d4575b15bd4b1e729f682`
> (sha256 `57863a4a35e46138b3f10da5b451b327cdc06ec83b8e5052e92b5db72a9c3c32`),
> filed as architect_spec receipt `6f07f0c1` on the sibling card
> `let-timeline-check-dates-and-ages`. The design body below is that artifact
> verbatim. It governs byte-for-byte; this file only records the routing
> overrides below, which supersede the two corresponding lines in the body.
>
> ROUTING OVERRIDES (architect, normal board path):
> 1. BASE: branch from develop head `8d30c4be8bc3f828f8a15832ce1982338c0d7cf3`
>    (the body's base line predates the five-language + narrative landings).
>    Push work to `build/add-timeline-date-and-age-checks` (the body's branch
>    name names the wedged sibling card). Where the body says
>    `git diff 868079e`, diff against `8d30c4b`.
> 2. TEST-COUNT FLOOR: "109 existing tests" is a floor, not a pin - develop
>    has grown since. Binding criterion: every existing test passes WITHOUT
>    modification, plus the new tests.
> 3. BOARD PATH: this task runs OUTSIDE the quality workflow. No quality-start,
>    no quality receipts. Self-check report goes to the task as a comment;
>    status moves via the task board (building -> review). Review, QA and
>    landing are owned upstream.
>
> Everything else in the body - including the full region discipline (section
> 3) and the not-allowed list - is binding as written.

---

# let-timeline-check-dates-and-ages: Timeline date fields + date/age math

AGENT_ROLE: builder
PROJECT: Lorewardens

## Task

Add writer-confirmable date fields to the Living Canon entities and teach the
Timeline agent to flag date contradictions and impossible age/elapsed-time
math. This closes the known limit from increment 1 ("timeline age/date math
needs TimelineEvent date fields").

Everything here is deterministic and offline. No network, no LLM, no new
dependencies.

## Context

- Base: `develop` at `868079e386fb0dda998e357e336369d3cd7c79b4`. Branch from
  exactly that commit; push your work to `build/let-timeline-check-dates-and-ages`.
  Do not merge, rebase, or touch any other branch.
- Read first: `docs/living-canon-data-model.md`, `docs/agent-contract.md`,
  `packages/core/src/types.ts` (TimelineEvent, Character),
  `packages/agents/src/timeline.ts`, `packages/agents/src/lexical.ts`,
  `packages/agents/test/agents.test.ts` (test conventions).
- The timeline agent today detects sequence contradictions (comparative cues
  between two event mentions vs canon `order`) and ambiguous sequencing. It
  has no notion of calendar dates.
- A PARALLEL task (`add-the-five-language-and-prose-agents`) works the same
  package tree at the same time. Region discipline below is binding.

## Design (binding)

### 1. Data model (packages/core/src/types.ts)

Add to `TimelineEvent`:

- `date?: string` — the writer-confirmed date of the event. Format:
  `YYYY` | `YYYY-MM` | `YYYY-MM-DD` (a fictional calendar uses the same shape
  for comparability). A `precision: "fuzzy"` event must never carry a date.

Add to `Character`:

- `birthDate?: string` — same format. Enables age math.

Only these two optional fields in these two interfaces. Touch nothing else in
types.ts (a parallel task owns the `ContinuityAgentId`/`Category` unions).

Add a small date utility module in core, e.g. `packages/core/src/dates.ts`,
exported from the package index:

- `parseCanonDate(value: string): { year: number; month?: number; day?: number } | undefined`
  — strict regex `^\d{4}(-\d{2}(-\d{2})?)?$` plus calendar sanity (month
  01-12, day 01-31). Undefined on any mismatch (callers stay silent).
- `granularityOf(value)` → `"year" | "month" | "day"`.
- Whatever comparison helpers you need (elapsed amounts, age at event).
  All pure functions, no side effects.

### 2. Timeline agent checks (packages/agents/src/timeline.ts + new dates helper)

Put lexical/parse helpers for these checks in a NEW file
`packages/agents/src/event-dates.ts`. Do NOT edit `lexical.ts` or
`agents/src/index.ts` (parallel-task territory). Reuse from `lexical.ts`:
`sentences`, `mentionsEvent` machinery (buildRefs/mentionScore),
`numbersIn`-style number parsing — import them; numbers-as-words beyond ten
live in your new module's own table.

The three new findings (all `agent: "timeline"`, `category: "timeline"`):

| type | when | unlocked | locked anchor |
| --- | --- | --- | --- |
| `date-contradiction` | sentence mentions a dated event and asserts a conflicting year, month, or season for it (e.g. "the winter siege" vs canon `1204-07`; "in the year 1200" vs canon 1204) | minor / 0.8 / standard | major / 0.95 / gentle |
| `duration-contradiction` | sentence mentions two dated events plus an elapsed-time cue ("three days after", "five years later", "a month before") whose amount or direction contradicts the canon date difference | minor / 0.8 / standard | major / 0.95 / gentle |
| `impossible-age` | sentence asserts a character's age at a dated event and the character has a `birthDate` making it wrong (mismatch beyond tolerance) — or negative (before birth) | minor / 0.8 / standard; age < 0 always major / 0.9 / standard | major / 0.95 / gentle |

"Locked anchor" = the contradicted `TimelineEvent` (or the `Character` for
age findings) has `locked: true`. This mirrors the existing locked-event
escalation in `timelineFindings` exactly.

Comparison rules (document them as comments next to the tables):

- Only events with a parseable `date` participate. Undated canon → the new
  checks are silent; existing behavior is byte-identical.
- Compare at the COARSEST common granularity of the two dates: year-vs-month
  compares years only; month-vs-day compares year+month.
- Duration cues: unit must match on both sides ("days" vs canon day
  difference). Day units compare exactly; month/year units flag when the
  asserted amount differs from the calendar difference by >= 1.
- Direction reversal ("X, two years after Y" but X's date precedes Y's) is a
  `duration-contradiction` even when the amount matches.
- Age tolerance: with full birth + event dates, flag unless the computed age
  equals the asserted age; when either date is year-only, allow ±1
  (birthday rounding). Age < 0 or > 150 is always flagged (major when
  unlocked, per the table).
- Sentence-scoped like the existing checks; findings carry chunk-relative
  offsets into the real chunk (`chunk.span.startOffset + sentence.start`),
  exact `quote: sentence.text`, and `canonRefs` of the involved event(s)
  (and character id for age findings).

### 3. Region discipline (parallel task in flight)

You may edit: `packages/core/src/types.ts` (ONLY the TimelineEvent and
Character blocks), the new `packages/core/src/dates.ts`, `packages/core/src/index.ts`
(export the new helpers), `packages/agents/src/timeline.ts`, new
`packages/agents/src/event-dates.ts`, new test file
`packages/agents/test/timeline-dates.test.ts`, and the two docs listed below.

You may NOT edit: `packages/agents/src/index.ts`, `lexical.ts`,
`canon-lore.ts`, `character-consistency.ts`, anything under
`packages/mcp-server`, `packages/proof`, `schemas/`, or any fixture file.
The MCP path needs no change (no new agents, no schema change — `type` is an
open string in `schemas/finding.schema.json`, category stays `timeline`).

### 4. Docs

- `docs/living-canon-data-model.md`: document the two new optional fields and
  the date semantics (formats, granularity comparison, locked escalation),
  plus one line: derived/"resolvable" dates are future work — the writer
  confirms explicit dates.
- Root `README.md` increment list: note timeline date/age checks landed.

## Judgment calls allowed (flag in self-check)

- Exact wording of messages and suggestions (advisory text).
- Internal helper decomposition, as long as pins and exports hold.
- The closed tables: month names, season names (meteorological: spring Mar-May,
  summer Jun-Aug, autumn Sep-Nov, winter Dec-Feb — northern-hemisphere
  convention, documented), duration cue words, age-assertion cue patterns
  ("was N years old", "at N", "aged N"). Keep each table small, closed and
  commented.

## Judgment calls NOT allowed (stop and report instead)

- Changing severity/confidence/minStrictness pins.
- Making any check fire on undated canon.
- Editing any file outside the allowed list (especially `agents/src/index.ts`
  or anything a parallel task owns).
- Adding derived-date proposals (agent-proposed date canon) — out of scope.

## Acceptance Criteria

- [ ] `TimelineEvent.date?` and `Character.birthDate?` exist, are optional, and
      a strict shared parser (`parseCanonDate`) validates their format; a
      `fuzzy`-precision event with a date is treated as undated (silent).
- [ ] Timeline agent flags `date-contradiction` when the text asserts a
      conflicting year/month/season for a dated event.
- [ ] Timeline agent flags `duration-contradiction` for wrong elapsed amounts
      between two dated events, including direction reversal.
- [ ] Timeline agent flags `impossible-age` for age assertions contradicted by
      `birthDate` + event date (with the documented birthday tolerance), and
      always for negative ages.
- [ ] Locked dates escalate exactly like other locked canon (major/0.95/gentle).
- [ ] Incremental input, strictness gating and clean-text silence unchanged:
      every existing test passes WITHOUT modification; undated canon produces
      no new findings anywhere in the existing suites.
- [ ] All new findings validate against `schemas/finding.schema.json` (no
      schema edits required) and carry chunk-relative offsets + exact quotes.
- [ ] `npm run build && npm test` green at repo root (109 existing + your new
      timeline-dates tests).

## Test Instructions

1. `npm install && npm run build && npm test` at repo root — all green.
2. `npm test -w @lorewardens/agents` — new `timeline-dates.test.ts` covers:
   each new finding type caught at standard; locked escalation at gentle with
   major severity; the ±1 birthday tolerance case stays SILENT; year-only
   dates compare at year granularity; direction reversal caught; negative age
   major at standard; undated canon → no findings; clean sentences → `[]`.
3. Re-run `npm test` twice — identical results (determinism).
4. `git diff 868079e` shows changes ONLY in the allowed file list.
