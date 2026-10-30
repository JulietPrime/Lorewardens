# Lorewardens for Google Docs

An MV3 Chrome extension (loadable unpacked, no Marketplace listing) that runs
the Lorewardens agents **inside Google Docs**: findings surface as **native
Docs comments** and in a **side panel**, incrementally and non-destructively.
The document's text is never edited — comments are the only write surface.

```
Google Docs tab ──► extension (service worker)
                      │  documents.get (read-only scope)
                      │  Drive comments (drive.file scope)
                      ▼
              loopback bridge (@lorewardens/bridge, 127.0.0.1:8765)
                      │  same runAnalyzeTool / fixtures as the MCP server
                      ▼
              Lorewardens engine (@lorewardens/core + agents)
```

## 1. Start the bridge

```bash
npm run build -w @lorewardens/bridge
npm start -w @lorewardens/bridge
```

The bridge listens on **`http://127.0.0.1:8765`** (loopback only — it is not
reachable from other machines) and generates a shared token on first start,
persisted to `.lorewardens-bridge.token` (gitignored). Logs print the port,
the seeded project list, and the token file location.

Environment overrides:

| Variable | Meaning | Default |
| --- | --- | --- |
| `LOREWARDENS_BRIDGE_PORT` | listen port | `8765` |
| `LOREWARDENS_BRIDGE_TOKEN_FILE` | token file path | `./.lorewardens-bridge.token` |
| `LOREWARDENS_EXTENSION_ID` | pin the `chrome-extension://` Origin allowlist to one extension id | any unpacked extension |
| `LOREWARDENS_BRIDGE_FIXTURES_DIR` | canon fixtures directory | the MCP server's `packages/mcp-server/fixtures` |

Routes: `GET /health`, `POST /analyze` (`{ projectId, text, spanStart?, strictness?, title? }`),
`GET /settings/:projectId`. Every request needs `Authorization: Bearer <token>`;
non-loopback `Host` headers and non-`chrome-extension://` `Origin` headers are
rejected with `403` before the token check.

## 2. Load the extension unpacked

1. Build it: `npm run build -w @lorewardens/docs-extension`.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select `packages/docs-extension/dist/`.

The manifest carries a pinned `key`, so the unpacked extension always gets
the stable id **`mmmbfenncncclcoajepmfdfpfkdjnogj`** (the id is the first 32
hex digits of the SHA-256 of the pinned key's DER-encoded public part, mapped
`0-9a-f → a-p`). No icons are bundled; Chrome shows the default puzzle icon.

Host permissions are limited to `https://docs.googleapis.com/`,
`https://www.googleapis.com/` (Drive comments), and `http://127.0.0.1:8765/*`.
If you change the bridge port, update `host_permissions` in `manifest.json`
and rebuild.

## 3. Configure the options page

Open the extension's **Options** (Details → Extension options, or the link in
the side panel) and set:

- **Bridge URL** — `http://127.0.0.1:8765`
- **Bridge token** — the contents of `.lorewardens-bridge.token`
- **Google OAuth client id** — see the next section

The page shows the **extension ID** to give to the bridge's Origin allowlist
(`LOREWARDENS_EXTENSION_ID=<extension id>`), and a **Test bridge connection**
button that should report the registered agent count.

## 4. Owner setup: Google Cloud, consent screen, OAuth client

This is the `google-oauth-credentials-v1` owner dependency. In Testing mode
only — **no Marketplace listing, no verification flow** anywhere in this
project:

1. In the owner's [Google Cloud console](https://console.cloud.google.com/),
   create (or pick) a project and configure the **OAuth consent screen** with
   publishing status **Testing**.
2. Add the owner's account — plus anyone else who should be able to use the
   extension — as **test users** on the consent screen. Testing mode allows
   up to **100 test users**; anyone NOT on the list cannot complete the
   sign-in flow (that is the access control, and it is verified in the live
   E2E below).
3. Enable the **Google Docs API** and the **Google Drive API** for the
   project.
