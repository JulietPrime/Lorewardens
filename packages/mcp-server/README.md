# @lorewardens/mcp-server

Local MCP server that exposes the Lorewardens continuity agents as callable
tools. Runs entirely on the writer's machine over **stdio** with **no network
access** and **no write paths**: findings are structured, non-destructive
reports, and every canon write requires writer confirmation outside this
server.

> Agent analysis logic ships in a later increment — the three agents are
> currently stubs that return zero findings. The tool surface, gating,
> context selection, and canon seeding implemented here are final.

## Run

```bash
npm install          # from the repo root
npm run build -w @lorewardens/mcp-server
npm start -w @lorewardens/mcp-server
```

The server speaks MCP over stdio and logs readiness to stderr:

```
[lorewardens] MCP server ready on stdio (no network). Tools: analyze_canon_lore, ...
```

## Connect a local MCP client

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lorewardens": {
      "command": "node",
      "args": ["/absolute/path/to/Lorewardens/packages/mcp-server/dist/src/index.js"]
    }
  }
}
```

Cursor / any MCP client that reads `mcp.json` uses the same shape. No env
vars, no network, no external permissions.

## Tools

| Tool | Input | Output |
| --- | --- | --- |
| `analyze_canon_lore` | `{ projectId, chunk: { text, file, startOffset, endOffset }, strictness? }` | `{ agent, projectId, strictness, invoked, findings[], findingsCount, contextSummary, reason? }` |
| `analyze_character_consistency` | same input | same output |
| `analyze_timeline` | same input | same output |
| `canon_list` | `{ projectId }` | `{ projectId, snapshot: { entries, characters, events }, counts, note }` |

- `strictness` is optional: `off \| gentle \| standard \| strict`. It defaults
  to the project's agent setting, then the agent's `defaultStrictness`
  (`standard`). With `off` the agent is **not invoked** — the result carries
  `invoked: false`, an empty `findings` array and a short `reason`.
- `findings` validate against `schemas/finding.schema.json`; `suggestion` is
  advisory and never applied. The runtime re-gates every finding
  (strictness level + confidence floor, dismissals, exceptions) before it is
  returned, per `docs/agent-contract.md`.
- `contextSummary` shows the minimal canon context selected for the chunk
  (confirmed items only; world rules always included). Agents never see the
  whole manuscript.
- Unknown `projectId`, malformed input, or a disabled agent produce clear
  error/reason text. Nothing mutates.

## Canon fixtures

Canon context is seeded at startup from JSON fixtures (a file-backed store
replaces this in a later task):

- `fixtures/<projectId>.canon.json` — a `CanonSnapshot`
  (`{ projectId, entries, characters, events }` as defined in
  `packages/core/src/types.ts`). Items carry their `status`
  (`proposed`/`confirmed`/`retired`), `locked` flags and `sources`.
- `fixtures/<projectId>.settings.json` (optional) — partial
  `ProjectSettings`: listed agents override the descriptor defaults
  (`enabled`, `strictness`, `options`); unlisted agents stay enabled at
  their defaults; `exceptions` and `dismissed` are honored by the findings
  pipeline.

`demo` is seeded out of the box: two characters (Mira the cartographer and
Daven her apprentice), a locked world rule (magic costs a memory), the
sealed Weeping Gate fact, and two timeline events — one deliberately
`proposed` so `canon_list` shows confirmation state. Add your own project by
dropping `<yourProject>.canon.json` into `fixtures/`.

The fixture store is read-only by construction: its write methods
(`applyConfirmed`, `addException`, `dismissFinding`) throw, and tests assert
that.

## Smoke test

```bash
npm run smoke -w @lorewardens/mcp-server
```

Builds the package, launches the real server binary, connects an MCP client
over stdio, lists tools, calls `analyze_canon_lore` (standard strictness) and
`analyze_timeline` (`off`), calls `canon_list`, and prints the structured
results. Exits non-zero on any failure.
