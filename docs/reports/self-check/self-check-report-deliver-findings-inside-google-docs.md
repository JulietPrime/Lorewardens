# Self-check report — deliver-findings-inside-google-docs

- Revision: `147bf7cdd6feb8688d92b6852a409e246ab1c6ad` (branch `build/deliver-findings-inside-google-docs`, fast-forwarded onto the exact required base `8d30c4be8bc3f828f8a15832ce1982338c0d7cf3` before work)
- Spec artifact: `e9608e9909664759bd77e357ebd157b5` (repo commit fe981e8)
- Confidence: 80

## What was built

**`packages/bridge`** (new, zero runtime dependencies beyond the three workspace packages):
loopback-only `node:http` server bound to `127.0.0.1`, routes `POST /analyze`
(`{ projectId, text, spanStart?, strictness?, title? }` → `{ findings, invokedAgents, skipped }`),
`GET /settings/:projectId` (passthrough), `GET /health` (`{ ok, agents }`, count from the
registry at runtime — roster-agnostic). Guards unit-tested: shared token
(`Authorization: Bearer`, timing-safe compare, generated once, persisted to gitignored
`.lorewardens-bridge.token`), `chrome-extension://` Origin allowlist (exact extension id via
`LOREWARDENS_EXTENSION_ID`), DNS-rebinding `Host` guard, plus 400/404/405/413 handling with a
closed request shape (unknown fields rejected). Analysis iterates the registry and calls the
same `runAnalyzeTool` over the same fixture-backed store, so enablement, strictness floors,
confidence gating and the disabled not-invoked behavior are identical to the MCP path —
proven by parity tests (bridge HTTP response vs direct `runAnalyzeTool`, per agent, on the
seeded proof corpus incl. a strictness variant and the demo fixture; deterministic content
fields compared, `makeFinding`'s runtime `id`/`createdAt` projected out exactly as the proof
suite does). `spanStart` offset math asserted document-absolute (+500 shift, title in
`location.file`). No outbound egress anywhere in src (offline scan).

**`packages/docs-extension`** (new, MV3, loadable unpacked, `tsc` only, zero new dependencies):
pinned manifest `key` → stable id `mmmbfenncncclcoajepmfdfpfkdjnogj`; permissions
`sidePanel, storage, identity, activeTab, alarms` (alarms is required by the spec's mandated
`chrome.alarms` watcher); host permissions `docs.googleapis.com`, `www.googleapis.com`,
`http://127.0.0.1:8765/*`. Service worker (ES module) orchestrates auth/document/diff/bridge/
comments; side panel (project picker, read-only resolved settings display, findings list,
status, clear button, options link); options page (bridge URL + token, OAuth client id,
extension-ID display, connection test). Lib code is dependency-injected and Chrome-free:
index-driven `documents.get` walker producing `{ text, indexMap }` (gaps between runs become
`\n` at their real doc indices; no index convention hard-coded; emoji = 2 UTF-16 units; tables
and autoText handled; multi-tab flagged, first tab only per the documented v1 limit), LCP/LSF
diff with paragraph-boundary expansion and the closed 1200-char minimum context constant,
marker/hash comment content (FNV-1a, standard test vectors), Drive comments client
(list paginated / create / patch / delete) with the Docs-range anchor builder and
`quotedFileContent.value` quoting, `launchWebAuthFlow` OAuth (implicit token flow, silent
`prompt=none` first, interactive fallback, scopes exactly `documents.readonly` +
`drive.file`, Testing-mode guidance in the error), and a `pipeline.ts` orchestration core
(shared by the worker and the fakes E2E): full check, incremental check (first-observation
snapshot, unchanged no-op, padded-region analysis, dedupe by hash), and clear-own-only
comment removal. The document text is never written (DocsClient is get-only by interface).

