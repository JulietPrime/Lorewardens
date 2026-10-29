# Decision Log

## 2026-10-29 - TypeScript monorepo via npm workspaces

**Context**: Greenfield repo, no commits. MCP server is the first MVP integration and a browser extension (Google Docs sidebar) follows.

**Decision**: TypeScript everywhere, npm workspaces, packages: core, agents, mcp-server, proof. Node >= 20, ESM, strict mode.

**Rationale**: The MCP TypeScript SDK is first-class; the future extension reuses the same `Finding`/`Canon` types from `@lorewardens/core`; one contract package prevents drift between agents and server. Full rationale in `architect/decisions/0001-typescript-monorepo.md`.

## 2026-10-29 - Findings and canon semantics (strictness as data, confirmation as write path)

**Context**: Core principles demand non-destructive findings, writer-owned canon updates, modular enable/disable, and off/gentle/standard/strict strictness.

**Decision**: Findings carry `minStrictness` + `confidence` and the runtime gates them (`surfacesAt`, confidence floors 0.9/0.7/0.4). Agents propose canon changes via `CanonProposal`; only `applyConfirmed` writes. Locks, exceptions, and dismissals live in `ProjectSettings` and are enforced by the findings pipeline.

**Rationale**: Agents stay stateless and read-only; writer decisions (dismiss/lock/exception) are enforced centrally so agents never need to re-learn them; strictness tuning never requires agent rewrites. Full rationale in `architect/decisions/0002-canon-and-findings-model.md`.

## 2026-10-29 - Builder routing order: MCP server first, then agents, then proof

**Context**: The manifest wires mcp-server and agents both to depend only on foundations, but both touch `packages/agents` (the server registers agents; the agents task replaces the stubs).

**Decision**: Route builders sequentially — expose-lore-agents-as-local-mcp-tools, then implement-three-continuity-agents, then prove-agents-catch-seeded-errors.

**Rationale**: Avoids two builders colliding in `packages/agents`; the proof suite (which depends on agents) lands last against the real implementations.
