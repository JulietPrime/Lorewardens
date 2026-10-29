# Self-Check Report — design-lorewardens-foundations

**Task**: design-lorewardens-foundations (Design Lorewardens foundations and agent contract)
**Date**: 2026-10-29
**Revision**: committed on this branch, pushed to `build/design-lorewardens-foundations` (SHA in the submission)
**Confidence**: 90

## What was verified

### 1. Clean-checkout cycle (acceptance criterion 6)

Simulated a fresh clone (`rm -rf node_modules packages/*/dist`) then ran the
full cycle on Node v24.18.1:

- `npm install` — OK, 0 vulnerabilities
- `npm run build` — OK for all four workspaces
- `npm test` — OK: core 7/7 pass, agents 2/2 pass, 0 failures

**Issue found and fixed during self-check**: the original root scripts built
workspaces alphabetically (`--workspaces`), so `@lorewardens/agents` compiled
before `@lorewardens/core` existed and the cold build failed with TS2307
(`Cannot find module '@lorewardens/core'`). Root `build`/`test` scripts now
build in dependency order (core → agents → mcp-server → proof), and per-package
test scripts use a shell-expanded glob (`node --test dist/test/*.test.js`)
that works on Node 20 through 24. Verified by the clean-cycle above, which was
run *after* the fix.

### 2. Strictness gating per the contract table (test instruction 2)

`node packages/core/dist/test/strictness.test.js` — 4/4 pass:

- ordering `off < gentle < standard < strict`
- `off` never surfaces findings (agent not invoked)
- `minStrictness` gating (a standard finding does not surface at gentle)
- confidence floors: gentle ≥ 0.9, standard ≥ 0.7, strict ≥ 0.4

### 3. Contract vs. ground truth (test instruction 3)

`docs/agent-contract.md` checked against `project-files/Lorewardens.md` core
principles:

- Incremental analysis only — contract rule 3 binds agents to the changed
  chunk plus the minimal canon context (`selectRelevantContext`); agents must
  not require the full manuscript. Also enforced structurally: `AnalyzeInput`
  has no field for the full manuscript.
- Non-destructive output — findings are data; `suggestion` is advisory and
  nullable; the only canon write path is writer-confirmed `CanonProposal`.
- Writer owns all creative decisions — locks, dismissals, exceptions all live
  in `ProjectSettings` / the canon store, never in agent hands.
- Strictness levels `off / gentle / standard / strict` match the ground-truth
  roster language; confidence floors are fixed in
  `packages/core/src/strictness.ts` and enforced a second time by the runtime
  gate `surfacesAt()`.

### 4. Findings schema (test instruction 4)

`schemas/finding.schema.json` parses as valid JSON (draft 2020-12). Automated
cross-check against the TypeScript `Finding` type in
`packages/core/src/types.ts`:

- schema `required` has 13 fields; TS `Finding` has 13 fields; 0 mismatches
- `severity` enum `info | minor | major | critical` agrees with the TS union
- `suggestion` is `"string" | "null"` — advisory-only, never applied
- `minStrictness` enum is `gentle | standard | strict` (off means "never
  surfaced", so it is not a valid finding level)

### 5. Acceptance criteria walk-through

| Criterion | Evidence |
| --- | --- |
| Repo scaffold + architecture doc with component map/statuses | `docs/architecture.md` component table (core current; agents/mcp-server/proof stubs for tasks 2–4; Docs integration + 17-agent roster potential) |
| Living Canon model covers writer-confirmable facts, locks, exceptions | `docs/living-canon-data-model.md`; `CanonEntry/Character/TimelineEvent` with `status: proposed → confirmed → retired`, `locked`/`lockReason`, `CanonException`, `DismissedFinding`, `CanonProposal`; write path only via `CanonStore.applyConfirmed` |
| Findings schema covers type/location/severity/explanation/optional suggestion; JSON Schema + TS agree | `schemas/finding.schema.json` vs `Finding` — 0 field mismatches (automated check above) |
| Agent contract fixes strictness levels + confidence floors | `docs/agent-contract.md` table; `STRICTNESS_CONFIDENCE_FLOOR` in `packages/core/src/strictness.ts` |
| Incremental input rule written down | Contract rule 3 + `docs/living-canon-data-model.md` §Incremental analysis contract |
| Clean checkout build+test green | Re-run after fix (above) |
| Core unit tests prove strictness gating + confirmed-only context | `packages/core/test/strictness.test.ts` (4 tests), `packages/core/test/context.test.ts` (3 tests: confirmed-only, alias matching, rules-always-in) |

## Known limitations (by design, not shortcuts)

- The three agents are **stubs** returning `[]` — replaced by the
  implement-three-continuity-agents task. Their descriptors, defaults, and
  options are real.
- `InMemoryCanonStore` is v0; a file-backed store follows before the MCP
  server task ships.
- `packages/mcp-server` and `packages/proof` are runnable placeholders for
  tasks 2 and 4 respectively (the MCP placeholder exits non-zero by design so
  nobody mistakes it for a live server).
- "Contradictions with locked canon are major+" is a contract rule and doc'd
  severity semantics; runtime enforcement lands with the real agents (task 3),
  since stub agents emit no findings.
- `selectRelevantContext` matches tags by whole token and names/aliases by
  token or substring; no fuzzy/semantic matching at this level.

## Shortcuts

None. No mocks at the wrong level, no tests written around the
implementation, no spec sections skipped.
