# Agent Contract

Every Lorewardens agent implements `ContinuityAgent` from
`packages/core/src/agent.ts` and obeys the rules in `AGENT_CONTRACT_RULES`.

## Interface

```ts
interface ContinuityAgent {
  id: ContinuityAgentId;
  descriptor: AgentDescriptor;   // title, description, defaultStrictness, options
  analyze(input: AnalyzeInput): Promise<Finding[]>;
}

interface AnalyzeInput {
  projectId: string;
  chunk: TextChunk;              // changed text + file + offsets
  context: CanonContext;         // minimal, confirmed-only, pre-selected
  strictness: Strictness;        // "off" is filtered before agents run
  settings: ProjectSettings;     // enablement, options, exceptions, dismissals
}
```

## Contract rules (binding)

1. **Read-only.** Agents never mutate the manuscript, the Canon store, or
   project settings. Canon updates happen only as `CanonProposal` objects the
   writer confirms.
2. **Findings only.** `suggestion` is advisory text; nothing is applied
   automatically. The writer owns every creative decision.
3. **Incremental input.** Agents receive only the changed chunk plus the
   minimal canon context selected for it. Agents must not require and must
   not request the full manuscript.
4. **Complete metadata.** Every finding carries `type`, `severity`,
   `confidence`, `minStrictness`, `location`, `canonRefs` and validates
   against `schemas/finding.schema.json`.
5. **Silence is correct.** Clean text returns `[]`. Agents never pad output
   with speculative noise below the requested strictness.
6. **Locked canon is inviolable.** Contradictions with locked items are
   reported at `major`+ severity.
7. **Honoring writer memory.** Agents may propose freely; the pipeline
   (not the agent) applies dismissals and exceptions. Agents must not
   re-raise suppressed finding types on unchanged input.

## Strictness levels

| Level | Behavior |
| --- | --- |
| `off` | The runtime does not invoke the agent. Zero findings, zero cost. |
| `gentle` | Only clear, high-confidence contradictions with confirmed canon (confidence ≥ 0.9). Minimal interruption while drafting. |
| `standard` | All contradictions and inconsistencies with confirmed canon (confidence ≥ 0.7). The default and the level the proof suite asserts. |
| `strict` | Adds speculative and low-confidence notes (confidence ≥ 0.4) plus optional per-agent checks (e.g. object/location tracking for Canon/Lore, relationship state for Character Consistency). |

Strictness is enforced twice: agents self-select what to emit (they know the
requested level), and the runtime re-gates via `surfacesAt()` using
`minStrictness` + `confidence`. The runtime gate is authoritative.

## Modular enable/disable

`ProjectSettings.agents[]` holds an `AgentSettings` per agent:
`enabled` (modular on/off per project), `strictness`, and `options` (per-agent
toggles declared in the descriptor). The runtime runs exactly the enabled
agents at their configured strictness.

## Registry

`AgentRegistry` (packages/core/src/registry.ts) is roster-agnostic: 17 agents
fit the same contract. Increment 1 registers the three Continuity agents;
later families (Domain, Language & Prose, Narrative, Optional) implement the
same interface and appear as new MCP tools without contract changes.
