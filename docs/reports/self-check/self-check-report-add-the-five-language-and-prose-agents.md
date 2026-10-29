# Self-Check Report: add-the-five-language-and-prose-agents

- **Task:** add-the-five-language-and-prose-agents
- **Role:** builder (`lor_jeremiahtheobald_build-add-the-five-language-and-prose-agents`)
- **Date:** 2026-10-29
- **Base:** `develop` @ `b10ef32aeeff84d7e08cb03360198cb56ed44359` (base refreshed mid-task per architect directive; original launch base `868079e`)
- **Branch:** session branch `build/agent-a2b79354df3a4d34145e`, pushed to `build/add-the-five-language-and-prose-agents`
- **Spec:** builder-artifacts/2212541c1f204d51a8c944e9a21a584e, sha256 `4f3055234e4d4a155298d3660134c57f320cb2335e8452040efad6e98eacbaee` (matches task metadata; full snapshot carried at launch)

## What was delivered

The five Language & Prose agents, deterministic and offline, behind the
unchanged agent contract, registered as MCP tools, proven by a dedicated
seeded-language fixture project — per the pinned spec:

1. **Contract extension** (`packages/core/src/types.ts` union lines only,
   `schemas/finding.schema.json`, `packages/mcp-server/src/validate.ts`,
   `packages/mcp-server/src/index.ts` → `ALL_AGENTS`): `ContinuityAgentId`
   gains the five ids; `Category` gains `language`/`prose`; schema enums and
   validator sets extended identically. No interface renames.
