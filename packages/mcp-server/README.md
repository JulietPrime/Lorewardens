# @lorewardens/mcp-server

Local MCP server that exposes the Lorewardens continuity agents as callable
tools. Runs entirely on the writer's machine over **stdio** with **no network
access** and **no write paths**: findings are structured, non-destructive
reports, and every canon write requires writer confirmation outside this
server.

The three continuity agents are the real deterministic lexical matchers from
`@lorewardens/agents` (`CONTINUITY_AGENTS`). A smarter engine can replace the
matchers later without changing the tool surface (see `docs/agent-contract.md`).

## What the engine catches today

The matchers are deliberately simple, offline and deterministic. Between new
text and confirmed canon entries they catch exactly three shapes of
contradiction (all in `packages/agents/src/lexical.ts` + `canon-lore.ts`):

1. **Negation-polarity conflict** — the text affirms what canon negates, or
   negates what canon affirms, while being about the same subject.
2. **Antonym swap** — a word in the text is a curated antonym of a word in
   the canon entry (sealed/open, north/south, always/never, careful/careless, ...).
3. **Numeric mismatch** — the text and the canon entry carry different
   concrete numbers for the same unit ("9 years" vs "3 years").

On top of the three shapes, two agents add their own deterministic cue
checks: Character Consistency checks knowledge/recovery cues against
confirmed characters (abilities, traits, injuries), and Timeline checks
sequence cues ("before"/"after") and hedged wording ("sometime", "around
then") between mentioned canon events.

## Try these (every sample is machine-proven)

Each sentence below is asserted by `test/readme-samples.test.ts`: the test
runs the sentence through the real MCP tool path (`runAnalyzeTool`) against
the seeded `demo` project at standard strictness and requires exactly the
listed finding — and silence from the other agents. If the engine changes,
the test fails before this README can over-promise.

| Paste this into the `demo` project | You get |
| --- | --- |
| `Mira pushed through the Weeping Gate on the city wall, and found it standing open.` | `canon-lore` → `canon-contradiction` (antonym swap: canon says the gate is sealed), ref `canon_fact_weeping_gate` |
| `The Weeping Gate is not the only gate in the city wall.` | `canon-lore` → `canon-contradiction` (negation polarity), ref `canon_fact_weeping_gate` |
| `Daven swore the siege of the city lasted only 3 years.` | `canon-lore` → `canon-contradiction` (numeric mismatch: canon says 9 years), ref `canon_fact_siege_years` |
| `Daven flexed his sprained wrist, which had healed nicely since the fall.` | `character-consistency` → `injury-contradiction` (recovery cue vs canon injury), ref `char_daven` |

## What the engine does NOT catch today (known limits)

- **Implicit / full-retention contradictions.** The flagship demo rule —
  `canon_rule_magic_memory`, "Every spell costs the caster one personal
  memory; the stronger the spell, the more precious the memory lost" — is
  **not** flagged for the repro sentence:
  "She cast the ward and remembered every detail of it afterward."
  Remembering every detail contradicts a rule that every spell costs a
  memory, but the sentence carries no explicit negation, antonym or numeral,
  so today's matchers stay silent. That silence is asserted in
  `test/readme-samples.test.ts` too, so the limit is honest in both
  directions until the smarter matcher lands
  (`catch-implicit-contradictions-in-matchers`).

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
