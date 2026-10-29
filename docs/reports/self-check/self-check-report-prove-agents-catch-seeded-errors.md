# Self-Check Report — prove-agents-catch-seeded-errors

**Task**: prove-agents-catch-seeded-errors (seeded manuscript + automated proof suite)
**Date**: 2026-10-29
**Revision**: pushed to `build/prove-agents-catch-seeded-errors` (SHA in the submission)
**Base**: develop `d773dc5b` (landed task 3), branched exactly; no other branch touched
**Confidence**: 90

## What was implemented

The seeded-error proof suite in `packages/proof`, replacing the placeholder,
exercising the real MCP tool path (`runAnalyzeTool` from
`packages/mcp-server/src/tools.ts`) end to end over fixture-seeded projects:

- `fixtures/proof.canon.json` + `proof.settings.json` — project `proof`: the
  demo world (locked magic-memory rule, Weeping Gate, Mira/Daven) extended
  with the Karth ferry (numeric canon fact), the glass astrolabe + harbor
  ledger (`LOCATION_BINDING` entries for the drift check), Calla (siege
  participant, so the siege event reaches the context selector), Bren &
  Oskar (canon `ally` pair with an antonym in the matcher table), and the
  harbor-lanterns event (unlocked sequence partner). All agents enabled at
  `standard`, optional checks off.
- `fixtures/proof-strict.canon.json` + `proof-strict.settings.json` — project
  `proof-strict`: same canon content under its own `projectId` (asserted
  byte-equal modulo the id), all agents at `strict`,
  `objectLocationChecks: true`, `relationshipState: true`.
- `fixtures/manuscript/ch4.md` — 18 blank-line-separated paragraphs, one per
  scenario: E1–E10 seeded errors, S1/S2 strict-only seeds, 6 clean passages
  that touch the same canon objects (gate, survey, Daven's wrist, Mira's
  abilities, ferry, ledger, magic rule) in canon-consistent ways. The suite
  computes real file-relative offsets per paragraph and feeds each one to the
  tool as its own changed chunk.
- `test/proof.test.ts` (node:test, 10 tests) asserting:
  - **Catch table at standard** — for each of E1–E10 the target agent's
    `runAnalyzeTool` result is `invoked: true` with ≥1 finding of the
    expected `type` whose `canonRefs` contain the expected canon id
    (E1/E9 major+gentle; E2–E10 minor+standard; verified severities match
    the spec table).
  - **Strict-only notes** — S1 (`canon-location-drift`) and S2
    (`relationship-drift`) fire at strict (info/0.55/minStrictness strict)
    and are silent on an explicit `standard` call in the same strict project.
  - **Strictness matrix** — at gentle, across all seeded paragraphs × all
    three agents, exactly E1 and E9 (the writer-locked seeds) surface and
    nothing else.
  - **Silence on clean** — 6 clean paragraphs × 3 agents × gentle/standard
    (proof project) and × strict (proof-strict, options on): zero findings.
  - **Schema + offsets** — every finding from full passes (both projects,
    gentle/standard/strict) validates against `schemas/finding.schema.json`,
    stays inside its chunk, and its `quote` slices exactly from the
    manuscript file on disk.
  - **Determinism** — two identical passes yield identical finding
    type/canonRef/location/confidence tables (ids/timestamps excluded).
- Root `npm test` now ends with the proof workspace in dependency order;
  `packages/proof` gained the `node --test dist/test/*.test.js` script and
  its tsconfig compiles `test/`. No existing test was weakened.
- Docs: root README increment list (task 4 done), `docs/architecture.md`
  component status (current), and `packages/proof/README.md` pinning the
  matcher cautions (cue-between first-occurrence, ambiguity-cue over-trigger,
  `tags[0]` drift keying, participant-intersection context selection +
  timeline mention-index collapse, confidence floors) so future matcher
  upgrades know what the fixtures pin.

## Verification performed

- `npm run build && npm test` at repo root: green — core 26/26, agents 45/45,
  mcp-server 21/21, proof 10/10; run twice consecutively with identical
  results (determinism across invocations, not just within the test).
- The full findings table was dumped and reviewed against the spec target
  table: every seeded paragraph produces exactly its target finding (no
  cross-agent noise), every clean paragraph produces zero findings in both
  projects, severities/confidences/minStrictness match the spec exactly.
- `git diff` against base confirms zero changes under `packages/core` and
  `packages/agents` (rule honored; no stop-and-report condition hit — every
  seeded error is catchable with fixture design alone).
- No network anywhere in the proof path: the suite and its helpers import
  only `@lorewardens/*` packages plus `node:fs`/`node:url`; all analysis is
  in-process over fixture data.

## Judgment calls (flagged for review)

1. **Single-sentence paragraphs.** Each scenario paragraph is one sentence.
   Matchers operate sentence-wise, so multi-sentence paragraphs would not
   change detection outcomes; single sentences keep the prefix→paragraph
   mapping and offset assertions airtight.
2. **Exactness asserted at gentle, target-presence at standard.** The gentle
   matrix asserts the exact finding set; the standard catch table asserts
   only each target (the spec explicitly allows extra findings on seeded
   paragraphs and requires only the target assertion). Asserting exactness at
   standard would over-pin current matcher precision.
3. **Fixture-driven scenario table.** The scenario table (id → agent, type,
   canonRef, stable text prefix) lives in the test file; the manuscript maps
   paragraphs to scenarios by exact-text prefix, and a guard test asserts
   every prefix resolves to exactly one paragraph and covers all paragraphs.

## Shortcuts

Critical:
1. NONE.

Minor:
2. Deep imports: the test imports `runAnalyzeTool`, `loadFixtures` and
   `validateFinding` via `@lorewardens/mcp-server/dist/src/*.js` because the
   package index does not re-export them and the spec forbids MCP-server
   changes (adding re-exports would have been one). Works today (no
   `exports` map in that package.json); if one is added later, these three
   import specifiers need updating.
3. No automated no-network scan for the proof package itself; verified by
   inspection (only `node:fs`/`node:url` plus already-scanned `@lorewardens/*`
   dependencies).
4. E1–E10 are asserted on the `proof` project only (the standard project, per
   spec). The `proof-strict` copies' standard-level behavior was verified
   identical during development but is not asserted in the suite.

Questionable:
5. None beyond the judgment calls above.

COMPLETE DISCLOSURE CONFIRMATION:
[x] I have listed ALL shortcuts. If asked "any more?", my answer is NO.

VERDICT: READY FOR ARCHITECT REVIEW
