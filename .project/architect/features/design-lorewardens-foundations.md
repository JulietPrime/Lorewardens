# Feature spec: Design Lorewardens foundations and agent contract

**Task**: design-lorewardens-foundations
**Workstream**: foundations
**Ground truth**: `project-files/Lorewardens.md`, `project-files/Lorewardens Agents.md`

## Purpose

Every later piece — MCP server, the three continuity agents, the proof suite,
and eventually the Google Docs integration and the full 17-agent roster —
needs one shared data model and one agent interface. This task lays down the
repo scaffold, the architecture doc, the Living Canon data model, the findings
schema, and the agent contract, so builders implement against stable types
instead of inventing them.

## Design approach

- **Stack**: TypeScript monorepo (npm workspaces), Node >= 20, ESM. Packages
  with a strict dependency direction: `proof → mcp-server → agents → core`.
  Rationale in `.project/architect/decisions/0001-typescript-monorepo.md`.
- **Living Canon model**: canon entries (fact/rule/history/setting),
  characters (traits, abilities, injuries, goals, voice, relationships),
  timeline events (order, precision, participants). All carry
  `proposed → confirmed → retired` status, writer locks, and source spans.
  Agents read confirmed snapshots and emit `CanonProposal`s; only the
  writer's confirmation writes. Dismissals and exceptions live in
  `ProjectSettings` and are enforced by the findings pipeline.
- **Findings schema**: structured, localized, non-destructive. Fields per
  `docs/findings-schema.md`; machine schema in `schemas/finding.schema.json`.
  `suggestion` is advisory and never applied.
- **Agent contract**: `ContinuityAgent.analyze(AnalyzeInput) → Finding[]` with
  input `(chunk, minimal context, strictness, settings)`. Strictness off /
  gentle / standard / strict fixed as in `docs/agent-contract.md`:
  off = not invoked; gentle = clear contradictions, confidence ≥ 0.9;
  standard = all contradictions + inconsistencies, confidence ≥ 0.7 (the
  proof level); strict = adds speculative notes, confidence ≥ 0.4, plus
  optional per-agent checks. Contradictions with locked canon are major+.
- **Incremental input rule**: changed text + minimal canon context only,
  selected by `selectRelevantContext` (name/alias/tag matching, world rules
  always included, confirmed items only). Written into the contract as a
  binding rule, not an optimization.
- **Modularity**: `AgentRegistry` + `AgentDescriptor` are roster-agnostic;
  per-project `AgentSettings { enabled, strictness, options }`.

## Key implementation details

- `packages/core/src/types.ts` — all domain types
- `packages/core/src/strictness.ts` — ordering, confidence floors, `surfacesAt`
- `packages/core/src/canon.ts` — `CanonStore` interface + `InMemoryCanonStore`
- `packages/core/src/context.ts` — `selectRelevantContext`
- `packages/core/src/agent.ts` — contract + binding rules
- `packages/core/src/findings.ts` — `makeFinding`, `filterFindings`
- `packages/core/src/registry.ts` — `AgentRegistry`
- `packages/agents` — descriptors for the three continuity agents + stub agents (replaced by task 3)
- `packages/mcp-server`, `packages/proof` — runnable placeholders for tasks 2 and 4
- `docs/` — architecture, canon model, findings schema, agent contract
- `schemas/finding.schema.json` — language-neutral finding schema

## Acceptance criteria

- [ ] Repo scaffold and architecture doc describe every component (component map with statuses).
- [ ] Living Canon model covers writer-confirmable facts, locks, and exceptions.
- [ ] Findings schema covers type, location, severity, explanation, optional suggestion (JSON Schema + TS type agree).
- [ ] Agent contract fixes strictness levels off/gentle/standard/strict with confidence floors.
- [ ] Incremental input rule written down: changed text plus minimal canon context only.
- [ ] `npm install && npm run build && npm test` pass on a clean checkout.
- [ ] Core unit tests prove strictness gating and confirmed-only context selection.

## Test instructions

1. Fresh checkout: `npm install`, `npm run build`, `npm test` — all green.
2. `node packages/core/dist/test/strictness.test.js` — strictness gating behaves per contract table.
3. Read `docs/agent-contract.md` — confirm the incremental input rule and strictness semantics match `project-files/Lorewardens.md` core principles.
4. Validate `schemas/finding.schema.json` parses and its required fields match `docs/findings-schema.md`.
