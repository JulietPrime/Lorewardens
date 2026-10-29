# Findings Schema

Findings are the only output agents produce. They are structured, localized,
and non-destructive: nothing in a finding modifies the manuscript, and the
`suggestion` field is advisory text the writer may ignore.

The canonical machine-readable schema is `schemas/finding.schema.json`
(JSON Schema draft 2020-12). The TypeScript type is `Finding` in
`packages/core/src/types.ts`.

## Fields

| Field | Meaning |
| --- | --- |
| `id` | `fnd_<uuid>` — stable id; writers dismiss findings by id |
| `agent` | Producing agent: `canon-lore` \| `character-consistency` \| `timeline` |
| `category` | `canon` \| `character` \| `timeline` |
| `type` | Machine-readable problem type, e.g. `canon-contradiction`, `knowledge-violation`, `trait-contradiction`, `impossible-time-jump`, `unclear-time-jump`. Exceptions can suppress a whole type. |
| `severity` | `info` \| `minor` \| `major` \| `critical`. Contradictions with **locked** canon are `major`+. |
| `confidence` | 0–1. Gated by the strictness confidence floor. |
| `minStrictness` | Lowest strictness level at which the finding surfaces: `gentle` \| `standard` \| `strict`. |
| `message` | Human explanation of the problem. |
| `quote` | Exact excerpt from the manuscript. |
| `location` | `file`, `startOffset`, `endOffset`, optional `line`/`column`. Offsets enable the future Docs sidebar mapping. |
| `canonRefs` | Ids of the canon entries / characters / events involved. |
| `suggestion` | Advisory resolution or `null`. Never auto-applied. |
| `createdAt` | ISO-8601 timestamp. |

## Pipeline semantics

Findings pass through `filterFindings(findings, { strictness, settings })`
which applies, in order:

1. **Dismissal** — findings whose id the writer dismissed never resurface.
2. **Strictness gate** — `surfacesAt()` drops findings below the project's
   strictness level or under its confidence floor:
   - `gentle`: confidence ≥ 0.9, clear contradictions only
   - `standard`: confidence ≥ 0.7, all contradictions and inconsistencies
   - `strict`: confidence ≥ 0.4, adds speculative and low-confidence notes
3. **Exceptions** — writer-marked intentional items suppress matching
   findings by `finding` id, by `passage` (file), or by `rule` (finding type).

A dismissed finding stays dismissed; an exception stays honored. Agents do
not need to re-learn writer decisions — the pipeline enforces them.