2. **Five agent files** in `packages/agents/src/` — one per agent, each with
   its closed tables as commented constants at the top:
   - `grammar-mechanics.ts` — `grammar-mechanical-error` (minor/0.9/gentle:
     doubled word, whitespace before `,.;:!?`, doubled `,`/`..` with
     ellipsis and `?!`/`!?` excluded, lowercase `i` and i-contractions) and
     `grammar-unbalanced-quotes` (minor/0.75/standard, chunk-scoped, located
     at the heaviest-quote sentence). Header documents the deliberate
     exclusions: missing sentence-final punctuation, comma splices, passive
     voice.
   - `vocabulary-repetition.ts` — `vocabulary-overuse` (info/0.7/standard:
     non-stopword stem ≥ 3 in chunk) and `vocabulary-echo` (info/0.55/strict:
     same stem ≥ 2 in one sentence); confirmed names/aliases excluded;
     tokens ≤ 2 not counted; messages state the pattern, never replacements.
   - `style-voice.ts` — `style-rhythm-shift` (info/0.55/strict: ≥ 4
     sentences, ≥ 3× chunk median and ≥ 20 words) and
     `style-formality-shift` (info/0.7/standard: ≥ 8 sentences, midpoint
     split, word-final contraction count differs ≥ 3 with deviant ≥ 3 and
     other ≤ 1, located at the first sentence of the deviant half).
   - `character-voice.ts` — `voice-drift` (minor/0.8/standard; locked
     character → major/0.95/gentle; `canonRefs: [character.id]`): avoid-phrase
     path (quoted phrase in `voice` text preceded by an avoid-cue, appearing
     in the character's quoted dialogue) and no-contraction cue path
     (closed cue list + word-final contraction in dialogue). Attribution
     heuristic documented: quoted span in a sentence that mentions the
     character's name/alias; internal thought counts when in italics-free
     quotes; unpaired double quotes (dialogue closed `." ` split by the
     sentence splitter) run to sentence end; single quotes pair-only.
     Graceful degradation without a voice field or usable cues.
   - `period-dialect.ts` — confirmed rule/setting pre-1900 gate (year
     `\b1[0-8]\d\d\b` or closed period-word list) and no modern-language
     intent entry; `period-anachronism` (minor/0.85/standard; locked gate →
     major/0.95/gentle) and `period-register-mismatch` (info/0.7/standard,
     no lock escalation); `canonRefs: [gate entry id]`; silent without gate.
   - `language-lexical.ts` was NOT needed: shared helpers come from
     `lexical.ts` imports (which was not edited); closed tables live in
     their agent files per spec.
3. **Registry** (`packages/agents/src/index.ts`): five descriptors (family
   `language`, defaultStrictness `standard`, `options: []`), five factories,
   `LANGUAGE_AGENTS` and `ALL_AGENTS` exports; `CONTINUITY_AGENTS`
   byte-identical. MCP server registers `ALL_AGENTS` → the five new
   `analyze_*` tools appear automatically (proven by a new additive bundle
   test).
4. **Fixture project** `packages/proof/fixtures/`: `proof-language.canon.json`
   (confirmed period rule `canon_rule_period_voice`; characters Elinor —
   avoid-phrase voice, Tam — no-contractions voice, Marda — no voice, for
   name-exclusion), `proof-language.settings.json` (five language agents
   enabled at standard, three continuity agents explicitly disabled),
   `manuscript/ch-language.md` (15 paragraphs: G1-G3, V1-V2, S1-S2, CV1-CV2,
   P1-P2 + 4 clean paragraphs exercising repeated names, balanced dialogue,
   contractions, period-safe diction). `proof.settings.json` and
   `proof-strict.settings.json` gained explicit `enabled: false` entries for
   the five new agents (modular disable keeps increment-1 tables stable).
5. **Proof surface** `packages/proof/test/language-proof.test.ts`: drives
   `runAnalyzeTool` over `proof-language` via the dist deep paths — standard
   catch table (9 rows: each seed → agent, type, canonRefs, severity; strict-
   only notes asserted silent), gentle matrix (only the gentle-pinned
   mechanical-error rows; every other seed silent), strict adds V2/S1 on top
   of the full table, clean paragraphs silent for all five agents at
   gentle/standard/strict, schema validation + manuscript-exact offsets +
   determinism asserted.
6. **Unit suite** `packages/agents/test/language-agents.test.ts` (26 tests):
   every finding type, every strictness level including off-silence, locked
   escalations (character + gate), attribution heuristic (alias, bare
   narration, unattributed quotes), period gate on/off/proposed +
   modern-intent switch-off, name exclusion, graceful degradation.
7. **Docs**: `README.md` increment list gains the language-roster line;
   `docs/agent-contract.md` Registry sentence now reads "Increment 2
   registers the three Continuity agents and the five Language & Prose
   agents (eight total)". No other contract text changed.

## Acceptance criteria

- [x] All five agents behind the existing contract, registered via
      `ALL_AGENTS`, each with its MCP tool
      (`analyze_grammar_mechanics`, `analyze_vocabulary_repetition`,
      `analyze_style_voice`, `analyze_character_voice`,
      `analyze_period_dialect`) — tool list pinned by the additive bundle test.
- [x] Grammar flags clear mechanical errors only; style-affecting checks
      absent and documented in the file header.
- [x] Vocabulary flags patterns only (threshold-gated), names excluded.
- [x] Style/voice, character-voice (with locked escalation), period gate +
      locked-gate escalation all proven at pinned strictnesses.
- [x] Finding schema + MCP validation enums extended; every finding from the
      five agents schema-validates (asserted in both suites).
- [x] Modular enable/disable proven: five agents disabled in the two
      increment-1 proof projects (their suites green unmodified apart from
      the ruled accommodations below) and enabled in `proof-language`.
- [x] Strictness matrix proven: gentle surfaces only the 0.9/gentle pins;
      strict adds the strict-only notes; clean paragraphs silent at all
      levels for all five agents.
- [x] `npm run build && npm test` green at repo root — run twice, identical
      results: core 26/26, agents 65/65, mcp-server 34 (32 pass + 2 ruled
      skips), proof 24/24.

## Ruled accommodations of increment-1 assertions (full disclosure)

All four were mandatory consequences of spec-mandated changes; each was
stopped-and-reported, then applied only under an explicit architect ruling.

1. **`packages/agents/test/agents.test.ts`** — the exhaustive
   `AGENT_DESCRIPTORS` deepEqual pinned the 3-continuity registry
   ("AGENT_DESCRIPTORS are unchanged"). The spec requires the five language
   descriptors IN the descriptor registry (`defaultSettings` derives from
   `AGENT_DESCRIPTORS`; `loadFixtureBundle` silently drops `enabled: false`
   overrides for unregistered ids, so modular disable and increment-1 proof
   stability depend on registration). Ruled by **descriptor-pin-ruling-v1**:
   expected array extended additively (3 continuity rows byte-identical in
   order, then the five language rows, same shape, `standard`), exhaustive
   deepEqual kept, message reworded to "AGENT_DESCRIPTORS pin the full
   registered roster (continuity + language)", no other edits in the file.
2. **`packages/proof/test/acceptance-seeded-errors.test.ts`** (three lines,
   ruled by **acceptance-seeded-errors-ruling-v1**, granted verbatim as
   applied):
   a. line ~219 `projectIds` pin `["proof", "proof-strict"]` →
      `["proof", "proof-language", "proof-strict"]` — the same pinned
      assertion the spec itself sanctions updating ("proof fixtures seed
      exactly the two proof projects"), which exists verbatim in both
      `proof.test.ts` (sanctioned file) and this file; order matches
      `loadFixtures`' sorted output.
   b. line ~243 `Record<Category, number>` literal gained `language: 0,
      prose: 0` (TS requires the widened union) with the deepEqual extended
      to pin both at zero — the increment-1 suite now also asserts it seeds
      NO language/prose errors; strictly stronger.
   c. the ac-7 offline-scan label array gained
      `"test/language-proof.test.ts"` in sorted position so the scan covers
      the new file; strictly stronger.
3. **`packages/mcp-server/test/acceptance-demo-parity.test.ts`** (QA-authored
   on the base refresh, ruled by **demo-parity-skip-ruling-v1**): two
   diff-scope pins — "packages/proof is byte-identical to develop (ac-5)"
   and the ac-6/ac-7 protected-path/allowed-set check — compare the demo
   task's committed diff and fail by design on any branch carrying later
   increments. Both now skip (visible `t.skip` reason naming
   `b10ef32aeeff84d7e08cb03360198cb56ed44359` and the discharge rationale;
   one comment block records why) iff HEAD strictly descends from the
   demo-parity revision or predates it; they still run at the demo-parity
   revision itself. Note: the ac-5 pin passed during mid-build runs only
   because the proof edits were not yet committed; after committing it trips
   by design, which is why both pins carry the guard.

## Judgment calls (spec-allowed, flagged)

- Exact message/suggestion wording, helper decomposition (one
  mechanical-error finding per sentence with a fixed pattern order; one
  anachronism/slang finding per sentence naming the first matching word).
- Sentence splitting reuses `lexical.ts` `sentences` throughout.
- Clean-paragraph texts in `ch-language.md` chosen to hold every tripwire
  (verified by the clean-silence test at all three levels).
- **Interpretation flagged for review:** the spec's fixture note says
  "gentle matrix (only G1)", but `grammar-mechanical-error` is ONE finding
  type pinned minor/0.9/gentle covering G1 (doubled word) and G2
  (space-before-comma) alike, and pins are binding ("Judgment calls NOT
  allowed: changing any severity/confidence/minStrictness pin"). The gentle
  matrix therefore surfaces exactly the two mechanical-error rows (G1, G2)
  and nothing else — implemented and asserted that way. Changing a pin to
  make "only G1" literal would have violated the stronger constraint.

## Shortcuts

None. No network calls, no new dependencies, no options beyond the empty v1
set, no interface renames, no edits to `lexical.ts`, `timeline.ts`,
`canon-lore.ts`, `character-consistency.ts`, or the parallel task's files
(`core/dates.ts`, `event-dates.ts`, TimelineEvent/Character blocks). The
analyze tool input schema is untouched.

## Verification performed

- `npm install && npm run build && npm test` at repo root, twice, identical:
  147 pass / 0 fail / 2 ruled skips across core (26), agents (65),
  mcp-server (34), proof (24).
- `npm test -w @lorewardens/agents` — language-agents suite covers every pin
  and heuristic (65/65 with the increment-1 suite).
- `npm test -w @lorewardens/mcp-server` — new tools listed (bundle test),
  validation accepts the new agent/category values, `enabled: false` still
  short-circuits (existing test), demo-parity suite green apart from the two
  ruled skips.
- `npm test -w @lorewardens/proof` — language catch table, gentle matrix,
  strict additions, clean silence, determinism, and the untouched
  increment-1 tables all green.
- `git diff b10ef32a --stat` audited against the allowed file list; only the
  files listed above (plus the four ruled accommodations) changed.