**Tests** (all offline, no Google credentials): bridge 14/14 (guards, parity, spanStart,
settings, token persistence, gitignore pin, loopback bind, offline scan); extension 32/32
(walker incl. emoji/table/multi-tab, diff/expansion, comments/hashing, auth URL/redirect
parsing, and the fakes end-to-end over the REAL bridge handler on an ephemeral loopback
port: doc → findings → anchored marker comments with correct anchors/quotes → dedupe skip on
re-run → incremental edit re-runs only the padded region → clear removes only own marker
comments, human and foreign comments survive → doc JSON byte-identical throughout).

## Acceptance criteria

- [x] ac-1 — bridge loopback server with token/Origin/Host guards; `/analyze`,
      `/settings/:projectId`, `/health` with semantics identical to the MCP path (parity
      tests); no runtime deps beyond workspace packages; no egress (offline scan).
- [x] ac-2 — MV3 extension loads unpacked with a stable ID (pinned manifest key, documented);
      builds with `tsc` only; sidebar, options, background worker present.
- [x] ac-3 — `chrome.identity.launchWebAuthFlow`, options-page-configured web-application
      client id, scopes exactly documents.readonly + drive.file, silent-first; Testing mode
      only; no Marketplace/verification anywhere in code or docs.
- [x] ac-4 — findings appear as native Docs comments (marker line with agent/severity, type +
      message, hash; anchor + quoted span) and in the sidebar; text never edited; dedupe by
      compact hash; "Clear Lorewardens comments" removes only own marker comments.
- [x] ac-5 — incremental diff → paragraph-padded region (≥1200 chars) → bridge →
      document-absolute findings; manual "Run full check"; single-tab MVP, multi-tab notice
      documented.
- [x] ac-6 — offline suite green without credentials: bridge parity/guard tests, walker/
      diff/comments/auth unit tests, fakes E2E over the real bridge handler; offline scan
      covers `packages/bridge` (mirror file — see disclosures).
- [x] ac-7 — no secrets committed (bridge token gitignored + runtime-generated; client id
      options-only; only placeholder ids in code; manifest key is the public key required by
      the spec for a stable unpacked ID); bridge path performs no outbound network calls
      (scanned).
- [x] ac-8 — `packages/docs-extension/README.md` documents load-unpacked install, bridge
      startup, options configuration, the owner's Google Cloud/consent/client setup
      (referencing `google-oauth-credentials-v1`), the ≤100 test users flow, and the live E2E
      steps; `packages/bridge/README.md` covers the server.
- [x] ac-9 — **qualified**: `npm run build` green at root; per-workspace suites green and
      deterministic across two runs (core 25/26, agents 92/92, mcp-server 68 pass + 2
      pre-existing skips, bridge 14/14, proof 32/32, docs-extension 32/32). The root `npm
      test` chain currently fails in `packages/core` on a **pre-existing pin broken by this
      task's mandated new packages — disclosed below, NOT touched, awaiting your ruling.**

## BROKEN PIN — STOP and report (no edit applied)

`packages/core/test/acceptance-foundations.test.ts`, test *"ac-1: repo scaffold wires the
four workspace packages in dependency order"*, asserts:

```ts
const dirs = fs.readdirSync(path.join(root, "packages")).sort();
assert.deepEqual(dirs, ["agents", "core", "mcp-server", "proof"]);
```

This task's spec mandates two NEW workspace packages, so `packages/` now contains
`bridge` and `docs-extension` and this pin fails (`actual: ['agents','bridge','core',
'docs-extension','mcp-server','proof']`). It is not the pre-authorized offline-scan label
edit, so per the standing rule ("any other broken pin: STOP and report, never loosen") the
pin is untouched and reported. The same test's per-package loop (scoped name, ESM, build
script) passes for both new packages, and the per-package dep assertions for the original
four packages are unaffected.

Proposed additive resolution (requires your authorization; NOT applied): extend the expected
dir list to the six packages and add dep assertions for the two new ones
(`bridge → agents/core/mcp-server`, `docs-extension → bridge/core`) in the same additive
spirit as ruling v2.

## Disclosures (complete list)

