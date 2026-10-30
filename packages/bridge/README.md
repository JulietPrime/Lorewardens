# @lorewardens/bridge

Loopback HTTP server that serves the existing Lorewardens engine to local
clients (the Google Docs extension). Same store, same `runAnalyzeTool`, same
enablement/strictness/confidence behavior as the MCP server path — byte-for-
byte parity, proven by tests.

- **Loopback only**: binds `127.0.0.1`, validates the `Host` header
  (`127.0.0.1[:port]` / `localhost[:port]`, DNS-rebinding guard).
- **Shared token**: generated on first start, persisted to
  `.lorewardens-bridge.token` (gitignored), required as
  `Authorization: Bearer <token>`.
- **Origin allowlist**: `Origin` must be a `chrome-extension://` origin; when
  `LOREWARDENS_EXTENSION_ID` is set, only that exact extension passes.
- **No egress**: the server only listens; the package has no outbound HTTP
  client usage (pinned by `test/offline.test.ts`, a mirror of the proof
  package's offline scan — chosen because the proof scan's shared builtin
  allowlist cannot admit `node:http` without loosening it).
- **Read-only**: fixtures load through the MCP server's `loadFixtures`; the
  bridge never mutates canon.

## Run

```bash
npm run build -w @lorewardens/bridge
npm start -w @lorewardens/bridge        # http://127.0.0.1:8765
```

## Routes

| Route | Method | Notes |
| --- | --- | --- |
| `/health` | GET | `{ ok: true, agents: <roster count> }` |
| `/analyze` | POST | body `{ projectId, text, spanStart?, strictness?, title? }` → `{ findings, invokedAgents, skipped: [{ agent, reason }] }` |
| `/settings/:projectId` | GET | resolved project settings (read-only passthrough) |

`spanStart` (default `0`) becomes the chunk's `startOffset`, so returned
finding offsets are **document-absolute** (UTF-16 code units — the same unit
Google Docs uses) with no client-side arithmetic. `title` labels
`finding.location.file` (the document title); it defaults to `"document"`.

The registry is iterated at runtime — the bridge is roster-agnostic and
never hard-codes agent counts.

## Environment

| Variable | Meaning | Default |
| --- | --- | --- |
| `LOREWARDENS_BRIDGE_PORT` | listen port | `8765` |
| `LOREWARDENS_BRIDGE_TOKEN_FILE` | token file path | `./.lorewardens-bridge.token` |
| `LOREWARDENS_EXTENSION_ID` | exact extension id for the Origin allowlist | (unset = any unpacked extension) |
| `LOREWARDENS_BRIDGE_FIXTURES_DIR` | fixtures directory | MCP server's fixtures |
