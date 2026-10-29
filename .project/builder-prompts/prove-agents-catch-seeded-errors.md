# prove-agents-catch-seeded-errors: Seeded manuscript + automated proof suite

AGENT_ROLE: builder
PROJECT: Lorewardens

## Task

Build an automated proof suite in `packages/proof`: a sample manuscript with
seeded canon, character, and timeline errors, driven through the real agent
pipeline, asserting that standard strictness catches every seeded error and
clean passages stay silent.

## Context

- Agents to exercise: `@lorewardens/agents` (the three continuity agents, implemented by the previous task)
- Pipeline: `selectRelevantContext` + `filterFindings` from `@lorewardens/core` — mirror how the MCP server drives agents (read `packages/mcp-server/README.md` and source for the exact invocation pattern)
- Contract reference: `docs/agent-contract.md`; findings schema: `schemas/finding.schema.json`
- Placeholder to replace: `packages/proof/src/index.ts`

## Requirements

1. `packages/proof/fixtures/manuscript.md` — a coherent short story (several scenes, one file) containing **at least 6 seeded errors**: ≥ 2 canon contradictions (one against locked canon), ≥ 2 character inconsistencies (one knowledge violation, one trait/behavior), ≥ 2 timeline problems (one impossible ordering, one ambiguous/unclear jump). Weave them in naturally; the story must read normally.
2. `packages/proof/fixtures/seeds.json` — each seed: `{ id, category: "canon"|"character"|"timeline", expectedAgent, expectedType, quote }` where `quote` is the exact seeded sentence.
3. `packages/proof/fixtures/canon.json` — the confirmed canon snapshot (entries incl. one locked rule, characters with traits/injuries, timeline events) that the seeds violate. Reuse the snapshot shape from `docs/living-canon-data-model.md`.
4. The suite (integration test): for the whole manuscript, split into scene chunks with correct offsets, run each enabled agent at standard strictness through the same context-selection and filtering path the server uses, then assert **each seed individually** is caught (a finding whose `location` covers the seed quote and whose `type` matches `expectedType`). No aggregate-only counts.
5. Clean-passage assertion: passages of the manuscript far from any seed (declare them in `seeds.json` as `cleanSpans`) produce **zero findings** at standard.
6. Strictness contrast: the locked-canon contradiction is still caught at gentle; the unclear time jump is NOT surfaced at gentle; strict adds no findings below `minStrictness: "strict"` to clean passages.
7. Every produced finding validates against `schemas/finding.schema.json`.
8. One command: `npm test` at repo root runs the whole proof suite.

## Acceptance criteria

- [ ] `npm install && npm run build && npm test` pass on a clean checkout with one command.
- [ ] Every seeded error is individually asserted caught at standard.
- [ ] Clean intentional passages raise no findings at standard.
- [ ] Strictness contrast assertions (gentle/strict) hold.
- [ ] All findings validate against the JSON Schema.
- [ ] The suite is deterministic (no network, no randomness; fixed fixture data).

## Out of scope

Changing agent implementations (report problems instead — if an agent misses a seed, stop and report the specific gap rather than weakening the suite), MCP server changes beyond importing its invocation pattern.
