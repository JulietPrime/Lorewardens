# Self-Check Report — catch-implicit-contradictions-in-matchers

- **Builder session:** `lor_jeremiahtheobald_build-catch-implicit-contradictions-in-matchers`
- **Submitted revision:** `b4bb8a7f24a22c99c012c83c146e01bca8fda733` (branch `build/catch-implicit-contradictions-in-matchers`, pushed to origin)
- **Engine revision (pre-report commit):** `b4bb8a7f24a22c99c012c83c146e01bca8fda733` — the report commit and the engine commit are the same; this file was committed in that commit per the demo-parity precedent of shipping the report with the change set.

## 1. Pinned base (zero-trust rule) — verbatim

- **Pinned base SHA:** `dfb1ef4a9e9e939864d4f2323d67f0c364c3839e`
- **How verified:** explicit-refspec fetch exactly as mandated by the architect rider:
  `git fetch origin '+refs/heads/develop:refs/remotes/origin/develop'` followed by
  `git rev-parse refs/remotes/origin/develop` → `dfb1ef4a9e9e939864d4f2323d67f0c364c3839e`.
  Three-party agreement holds: architect `ls-remote` pin == approved `architect_spec`
  receipt `4da2acf2` baseline == my fetched `refs/remotes/origin/develop`.
- The sandbox branch `build/agent-71833e3fce4b7399e5ad` had no unique commits and was
  fast-forwarded (ff-only) to the pinned head before work started. No rebase onto any
  unmerged branch; T1's timeline date/age work was never touched.

## 2. Verification results

| Suite | Baseline (pinned base) | Final revision | Verdict |
| --- | --- | --- | --- |
| `@lorewardens/core` | 26 pass | 26 pass, 0 fail | byte-stable green |
| `@lorewardens/agents` | 118 pass | 147 pass, 0 fail | 118 original green unmodified + 29 new |
| `@lorewardens/mcp-server` | 95 pass + 2 pre-existing skips | 95 pass + 2 pre-existing skips, 0 fail | same counts; the two known-limit silence tests were flipped to catch tests (pre-authorized), all others green unmodified |
| `@lorewardens/proof` | 42 pass | 48 pass, 0 fail | 42 original green unmodified + 6 new |

- `npm install && npm run build && npm test` at repo root: green.
- `npm test` run **twice**, identical results both runs (26 / 147 / 97 / 48).
- `npm test -w @lorewardens/proof` twice via the root runs: identical.
- Protected-path diff empty, exactly per test instruction 5:
  `git diff dfb1ef4a9e9e939864d4f2323d67f0c364c3839e -- packages/proof/fixtures/manuscript/ch4.md packages/proof/fixtures/proof.canon.json packages/proof/fixtures/proof.settings.json packages/mcp-server/fixtures schemas packages/core packages/mcp-server/src` → **0 lines**.
- ch4 byte-pin: `packages/proof/fixtures/manuscript/ch4.md` untouched (inside the empty
  protected diff). E1–E10, gentle matrix (E1/E9 only), S1/S2 strict-only outcomes all
  green unmodified.

## 3. New engine behavior

### 3.1 `canon-implicit-contradiction` (agent `canon-lore`, category `canon`)

Eligibility gates, all within one sentence, all must pass:

1. entry is `confirmed` **and** `kind === "rule"` and its text contains a `COST_CUES` cue;
2. sentence contains a `CASTING_CUES` action cue;
3. sentence contains a `RETENTION_CUES` full-retention cue;
4. a `CASTING_DOMAIN` link exists between a domain word in the sentence and the rule's
   own domain words (entry text + tags, stemmed).

Not gated behind `aboutStatement` (the repro shares < 2 content words with the rule
text). Severity/confidence/minStrictness follow the existing `severityFor` /
`confidenceFor` / `minStrictnessFor` pattern: locked rule → `major` / 0.95 / gentle;
otherwise `minor` / 0.8 / standard. Distinct type, so it is dismissible/exceptionable
independently of `canon-contradiction`. Joins the existing `seen` dedup: exactly one
finding per (entry, sentence); explicit shapes take precedence (verified: ch4 line 1
"E1" sentence yields exactly one `canon-contradiction`, no implicit double fire; ch4
line 12 paid-cost sentence stays silent).

Owner repro proven through `runAnalyzeTool` on BOTH fixture surfaces:
- demo: "Mira cast a powerful spell and remembered every detail of it afterward." and
  "She cast the ward and remembered every detail of it afterward." →
  `canon-implicit-contradiction`, major, 0.95, gentle, ref `canon_rule_magic_memory`.