1. **Offline-scan path**: the spec offers "extend the existing scan in
   `packages/proof/test/acceptance-seeded-errors.test.ts` if its mechanics accommodate a new
   package cleanly, otherwise add `packages/bridge/test/offline.test.ts` mirroring it;
   disclose which path." The proof scan pins exact per-file labels AND a shared
   node-builtin allowlist; admitting the bridge would require adding `node:http` (legitimate
   loopback server usage) to that SHARED allowlist, which would weaken the proof pin for the
   proof package itself — i.e. a loosening. Mechanics do not accommodate it cleanly, so the
   spec's fallback was taken: `packages/bridge/test/offline.test.ts` mirrors the scan
   (exact-label pin, builtin allowlist `node:crypto|fs|http|path|url`, workspace-only package
   imports, network/nondeterminism pattern bans, loopback-bind pin, exact dependency
   assertions). Test files are excluded from the scan because they quote the patterns as
   data, mirroring the existing `packages/mcp-server/test/nonetwork.test.ts` precedent. The
   proof test file is UNTOUCHED (zero pin edits in this task).
2. **mcp-server re-exports** (`packages/mcp-server/src/index.ts`, additive only):
   `runAnalyzeTool`, input type `AnalyzeToolArgs`, `loadFixtures`, `defaultFixturesDir`
   (needed to load "the same fixtures directory the MCP server uses"), and `FixtureBundle`.
   Nothing else re-exported. The bridge derives result typing via
   `Awaited<ReturnType<typeof runAnalyzeTool>>` to keep the re-export surface strictly to
   the listed functions and their input types.
3. **Payload verification** (spec: "this spec fixes the architecture, not the payload
   spellings"): the writable quoted-content field on Drive v3 comments is
   **`quotedFileContent.value`** (verified against developers.google.com Drive API v3
   comments reference; the spec's `quotedResourceContent` spelling is stale). Anchor is the
   opaque JSON string `{"r":"head","a":[{"start":N,"end":M,"ti":"<tabId>"?}]}`; rendering of
   Drive-created anchored comments in Docs editors is explicitly flagged in current Google
   guidance and is verified at the gated live E2E.
4. **Watcher interval**: `chrome.alarms` floors at 30 s (0.5 min), so the closed interval is
   30 s, not the spec's "e.g. 5 s" example; documented in the README with the polling cost
   (one `documents.get` per tick; Docs API has no push).
5. **`alarms` permission** added to the manifest because the spec's mandated
   `chrome.alarms` watcher requires it (spec's permission list did not name it).
6. **`title` request field**: `/analyze` accepts optional `title` (document title) so
   `span.file` can be the document title as the spec requires; the spec's body list is
   accepted unchanged without it (defaults to `"document"`). Unknown top-level fields are
   rejected with 400 (closed shape, security-positive).
7. **`chrome.d.ts`**: minimal hand-written ambient Chrome API typings instead of
   `@types/chrome` — avoids a new dependency; surface limited to what the worker uses.
8. **Workspace deps of docs-extension**: `@lorewardens/bridge` + `@lorewardens/core`
   (first-party, required by the spec's "in-process bridge" E2E; no third-party packages).
9. **package-lock.json**: mechanically regenerated by `npm install` to register the two new
   workspaces (36 added lines, 0 removed — verified as workspace entries + links only).
   Root `package.json` changes are exactly the build/test script additions from the allowed
   list.
10. **Pre-existing skips**: 2 mcp-server tests skip by their own self-declared discharge
    notes (demo diff-scope pins discharged at landing b10ef32; branch predates that
    revision). Unrelated to this task; unchanged.
11. **Root build order**: the two new packages are wired after `mcp-server` (bridge) and
    after `proof` (docs-extension, which imports bridge + mcp-server dist for its E2E).

## Known limitations

- Live OAuth E2E (across all of test-instruction #4 and the Testing-mode access-control
  check) is integration-time work, gated on `google-oauth-credentials-v1` as instructed.
- Multi-tab documents analyze the first tab only (documented v1 limit; sidebar notice).
- Comment anchor rendering in the Docs editor depends on Google's treatment of
  Drive-created anchors (see disclosure 3) — verified live.
