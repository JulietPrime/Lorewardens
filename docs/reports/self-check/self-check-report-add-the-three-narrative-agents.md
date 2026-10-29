# Self-Check Report — add-the-three-narrative-agents

- **Revision:** `b4b04f33be753cb233bbdfe2a6c76cb90f3a5a35` (pushed to `build/add-the-three-narrative-agents`)
- **Base:** `develop` at `2d82cf294da5d6edbea9b7de9b3d3aa6c4176bbb` (fast-forwarded at session start; branch carried no local commits before the merge)
- **Confidence:** 88

## Summary

The three Narrative agents — Plot Thread / Promise (`plot-thread`), Pacing /
Tension (`pacing-tension`), POV Consistency (`pov-consistency`) — are
implemented as deterministic offline matchers behind the unchanged agent
contract, registered via `ALL_AGENTS`, exposed as the MCP tools
`analyze_plot_thread`, `analyze_pacing_tension`, `analyze_pov_consistency`,
and proven by a dedicated seeded fixture project (`proof-narrative`).
Same shape as the five language agents: contract union extension, closed
tables, strictness gating, modular enable/disable, seeded proof.

## What was built

**New files**

- `packages/agents/src/plot-thread.ts` — `plot-promise-conflict` (antonym /
  negation-of-affirmed / numeric shapes via the increment-1 matchers;
  minor/0.75/standard, locked escalates major/0.95/gentle, `canonRefs:
  [entry.id]`, one per entry per chunk at the first offending sentence);
  `plot-promise-planted` (closed cue table, narration only, info/0.55/strict,
  message names the cue, suggestion points at confirming a `plot-thread`
  entry or dismissing, never asserts the promise will be tracked);
  `plot-open-question` (closed cue table, narration only, one per sentence,
  info/0.55/strict). Messages describe the thread; nothing prescribes
  outcomes.
