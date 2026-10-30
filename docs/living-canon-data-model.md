# Living Canon Data Model

The Living Canon is the writer's authoritative, structured record of what is
true in their story. "Living" means it grows and changes with the work — but
only through the writer's explicit confirmation. Agents read it; they may
propose changes; they never apply them.

## Ground rules

1. **Confirmation required.** Every canon write goes through a
   `CanonProposal` created by an agent (or the writer) and applied via
   `CanonStore.applyConfirmed()` only after the writer approves it.
2. **Confirmed canon is the only analysis context.** `proposed` and `retired`
   items never feed agent context.
3. **Locks are inviolable.** A locked item is a fact the writer declares
   fixed. Contradictions with locked items are reported at `major` or
   `critical` severity regardless of confidence tuning.
4. **Exceptions and dismissals are writer memory.** Dismissing a finding or
   marking a passage/rule intentional is stored in `ProjectSettings` and
   honored by the findings pipeline forever after.

## Entities

### CanonEntry (facts, rules, history, settings)

| Field | Meaning |
| --- | --- |
| `kind` | `fact` \| `rule` \| `history` \| `setting` |
| `text` | The established fact in the writer's words |
| `tags` | Keywords used by the minimal-context selector |
| `status` | `proposed` → `confirmed` → `retired` |
| `locked` / `lockReason` | Writer-locked: agents must never suggest changing it; contradictions are major+ |
| `sources` | Manuscript spans that established this fact |

### Character

`name`, `aliases` (both feed context matching), `summary`, `traits`,
`abilities`, `injuries`, `goals`, `voice` (speech patterns — consumed by the
Character Voice agent), `birthDate?` (writer-confirmed birth date, consumed
by the Timeline agent's age checks — see below), `relationships[]` (optional
relationship-state continuity), plus shared `status` / `locked` / `sources`.

### TimelineEvent

`description`, `order` (monotonic canonical ordering key), `precision`
(`moment` … `fuzzy` — "unclear" time jumps are findings even when not
impossible), `date?` (writer-confirmed date — see below),
`participants[]` (character ids), `location`, plus shared fields.

### Writer-confirmed dates

`TimelineEvent.date` and `Character.birthDate` are optional strings in strict
`YYYY | YYYY-MM | YYYY-MM-DD` form. `parseCanonDate` (packages/core/src/dates.ts)
validates format plus calendar sanity (month 1-12, day within the month,
leap-aware); anything that does not parse is treated as absent, so a typo
degrades to silence rather than a wrong finding. A `fuzzy`-precision event
never carries a date: fuzzy + date is read as undated.

The Timeline agent uses these fields for three checks — `date-contradiction`
(a conflicting year/month/season asserted for a dated event),
`duration-contradiction` (elapsed time or order between two dated events that
contradicts the canon dates), and `impossible-age` (an asserted age
contradicted by `birthDate` plus a dated event). Comparison rules: only
parseable-dated events participate (undated canon stays silent, exactly as in
increment 1); comparisons happen at the coarsest common granularity
(year-vs-month compares years only); duration units must be representable on
both canon dates (day units exact, month/year units flag off-by-≥1);
direction reversals are flagged even when amounts match; age tolerance is
±1 at coarser-than-day granularity (birthday rounding); computed ages below 0
or above 150 are always flagged. Contradicted locked canon escalates to
major/0.95/gentle, like all locked canon.

Deriving or resolving dates from relative cues in the manuscript ("three
winters later") is future work; writers confirm dates explicitly.

## Canon store

`CanonStore` (packages/core/src/canon.ts) exposes:

- `read(projectId)` — the confirmed snapshot agents see
- `settings(projectId)` — per-project agent enablement/strictness, exceptions, dismissed findings
- `applyConfirmed(proposal)` — the only write path; called **after** writer confirmation
- `addException`, `dismissFinding` — writer memory writes

v0 ships `InMemoryCanonStore` for development and tests; a file-backed store
per project follows before the MCP server task lands its README.

## Incremental analysis contract

Analysis input is always `(changed chunk, minimal canon context)`:

1. The caller supplies the changed text as a `TextChunk` with file + offsets.
2. `selectRelevantContext(chunk, snapshot)` selects only confirmed items
   relevant to that chunk: characters by name/alias mention, canon entries by
   tag match (plus all world `rule` entries, which are cheap and always
   relevant), timeline events by participant overlap.
3. Agents never see the whole manuscript and never re-derive canon.

This keeps checks fast enough to run on every save and is a hard contract,
not an optimization (see `docs/agent-contract.md`).
