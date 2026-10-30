# Self-Check Report — bootstrap-canon-from-a-pasted-story

- **Builder session:** `lor_jeremiahtheobald_build-bootstrap-canon-from-a-pasted-story`
- **Submitted revision:** committed on branch `build/bootstrap-canon-from-a-pasted-story`, pushed to origin (SHA in the self-check submission; this file is part of that commit)
- **Spec:** builder-artifacts/fb91b68b47c3404d951266d067d21050, sha256 `46c0ed2426c622bcab10f6a1e1c42f6500693c9ac3cdbdd760e6ec1ba8a77932` (launch snapshot followed verbatim)

## 1. Pinned base (zero-trust rule) — verbatim

- **Pinned base SHA:** `7b5276a436bfc3f360b24ebfc0ecdf908a401263`
- **How verified:** I ran `git ls-remote origin refs/heads/develop` myself at
  session start: `7b5276a436bfc3f360b24ebfc0ecdf908a401263	refs/heads/develop`
  — exact match, no movement. I then fetched
  `refs/heads/develop:refs/remotes/origin/develop` (re-verified
  `git rev-parse origin/develop` = the pinned SHA) and created the task
  branch `build/bootstrap-canon-from-a-pasted-story` from that exact commit.
- The seeded sandbox checkout had been placed on platform branch
  `build/agent-0ca3ed75fdc0db368df9` at `34c18ae`, whose tree (`7fbc570`)
  differs from the pinned develop tip's tree (`c9e4e76`). Per the zero-trust
  rule I left that checkout and switched to the spec branch built from
  `7b5276a`. Architect was messaged at branch creation with the verified
  base (orq comm, `branch-created-bootstrap-canon-7b5276a`).

## 2. Verification results

| Suite | Baseline (pinned base) | Final revision | Verdict |
| --- | --- | --- | --- |
| `@lorewardens/core` | 26 pass | 54 pass, 0 fail | 26 original green unmodified + 28 new |
| `@lorewardens/agents` | 170 pass | 170 pass, 0 fail | untouched |
| `@lorewardens/mcp-server` | 95 pass + 2 pre-existing skips | 117 pass + 2 pre-existing skips, 0 fail | the 2 skips are the known demo-parity diff-scope pins (unchanged); 22 new tests added |
| `@lorewardens/bridge` | 14 pass | 14 pass, 0 fail | untouched |
| `@lorewardens/proof` | 48 pass | 48 pass, 0 fail | untouched |
| `@lorewardens/docs-extension` | 48 pass | 48 pass, 0 fail | untouched |

- `npm install && npm run build && npm test` at repo root: green.
- `npm test` run **twice**: identical results both runs
  (54 / 170 / 117+2 / 14 / 48 / 48).
- `npm run smoke -w @lorewardens/mcp-server`: SMOKE OK — real stdio server
  lists `canon_bootstrap` last (`smoke.mjs` membership-only, untouched).
- Baseline check: the pre-change suite at the pinned base reports 26 core /
  170 agents / 95+2 mcp-server / 14 bridge / 48 proof / 48 docs-extension
  (current develop tip); every pre-existing test passes unmodified at the
  final revision.

## 3. What was delivered

### 3.1 Extraction engine — `packages/core/src/bootstrap.ts` (new)

`bootstrapCanon({ projectId, source: {text, label}, generatedAt? })` →
`{ snapshot: CanonSnapshot, notes: string[] }`. Deterministic, offline,
pure (no fs, no network, no clock, no randomness, no locale APIs —
code-unit sort/compare only). Curated tables live at the top of the one
module, per spec. Exported via the package index (`export * from
"./bootstrap.js"`).

- Segmentation: `.`/`!`/`?` runs (trailing closing `"` included) plus
  newline boundaries; spans slice the trimmed sentence exactly
  (`text.slice(start, end) === sentence`, test-pinned).
- Dialogue skip: any sentence containing `"` is skipped for canon-ENTRY
  extraction (all four kinds); characters/events still extract (attribution
  lives there). Counted and disclosed in `notes`.
- Characters (evidence-gated): dialogue-attribution verbs
  `said|asked|whispered|shouted|replied|muttered` immediately before or
  after the name, OR >= 2 non-sentence-initial mentions. Case-insensitive
  merge, canonical name = first-seen surface form, possessive `'s` strip,
  aliases only from `Name "Nickname"` / `Name, the <epithet>,` apposition
  (epithet stored as `the <epithet>`, matching the demo fixture
  precedent). Curated stoplist: openers/function words (incl. copular and
  past forms), capitalized contractions, days, months, structural words
  (`Chapter/Prologue/Epilogue/Part`), honorifics, kinship titles.
