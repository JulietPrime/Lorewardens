# Decision 0002: Canon and findings model — strictness as data, confirmation as the only write path

**Status**: Accepted
**Date**: 2026-10-29

## Context

Core principles: incremental analysis only; non-destructive findings; writer
owns all creative decisions; modular enable/disable; living Canon updated
only with writer confirmation. The model must also honor locks and
intentional exceptions, and support 17 future agents without contract churn.

## Decision

1. **Findings are inert data.** `Finding` carries `type`, `severity`,
   `confidence`, `minStrictness`, `location`, `canonRefs`, optional advisory
   `suggestion`. Nothing in a finding mutates anything.
2. **Strictness is a runtime gate over finding metadata.** Agents stamp
   `minStrictness` (gentle/standard/strict) and `confidence`; `surfacesAt()`
   enforces confidence floors (0.9 / 0.7 / 0.4) against the project level.
   `off` means the agent is never invoked. Agents self-select at emit time;
   the runtime gate is authoritative.
3. **The only canon write path is writer-confirmed.** Agents emit
   `CanonProposal`; `CanonStore.applyConfirmed()` applies it after the writer
   approves. Only `confirmed` items feed the minimal-context selector.
4. **Writer memory is enforced centrally.** Dismissed finding ids and
   exceptions (by finding / passage / rule) live in `ProjectSettings`;
   `filterFindings` applies them so agents never re-raise suppressed items.
5. **Locks are inviolable.** Locked canon entries/characters/events never
   receive change proposals from agents, and contradictions with them are
   `major`+ severity.

## Consequences

- Agents stay pure functions: `(chunk, minimal context, strictness, settings) → findings`.
- Strictness tuning and UI policy changes never require agent rewrites.
- Minimal context (`selectRelevantContext`) is a replaceable heuristic behind a stable interface; v0 uses name/alias/tag matching plus always-on world rules.
- A file-backed canon store can replace `InMemoryCanonStore` without touching agents or the contract.
