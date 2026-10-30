# Self-Check Report — add-timeline-date-and-age-checks

- **Revision:** `47fb3d4fdbf7e97148aa8073fa0705c28976ba21`
- **Branch:** `build/add-timeline-date-and-age-checks` (fast-forward from the verified base)
- **Verified base SHA:** `d768ccf4f8e8838b9ef3af318feeff2134f96723`
- **Confidence:** 88 / 100
- **Shortcut count:** 6 (all rated below; none deviate from the binding spec)

## Zero-trust base verification

First action at session start: `git ls-remote origin` —
`refs/heads/build/add-timeline-date-and-age-checks` = `d768ccf4f8e8838b9ef3af318feeff2134f96723`
(exact match; the branch had no prior builder work and my checkout was clean on that commit).
`refs/heads/develop` had advanced four commits past the pin (`dfb1ef4`, parallel
light-agents landing); `git merge-base --is-ancestor` confirms `d768ccf4` is an
ancestor of origin/develop — normal forward evolution, not a rewrite, so the
pinned base stands. All work branched from exactly `d768ccf4`; the pushed
revision is a strict fast-forward of the task branch. The local clone's narrow
fetch refspec (only `build/design-lorewardens-foundations`) initially hid
origin/develop; I fetched that single ref read-only to run the ancestry check.

## What shipped

1. **Data model** (`packages/core/src/types.ts`): `TimelineEvent.date?: string`
   and `Character.birthDate?: string` — the only two fields added, only in
   these two interfaces, both documented as strict
   `YYYY | YYYY-MM | YYYY-MM-DD` and fuzzy-events-never-carry-dates.
2. **Pure date module** (`packages/core/src/dates.ts`, new, exported from the
   core index): `parseCanonDate` (strict regex `^\d{4}(-\d{2}(-\d{2})?)?$` +
   calendar sanity incl. leap-aware February; undefined on any mismatch,
   never throws), `granularityOf`, `coarsestCommon`, `compareCanonDates`,
   `elapsedBetween` (signed, undefined when a unit is not representable on
   both dates), `ageAt`, `daysInMonth`. All pure.
3. **Agent checks** (`packages/agents/src/event-dates.ts`, new; wired into
   `timelineFindings`/`createTimelineAgent` in `packages/agents/src/timeline.ts`):
   three new finding types, all `agent: timeline`, `category: timeline`:
   - `date-contradiction` — sentence mentions a dated event and asserts a
     conflicting year/month/season. minor/0.8/standard; locked anchor
     major/0.95/gentle.
   - `duration-contradiction` — two dated events + elapsed-time cue whose
     amount or direction contradicts the canon date difference (direction
     reversal flagged even when amounts match). minor/0.8/standard; locked
     major/0.95/gentle.
   - `impossible-age` — asserted age vs `birthDate` + event date beyond
     tolerance, computed age < 0 (always major/0.9/standard), or computed
     age > 150 (always flagged). Locked character escalates major/0.95/gentle.
   Findings carry chunk-relative offsets (`chunk.span.startOffset +
   sentence.start`), the exact sentence quote, and canonRefs of the involved
   events (+ character id for age, ordered event-first).
4. **Region discipline:** `git diff d768ccf4` touches ONLY the allowed list —
   `types.ts` (two interface blocks), new `dates.ts`, `core/index.ts` (one
   export line), `timeline.ts`, new `event-dates.ts`, new
   `test/timeline-dates.test.ts`, `docs/living-canon-data-model.md`, root
   `README.md`. NOT touched: `agents/src/index.ts`, `lexical.ts`,
   `canon-lore.ts`, `character-consistency.ts`, `packages/mcp-server`,
   `packages/proof`, `schemas/`, fixtures. Within `timeline.ts` the only
   changes are `export` keywords on the mention machinery, one import, and
   the wiring call — `cueBetween` and the ambiguity-window caution are
   byte-identical (lane contract with the matcher-upgrade builder).
5. **Docs:** `living-canon-data-model.md` documents both fields, date
   semantics and the comparison rules, plus the one-line future-work note
   (derived/resolvable dates). `README.md` increment list notes the checks
   landed (item 7).

## Verification evidence

- `npm install && npm run build && npm test` at repo root: **green**.
- Test counts: core 26→26, agents **92→115** (+23 new, all existing pass
  WITHOUT modification — no existing test file touched), mcp-server 70 (68
  pass + 2 pre-existing skips, fail 0)→identical, proof 32→32.
- `npm test` run **twice**: identical results (determinism).
- `npm test -w @lorewardens/agents` covers, per spec: each finding type at
  standard; locked escalation at gentle/major for all three types; ±1
  birthday tolerance SILENT (and beyond-tolerance flagged); year-only canon
  compares at year granularity (month/season assertions silent against it);
  direction reversal caught with matching amounts; negative age major at
  standard (surfaces standard, not gentle); undated canon → no findings
  (fast-path + strict level); clean sentences → []; fuzzy+date → silent;
  off strictness → []; chunk-relative offsets + exact quote + schema-valid
  assertions on every finding shape.
- New findings schema-validate against `schemas/finding.schema.json` with
  **no schema edits** (type is an open string; `agent`/`category` enums
  already contain `timeline`).
- MCP path needs no change and got none: no new agents, `ALL_AGENTS`
  unchanged, `packages/agents/src/index.ts` untouched.

## Acceptance criteria walk-through

