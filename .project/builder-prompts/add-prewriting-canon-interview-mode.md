# add-prewriting-canon-interview-mode — Builder Specification

AGENT_ROLE: builder
PROJECT: Lorewardens
BASE: develop a35b86730f0c208b809a3cbb178c86f8707e5928 (zero-trust: verify with `git ls-remote origin refs/heads/develop` before starting; see RIDER — the architect re-pins BASE at routing time if develop has moved, and states the final BASE in the spawn brief)

## Purpose

Owner-identified gap: canon is built from story text, but (a) text may already have drifted from the author's intended canon, and (b) writers starting book one have no text to extract from. A structured pre-writing interview closes both: the writer answers targeted questions (world rules, main cast, places, timeline anchors, hard constraints) and the answers become DRAFT canon proposals that feed the existing proposed→confirmation flow. Dynamic follow-ups are branching logic in a deterministic engine — no AI, fully offline. This pairs with `canon_bootstrap` as the two onboarding paths: start-from-text (bootstrap) or start-from-questions (interview).

Hard governance rules (inherited from canon_bootstrap, binding):
- NOTHING auto-confirms: every generated item is `status: "proposed"`. The canon store is never written by this task (zero store references in the tool handler).
- Explicit `outputPath` only; refuse to overwrite an existing path (the `wx`-style refusal canon_bootstrap uses).
- Fully offline: no network primitives anywhere in the interview path.
- Byte-deterministic: fixed-epoch `generatedAt` default (`"1970-01-01T00:00:00.000Z"`, the existing `DEFAULT_GENERATED_AT`), content-derived ids, same answers → byte-identical output files. No `Date.now`, no `Math.random`.
- Draft events NEVER carry `date` or `birthDate` fields — dates are writer-added at confirmation time (the landed T1 contract). Timeline anchors are proposed as events in interview order.
- No new agent: the interview is an engine + tool, not a 15th/16th agent. The agent roster and registry are untouched.

## Design Approach

A deterministic, stateless interview engine in `packages/core`, exposed as ONE new MCP tool `canon_interview`, plus a workflow doc. The session is stateless by construction: every tool call receives the ordered answers so far, and the engine is a pure function of (script, answers). The MCP host (Claude Desktop / Cursor) holds the transcript; the server holds nothing. This mirrors canon_bootstrap's statelessness and keeps the store untouched.

Structure:

```
packages/core/src/interview.ts            # engine + INTERVIEW_SCRIPT question/cue tables (exported data)
packages/core/test/interview.test.ts      # engine tests (script shape, branching, draft mapping, determinism)
packages/mcp-server/src/interview-tool.ts # tool definition (input schema, output shape, refusal semantics)
packages/mcp-server/test/interview-tool.test.ts  # tool tests (drive next/draft through the real tool path)
docs/canon-interview.md                   # the interview workflow: question tables + cue tables verbatim
```

## Key Implementation Details

### 1. Interview engine API (`packages/core/src/interview.ts`)

Pure exported functions plus exported data (all pinned by tests):

- `INTERVIEW_SCRIPT` — ordered question definitions. Five sections in fixed order: `world-rules`, `cast`, `places`, `timeline`, `constraints`. Each question: `{ id, section, prompt }`. Capture is plain text for every question in v1 (no choice lists — documented as a future extension; keeps determinism airtight).
- `interviewNext(answers)` → `{ done: false, question }` (the next question to ask, including any follow-up) or `{ done: true, missing }`. `answers` is `Array<{ questionId, text }>`.
- `interviewDraft(answers, options)` → the complete draft canon payload (entries, characters, events, and the minimal settings object) ready for the tool to write. Refuses (structured error) if the interview is incomplete or an answer is empty.
- Branching: each question def may carry `cues: Array<{ anyOf: string[], next: questionId }>`. When an answer contains any cue phrase (case-insensitive substring), the referenced follow-up question is asked IMMEDIATELY after that answer, before the next base question. At most ONE follow-up per answer, and follow-ups never trigger further follow-ups (max depth 1) — interviews are bounded. Where multiple cues match, the FIRST cue in the table's documented order wins (deterministic).
- Bootstrap governance is the template: look at `packages/core/src/bootstrap.ts` for the established patterns (fixed epoch, content-derived ids via the `uniqueId`/kebab discipline, `status: "proposed"` everywhere). You may IMPORT what bootstrap already exports; anything not exported is written locally in `interview.ts` with its own tests. `bootstrap.ts` itself stays BYTE-STABLE (see Allowed files).

### 2. Starting cue tables (precision-over-recall, small and documented)