- ch5 (`proof-implicit`): the repro is the FIRST paragraph plus three further catches
  using different cue-table entries (wove/kept-every-memory, invoked/recalled-every-
  detail, channelled/nothing-was-lost).

### 3.2 False-positive guards (each proven on both sides)

- **Verbatim agreement never flags.** Normalized (lowercase, non-alphanumeric runs
  collapsed to single spaces) entry text contained in, or equal to, the sentence is
  agreement; the check runs before all conflict shapes. Suppressed side: "The gate was
  not merely symbolic: the Weeping Gate is the only gate in the city's north wall, and
  it is sealed since the siege." (fires at base, silent now). Firing side: "The Weeping
  Gate is not the only gate in the city wall." still fires.
- **Antonym conflicts require the entry's subject anchor.** Anchor = `tags[0]` plus the
  first TWO content words of the entry text, stemmed. Suppressed side: "Light burned in
  every window that night." vs dark blackout canon (fires at base via light/dark, silent
  now). Firing side: "The capital blazed with light during the blackout." fires.
- **Negation-polarity conflicts require shared content beyond the subject anchor.**
  Anchor = `tags[0]` plus the FIRST content word. **Deviation, disclosed:** the spec
  sketch said "first two content words"; with two, the pinned test
  `agents.test.ts > "canon-lore: negated canon rule is caught (numeric-free negation
  path)"` ("Her spell cost her nothing at all." vs "Every spell costs the caster one
  personal memory.") would be silenced (its only shared words are exactly the anchor).
  Byte-stable-green outranks the sketch, so the negation anchor uses the first content
  word; the antonym guard keeps two. Documented in `docs/agent-contract.md`. Suppressed
  side: "The north wolves did not come down from the hills that spring." (fires at base,
  silent now). Firing side: "The north wolves did not hunt in packs that spring." fires.
- **Numeric conflicts require the differing numerals to share a unit word adjacent to
  each numeral.** Suppressed side: "She waited 1 hour on the bridge." vs canon "30 past"
  (fires at base, silent now). Firing side: "The bridge watch changed at 15 past each
  hour." fires; E3 ("ten minutes" / "15 minutes") and the demo "9 years"/"3 years" rows
  stay green (unit words adjacent on both sides).

All four owner FP classes are seeded in ch5 and produce ZERO findings at
gentle/standard/strict for every continuity agent: token collision ('light in every
window'), stray numeral ('1' vs '30'), negation on shared keywords ('wolves'), verbatim
canon agreement, plus the confirmed-setting co-mention seed ("dark stair"/"light on the
water" vs the lighthouse setting entry).

### 3.3 POV thought-tag attribution (owner FP evidence #2)

No engine change was needed or made: `pov-consistency.ts` already resolves
thought-tag attribution to the NAMED subject (`innerStateAttributions` via
`mentionsSubject`), skips the declared focal character, and never fires on a single
attribution when no rule is declared. `pov-consistency.ts` is outside this task's
allowed file list, so the requested coverage was folded into the new test file:
- declared-POV-rule case: "Liniel thought about it." with a rule naming Liniel → silent;
  "Oren realized the truth." under Liniel's rule → `pov-head-hop` (escalation only for a
  DIFFERENT non-focal character).
- absent-rule case: single thought-tag attribution → silent (the flagged FP shape).
- **Disclosed limit:** the "without a perception anchor" refinement (e.g. "Liniel
  watched as Oren realized the truth." still attributes to Oren) is engine behavior in
  `pov-consistency.ts`, which this task may not modify. If the architect wants that
  refinement, it needs a separate authorized change; I did not touch the file.

## 4. Pin/section updates — every change to existing tests, verbatim before → after

The pre-authorization named the `projectIds` pin in `packages/proof/test/proof.test.ts`.
The same deepEqual pin turned out to exist in seven more places; each got the identical
additive extension (exact deepEqual kept, existing entries byte-identical, new entry in
the loader's actual emission order — verified: `loadFixtures` sorts, so
`proof-implicit` lands between `proof` and `proof-language`). All are listed here so the
architect can audit each one.

1. `packages/proof/test/proof.test.ts` ("proof fixtures seed the two increment-1
   projects plus proof-language"):
   - before: `assert.deepEqual(projectIds, ["proof", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);`
   - after: `assert.deepEqual(projectIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);`
2. `packages/proof/test/acceptance-seeded-errors.test.ts` (ac-1):
   - before: `assert.deepEqual(projectIds, ["proof", "proof-language", "proof-light", "proof-narrative", "proof-strict"], "fixtures seed the two increment-1 projects plus the language, narrative and optional proof projects");`
   - after: same list with `"proof-implicit"` inserted after `"proof"` (message unchanged).
3. `packages/proof/test/language-proof.test.ts` ("the proof fixture directory seeds all
   five projects without skips"):
   - before: `assert.deepEqual(projectIds, ["proof", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);`
   - after: `assert.deepEqual(projectIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);`
4. `packages/proof/test/light-proof.test.ts`: identical before/after as (3).
5. `packages/proof/test/narrative-proof.test.ts`: identical before/after as (3).
6. `packages/mcp-server/test/acceptance-language.test.ts` (ac-6):
   - before: `assert.deepEqual(shippedIds, ["proof", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);`
   - after: `assert.deepEqual(shippedIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);`
7. `packages/mcp-server/test/acceptance-light.test.ts` (ac-6): identical before/after as (6).
8. `packages/mcp-server/test/acceptance-narrative.test.ts` (ac-6): identical before/after as (6).
9. `packages/proof/test/acceptance-seeded-errors.test.ts` (ac-7 offline scan list):
   - before: `["src/index.ts", "test/acceptance-seeded-errors.test.ts", "test/language-proof.test.ts", "test/light-proof.test.ts", "test/narrative-proof.test.ts", "test/proof.test.ts"]`
   - after: `["src/index.ts", "test/acceptance-seeded-errors.test.ts", "test/implicit-proof.test.ts", "test/language-proof.test.ts", "test/light-proof.test.ts", "test/narrative-proof.test.ts", "test/proof.test.ts"]`
   (additive, loader/glob order verified alphabetical). The new test file satisfies the
   scan: only `node:assert`, `node:test`, `node:fs`, `node:url` builtins; no fetch /
   `Math.random` / `Date.now` / `new Date`.
10. `packages/mcp-server/test/acceptance-demo-parity.test.ts` — README-parity pins,
    pre-authorized as a set:
    - SHAPES table: before = three entries (negation-polarity, antonym-swap,
      numeric-mismatch); after = those three byte-identical plus
      `{ key: "implicit-full-retention", heading: "Implicit full-retention contradiction", detailRe: /implicit full-retention/i }`.
    - ac-2: `sentences.length` 4 → 5 (message "three shapes plus one character cue
      check are demonstrated" → "four shapes plus ...").
    - ac-3 README test: replaced — previously asserted the known-limits section names
      implicit/full-retention as **not** flagged and that the repro never appears in
      try-this; now asserts the catches section documents "Implicit full-retention
      contradiction", the repro IS a try-this row, and the known-limits section no
      longer quotes the repro or claims "**not** flagged".
    - ac-3 behavioral test: flipped from "the known-limit repro stays silent across all
      three agents today" to "caught as an implicit contradiction" (canon-lore: exactly
      one `canon-implicit-contradiction`, major, ref `canon_rule_magic_memory`, schema
      valid; other agents silent).
11. `packages/mcp-server/test/readme-samples.test.ts` — README-parity pins:
    - README_SAMPLES: one additive row `{ id: "implicit-full-retention", text: "She cast the ward and remembered every detail of it afterward.", agent: "canon-lore", type: "canon-implicit-contradiction", canonRef: "canon_rule_magic_memory" }`.
    - The KNOWN_LIMIT_REPRO silence test ("stays silent until the smarter matcher
      lands") replaced by "the former known-limit repro is now caught as an implicit
      contradiction" (major / 0.95 / gentle, schema-valid, other agents silent).

No other existing test file was modified. The three demo diff-scope pins (ac-5/ac-6 in
`acceptance-demo-parity.test.ts`) self-skip on this branch (HEAD is a descendant of the
demo-parity landing revision `b10ef32a`, verified via `git merge-base --is-ancestor`).

## 5. Final cue tables — one-line justification per entry

### COST_CUES (entry side; word-boundary matched against rule text)
- `cost`, `costs` — the direct statement of a price.
- `price` — noun form of the same statement.
- `takes` — "every spell takes…" cost phrasing; double-edged (duration) but the shape's
  other gates (casting + retention + domain) keep duration-only rules silent.
- `sacrifice`, `sacrifices` — explicit giving-up language.
- `lose`, `loses` — the loss framing of the same rule.
- `forfeit`, `forfeits` — formal surrender of something owned.
- `surrender`, `surrenders` — same semantic family, different verb.
- `pays`, `paid` — past/present payment framing ("Mira paid a memory" is canon-side).
- `give up`, `gives up` — phrasal verb of relinquishing (ch4 line 1 uses it).
- `drains`, `drain` — resource-depletion framing common in cost rules.

### CASTING_CUES (sentence side; ACTION cues only — bare nouns deliberately excluded)
- `cast`, `casting`, `casted` — the canonical performance verbs.
- `wove`, `weave`, `weaving` — spell-weaving action metaphor.
- `invoked`, `invoke`, `invoking` — calling-power action.
- `channelled`, `channeled`, `channel`, `channeling` — both spellings, power-drawing
  action (the duplicate `channeling` key was a typo and is single in the final table).
- `conjured`, `conjure`, `conjuring` — summoning action.
- `enchanted`, `enchant`, `enchanting` — enchanting action.
- `spoke the incantation`, `uttered the incantation` — incantation-performance phrases
  (the noun alone is a domain word, not an action).

Bare nouns ("spell", "magic", "ward") are NOT casting cues — that is what keeps
"She remembered every detail of the spell book" silent.

### RETENTION_CUES (sentence side; full retention only, prefer false negatives)
- `remembered every detail` — the owner repro fragment.
- `remembered everything` — total-recall assertion.
- `recalled every detail` — synonym phrasing of the repro.
- `remembered all`, `recalled all` — quantified-total phrasing.
- `nothing was lost`, `nothing is lost` — negative-side retention assertion.
- `kept every memory`, `kept all her memories`, `kept all his memories`,
  `kept every one of her memories`, `kept every one of his memories` — the
  keeping-what-should-be-paid framing, both pronoun genders.

Generic memory words ("remembered the map") are not members: retention must be total.

### CASTING_DOMAIN (link keys → domain families)
- `cast`/`casting`/`casted` → spell, magic, ward, incantation, ritual, enchantment,
  hex, charm — the generic caster binds to any magic-domain rule.
- `wove`/`weave`/`weaving` → spell, magic, ward, enchantment, charm, weaving — weaving
  imagery binds to woven-magic rules.
- `invoked`/`invoke`/`invoking` → magic, ritual, spell, blessing — invocation is
  magic/ritual-adjacent, not ward-specific.
- `channelled`/`channeled`/`channel`/`channeling` → magic, power, spell, storm —
  channelling draws raw power.
- `conjured`/`conjure`/`conjuring` → magic, spell, spirit, creature — conjuration
  summons.
- `enchanted`/`enchant`/`enchanting` → magic, enchantment, object, spell — enchantment
  targets objects.
- `spoke the incantation`, `uttered the incantation` → incantation, spell, magic —
  the phrase carries its own domain.
- Domain nouns (`ward`, `warding`, `spell`, `magic`, `incantation`, `ritual`, `hex`,
  `charm`, `enchantment`, `blessing`) map to their own family plus the spell/magic
  cluster: they are NOT casting cues, but when a casting action cue is present they
  carry the domain link ("She cast the ward..." binds to a ward-specific rule via
  ward → ward; the demo repro binds via ward → spell).

## 6. `packages/agents/src/timeline.ts` diff summary (caution fixes only — REGION CONTRACT honored)

1. `cueBetween` (line ~81): first-occurrence `indexOf` check replaced by a
   while-loop over EVERY occurrence; a cue asserts only when an occurrence lies
   fully inside `[lo, hi]`. No other signature/semantic change.
2. Ambiguity gating in `detectTimelineIssues` (line ~108): the position-independent
   `AMBIGUITY_CUES.some(...)` branch was replaced by a mention-window gate —
   first-mention window when the two events' first mentions differ; a
   distinguishing-keyword fallback (`distinguishingMentionIndex`, new private helper)
   when shared participants collapse both first mentions onto one index; a hedge
   fires only when its first occurrence precedes the later mention
   (`hedgeAt < windowHi`) and no comparative cue sits fully inside the window
   (comparative wins and takes the sequence branch). New private helpers:
   `ambiguityCuePosition`, `distinguishingMentionIndex`. No exported signature
   changed; no date/age logic touched (T1's region is untouched — verified: the
   diff contains only the functions above).
3. Outcomes preserved: E8 (lanterns-before-survey), E9 (survey-before-siege),
   E10 (hedge between lanterns and survey mentions), S1, the agents/acceptance
   ambiguity pins ("Sometime before or after the survey, the siege was remembered."
   — hedge before the second mention still fires), correct-sequence silence, and
   the locked-event gentle escalation are all green unmodified.

## 7. `packages/agents/src/canon-lore.ts` diff summary

- `Reason` union extended with `implicit` and `drift` kinds; `messageFor` extended.
- `detectCanonContradictions` restructured: verbatim-agreement guard first; explicit
  shapes (aboutStatement-gated) with the antonym/negation/numeric FP guards; implicit
  shape last, not aboutStatement-gated; `seen` dedup shared; explicit precedence.
- New private helpers: `subjectAnchor`, `verbatimAgreement`, `sharedWordsBeyondAnchor`,
  `numeralsShareAdjacentUnit`, `castingDomainLinked`, `detectImplicit`.
- `detectLocationDrift`: object identity from subject words before the binding verb
  (`contentWordPairs`, tags[0] fallback), destination matched against other bindings'
  place words; emits `{ kind: "drift", object, movedTo }`.
- `canonLoreFindings`: type/severity/confidence/minStrictness switch on the drift and
  implicit kinds; the `word === opposite` isDrift hack is gone.
- Shared lexical exports keep their signatures and semantics; `aboutStatement` is
  unchanged; `plot-thread`/`theme-motif`/`character-consistency` are untouched
  (verified by the 118 baseline agents tests staying green).

## 8. Files changed (complete list)

Engine (allowed): `packages/agents/src/lexical.ts`, `packages/agents/src/canon-lore.ts`,
`packages/agents/src/timeline.ts`.
Tests (allowed): new `packages/agents/test/canon-lore-implicit.test.ts`; new
`packages/proof/test/implicit-proof.test.ts`; pin-only updates to
`packages/proof/test/proof.test.ts`, `acceptance-seeded-errors.test.ts`,
`language-proof.test.ts`, `light-proof.test.ts`, `narrative-proof.test.ts`,
`packages/mcp-server/test/readme-samples.test.ts`, `acceptance-demo-parity.test.ts`,
`acceptance-language.test.ts`, `acceptance-light.test.ts`,
`acceptance-narrative.test.ts` (each disclosed in §4).
Fixtures (allowed, all new): `packages/proof/fixtures/proof-implicit.canon.json`,
`proof-implicit.settings.json`, `manuscript/ch5-implicit.md`.
Docs (allowed): `packages/proof/README.md` (items 1–3 rewritten to fixed behavior +
rationale, new ch5 section appended, outcome tables byte-stable),
`packages/mcp-server/README.md` (known-limits bullet replaced by the documented shape +
machine-proven try-this row), `docs/agent-contract.md` (cue tables, guards, timeline
gating documented).
Platform artifact: this report file (`docs/reports/self-check/`), per the repo's
established self-check precedent.

## 9. Known limitations (no shortcuts held back)

1. The negation guard's anchor uses the first content word rather than two (§3.2) —
   forced by the pinned `agents.test.ts` negation test; disclosed, not hidden.
2. The ambiguity gate's "between the two event mentions" is implemented as "the hedge
   does not trail the second event mention and no comparative cue sits inside the
   mention window": a hedge BEFORE both mentions still fires, because the pinned
   ac-3/agents tests pin exactly that sentence ("Sometime before or after the
   survey...") as an `unclear-time-jump`. A strict between-only window would break
   those pinned tests; the implemented predicate kills the documented over-trigger
   class (trailing hedges) while keeping every pinned outcome. Exact predicate
   disclosed here and in `docs/agent-contract.md`.
3. The POV perception-anchor refinement needs `pov-consistency.ts`, outside this
   task's allowed files (§3.3).
4. Numeric adjacency is satisfied by ANY shared neighbor word of the two numerals
   (including prepositions like "at 15 past / at 30 past"); the guard kills the
   owner's stray-numeral class while keeping E3 and the demo rows green.

## 10. Confidence

High (88). The engine change is fully covered on both sides (catches and silences) at
unit and proof level through the real tool path; all four suites are green twice with
identical results; protected paths are diff-empty. The two disclosed deviations (§9.1,
§9.2) are forced by pinned tests and documented; the architect may want to re-rule on
either.
