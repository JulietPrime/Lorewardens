# Decision 0001: TypeScript monorepo via npm workspaces

**Status**: Accepted
**Date**: 2026-10-29

## Context

Lorewardens is greenfield. The MVP requires a local MCP server ("runnable
locally with no external permissions") and the roadmap adds a Google Docs
browser extension. Seventeen writer-selectable agents across five families
will eventually share one behavior contract.

## Options considered

1. **TypeScript monorepo (chosen)** — npm workspaces; packages core / agents / mcp-server / proof.
2. Python monorepo — strong NLP ecosystem, but MCP SDK and extension tooling are TS-first; two languages for one contract.
3. Single-package TypeScript — simpler now, but agent/server/proof boundaries would erode and the extension would import everything.

## Decision

TypeScript monorepo, npm workspaces, ESM, Node >= 20, `strict` TS. Four
packages with one dependency direction: proof → mcp-server → agents → core.

## Consequences

- The future browser extension imports `@lorewardens/core` types directly (findings, canon, settings).
- The MCP TypeScript SDK (`@modelcontextprotocol/sdk`) is a first-class dependency for `mcp-server` (added by that task).
- Shared JSON Schemas (`schemas/`) keep non-TS consumers honest.
- npm workspaces avoid adding a non-standard toolchain dependency for builders.