| Criterion | Where proven |
| --- | --- |
| `TimelineEvent.date?` / `Character.birthDate?` optional, strict `parseCanonDate` validation | types.ts + dates.ts; malformed input degrades to silence |
| fuzzy+date treated as undated/silent | `datedRefsOf` excludes fuzzy; test "a fuzzy-precision event with a date is treated as undated" |
| date-contradiction for conflicting year/month/season | three tests incl. preposition and day-of-month month frames |
| duration-contradiction incl. direction reversal | amount test, reversal test (amounts match), day-exact test, unit-representability test |
| impossible-age per tolerance, always for negative/>150 | tolerance tests (±1 silent at year granularity; exact at day), negative-age major test, >150 test |
| locked dates escalate major/0.95/gentle | three locked-escalation tests (event/date, duration, character/age) |
| incremental input / strictness / clean-text silence unchanged; every existing test passes WITHOUT modification | full suite green; no existing test file in the diff; undated fast-path guarantees byte-identical behavior |
| undated canon produces no new findings in existing suites | all pre-existing suites green unmodified (canon events there carry no `date`) |
| findings schema-validate (no schema edits), chunk-relative offsets + exact quotes | schema assertions in the new suite; offset test with non-zero `startOffset` (25) |
| `npm run build && npm test` green at repo root | twice, identical |

## Judgment calls (all inside the spec's allowance)

1. **Age tolerance generalized to coarser-than-day granularity** — the spec
   mandates ±1 when either date is year-only; I apply ±1 whenever the
   comparison granularity is year or month (0 only when both dates carry
   day precision), because month-level comparisons have the same
   birthday-rounding ambiguity (e.g. birth `1990-03` vs event day in March).
   The mandated year-only case is covered and tested.
2. **Proximity binding** — an assertion binds to the mentioned dated event
   whose first-mention index is nearest the assertion (ties → earlier
   mention); one finding per (event, assertion kind) per chunk; duration
   uses the top-2 mentioned events by the existing mention score.
3. **Month assertions require a temporal frame** (preposition or a following
   day/year number) so the modal verb "may" and adjectival uses ("the March
   offensive") stay silent.
4. **Season assertions require a temporal frame** (preposition/determiner/
   degree modifier) so "walls fall" stays silent; meteorological seasons
   documented (spring Mar–May, summer Jun–Aug, autumn Sep–Nov, winter
   Dec–Feb; "fall" aliases autumn).
5. **Closed word-number table 0–99** (teens/tens/hyphen-or-space compounds)
   in the new module per spec ("numbers-as-words beyond ten"); "hundred"
   deliberately excluded (digit forms cover it; avoids "two hundred"
   mis-parses). Ages accept digits 1–4 or word numbers in the closed cue
   patterns ("N years old", "N years of age", "aged N", "at age N",
   "at the age of N").
6. **Duration direction reuses `SEQUENCE_CUES_BEFORE/AFTER` from lexical.ts**
   via import (no new cue table); the module keeps its own local span helper
   rather than importing `cueBetween` (other builder's region).
7. **Message/suggestion wording** mirrors the existing timeline findings
   ("Timeline proposal (advisory): …"), including for locked anchors — same
   precedent as the existing `timeline-contradiction` locked path.
8. **Negative-age + locked character** → escalation wins
   (major/0.95/gentle; 0.95 ≥ 0.9, gentle stricter gate than standard).
9. **Co-firing documented:** a direction-reversal sentence also trips the
   existing order-based `timeline-contradiction` (different canon basis:
   `order` vs dates); both findings surface; the test documents this.
10. **Circular import `timeline.ts ↔ event-dates.ts`** is load-safe: both
    sides only use hoisted function declarations and types at call time; a
    comment documents this. This is the shape the spec implies (reuse
    `mentionsEvent` via imports while `timeline.ts` wires the findings in).

## Shortcuts (complete disclosure, each rated)

1. **Day-of-month numbers frame month assertions but are never compared
   against a canon day.** Rating: within spec — the spec requires
   year/month/season conflicts only; day-level text-vs-canon compare is not
   required and not implemented (adjacent to the documented future work).
2. **Duration cues require both dated events in the SAME sentence**
   ("Three years later, the survey began." across sentences is not
   detected). Rating: deliberate scope limit mirroring the existing
   sequence machinery's same-sentence rule; misses stay silent — no false
   positives.
3. **Non-adjacent duration phrases are not parsed** ("three whole years",
   "a hundred years", "two hundred years") — the number must sit within 3
   characters of the unit word. Rating: minor recall gap in a closed,
   deterministic table; silent, no false-positive risk.
4. **Bare sentence-initial season words are not detected** ("Winter came
   early" needs a frame). Rating: precision-first choice; documented in the
   module comments.
5. **Proximity binding can mis-attribute an assertion in sentences naming
   several dated events** (deterministic nearest-mention heuristic; the
   spec's sentence-level framing permits it). Rating: acceptable; tests use
   unambiguous bindings; wrong attribution degrades to a still-true
   sentence-level check.
6. **Bare 4-digit numbers are always read as years** (e.g. "Room 1190" in
   prose near a dated-event mention could assert a year). Rating: rare
   false-positive class, deterministic, writer-dismissable; age-assertion
   spans are masked from year detection, and 1–3 digit numbers need a
   temporal frame.

No spec pin was changed, no undated canon fires, no file outside the
allowed list was touched, and no derived-date proposal is emitted.

## Timing

Build cycle ran 2026-10-30 00:56Z (board start) → 04:10Z push. Wall clock
≈ 3h15m including zero-trust verification, implementation, test authoring
and the double determinism run; the board's 2h calendar estimate was
slightly under.

COMPLETE DISCLOSURE CONFIRMATION: I have listed ALL shortcuts. If asked any more?, my answer is NO.