- `packages/agents/src/pacing-tension.ts` — `pacing-static-stretch`
  (≥ 8 consecutive narration sentences, ≥ 100 words, one per run at the
  run's first sentence, info/0.6/standard), `pacing-rushed-passage`
  (≥ 5 consecutive sentences of ≤ 6 words, any dialogue state, one per run,
  info/0.55/strict), `tension-abrupt-shift` (adjacent esc↔de-esc pair,
  either direction, one per pair, info/0.55/strict). Closed threshold and
  cue tables at the top of the file; `suggestion: null` on all three.
- `packages/agents/src/pov-consistency.ts` — `pov-head-hop` (closed
  THOUGHT_CUES table; narration sentences that mention a confirmed character
  and carry a thought cue; declared single-POV rule → findings for other
  characters with `canonRefs: [povEntry.id]`; no usable rule → per-extra-
  character findings with `canonRefs: [character.id]`; locked rule escalates
  major/0.95/gentle; "omniscient" in the rule text silences the check),
  `pov-distance-shift` (≥ 8 narration sentences, midpoint split, word-
  boundary first/third-person counts, fires at ≥ 3 vs ≤ 1 with delta ≥ 3,
  minor/0.7/standard, located at the first sentence of the deviant half,
  dialogue excluded everywhere). File header documents the v1 limit:
  impossible-knowledge detection is deliberately out of scope.
- `packages/agents/src/narrative-helpers.ts` — `quotedSpans`,
  `narrationSentences` (documented choice: sentences minus quoted-span
  sentences — dialogue-carrying sentences are excluded from narration
  entirely; used consistently by all three agents), word-boundary cue
  matching, `countWords`, `countWordBoundary`. No `lexical.ts` internals
  moved or re-exported.
- `packages/agents/test/narrative-agents.test.ts` — unit coverage: every
  finding type; every strictness level including off-silence; both locked
  escalations (plot entry, pov entry); omniscient switch-off; tag-gating
  (untagged/proposed entries silent for conflicts while planted/open-question
  detection still works); pacing thresholds and dedup-per-run (dialogue
  breaks a run; 4 short sentences stay silent); head-hop attribution edges
  (alias match, dialogue excluded, one per character per chunk);
  distance-shift statistical gate (delta 2 silent, 7 narration sentences
  silent, dialogue-only drift silent); graceful silence without any canon.
- `packages/proof/fixtures/proof-narrative.canon.json` — two confirmed
  `plot-thread`-tagged promises (one `locked`), one confirmed `pov`-tagged
  rule naming a single POV character (locked variant covered in unit tests
  per spec), three confirmed characters for attribution.
- `packages/proof/fixtures/proof-narrative.settings.json` — three narrative
  agents enabled at standard; continuity + language rosters explicitly
  `enabled: false`.
- `packages/proof/fixtures/manuscript/ch-narrative.md` — seeded paragraphs
  (labels PT1–PT4, PA1–PA3, POV1–POV3 mapped by exact-text prefix in the
  proof test, matching the established fixture convention) plus five clean
  paragraphs exercising every tripwire (dialogue-mixed, numeric-adjacent,
  open-question-adjacent, non-adjacent tension cues, 4-sentence short run).
- `packages/proof/test/narrative-proof.test.ts` — drives `runAnalyzeTool`
  over `proof-narrative` the same way `language-proof.test.ts` does: standard
  catch table (every seed → agent, type, canonRefs, severity), gentle matrix
  (locked escalation only), strict additions, clean silence at
  gentle/standard/strict for all three agents, schema validation,
  manuscript-exact offsets, determinism across repeated passes, modular
  enable/disable assertions both directions (including a behavioral
  not-invoked check on the three existing projects).

**Changed files (additive unless noted as a ruled/pre-authorized pin)**

- `packages/core/src/types.ts` — union lines ONLY: `ContinuityAgentId` gains
  the three ids; `Category` gains `"narrative"`.
- `schemas/finding.schema.json` — `agent` enum and `category` enum gain the
  new values (additive).
- `packages/mcp-server/src/validate.ts` — `AGENT_IDS` and `CATEGORIES` sets
  gain the same values (additive).
- `packages/agents/src/index.ts` — three descriptors appended
  (`CONTINUITY_AGENTS` and `LANGUAGE_AGENTS` byte-identical), three
  factories, `NARRATIVE_AGENTS` export, `ALL_AGENTS` extended to
  `[...CONTINUITY_AGENTS, ...LANGUAGE_AGENTS, ...NARRATIVE_AGENTS]`.
- `packages/proof/fixtures/proof.settings.json`, `proof-strict.settings.json`,
  `proof-language.settings.json` — explicit `enabled: false` entries for the
  three new agents (modular disable keeps existing tables stable).
- Pre-authorized pin updates and ruled pin accommodations — disclosed in
  full below.

Not touched: `lexical.ts`, any increment-1 or language agent implementation
file, `packages/mcp-server/src/index.ts`, `acceptance-demo-parity.test.ts`,
`packages/core` beyond the two union lines, the parallel timeline task's
files, and no severity/confidence/minStrictness pin from the spec.

## Verification

- `npm run build && npm test` at repo root: **green, run twice, identical
  results, exit 0 both times.**
- Counts per workspace (both runs): core 26 pass / 0 fail; agents 92 pass /
  0 fail; mcp-server 50 pass / 0 fail / **2 skipped** (the demo-parity
  demo-region pins, pre-existing auto-skip per `demo-parity-skip-ruling-v1`
  — untouched, as the spec describes); proof 32 pass / 0 fail.
  Total: 200 pass, 0 fail, 2 skipped.
- Typecheck is part of the build (`tsc -p` per workspace); the offline scan
  (ac-7, extended with `test/narrative-proof.test.ts`) and the no-network
  source scans pass over the new agent files.

## Pre-authorized pin updates (applied exactly, per the spec)

1. `packages/agents/test/agents.test.ts` — the exhaustive `AGENT_DESCRIPTORS`
   deepEqual: the 3 continuity rows and 5 language rows kept byte-identical
   and in order, then appended the three narrative rows in the same
   `[id, family, title, defaultStrictness]` shape with `standard`; the
   exhaustive deepEqual is kept; only the pin message was reworded
   ("continuity + language" → "continuity + language + narrative"). No other
   edits in the file. The `CONTINUITY_AGENTS` id pin passes unmodified.
2. `packages/proof/test/proof.test.ts` and
   `packages/proof/test/acceptance-seeded-errors.test.ts` — the `projectIds`
   pin became `["proof", "proof-language", "proof-narrative", "proof-strict"]`
   (verified against `loadFixtures` actual sorted output; deepEqual is
   order-sensitive) in BOTH files; only the pin message may be and was
   reworded in the acceptance file.
3. `packages/proof/test/acceptance-seeded-errors.test.ts` — the
   `Record<Category, number>` literal gained `narrative: 0` and the deepEqual
   extends to pin it at zero
   (`{ canon: 3, character: 4, timeline: 3, language: 0, prose: 0, narrative: 0 }`);
   the increment-1 suite now asserts it seeds NO narrative errors.
4. `packages/proof/test/acceptance-seeded-errors.test.ts` — the ac-7
   offline-scan labels array gained `"test/narrative-proof.test.ts"` in
   sorted position; the scan got STRICTER.
5. `packages/mcp-server/test/tools.test.ts` — the full-roster tool-list pin
   gained the three `analyze_*` tools (continuity + language rows
   byte-identical, then the three narrative rows, then `canon_list`); only
   the test title was reworded.
6. `packages/mcp-server/test/schema.test.ts` — added an additive acceptance
   test for the three agent values with category `narrative`; unknown agents
   and unknown categories are still rejected.

## Ruled pin accommodations (narrative-roster-pin-ruling-v1, GRANTED)

My spec's pre-authorization list predated two files that pin the FULL roster;
I stopped and reported before touching them. Ruling
`narrative-roster-pin-ruling-v1` granted the extensions on the same basis as
`descriptor-pin-ruling-v1` and included a general clause for full-roster
pins. Disclosed verbatim:

1. `packages/agents/test/language-agents.test.ts` (~line 96) — the
   `ALL_AGENTS` deepEqual expected array extended with
   `...NARRATIVE_AGENTS.map((a) => a.id)` exactly as the ruling prescribes
   (this required adding `NARRATIVE_AGENTS` to the file's existing import
   list from `../src/index.js` — the minimal edit the prescribed form
   needs). Existing expected values byte-identical and in order.
2. `packages/mcp-server/test/acceptance-language.test.ts` (ac-1 registry
   pin) — `registry.list().length` pin took the new exact value 8 → **11**
   ("eleven agents registered in total"); no loosening to ranges.
3. `packages/mcp-server/test/acceptance-language.test.ts` (ac-1 roster-order
   pin) — the three narrative ids (`"plot-thread"`, `"pacing-tension"`,
   `"pov-consistency"`) appended after the language ids in the `ALL_AGENTS`
   deepEqual; existing values byte-identical and in order; only the pin
   message reworded.
4. `packages/mcp-server/test/acceptance-language.test.ts` (ac-1 tool-list
   pin) — `analyze_plot_thread`, `analyze_pacing_tension`,
   `analyze_pov_consistency` appended before `canon_list`; existing rows
   byte-identical and in order.
5. `packages/mcp-server/test/acceptance-language.test.ts` (ac-5 schema
   enums) — agent enum expected array extended with the three narrative ids
   (both sides `.sort()`ed, as before); message reworded eight → eleven.
   Category enum expected array extended with `"narrative"` in sorted
   position. No loosening.
6. `packages/mcp-server/test/acceptance-language.test.ts` (ac-6, ~line 634)
   — the shipped-proof-projects `projectIds` deepEqual extended with
   `"proof-narrative"` in sorted position. Classification note: this is a
   fixture-list pin, not one of the ruling's enumerated shapes (agent id
   list, registry length, tool list, schema enums); it is covered by the
   ruling's general basis AND by the spec's own pre-authorized update #2,
   which pins the IDENTICAL assertion to the identical new value in the two
   sibling files. Language-behavior pins in this file (catch tables, gentle
   matrices, per-agent heuristics) are untouched.
