# Self-Check Report: make-the-demo-match-the-engine

- **Task:** make-the-demo-match-the-engine
- **Role:** builder (rider on session `lor_jeremiahtheobald_build-add-the-five-language-and-prose-agents`)
- **Date:** 2026-10-29
- **Base:** `develop` @ `868079e386fb0dda998e357e336369d3cd7c79b4`
- **Branch:** committed on the session-isolated branch `build/agent-a2b79354df3a4d34145e`, pushed to `build/make-the-demo-match-the-engine`
- **Spec:** builder-artifacts/221da5e8fbb04914a91c1c758ac395ed (sha256 verified: `07a97eea8b61a73b800fc304580ae4ad21d9bba00cf860555cee0c1a993197d7`)

## What was delivered

The demo now promises only what the engine demonstrably catches, and every
promise is enforced by a test through the real MCP tool path.

1. **`packages/mcp-server/README.md`** — three new sections:
   - *What the engine catches today*: the three deterministic contradiction
     shapes (negation-polarity, antonym swap, numeric mismatch) with a
     concrete example each, plus a factual paragraph on the agent-specific
     cue checks (Character Consistency knowledge/recovery cues, Timeline
     sequence/ambiguity cues).
   - *Try these (every sample is machine-proven)*: four sample sentences, one
     per shape plus one character cue check, each with its exact expected
     finding.
   - *What the engine does NOT catch today (known limits)*: names the
     owner-found false negative — locked rule `canon_rule_magic_memory`
     ("Every spell costs the caster one personal memory...") is not flagged
     for "She cast the ward and remembered every detail of it afterward."
     The flagship rule appears ONLY here, never as a "we catch this" sample.
2. **`packages/mcp-server/test/readme-samples.test.ts`** (new) — runs every
   README sample through `runAnalyzeTool` (all three agents) against the
   seeded `demo` project and asserts: the expected agent returns exactly one
   finding with the documented type and `canonRefs` (including the expected
   canon id), the finding quotes the sample sentence, it schema-validates
   (`validateFinding`), the other agents stay silent, and repeated runs are
   deterministic (ids/timestamps projected out, per the proof-suite
   convention). Also asserts the known-limit repro sentence stays silent for
   all three agents, so the limit is honest in both directions.
3. **`packages/mcp-server/fixtures/demo.canon.json`** — exactly ONE additive
   confirmed fact entry `canon_fact_siege_years` ("The siege of the city
   lasted 9 years.", tags `["siege"]`) so the numeric shape has a demo-project
   sample, per the spec's bound design decision.
4. **`packages/mcp-server/test/tools.test.ts`** — the fixture-count assertion
   updated `entries.confirmed` 2 → 3 for the additive entry (permitted by the
   spec; requirement strengthened, not weakened: proposed count still pinned).
5. **`README.md`** — one-line status note in the increment list.

## Acceptance criteria

- [x] ac-1 README documents the three detection shapes with one concrete example each
- [x] ac-2 Every try-this sample asserted by the new test to produce its expected finding type at standard through `runAnalyzeTool`
- [x] ac-3 README states the known limit (implicit/full-retention contradictions, memory-rule repro) with the exact repro sentence
- [x] ac-4 Each sample asserts agent, type, canonRefs containing the expected canon entry id; every finding schema-validates
- [x] ac-5 `packages/proof/**` byte-identical to develop (`git diff 868079e -- packages/proof` is empty)
- [x] ac-6 No changes to `packages/agents/**`, `packages/core/**`, `schemas/**`, `packages/mcp-server/src/**` (diff touches only the five allowed files)
- [x] ac-7 `npm run build && npm test` green at repo root; existing tests unmodified except the permitted count pin

## Verification performed

- `npm install && npm run build && npm test` at repo root: **112/112 green**
  (109 pre-existing + 3 new readme-samples tests), run **twice with identical
  results**.
- `npm run smoke -w @lorewardens/mcp-server`: SMOKE OK; `canon_list` shows
  entries confirmed 3 / proposed 1 as expected.
- Verbatim parity checked mechanically: all four try-this sentences and the
  known-limit repro appear exactly once each in both README and test file.
- Diff scope audited: `git diff 868079e --stat` shows only
  `README.md`, `packages/mcp-server/README.md`,
  `packages/mcp-server/fixtures/demo.canon.json`,
  `packages/mcp-server/test/tools.test.ts` (+ new
  `packages/mcp-server/test/readme-samples.test.ts`).

## Engineering notes

- Sample sentences were traced line-by-line through the real matchers and the
  minimal-context selector before writing: entries of kind `fact` enter
  context only when a tag token appears in the chunk (`context.ts`), which is
  why both Weeping Gate samples say "the city wall" (possessive "city's" does
  not tokenize to the tag word `city`). Each sample yields exactly one
  finding and provable silence elsewhere — e.g. the antonym sample mentions
  two canon events but carries no sequence cue, so Timeline stays silent.
- Determinism test projects findings to stable fields (agent, type, severity,
  confidence, minStrictness, canonRefs, quote, location.file/startOffset)
  because `makeFinding` stamps fresh `id`/`createdAt` per run — same
  convention as the proof suite.

## Judgment calls (within the spec's allowance)

- Exact sample wording, table format, and section prose.
- The known-limit repro sentence is additionally asserted silent in the test
  (spec required documenting the limit; asserting the silence makes the
  README's negative claim machine-checked too, matching the "prove every
  promise" intent).

## Shortcuts

None taken in this task. One operational note, not part of the deliverable:
the in-flight contract-extension WIP of the paused language-roster task
(`add-the-five-language-and-prose-agents`) is parked unmerged in this
worktree's git stash (`stash@{0}`, message "WIP language-agents contract
extension (paused for rider task make-the-demo-match-the-engine)") — it was
stashed before this task started because it touches files this task's ac-6
forbids and broke the build; it must be restored after this task lands.
