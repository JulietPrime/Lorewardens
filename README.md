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
2. `expose-lore-agents-as-local-mcp-tools` — local MCP server, in progress next
3. `implement-three-continuity-agents` — Canon/Lore, Character Consistency, Timeline
4. `prove-agents-catch-seeded-errors` — seeded manuscript proves standard strictness catches every seeded error while clean passages stay silent

See `docs/architecture.md` for the component map and `docs/agent-contract.md` for the strictness semantics.