- Entries (dialogue skipped), kind precedence exactly per spec:
  `rule` (sentence-initial quantifier OR literal ` must `/` may only `/`
  cannot `/` is forbidden `) -> `history` (past copular AND era cue) ->
  `setting` (place-cue noun table) -> `fact` (copular) -> none. Exact-text
  dedupe (whitespace-collapsed, case-insensitive, first occurrence wins);
  tags = first <= 3 content words (stoplist removed, deduped, lowercased).
- Events: one max per sentence; needs a proposed character named in the
  sentence AND a curated action verb; `won't` never fires `won`
  (contraction guard `(?!')` — disclosed below); `order` monotonic from 1;
  `participants` = proposed characters named in the sentence, appearance
  order (alias mentions count); `precision: "fuzzy"`; NO `date`, NO
  `location`.
- Ids: `char_<kebab name>`, `canon_<kind>_<first-3-words>`,
  `event_<first-3-words>`, collision suffixes `-2`/`-3` (deterministic
  `seen`-map). Cap: > 200,000 chars → error naming the cap and "Split the
  story and bootstrap it in parts." `generatedAt` defaults to the fixed
  `1970-01-01T00:00:00.000Z`; stamps `createdAt`/`updatedAt` on every item.

### 3.2 Tool — `packages/mcp-server/src/bootstrap.ts` (new) + wiring

- `canon_bootstrap` tool def (`buildCanonBootstrapTool()`) with zod input
  schema mirroring the existing tool style: `projectId` min 1;
  `source` discriminatedUnion `text` (text min 1, optional label) |
  `file` (path); `generatedAt` `z.string().datetime()` optional;
  `outputPath` optional. Registered in `createLorewardensServer` AFTER
  `canon_list`: `const tools: ToolDef[] = [...buildTools(registry, store),
  buildCanonBootstrapTool()]` — `buildTools()` untouched, emission order =
  pin order, `canon_bootstrap` last. Additive re-exports in package index.
