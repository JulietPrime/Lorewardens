# Self-Check Report — expose-lore-agents-as-local-mcp-tools

**Task**: expose-lore-agents-as-local-mcp-tools (Expose lore agents as local MCP tools)
**Date**: 2026-10-29
**Revision**: pushed to `build/expose-lore-agents-as-local-mcp-tools` (SHA in the submission)
**Confidence**: 90

## What was implemented

Local stdio MCP server in `packages/mcp-server` (SDK `@modelcontextprotocol/sdk`
1.32.2, `zod` 3.25):

- `src/index.ts` — server assembly (`createLorewardensServer`), stdio main with
  direct-invocation guard; replaces the placeholder.
- `src/tools.ts` — tool builder + the analyze pipeline: strictness resolution
  (call input → project agent setting → descriptor default), enablement check,
  `selectRelevantContext` for minimal context, agent invocation, runtime
  re-gate via core `filterFindings` (strictness floor + dismissals +
  exceptions), finding validation before anything reaches a client.
- `src/store.ts` — `FixtureCanonStore` implementing core's `CanonStore`
  read-only: seeded from `fixtures/<projectId>.canon.json` (+ optional
  `<projectId>.settings.json` merged over descriptor defaults); every write
  method throws `ReadOnlyStoreError`; reads return defensive copies.
- `src/validate.ts` — finding validator mirroring `schemas/finding.schema.json`.
- `fixtures/demo.canon.json` + `demo.settings.json` — seeded demo project
  (2 characters, locked world rule, confirmed + proposed entries, 2 events).
- `scripts/smoke.mjs` — drives the real server binary over stdio with the MCP
  SDK client.
- `README.md` — run instructions, Claude Desktop / Cursor config snippet, tool
  table with inputs/outputs, fixture format, guarantees.
- Root `package.json` test script extended to the new workspace;
  `docs/architecture.md` + root README status updated.

## Acceptance criteria walk-through

| Criterion | Evidence |
| --- | --- |
| `npm install && npm run build` succeed at root | Clean-cycle run: wiped `node_modules` + all `dist/`, install + build OK |
| `npm start -w @lorewardens/mcp-server` launches on stdio | Server prints readiness line and serves while stdin is open; exits cleanly on EOF (correct stdio-transport semantics). Smoke drives the real client path |
| Each of the three agents callable as an MCP tool; findings match the schema | `analyze_canon_lore`, `analyze_character_consistency`, `analyze_timeline` registered; every returned finding passes `assertValidFindings` (schema-mirroring validator, itself cross-checked against `schemas/finding.schema.json` in tests); stub agents return `[]`, which is valid |
| `canon_list` returns the seeded confirmed canon snapshot | Returns snapshot + status counts (demo: entries 2 confirmed/1 proposed, characters 2, events 2) |
| No tool performs any write or network operation | `test/nonetwork.test.ts` scans shipped source + dist for network entry points (fetch/XHR/WebSocket/node:http/https/net/dns/tls/undici/axios — zero matches); every store write path rejects (`ReadOnlyStoreError`) asserted in two test files; handlers never receive write capabilities |
| Smoke script + `npm run smoke` | `scripts/smoke.mjs` lists tools, calls `analyze_canon_lore` (standard), `analyze_timeline` (off → `invoked: false` + reason), `canon_list`; prints structured results; exits 0 |
| README shows how to run + connect a local MCP client | `packages/mcp-server/README.md` |
| New behavior covered by tests in `packages/mcp-server/test/` via `npm test` | 21 tests across `store`, `tools`, `schema`, `nonetwork` — all green; root `npm test` runs core (7) + agents (2) + mcp-server (21) after a full rebuild |

Strictness semantics per contract: `off` → not invoked, empty result with
reason; strictness floors enforced twice (agents self-select, runtime re-gates
via `surfacesAt`/`filterFindings` — proven by the re-gate test where a
`strict`-level speculative note at standard strictness never reaches the
caller).

## Issues found and fixed during this task

1. **Stale binary layout**: the foundations-era placeholder built to
   `dist/index.js` (`rootDir: src`); the new layout compiles to
   `dist/src/`. The stale file shadowed the new server (`npm start` ran the
   placeholder). Fixed: package `main`/`bin`/`start` → `dist/src/index.js`,
   stale dist removed.
2. **Fixtures path** resolved one directory short (`dist/fixtures`);
   corrected to `../../fixtures` from `dist/src/`.
3. **Partial settings files** replaced the agent list wholesale; now merged
   over descriptor defaults per `agentId` (a settings file that disables one
   agent no longer silently disables the others).

## Known limitations (by design, not shortcuts)

- Agents are stubs returning `[]` — real analysis lands with
  `implement-three-continuity-agents`. The spec for this task explicitly says
  the stubs are correct here.
- Canon context is fixture-seeded per project; the file-backed store replaces
  it in a later task (spec requirement 5 anticipated this).
- `canon_list` returns the full snapshot *with* status fields (and counts) so
  the caller sees confirmation state; spec asked for "the confirmed canon
  snapshot" — statuses make that state explicit rather than hiding it.
- All three analyze tools are always registered; enablement is enforced at
  call time (disabled agent → clear reason, no invocation). This keeps the
  tool surface stable across projects while honoring per-project settings.

## Shortcuts

None. No mocked MCP layer in tests (the smoke test uses the real SDK client
and the real stdio binary; unit tests call the same handlers the server
registers).