7. `packages/proof/test/language-proof.test.ts` (~line 100) — same
   `projectIds` deepEqual extended with `"proof-narrative"` (same
   classification note as #6); the test title was reworded "three projects"
   → "four projects" (pin-message rewording only). No other edits in the
   file.

## Design decisions and observations (disclosed, nothing changed)

- **Pins applied exactly; one surfacing consequence to know about.**
  `pacing-static-stretch` is pinned info/0.6/**standard**. At project
  standard the runtime confidence floor is 0.7, so this finding surfaces at
  **strict** (floor 0.4), not standard — the `minStrictness: "standard"` pin
  is honored, the confidence floor decides. The spec pins were NOT changed;
  both the unit suite and the proof suite assert the actual surfacing
  behavior (silent at standard, present at strict). Flagging it because it
  may not be what the pin intended.
- **Fixture entries are `kind: "rule"`.** `selectRelevantContext` passes a
  non-rule entry to agents only when one of its tags appears as a word token
  in the chunk text; the hyphenated tag `plot-thread` can never match a word
  token (hyphens split tokens), so a `fact`/`history`-kind plot promise would
  never reach the agents through the MCP tool path. The fixtures therefore
  use `kind: "rule"` entries (the same mechanism the language fixture's
  period rule uses). No `packages/core` change was made or requested; if the
  context selector should learn about tag shapes, that is a separate task.
- **Deterministic tie-breaks, documented in code:** when both first-person
  and third-person drift conditions hold, `pov-distance-shift` emits one
  finding located at the earliest deviant half; when a confirmed `pov` entry
  exists but names zero or multiple confirmed characters, the agent falls
  back to the no-declared-rule path (documented in `declaredPovCharacter`).
- **`packages/mcp-server/README.md`** still shows the three continuity tools
  in its example tool table (illustrative, not an exhaustive claim; no test
  pins it). It is outside this task's allowed file list, so it was left
  alone — worth a docs touch-up task later.
- **makeFinding ids/timestamps are random by design** (core `randomUUID` /
  clock), so determinism is asserted on the stable finding surface (agent,
  type, severity, confidence, minStrictness, canonRefs, quote, location),
  the same way the language proof does it.

## Shortcuts taken

None. No mocked levels, no assumed schemas, no coverage theater: the proof
suite drives the real MCP tool path (`runAnalyzeTool` + real fixture store)
over a seeded manuscript with real file offsets, and the unit suite drives
the real agent functions with no canon shortcuts. The two pre-existing
mcp-server skips are the demo-parity demo-region pins, unrelated to this
task and untouched.