- Handler `runCanonBootstrapTool`: resolves text/label (file read errors →
  `Cannot read source file '<path>': <reason>`; label default
  `"pasted-text"`); calls `bootstrapCanon`; writes ONLY when `outputPath`
  is given — refuses if the file exists ("Bootstrap drafts never overwrite
  anything"), refuses a missing/non-directory parent (no mkdir), writes
  2-space JSON + trailing newline via `flag: "wx"`; returns
  `{ projectId, source: {kind, label, length}, generatedAt, snapshot,
  counts, notes, writtenTo? }` with `writtenTo` present iff written.
- The store is never passed to the bootstrap path at all: no
  `applyConfirmed`, no registration, nothing.

### 3.3 Tests (22 new mcp-server + 28 new core)

- `packages/core/test/bootstrap.test.ts` (28 tests): all-proposed/no-lock
  shape, no `date`/`location`/`birthDate`/`voice` keys, monotonic event
  order, attribution both directions, recurrence gate, single-mention and
  only-sentence-initial silence, stoplist/kinship silence, possessive
  collapse, quoted-nickname and epithet aliases, character sources =
  name-mention sentences, rule quantifier/modal (+ precedence over place
  cue), history era (+ negative), setting place-cue (+ precedence over
  fact), fact fallback, non-copular silence, dialogue skip for entries,
  dedupe, tags, one-max-per-sentence, proposed-only participants,
  appearance order, non-action silence, `won't` guard, id collision
  suffixes, exact span slices with custom label, cap reject/pass,
  byte-identical determinism, generatedAt stamping, source grep guard
  (no network modules, no `Date.now`/`new Date`/`Math.random`/`toLocale*`/
  `localeCompare` in the extractor).
- `packages/mcp-server/test/bootstrap-tool.test.ts` (22 tests): tool
  contract (result shape, default label `pasted-text`, custom label into
  spans), tool-level byte-identical determinism, file source (+ unreadable
  error), schema rejects, `outputPath` write + exact file bytes +
  refuse-second-write + file untouched, missing-parent refusal (nothing
  created), **ac-2** (canon_list output and settings deepEqual-identical
  before/after a bootstrap call, projectIds unchanged, `applyConfirmed`
  still throws), **ac-5** (draft written into a TEMP fixtures dir loads
  cleanly through `loadFixtureBundle`, deepEqual to the response snapshot),
  **ac-3** grep guard over BOTH bootstrap sources.

### 3.4 Docs

- `docs/canon-bootstrap.md` (new): governance, tool contract, draft item
  rules, pinned behaviors (11 numbered cautions mirroring the proof README
  pin style), known limits, module locations.
- `docs/architecture.md`: component-map row for the canon bootstrap.
- `docs/living-canon-data-model.md`: note under Writer-confirmed dates that
  bootstrap drafts never fabricate `date`/`birthDate`.
- `packages/mcp-server/README.md`: `canon_bootstrap` row in the Tools table
  + a "Canon bootstrap" section (governance + example call).

## 4. Pins (ruling v2 pre-authorized additive clause) — verbatim disclosure

Exactly four tool-list deepEquals extended; `canon_bootstrap` appended LAST
(actual emission order); every existing array element byte-identical; the
registry-derived pin in `tools.test.ts` ("one tool per registered agent plus
read-only canon_list", buildTools → 4 entries) untouched; `smoke.mjs`
untouched; no other test modified.

1. `packages/mcp-server/test/tools.test.ts` — server-bundle tool-list
   deepEqual: before `[..., "analyze_theme_motif", "canon_list"]` (15),
   after `[..., "analyze_theme_motif", "canon_list", "canon_bootstrap"]`
   (16). Single added line.
2. `packages/mcp-server/test/acceptance-language.test.ts` — same array,
   += `"canon_bootstrap"`. Single added line.
3. `packages/mcp-server/test/acceptance-narrative.test.ts` — same array,
   += `"canon_bootstrap"`. Single added line.
4. `packages/mcp-server/test/acceptance-light.test.ts` — same array,
   += `"canon_bootstrap"`, plus its assert message reworded
   `"the fifteen tools ..."` → `"the sixteen tools ... before canon_list,
   then canon_bootstrap"` (message text only; the array is the pin).

No changes to `packages/agents`, no new package, no new files under seeded
fixture dirs, no schema changes, seeded fixtures byte-identical.

## 5. Judgment calls (spec-allowed, flagged)

1. **Dialogue-skip scope**: spec says "skipped for rule/fact extraction";
   implemented as: ANY sentence containing `"` is skipped for ALL FOUR
   canon-entry kinds (rule/fact/history/setting are all "established world
   fact"). Characters/events still extract from those sentences. Pinned and
   documented; disclosed because "rule/fact" could be read as two kinds
   only.
2. **Canonical name = first-seen surface form** (spec: "merge same name
   case-insensitive" — the surviving display name was unspecified).
3. **Alias stored as `the <epithet>`** for `Name, the <epithet>,` — matches
   the hand-authored demo fixture precedent (`aliases: ["the
   cartographer"]`).
4. **Attribution detection**: neighbor-word check — the word immediately
   before or after the name run (punctuation/space-stripped, lowercased)
   must be one of the six verbs. Spec gave the two patterns without an
   exact matching rule.
5. **Contraction guard on action verbs**: `(?!')` so `won't` does not fire
   the verb `won`. Minimal precision guard inside the curated-verb
   contract; disclosed.
6. **`generatedAt` validated with `z.string().datetime()`** (strict UTC Z
   form) — a malformed timestamp is rejected rather than stamped verbatim.
7. **Entry-id words = first 3 words of the sentence** (spec:
   `canon_<kind>_<first words of text>` — count unspecified); same 3 for
   `event_`. Collision suffixes `-2`/`-3` per spec.
8. **Character `sources`** = every sentence mentioning the NAME (alias-only
   sentences not included); event participants match name surface forms
   AND aliases ("named in the sentence" read to include aliases).
9. **Tags deduped** before taking the first 3 (spec silent on duplicate
   content words).
10. **Notes** content: deterministic advisories (all-proposed reminder,
    quoted-skip count, one silence note per empty subject kind) — spec
    listed `notes: string[]` without content; test-pinned.
11. **Span objects omit the optional `line`/`column` fields** (fixtures
    include `line`, but the extractor cannot know manuscript line numbers
    from a pasted chunk; `Span.line` is optional).

## 6. Known limits disclosed to the writer (docs/canon-bootstrap.md)

- **Proper-noun places can be proposed as characters** (e.g. a recurring
  "the Weeping Gate" passes the 2-mention evidence gate). The spec's
  candidate definition has no place-name guard; I implemented the
  extraction taxonomy verbatim rather than silently adding one. Flagged
  here and in the cautions doc for the architect: if a guard is wanted
  (e.g. exclude candidate runs containing a place-cue token), it is a
  small follow-up.
- Simple sentence splitting (decimals/abbreviations split), modal cues
  need their surrounding spaces (sentence-final `must.` missed), indirect
  speech is not treated as dialogue, English-only tables, kinship-title
  characters never proposed, no relationship/date/birthDate/voice
  extraction, traits/abilities/injuries/goals empty by design.

## 7. Shortcuts

Determined. None. No network code, no store write path, no
confirm/apply path, no new dependency, no LLM/NLP, no seeded-fixture
change, no pin beyond the four pre-authorized ones.

Questionable:
1. None beyond the judgment calls above.

COMPLETE DISCLOSURE CONFIRMATION:
[x] I have listed ALL shortcuts. If asked "any more?", my answer is NO.

VERDICT: READY FOR ARCHITECT REVIEW
