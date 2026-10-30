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

## Name-variant drift (character-consistency)

The character-consistency agent flags spelling drift between a passage and
the writer-confirmed character canon (`name-variant-drift`; minor / 0.72 /
standard — silent at gentle, surfaces at standard and strict). The rule
table lives in `packages/core/src/name-variants.ts` and is the ONLY spelling
tolerance that exists in the engine: closed, enumerated, offline, no fuzzy
thresholds beyond the listed edit operations.

**Closed variant rule table.** A candidate text token T is a spelling
variant of a canon name N iff ALL hold:

1. T and N are case-insensitively unequal — exact matches (canon name or
   alias) are never variants;
2. restricted Damerau-Levenshtein distance between `lower(T)` and `lower(N)`
   is exactly 1: ONE of — single substitution, single insertion, single
   deletion, adjacent transposition. No other operation, no distance 2, no
   phonetic rules;
3. `min(len(T), len(N)) >= 4` — short names never variant-match (avoids
   'Ed'/'Edw' noise);
4. T appears as a CAPITALIZED whole word token in the sentence text
   (proper-noun surfaces only; tokenization: `[A-Za-z0-9'’]+` runs,
   possessive `'s`/`'s` stripped before comparing, the stripped token is
   what is compared);
5. T is not stoplisted (the same name stoplist the place-name evidence
   below uses).

Canon name sources per character: `[character.name, ...character.aliases]`,
each length > 1. **Aliases are honored by construction:** an exact
case-insensitive alias match is never a variant, so a writer who locks a
deliberate variant as an alias silences it permanently. The writer dismissal
path is to add the variant as an alias of the character (or correct the
canon spelling) — no new store plumbing, no exception plumbing.

**Variant-tolerant context selection.** A confirmed character enters the
agent's context when any capitalized whole token of the chunk is a
rule-table variant of the character's name or one of its aliases — so a
paragraph that contains ONLY the drifted spelling still reaches the agent
and still flags. Without this, the feature would fail its own acceptance
case: the drifted paragraphs never pull the character into context.

**Stateless semantics (pinned judgment call).** The canon spelling is the
reference, so EVERY variant occurrence flags — there is no document-order
"first mention" tracking. The owner's scenario (canon spelling first, drift
later) is fully covered; a variant-first occurrence also flags, which is
minor, advisory, and dismissible by locking the variant as an alias.
Determinism and the chunk-wise contract outrank the literal "after first
mention" wording.

**Place-name guard.** An issue is suppressed when EITHER the character's
canon name (name or alias) OR the variant token T is a member of
`CanonContext.placeNames` (case-insensitive). `placeNames` is populated by
the context selector from the snapshot: for every confirmed `setting`
entry, its capitalized whole-word tokens (length >= 4, not stoplisted,
first-occurrence order, first capitalized casing kept) are place-name
evidence — a sentence became a setting entry because a place cue noun was
present, so its capitalized tokens are place evidence. A proper noun
evidenced as a place in confirmed setting canon must not be treated as a
character name; this prevents the canon extractor's documented v1 gap
(recurring proper-noun places proposed as characters) from compounding
into drift findings. The writer-side cleanup of a mis-proposal stays
manual, exactly as `docs/canon-bootstrap.md` documents.

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