4. Create an **OAuth client ID** of type **Web application**. Under
   *Authorized redirect URIs* add exactly:
   `https://mmmbfenncncclcoajepmfdfpfkdjnogj.chromiumapp.org/`
5. Copy the client id (`….apps.googleusercontent.com`) into the extension's
   options page. The client id is public by design and is **never committed**
   to this repository — no client secret exists for this flow (implicit
   token flow via `chrome.identity.launchWebAuthFlow`).

Requested scopes are exactly:

- `https://www.googleapis.com/auth/documents.readonly` — read the document
- `https://www.googleapis.com/auth/drive.file` — read and comment on files
  the user opens with the extension

Sign-in tries the silent flow (`prompt=none`) first and falls back to the
account chooser only when that fails.

## 5. Using it on a document

1. Open a Google Doc, click the Lorewardens action — the side panel opens.
2. Pick the canon **project** (must be one of the bridge's seeded projects,
   e.g. `demo` or `proof`). The panel shows each agent's enabled state and
   strictness from `GET /settings/:projectId` (read-only — the panel never
   edits settings).
3. **Run full check** analyzes the whole first tab through the bridge and
   posts one comment per finding: `🔎 Lorewardens · <agent> · <severity>`,
   the finding message, and an embedded compact hash for dedupe. Comments
   carry a range anchor (document-absolute indices) and the quoted span.
4. A watcher (`chrome.alarms`, every 30 s while the panel is watching a doc)
   re-reads the document, diffs against the last snapshot, expands the change
   to enclosing paragraphs with at least a 1200-char context window, and
   analyzes only that region. Re-runs post **only new findings** — identical
   findings dedupe by hash. (Chrome alarms floor at 30 s; the Docs API has no
   push, so the watcher is poll-based and costs one `documents.get` per
   tick.)
5. **Clear Lorewardens comments** deletes only comments carrying the
   Lorewardens marker and authored by the current user. Nothing else is ever
   deleted, resolved, or edited.

## Known v1 limits (documented, by design)

- **Single tab only**: tabbed documents are analyzed on the first tab; the
  sidebar shows a notice when `documents.get` reports multiple tabs.
- **Comment anchors**: findings are posted through the Drive API v3
  `files.comments` with an anchor JSON string and the quoted text in
  `quotedFileContent.value`. Google's current guidance notes that editor
  apps may render Drive-created anchored comments as unanchored; the exact
  anchor payload is verified at the live E2E step below.
- **Polling, not push**: the Docs API has no change notifications.

## 6. Live E2E (gated on `google-oauth-credentials-v1`)

Everything in this repository builds and tests **offline** — no Google
credentials. The live pass runs once the owner's Testing-mode client exists:

1. Start the bridge; load the unpacked extension; configure the options page.
2. With an account **on** the consent-screen test list, open the seeded doc,
   run a full check — comments appear anchored to the seeded-error ranges
   with correct quotes; re-run — no duplicates.
3. Edit one paragraph — only that region's findings change.
4. **Clear Lorewardens comments** — only the marked comments disappear; the
   document text is unchanged throughout.
5. With an account **not** on the test list, confirm the OAuth flow cannot
   complete (Testing-mode access control), and confirm the bridge is
   unreachable from outside the machine (loopback bind).

## Development

- `npm run build -w @lorewardens/docs-extension` — `tsc` only (no bundler);
  the service worker is an ES module; static HTML is copied into `dist/`.
- `npm test -w @lorewardens/docs-extension` — offline `node:test` suites:
  the documents walker (index mapping incl. emoji), diff/region expansion,
  comment content/hashing, OAuth URL/redirect handling, and a fakes
  end-to-end (`FakeDocsClient` + the real bridge handler on an ephemeral
  loopback port + `FakeDriveComments`) asserting anchors, quotes, dedupe and
  clear-own-only deletion.
- The engine path (bridge) performs no outbound network calls; the bridge's
  offline scan (`packages/bridge/test/offline.test.ts`) pins that.
