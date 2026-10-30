# Self-Check Report — flag-character-name-spelling-variants

**Task**: flag-character-name-spelling-variants (name-variant drift flagger + place-name guard)
**Date**: 2026-10-30
**Revision**: pushed to `build/flag-character-name-spelling-variants` (SHA in the submission)
**Base**: develop `9ff1b714d8753c494ebd8aa39772bffd9e56e898` — verified via `git ls-remote origin refs/heads/develop` before branching (zero-trust pass), explicit-refspec fetch of both `develop` and the build branch performed
**Confidence**: 85

## What was implemented

Three moving parts, exactly per the artifact-pinned spec (c8fcf510):

- `packages/core/src/name-variants.ts` (NEW) — the closed variant rule table.
  Pure, deterministic, offline, side-effect free. `nameVariantOf(token,
  canonNames)` (exact case-insensitive matches and stoplisted tokens are
  never variants; distance exactly 1 over {substitution, insertion,
  deletion, adjacent transposition}; `min(len) >= 4`), `capitalizedTokens` /
  `wholeWordTokens` (the spec's `[A-Za-z0-9'’]+` tokenization with
  possessive stripping), `canonNamesOf` (namesOf semantics),
  `textHasNameVariant` (sentence/chunk-level helper), `isStoplistedName`,
  `stripPossessive`.
- `packages/core/src/context.ts` + `types.ts` + `index.ts` — variant-tolerant
  selection (a confirmed character also enters context when any capitalized
  whole chunk token is a rule-table variant of a canon name or alias, via
  the same shared helpers — no forked logic), optional additive
  `CanonContext.placeNames?: string[]` populated deterministically from
  confirmed `setting` entries (capitalized whole tokens, length >= 4,
  not stoplisted, first-occurrence order, first capitalized casing kept),
  `name-variants.js` re-exported from the core barrel.
- `packages/agents/src/character-consistency.ts` — `detectNameVariantDrift`
  wired into `characterConsistencyFindings` (after `detectCharacterIssues`,
  before relationship drift): `name-variant-drift`, minor / 0.72 /
  standard, message `Passage spells X as 'T' (canon: 'C').`, canonRefs
  `[character.id]`, sentence-quote + `chunk.span.startOffset + sentence
  start/end` offsets, existing `pushIssue` seen-key dedupe, the spec's
  exact advisory suggestion. Place-name guard: suppressed when EITHER the
  character's canon name OR the variant token is place-evidenced
  (`context.placeNames ?? []`, case-insensitive). Stateless — every variant
  occurrence flags, no first-mention tracking (disclosed below, pinned in
  tests). `lexical.ts` re-exports the core variant helpers (thin, no logic
  duplication).
- `docs/agent-contract.md` — new "Name-variant drift (character-consistency)"
  section: the closed rule table verbatim, variant-tolerant selection, the
  stateless rationale, the place-name guard and its sourcing, and the
  alias/dismissal story (add the variant as an alias, or correct canon —
  no new store plumbing).
- `packages/core/src/bootstrap.ts` and `packages/agents/src/timeline.ts`:
  ZERO changes (out of region, verified in the diff).

**Out-of-region verifications (no edits)**: `schemas/finding.schema.json`
`type` is a free string — no enum — so the STOP-and-report condition for a
schema type enumeration did not trigger. All existing test files pass
unmodified (FP-safety silence proof).

## Acceptance criteria walk-through

| Criterion | Evidence |
| --- | --- |
| ac-1 closed rule table + documented | `packages/core/test/name-variants.test.ts` (18 tests): each edit operation fires, distance-2 (two substitutions; substitution+length-change; two disjoint transpositions) does not, length-3 names do not, lowercase tokens do not, exact canon name/alias never flags (case-insensitive), possessive stripping (straight + curly), tokenization with internal apostrophes, stoplist exclusion, first-match determinism; rules documented verbatim in `docs/agent-contract.md` |
| ac-2 minor finding, exact row | `packages/agents/test/name-variants.test.ts`: agent `character-consistency`, type `name-variant-drift`, severity `minor`, confidence `0.72`, `minStrictness` `standard`, canonRefs `["char_haze"]`, exact message, sentence offsets anchored to `chunk.span.startOffset` (40/67 and 68/96 pinned), spec-exact suggestion string; schema mirror asserted |
| ac-3 aliases honored by construction | exact case-insensitive alias match is never a variant (core test); end-to-end: locking 'Hazeldown' as an alias silences the owner scenario (agents test); dismissal path documented in the contract |
| ac-4 place-name guard | selector populates `placeNames` from confirmed settings only (proposed/retired contribute nothing — pinned); agents tests: canon-name-place-evidenced → silent, variant-token-place-evidenced → silent, hand-built `placeNames` honored |
| ac-5 variant-only chunk selects | core context test: chunk containing only 'Hazeldown' pulls 'Hazledown' into context (and via an alias variant); agents test proves the flag then fires end to end through `selectRelevantContext` → `analyze` |
| ac-6 determinism + FP safety | root `npm install && npm run build && npm test` exit 0, run twice with identical outcome tables (core 77, agents 181, mcp-server 127+2 discharged skips, bridge 14, proof 48, docs-extension 48 — 497 pass / 0 fail both runs); both new suites run twice each — byte-identical tables (durations stripped, names+counts identical); offline: no network anywhere in the path (new code is pure string/number work) |

Owner scenario scratch-verified (spec Test Instruction 5) against the built
packages, all three legs: paragraph with only 'Hazeldown' → 2 findings at
standard with the exact message; 'Hazeldown' locked as alias → 0 findings;
canon name place-evidenced in a confirmed setting → 0 findings.

## Allowed-files audit

`git diff --stat` vs base shows exactly: NEW `packages/core/src/
name-variants.ts`, `packages/core/test/name-variants.test.ts`,
`packages/agents/test/name-variants.test.ts`; EDIT `packages/core/src/
context.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`,
`packages/core/test/context.test.ts`, `packages/agents/src/
character-consistency.ts`, `packages/agents/src/lexical.ts`,
`docs/agent-contract.md`. Nothing else. (This report file and the build-branch
metadata are the platform-required additions outside the task's product
surface.)

## Judgment calls (verbatim disclosure)

1. **Predicate field semantics** (spec said "e.g."): `nameVariantOf` returns
   `{ variantOf, canonical }` where `variantOf` is the canon name from the
   list that matched (first match in list order) and `canonical` is
   `canonNames[0]` — the character's primary name — so messages read
   "canon: '<primary>'" even when the variant matched an alias. Pinned by
   the alias-variant test.
2. **Capitalization gate placement**: rule 4 (capitalized whole word) is
   enforced by the sentence-level helpers (`capitalizedTokens`,
   `textHasNameVariant`), not inside `nameVariantOf` itself (which receives
   bare tokens); both call sites (selector and flagger) feed it tokens from
   `capitalizedTokens`. Documented on the predicate.
3. **"The canon name" in the guard** is read as ANY of the character's canon
   names (name + aliases) being place-evidenced, not only the matched one —
   the broader reading favors suppression, matching the guard's purpose.
4. **placeNames ordering**: first-occurrence order preserved (not sorted);
   the first CAPITALIZED occurrence's casing is kept (the field's own doc
   says "Capitalized proper-noun tokens"). Both pinned by tests; the guard
   itself treats the list as a case-insensitive set, so ordering is
   cosmetic.
5. **NAME_STOPLIST copied verbatim** into `name-variants.ts` with a
   keep-in-sync comment naming the source (`packages/core/src/bootstrap.ts`,
   private there and out of this task's allowed-file region — the spec's
   "copy it verbatim with a comment naming the source" option). No change
   to bootstrap.ts.
6. **`canonNamesOf` added to core** (identical one-line semantics to the
   agents package's existing `namesOf`): core cannot import the agents
   package, and the selector needs the list in core. The agent keeps using
   its existing `namesOf`; the variant RULE logic itself is shared via the
   core module with zero duplication.
7. **Existing test file line touched**: `packages/core/test/context.test.ts`
   — all new cases are additive; ONE existing line was extended (the type
   import gained `CanonEntry`) because the new fixture helper needed it.
   Zero other existing test files modified.
8. **Issue interface gained an optional `suggestion` field** with
   `issue.suggestion ?? suggestionFor(issue.character)` in the finding
   mapping — required because the spec's variant suggestion differs from
   the agent's generic suggestion text.
9. **Emission order**: variant-drift findings append after the existing
   character issues and before strict-only relationship drift. Existing
   fixtures never produce variant findings (suite green unmodified proves
   the silence), so no existing outcome table reorders.
10. **Two defects in my own new code caught and fixed during development**:
    (a) the substitution counter early-returned on a second mismatch, which
    blocked the adjacent-transposition branch (transpositions ARE two
    mismatched positions) — fixed before submission; (b) a scratch test
    string "Hazledwn" is a single-deletion variant of "Hazledown", not the
    intended distance-2 — corrected to "Hazldwn" in the test. Both are in
    this task's new files only.
11. **Pin encounter (resolved without loosening anything)**: the mcp-server
    acceptance-bootstrap ac-8 pin greps `packages/agents/src` for
    `/bootstrap/i` ("packages/agents carries no bootstrap code"). My
    flagger's doc comment originally contained the prose "bootstrap
    extractor" and tripped it. Fixed by rewording the comment ("canon
    extractor") — no forbidden file touched, no pin edited; the pin's
    intent (no bootstrap code in the agents package) remains intact and
    the suite is green.

## Known limitations (by design)

- Tolerance is exactly one enumerated edit operation on length >= 4
  capitalized whole tokens; nothing further (no phonetics, no distance 2).
- Stateless per-occurrence flagging means a deliberate variant that is NOT
  locked as an alias flags on every occurrence until the writer locks it —
  advisory, dismissible, and documented as the dismissal path.
- Tokenization splits hyphenated names ("Mary-Ann" → "Mary", "Ann");
  sub-token variants are matched per part, never across the hyphen.

## Shortcuts

None. No mocks at the wrong level, no schema edits, no pin loosening, no
partial implementations; every acceptance criterion has a pinning test.