These are the starting branches; refine wording as you implement, but the FINAL tables must be documented verbatim in `docs/canon-interview.md` and pinned by tests (at least one firing and one not-firing case per cue family):

- world-rules answer contains a cost/limit cue (`cost`, `price`, `limit`, `exhaust`, `run out`) → follow-up: what does using it cost, and what happens when it runs out?
- cast answer contains a relationship cue (`mother`, `father`, `brother`, `sister`, `rival`, `ally`, `mentor`, `enemy`) → follow-up: who else is involved, and how do they stand with each other?
- places answer contains a governance cue (`rule`, `ruled`, `capital`, `throne`, `govern`) → follow-up: who rules it, and is that rule contested?
- timeline answer contains an ordering cue (`before`, `after`, `when`, `first`, `then`) → follow-up: what happens first, and what follows it?
- constraints: terminal capture, no branching.

Base questions (one per section minimum, more if the tables need them): world rule(s) as stated by the writer; main cast (who matters); places (where it happens); timeline anchors (what happens, in order); hard constraints (what must never be violated in the story).

### 3. Draft canon generation (deterministic mapping)

`interviewDraft` maps answers to the EXACT fixture shape canon_bootstrap emits — `{ projectId, entries, characters, events }` — same schema of record as `packages/proof/fixtures/*.canon.json` and `packages/core/src/types.ts`. Never invent new kinds or fields; map to the existing schema:

- world-rule and constraint answers → canon entries, kind `rule`, `status: "proposed"`, unlocked (locking is writer-only at confirmation). Entry text/quote carries the writer's answer verbatim so the confirmation review shows provenance.
- places → canon entries kind `setting` (what the schema of record uses for places — check `types.ts`; do not invent a kind), `status: "proposed"`.
- cast → character objects (name + description from the answers).
- captured relationships → map to the schema of record's relationship representation if one exists; otherwise fold them into the character descriptions. Disclose which you did.
- timeline anchors → events with NO date/birthDate fields, in interview order.
- ids: content-derived, kebab/slug, collision-safe (same discipline as bootstrap's `uniqueId`).
- `generatedAt`: the fixed epoch default. `projectId`: writer-supplied or slugified from their stated story name; validated non-empty against the same rules fixtures use.
- Settings: the draft MUST load through the existing fixture-validation path unchanged (ac-4). If that path requires a settings file, emit a minimal `settings.json` next to the canon file (all agents at `standard`, optional checks off) — same `wx` refusal per path. Disclose what you emitted and why.

### 4. MCP tool `canon_interview`

New tool definition in `packages/mcp-server/src/interview-tool.ts`, registered in `packages/mcp-server/src/index.ts` immediately AFTER `canon_bootstrap` (registration order = emission order; the tool list pin extends additively). Input schema:

```
{ action: "next" | "draft",
  answers?: Array<{ questionId: string, text: string }>,
  outputPath?: string }            // required for action "draft"
```

- `action: "next"` → the next question (`{ done: false, question: { id, section, prompt } }`) or `{ done: true }` when the script is exhausted.
- `action: "draft"` → validates completeness, writes the draft canon (+ settings if required) to `outputPath` with existing-path refusal, returns `{ written: [...], counts: { entries, characters, events } }`. Refusals and validation errors come back as structured errors, never raw throws.
- The handler touches NO store, NO network, NO wall-clock time. Description text says what it does and that everything it produces is proposed-only and offline.

### 5. Region, pins, stability

- Pin edits are pre-authorized ONLY under the ruling-v2 additive clause: the server-bundle tool-list deepEqual in `packages/mcp-server/test/tools.test.ts` extends 16 → 17 (`"canon_interview"` appended after `"canon_bootstrap"`, every existing name byte-identical); the acceptance test files that pin the tool list (the same set canon_bootstrap extended 15 → 16 — find them with `grep -r "canon_bootstrap" packages/*/test`) extend the same way. The registry-derived pin is untouched; NO other pin changes are authorized. If any other pin fails: STOP and report.
- Out of region: `packages/core/src/bootstrap.ts` (byte-stable), the canon store and all confirmation paths, `schemas/`, `packages/agents/**`, `packages/proof/**` (including fixtures), `packages/bridge/**`, `packages/docs-extension/**`, and every existing test file not listed under Allowed files.
- Byte-stable: root `npm install && npm run build && npm test` exit 0, run twice with identical outcomes; offline everywhere (a dependency/forbidden-primitive scan over the new sources is part of the suite, mirroring the proof offline-scan pattern: no network primitives, no `Date.now`/`Math.random` in interview + tool sources).

## Allowed files (complete list — nothing else may change)

- NEW: `packages/core/src/interview.ts`, `packages/core/test/interview.test.ts`, `packages/mcp-server/src/interview-tool.ts`, `packages/mcp-server/test/interview-tool.test.ts`, `docs/canon-interview.md`
- EDIT: `packages/mcp-server/src/index.ts` (one registration line only), `packages/mcp-server/test/tools.test.ts` (server-bundle pin additive only), the acceptance test files pinning the tool list (additive 16 → 17 entries only)
- FORBIDDEN: everything else, including `packages/core/src/bootstrap.ts`, the store/confirmation code, `schemas/`, `packages/agents/**`, `packages/proof/**`, and all other existing test files.

## Acceptance Criteria

- [ ] ac-1: An interview session asks targeted questions across all five sections (world rules, main cast, places, timeline anchors, hard constraints) and captures answers as DRAFT canon proposals — every item `status: "proposed"`, nothing auto-confirms (zero store access in the tool handler, structurally verified).
- [ ] ac-2: Follow-up questions branch on prior answers via deterministic cue/question tables; the final tables are documented verbatim in `docs/canon-interview.md`; tests drive at least one firing and one not-firing case per documented cue family.
- [ ] ac-3: Draft output uses the exact fixture shape and the full governance set: explicit `outputPath` only with existing-path refusal, offline, byte-deterministic (same answers → byte-identical files; fixed-epoch `generatedAt`; content-derived ids), store untouched.
- [ ] ac-4: A completed interview's draft canon loads through the existing fixture validation unchanged and immediately anchors the continuity agents — proven in tests by driving `runAnalyzeTool` over a chunk containing a proposed rule and asserting the proposed canon reaches context.
- [ ] ac-5: Draft events never carry `date`/`birthDate`; interviews are bounded (documented max depth/length); root suite green twice identical.

## Test Instructions

1. `git ls-remote origin refs/heads/develop` — must show the BASE sha (or the architect's re-pinned BASE in the spawn brief); branch from it.
2. `npm install && npm run build && npm test` at repo root — exit 0, including the new engine + tool suites; run the root suite twice — identical outcomes.
3. `git diff --stat` vs base — only the allowed files above.
4. Drive a full interview through the real tool path (next → scripted answers → draft): inspect the output — all items proposed, events dateless; a second run with identical answers produces byte-identical files.
5. Load the draft through the existing fixture-validation path and call `runAnalyzeTool` on a chunk containing a proposed rule's text — `invoked: true` and the proposed canon reaches context.
6. Branch sensitivity: scratch-run the engine with a cue word removed from an answer — the follow-up is not asked; restore.
7. Refusal: draft to an already-existing path — structured refusal, no overwrite, no partial writes.
8. Offline/determinism scan: grep the new sources for network primitives and `Date.now`/`Math.random` — none.

## RIDER — process rules (binding)

1. ZERO-TRUST BASE: verify `git ls-remote origin refs/heads/develop` == the BASE sha before branching. If it differs from your brief's BASE, STOP and report to the architect via comm.
2. EXPLICIT-REFSPEC FETCH (proven sandbox fix): your sandbox's fetch refspec may be single-branch; network-visible SHAs can be invisible to local verification. Run `git fetch origin refs/heads/develop:refs/remotes/origin/develop` and, before any self-check submission, `git fetch origin refs/heads/build/add-prewriting-canon-interview-mode:refs/remotes/origin/build/add-prewriting-canon-interview-mode`.
3. REPORTING: report to the architect session (lor_jeremiahtheobald_archi-add-timeline-date-and-age-checks) via orq comm ONLY. Task comments do not reach your terminal; comm is the delivery channel.
4. SELF-CHECK: submit via the CLI at your branch tip; the CLI records the pushed tip. If a gate refuses (anchor/origin-family errors are known), do ONE verified retry (re-run the explicit-refspec fetch, re-verify with ls-remote, resubmit); if it refuses again, STOP and report — no retry loops.
5. BYTE-STABLE + DISCLOSURE: full suite green twice identical before self-check; verbatim disclosure of every judgment call or deviation in the self-check report.
6. ROUTING: this task routes via the orchestrator's reset+quality-start promotion when a workstream slot opens; the architect performs artifact-pin, spawn and quality-assign. The architect may re-pin BASE to a later verified develop head at routing; the zero-trust rule governs regardless.
7. PARALLEL-LANE: no sibling builder touches your region as of this spec. If a comm from the architect reports a landed change to `tools.ts`/`index.ts` or any pin surface, STOP and await the architect's second-lander rebase instruction before pushing.
