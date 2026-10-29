# Self-Check Report — implement-three-continuity-agents

**Task**: implement-three-continuity-agents (Canon/Lore, Character Consistency, Timeline)
**Date**: 2026-10-29
**Revision**: pushed to `build/implement-three-continuity-agents` (SHA in the submission)
**Base**: integration head `e40223f5` (landed task-1 + task-2 + acceptance suite), fast-forwarded cleanly
**Confidence**: 85

## What was implemented

The three Continuity agents in `packages/agents`, replacing the stubs, behind
the unchanged `AGENT_CONTRACT_RULES` contract:

- `src/lexical.ts` — shared deterministic matcher toolkit (pure, offline):
  tokenizer, stemmer, sentence splitter with offsets, negation/recovery/
  knowledge/sequence/ambiguity cue lists, a small documented antonym table
  (stem-keyed), numeric-conflict detection with shared unit words, and
  `gateForAgent` (agent-side self-gating by strictness floor).
- `src/canon-lore.ts` — contradiction detection against confirmed entries via
  three deterministic paths: antonym conflicts, negation of an affirmed
  statement (and vice versa), numeric conflicts. Locked entries → severity
  `major`, `minStrictness: "gentle"`, confidence 0.95; unlocked → `minor`,
  `"standard"`, 0.8. Optional strict `objectLocationChecks` (off by default)
  detects relocation of tagged objects contrary to canon bindings
  (`canon-location-drift`, strict/info/0.55). Suggestions are
  CanonProposal-shaped advisory text.
- `src/character-consistency.ts` — trait contradictions (antonym or negation),
  injury contradictions (recovery/negation cues against current injuries),
  ability contradictions (negated possession), knowledge violations
  (knowledge cues about an event whose canon participants exclude the
  character), plus optional strict `relationshipState` drift check.
- `src/timeline.ts` — sequence contradictions: comparative cues ("before"/
  "after" and variants) between two event mentions compared with canon
  `order`; pairs are positional (mention order) and canonicalized by canon
  order for deterministic output; locked events escalate to major/gentle.
  Genuinely ambiguous sequencing (hedged cues) → `unclear-time-jump`,
  severity `minor`, `minStrictness: "standard"` (never surfaces at gentle).
- `src/index.ts` — `AGENT_DESCRIPTORS` byte-identical to the stub era;
  `CONTINUITY_AGENTS` exported (see judgment calls).
- `packages/mcp-server` updated in lockstep: `STUB_AGENTS` import →
  `CONTINUITY_AGENTS` (one line in `src/index.ts` + test imports) so the MCP
  tools serve the real agents and `npm run smoke` still passes end to end.

## Acceptance criteria walk-through

| Criterion | Evidence |
| --- | --- |
| All three agents implement `ContinuityAgent`, exported; `AGENT_DESCRIPTORS` unchanged | `test/agents.test.ts` pins the descriptor table (id/family/title/defaultStrictness) and asserts each agent's `analyze` + descriptor binding |
| Per-agent unit tests: contradiction at standard; locked→gentle with major+; clean text `[]` at gentle/standard/strict; strict-only notes silent at standard; timeline ambiguity → `unclear-time-jump` (minor) | 18 tests, all green; the clean-text test runs all three agents × three levels; ambiguity test asserts `surfacesAt(finding, "gentle") === false` |
| Findings validate against `schemas/finding.schema.json`, asserted in tests | The test file loads the actual schema JSON from `schemas/` and validates every finding it produces (required fields, enums, `fnd_` id, location shape, nullable suggestion, ISO date) |
| No writes or network calls | No `fs`/`net` imports in `packages/agents/src`; agents are pure functions over `AnalyzeInput`; the mcp-server no-network scan test still passes over the whole dependency chain |
| `npm run build && npm test` pass at root | Root cycle green: core 26/26 (incl. the task-1 acceptance suite), agents 18/18, mcp-server 21/21 |
| (Routing) `npm run smoke -w @lorewardens/mcp-server` passes with real agents | SMOKE OK — the demo chunk yields zero findings from all three real agents (no false positives), `off` still short-circuits, `canon_list` unchanged |

Contract specifics proven by tests: exact `quote` excerpts with file-relative
offsets (verified by slicing the reconstructed file text), `canonRefs` ids,
advisory `suggestion` strings, agent-side self-gating (an unlocked
contradiction at confidence 0.8 is *not emitted* at gentle by the agent
itself, while the runtime re-gate remains authoritative).

## Judgment calls (flagged for review)

1. **`STUB_AGENTS` removed, replaced by `CONTINUITY_AGENTS`** (same shape:
   `ContinuityAgent[]`). Keeping a "stub" name exporting real agents seemed
   worse than a one-line import update in the MCP server, which the routing
   required to function with real agents anyway. Descriptors and all other
   exports unchanged.
2. **Severity mapping**: locked-canon contradictions → `major` (the contract's
   floor); unlocked contradictions → `minor`; speculative/drift notes →
   `info`; `critical` is reserved and currently unused. Documented in code.
3. **Knowledge violations are lexical proxies**: a character with knowledge
   cues about an event whose participants exclude them, with no canon record
   of learning it, is flagged at 0.72 confidence for the writer to judge —
   the message says "shows knowledge", not "impossibly knows".
4. **Timeline ambiguity scope**: `unclear-time-jump` fires when a sentence
   hedges the sequence of two canon events ("sometime before or after…").
   Age/date conflicts are not detectable yet because canon `TimelineEvent`s
   carry `order`+`precision` but no dates — documented as future matcher work.
5. **Mention thresholds**: events are "mentioned" at ≥2 keyword hits or one
   *unique* keyword (unique across the context refs), which keeps precision
   high on small contexts; characters by name/alias substring as in
   `selectRelevantContext`.

## Known limitations (by design)

- Detection is deliberately lexical (per spec): no inference, no embeddings.
  The matchers are pure functions over `(chunk, context)` so a smarter engine
  can replace them without touching the contract.
- The antonym/negation tables are small and documented; unseen phrasings
  will not be caught until the matcher engine is upgraded (task 4's proof
  suite will exercise exactly these paths).
- `critical` severity and date/age checks are reserved for later increments.

## Shortcuts

None. All spec bullets are implemented or explicitly scoped out by the spec
itself; no mocks, no test-shaped implementations.
