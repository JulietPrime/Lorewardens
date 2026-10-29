# Lorewardens — Architecture

System overview, component dependency map, and decisions live in the repo:

- `docs/architecture.md` — canonical architecture doc with component map and flow diagram
- `docs/living-canon-data-model.md` — Living Canon data model
- `docs/findings-schema.md` — findings schema and pipeline semantics
- `docs/agent-contract.md` — agent contract, strictness levels, incremental input rule
- `architecture/components.json` — machine-readable component dependency map (owned by the Architect)

## Component status snapshot

- **current**: core domain package, Living Canon store (v0 in-memory)
- **planned** (increment 1): three continuity agents, local MCP server, seeded-error proof suite
- **potential**: Google Docs integration (OAuth Testing mode), extended 14-agent roster

The repo is the single source of truth for architecture; this file only points at it.
