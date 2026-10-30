# Lorewardens

Modular multi-agent fiction continuity checking. Agents analyze fiction as it is
written and flag problems in specialized domains. The writer stays in their
existing tools, owns every creative decision, and can lock facts, dismiss
findings, or mark intentional exceptions. Agents never auto-rewrite.

## Principles

- **Incremental analysis only** — changed text plus minimal relevant canon context, never a full re-read.
- **Non-destructive findings** — structured reports with location, severity, explanation, optional suggestion. No edits without the writer asking.
- **Writer owns the Canon** — agents read confirmed canon and may only propose changes; the writer confirms every update.
- **Modular** — agents are enabled/disabled per project, each with strictness off / gentle / standard / strict.

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Domain types, strictness gating, canon snapshot/store, minimal-context selector, agent contract, registry |
| `packages/agents` | The agent implementations (increment 1: Canon/Lore, Character Consistency, Timeline) |
| `packages/mcp-server` | Local MCP server exposing agents as tools (stdio, no network) |
| `packages/proof` | Seeded-error proof suite: sample manuscript + automated tests |
| `docs/` | Architecture, Living Canon data model, findings schema, agent contract |
| `schemas/` | Language-neutral JSON Schemas (consumed by the future browser extension) |
| `.project/` | Specs, architecture map, decision log, builder prompts |

## Build and test

```bash
npm install
npm run build
npm test
```

## Status: increment 1

1. `design-lorewardens-foundations` — repo scaffold, architecture doc, Living Canon model, findings schema, agent contract (this commit)
2. `expose-lore-agents-as-local-mcp-tools` — local MCP server, done (stdio tools + read-only canon_list, fixture canon store, smoke script; see `packages/mcp-server/README.md`)
3. `implement-three-continuity-agents` — Canon/Lore, Character Consistency, Timeline, done (deterministic lexical matchers behind the same contract; `CONTINUITY_AGENTS` replaces the stubs)
4. `prove-agents-catch-seeded-errors` — done (seeded manuscript `packages/proof/fixtures/manuscript/ch4.md` proves standard strictness catches every seeded error through the real MCP tool path while clean passages stay silent; strictness matrix, strict-only notes, schema/offset and determinism asserted; see `packages/proof/README.md`)
5. `make-the-demo-match-the-engine` — done (demo honesty: `packages/mcp-server/README.md` documents the three detection shapes the engine really catches, with machine-proven sample sentences and the known limits incl. the implicit-contradiction false negative)
6. `add-the-five-language-and-prose-agents` — done (Grammar/Mechanics, Vocabulary/Repetition, Style/Voice Consistency, Character Voice, Period/Dialect/Language behind the same contract, registered via `ALL_AGENTS` as new MCP tools; every finding pin proven in the seeded `proof-language` fixture project)
7. `add-timeline-date-and-age-checks` — done (writer-confirmable `TimelineEvent.date` and `Character.birthDate` fields; the Timeline agent now flags `date-contradiction`, `duration-contradiction` and `impossible-age` against them, with locked-canon escalation and unchanged behavior for undated canon)

See `docs/architecture.md` for the component map and `docs/agent-contract.md` for the strictness semantics.
