# implement-three-continuity-agents: Canon/Lore, Character Consistency, Timeline

AGENT_ROLE: builder
PROJECT: Lorewardens

## Task

Replace the stub agents in `packages/agents` with working implementations of
the three Continuity agents, per their role descriptions and the binding
agent contract.

## Context

- Ground truth for roles: `project-files/Lorewardens Agents.md` (sections "Canon / Lore", "Character Consistency", "Timeline / Chronology")
- Contract: `packages/core/src/agent.ts` (`AGENT_CONTRACT_RULES` are binding) and `docs/agent-contract.md`
- Types: `packages/core/src/types.ts` — findings must validate against `schemas/finding.schema.json`
- Gating: `packages/core/src/strictness.ts`, `packages/core/src/findings.ts` (`makeFinding`, `filterFindings`)
- Input you receive: `AnalyzeInput` = changed chunk + minimal confirmed canon context + strictness + project settings
- Stub to replace: `packages/agents/src/index.ts` (keep `AGENT_DESCRIPTORS` and the export shape; the MCP server task consumes them)

## Requirements per agent

1. **canon-lore** — flags text contradicting confirmed facts, rules, history, settings. Honors locked details: contradictions with locked items are severity `major`+ and `minStrictness: "gentle"` (they surface at every active level). Optional strict check `objectLocationChecks` (off by default): when enabled at strict, flags important objects/locations moved contrary to canon. May emit `CanonProposal`-shaped suggestion text in `finding.suggestion`; never writes anywhere. Does not invent lore.
2. **character-consistency** — flags knowledge violations (knows something they should not), trait/ability/injury contradictions, and behavior against established patterns. Optional `relationshipState` check (off by default) for relationship-state continuity. Internal consistency only — not style, not voice quality.
3. **timeline** — flags impossible time jumps, chronological contradictions, age/date conflicts against confirmed `TimelineEvent`s, and marks genuinely ambiguous sequence as `unclear-time-jump` findings (severity `minor`, so they surface at standard/strict, not gentle).

## Contract rules that will be tested

- Read-only: no writes to manuscript, canon store, or settings; no network.
- Incremental: work only from `input.chunk` and `input.context`. No global state that assumes full-manuscript context.
- Strictness: emit findings with correct `minStrictness` and `confidence` — clear contradictions at standard (confidence ≥ 0.7); locked-canon contradictions at gentle (≥ 0.9); speculative/drift notes at strict (0.4–0.69). Never emit below-floor noise.
- Clean text returns `[]`.
- Every finding: `type`, `severity`, `confidence`, `minStrictness`, `message`, `quote` (exact excerpt from the chunk), `location` (offsets within the file), `canonRefs`, `suggestion` (string or null).
- Detection approach for this increment: deterministic lexical/keyword matching against the canon context (e.g. name/alias mention, numeric/date and ordered-clause checks for timeline). No external AI calls — this must run offline and deterministically. Structure the code so a smarter matcher can replace the heuristic later.

## Acceptance criteria

- [ ] All three agents implement `ContinuityAgent` and are exported, with `AGENT_DESCRIPTORS` unchanged.
- [ ] Unit tests per agent cover: contradiction caught at standard; locked-canon contradiction surfaces at gentle with severity major+; clean passages return `[]` at gentle, standard, and strict; strict-only notes do not surface at standard; timeline ambiguity becomes `unclear-time-jump` (minor) not gentle-severity.
- [ ] Findings produced by tests validate against `schemas/finding.schema.json` (assert in tests).
- [ ] No agent performs writes or network calls (asserted by code inspection in review; keep the packages free of `fetch`, `fs` writes outside tests).
- [ ] `npm run build && npm test` pass at repo root.

## Out of scope

MCP server changes (its task), the seeded-error proof suite (its task builds on this one), non-continuity agents.
