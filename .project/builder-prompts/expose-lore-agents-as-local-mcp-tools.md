# expose-lore-agents-as-local-mcp-tools: Local MCP server for the continuity agents

AGENT_ROLE: builder
PROJECT: Lorewardens

## Task

Implement a local MCP server in `packages/mcp-server` that exposes each
enabled continuity agent as a callable MCP tool. It must run entirely on the
writer's machine over stdio with no external permissions and no network
access, and return structured, non-destructive findings.

## Context

- Read first: `docs/agent-contract.md`, `docs/findings-schema.md`, `docs/living-canon-data-model.md`, `README.md`
- Contract to implement against: `packages/core/src/agent.ts` (`ContinuityAgent`, `AnalyzeInput`, `AGENT_CONTRACT_RULES`)
- Types: `packages/core/src/types.ts`; gating helpers: `packages/core/src/strictness.ts`, `packages/core/src/findings.ts`
- Agent descriptors and stub agents: `packages/agents/src/index.ts` (real agent logic lands in a later task — do NOT implement agent logic here; the stubs are correct for this task)
- Placeholder to replace: `packages/mcp-server/src/index.ts`
- MCP SDK: `@modelcontextprotocol/sdk` (add it to `packages/mcp-server/package.json`)

## Requirements

1. Server transport: stdio. Zero outbound network calls anywhere in the package.
2. Tools (one per enabled agent): `analyze_canon_lore`, `analyze_character_consistency`, `analyze_timeline`. Input: `{ projectId, chunk: { text, file, startOffset, endOffset }, strictness }`. `strictness` defaults to the agent's `defaultStrictness`; `off` returns an empty result with a short reason string.
3. Read-only companion tool `canon_list` returning the confirmed canon snapshot for a project (entries, characters, events).
4. Non-destructive by construction: no tool writes to the manuscript, the canon store, or settings; findings validate against `schemas/finding.schema.json`.
5. Canon context for tool calls comes from a canon store instance; for this task seed it from a JSON fixture file loaded from disk (per-project JSON under `packages/mcp-server/fixtures/<projectId>.canon.json` using the canon snapshot shape), so calls accept "new or changed text plus project context" end to end. A file-backed canon store will replace this later.
6. Use `selectRelevantContext` from `@lorewardens/core` to build the minimal context passed to agents.
7. `packages/mcp-server/README.md`: how to run the server and connect a local MCP client (e.g. Claude Desktop / Cursor config snippet), plus the tool list with inputs/outputs.

## Acceptance criteria

- [ ] `npm install && npm run build` succeed at repo root.
- [ ] `npm start -w @lorewardens/mcp-server` launches the server on stdio.
- [ ] Each of the three agents is callable as an MCP tool and returns findings matching `schemas/finding.schema.json` (empty arrays from stub agents are valid).
- [ ] `canon_list` returns the seeded confirmed canon snapshot.
- [ ] No tool performs any write or network operation (asserted by tests that inspect registered tool handlers and by grep-clean source).
- [ ] A smoke script `packages/mcp-server/scripts/smoke.mjs` drives one analyze tool call over stdio and prints the structured result; `npm run smoke -w @lorewardens/mcp-server` runs it.
- [ ] README shows how to run and connect a local MCP client.
- [ ] New/changed behavior is covered by tests in `packages/mcp-server/test/` (run via `npm test`).

## Out of scope

Real agent analysis logic (later task), file-backed canon store UI, Google Docs integration.
