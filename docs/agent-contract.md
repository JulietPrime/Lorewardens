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

## Canon-lore detection shapes and false-positive guards

The canon-lore matcher (`packages/agents/src/canon-lore.ts`) works over the
deterministic cue tables in `packages/agents/src/lexical.ts`. All matching is
offline, word-boundary based and side-effect free.

Explicit shapes (keyword-overlap gated via `aboutStatement`, one finding per
entry and sentence, explicit shapes take precedence):

- **Antonym swap.** Guard: the sentence must engage the entry's *subject
  anchor* — `tags[0]` plus the first two content words of the entry text,
  stemmed — so a token collision ("light in every window" meeting dark canon
  on "light") cannot fire without the entry's own subject.
- **Negation-polarity conflict.** Guard: at least one shared content word
  beyond the subject anchor (`tags[0]` plus the FIRST content word — the
  narrower anchor keeps one-word-predicate negations such as "Her spell cost
  her nothing" catchable), so polarity must conflict over predicate
  vocabulary, not merely co-occur with the subject ("wolves" class).
- **Numeric mismatch.** Guard: the differing numerals must share a unit word
  directly adjacent to each numeral ("9 years" vs "3 years"), so stray
  counters ("a 1", "2 wagons") cannot match canon numbers ("30") through
  unrelated shared words.
- **Verbatim agreement (guard, runs before all shapes).** A sentence that
  contains the entry text verbatim — normalized lowercase, punctuation and
  whitespace collapsed — is agreement and never a conflict, whatever cues
  the surrounding sentence frame carries.

Implicit full-retention shape (`canon-implicit-contradiction`; NOT gated on
`aboutStatement` because the repro sentence shares fewer than two content
words with the rule text). Every gate must pass within one sentence:

1. the entry is confirmed, rule-kind, and its text contains a `COST_CUES`
   cost/loss cue;
2. the sentence contains a `CASTING_CUES` casting ACTION cue (bare nouns
   like "spell"/"magic" are deliberately not casting cues — that is what
   keeps "remembered every detail of the spell book" silent);
3. the sentence contains a `RETENTION_CUES` full-retention phrase (generic
   memory words are not retention; the tables prefer false negatives);
4. a `CASTING_DOMAIN` link exists: some domain word present in the sentence
   (casting cue or magic-domain noun) has a family that intersects the
   rule's own domain words (text + tags, stemmed) — "She cast the ward..."
   binds to the demo memory rule via ward → spell.

Severity/confidence/minStrictness follow the locked-canon pattern: locked
rule → major / 0.95 / gentle-eligible; otherwise minor / 0.8 / standard.
The type is distinct from `canon-contradiction` so the writer can dismiss or
exception it independently.

Location drift (`canon-location-drift`, strict-only, info / 0.55) derives
the object's identity from the entry's own text — the subject words before
the binding verb, `tags[0]` as fallback — and carries its own drift reason
and message instead of reusing the antonym shape.

## Timeline gating

Sequence assertions require a comparative cue ("before"/"after" families)
fully inside the mention window between the two event mentions; every
occurrence of a cue counts, not just the first. An `unclear-time-jump` fires
only when a hedge is present, no comparative cue sits inside that window,
and the hedge does not trail the second event mention. When the two events
share a participant their first-mention indices collapse onto the shared
name; the ambiguity gate then falls back to each event's first
distinguishing keyword to build the window.

## Modular enable/disable

`ProjectSettings.agents[]` holds an `AgentSettings` per agent:
`enabled` (modular on/off per project), `strictness`, and `options` (per-agent
toggles declared in the descriptor). The runtime runs exactly the enabled
agents at their configured strictness.

## Registry

`AgentRegistry` (packages/core/src/registry.ts) is roster-agnostic: 17 agents
fit the same contract. Increment 2 registers the three Continuity agents and
the five Language & Prose agents (eight total); later families (Domain,
Narrative, Optional) implement the
same interface and appear as new MCP tools without contract changes.
