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
text and confirmed canon entries they catch exactly four shapes of
contradiction (all in `packages/agents/src/lexical.ts` + `canon-lore.ts`):

1. **Negation-polarity conflict** — the text affirms what canon negates, or
   negates what canon affirms, while being about the same subject.
2. **Antonym swap** — a word in the text is a curated antonym of a word in
   the canon entry (sealed/open, north/south, always/never, careful/careless, ...).
3. **Numeric mismatch** — the text and the canon entry carry different
   concrete numbers for the same unit ("9 years" vs "3 years").
4. **Implicit full-retention contradiction** — the passage shows a caster
   keeping everything a confirmed cost rule says every casting costs
   ("remembered every detail of it afterward" after a casting action). The
   shape is eligibility-gated within one sentence: a confirmed rule-kind
   entry whose text states a cost, a casting action cue, a full-retention
   cue, and a domain link between the casting cue and the rule's own domain
   words. Clean prose that only casts, only remembers, pays the cost, or
   remembers a non-magic object stays silent.

On top of the four shapes, two agents add their own deterministic cue
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
| `She cast the ward and remembered every detail of it afterward.` | `canon-lore` → `canon-implicit-contradiction` (implicit full-retention: the locked rule says every spell costs a memory), ref `canon_rule_magic_memory` |
| `Daven flexed his sprained wrist, which had healed nicely since the fall.` | `character-consistency` → `injury-contradiction` (recovery cue vs canon injury), ref `char_daven` |

## What the engine does NOT catch today (known limits)

- **Implied contradictions beyond the full-retention shape.** The implicit
  matcher (shape 4 above) catches castings whose full retention contradicts
  a confirmed cost rule. Broader implied contradictions — irony, subtext,
  between-the-lines conflicts that use none of the cue tables — remain
  uncaught; a smarter engine can replace the matchers later (see
  `docs/agent-contract.md`).

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
| `canon_bootstrap` | `{ projectId, source: { kind: "text", text, label? } \| { kind: "file", path }, generatedAt?, outputPath? }` | `{ projectId, source: {kind, label, length}, generatedAt, snapshot, counts, notes, writtenTo? }` |

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

## Canon bootstrap: paste a story, get a draft canon

`canon_bootstrap` is the entry point for "I have a story, give me a starting
canon". It runs a deterministic, offline extractor over a pasted chunk (or a
local UTF-8 file) and returns a DRAFT snapshot in the exact canon fixture
shape, ready for the existing proposal -> writer-confirmation flow.

- Every item is `status: "proposed"` — nothing auto-confirms, and the
  fixture store is never touched (asserted by tests: `canon_list` output is
  byte-identical before/after any bootstrap call).
- Zero network anywhere in the path (grep-guarded in tests).
- The draft is written to disk only when the writer passes `outputPath`;
  existing files are never overwritten and no directory is ever created.
- Byte-deterministic: the same input (and `generatedAt`) yields
  byte-identical output; `generatedAt` defaults to a fixed constant and the
  confirmation flow re-stamps timestamps on apply.
- Events come out `precision: "fuzzy"` with no `date`, characters with no
  `birthDate` — writer-confirmed fields are never fabricated.
- Extraction is precision-first with modest recall by design; the curated
  cue tables, pinned behaviors and known limits live in
  `docs/canon-bootstrap.md`.

Example call:

```json
{
  "projectId": "my-novel",
  "source": { "kind": "text", "text": "Every gate closes at dusk. Mira said the road was closed." },
  "outputPath": "/home/writer/my-novel.canon.json"
}
```


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
