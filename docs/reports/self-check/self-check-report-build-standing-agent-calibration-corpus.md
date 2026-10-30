# Self-check report — build-standing-agent-calibration-corpus

- Branch: `build/build-standing-agent-calibration-corpus`
- Base: `develop` `65a278c1406a9b1c42945896e09ca116751e719a` (verified via
  `git ls-remote origin refs/heads/develop` immediately before branching —
  exact match, no drift)
- Submitted revision: the pushed tip of the branch (SHA recorded by the CLI)
- Task: standing calibration corpus for `packages/proof` (artifact f41b5722 /
  sha 65766a81, as amended by the orchestrator routing overrides O1–O7)

## What was built

1. **Corpus subtree** `packages/proof/calibration/` — three repo-owned,
   fantasy-neutral, original stories, each with `canon.json` + `settings.json`
   (same schemas as `packages/proof/fixtures/*.canon.json` /
   `*.settings.json`) and a `manifest.json` regression contract
   (`catch` / `fp-guard` / `miss` seeds + `cleanPassages`), plus
   `triage/<story-id>.triage.json` records seeded from my initial run:
   - `cal-light-collision` — 8 paragraphs; fp-guards for verbatim-agreement
     (s1), token-collision light-vs-dark (s2), negation-on-shared-keywords
     (s3); 5 clean passages.
   - `cal-veiled-cost` — 7 paragraphs; two `catch` rows for
     `canon-implicit-contradiction` (wove/kept-every-memory; invoked/recalled-
     every-detail) against a locked memory-cost rule; 5 clean passages
     (cast-alone/paid-cost, remember-alone, spell-book, frame).
   - `cal-tidewright-names` — 9 paragraphs; two `catch` rows for
     `name-variant-drift` ('Tamsine' insertion, 'Tamzin' substitution —
     separate occurrences pin the stateless per-occurrence flagger), one
     fp-guard for POV thought-tags (single thought-tag attribution to the
     declared POV character stays silent); 6 clean passages.
   - All six required classes are covered; O2 resolved name variants to
     `catch` rows (the flagger is on develop at the base: `62f303e`).
2. **Runner** `packages/proof/test/calibration-corpus.test.ts` — data-driven,
   walks `calibration/stories/*` sorted, drives the real MCP tool path
   (`runAnalyzeTool` via the established deep imports; no mocks; offline),
   enforces per story: exact pinned catch rows (agent, category, type,
   severity, confidence, minStrictness, canonRefs, message, quote, offsets,
   suggestion; offsets slice `story.md`; `validateFinding` clean; cross-agent
   silence on catch paragraphs), fp-guard silence at gentle/standard/strict,
   miss silence with seed ids in CI test names, clean-passage silence at all
   three levels, structural integrity (four files per story dir, triage
   bijection, projectId equality, paragraph↔seed/clean bijection, expect
   offsets slice the story text, triage disclosure present), a stable
   manifest-derived known-misses table, and whole-corpus determinism (two
   full passes, byte-identical tables).
3. **Workflow doc** `docs/calibration.md` — RUN / TRIAGE / CONVERT / GATE /
   GROWTH, with the gate rule stated verbatim ("extends the existing proof
   gate"): every matcher/cue-table/guard change MUST run the full corpus
   before landing, mechanically enforced because the runner lives in root
   `npm test`.
4. **READMEs** — `packages/proof/calibration/README.md` (short corpus guide)
   and a pointer section appended to `packages/proof/README.md` (the
   optional edit the spec allows).

## Acceptance criteria

- ac-1 ✅ corpus structure exists as specified (3 stories × 4 files + triage).
- ac-2 ✅ triage workflow documented with the exact conversion rules and the
  landing-gate rule stated verbatim in `docs/calibration.md`.
- ac-3 ✅ three stories cover the four FP classes (token collisions,
  negation-on-shared-keywords, verbatim agreement, POV thought-tags) and the
  two miss-classes-turned-catches (implicit contradictions, name variants).
- ac-4 ✅ the runner is part of root `npm test` (proof workspace test glob);
  the gate rule is stated verbatim in `docs/calibration.md`.
- ac-5 ✅ additive by design (runner asserts structural integrity and walks
  sorted); whole-corpus determinism asserted byte-identical in-suite and
  verified across external runs; fully offline; repo-owned content only.

## Checks run (all on the submitted tree)

- `git ls-remote origin refs/heads/develop` → `65a278c…` exact match before
  branching; explicit-refspec fetch used throughout (O6).
- Root `npm install && npm run build && npm test` → exit 0; 533 tests
  passing, 0 failing (includes all pre-existing suites — zero leakage).
- Calibration runner run twice more beyond the in-suite double pass —
  normalized TAP output byte-identical between the two extra runs
  (normalization strips only per-test durations and the total duration_ms;
  all test names, counts and ordering identical).
- Sensitivity spot-checks (Test Instruction 5), both reverted afterwards:
  - Flipped `cal-veiled-cost` s1 expect `type` to `canon-contradiction` →
    runner failed exactly `calibration cal-veiled-cost catch s1 …`
    (13 pass / 1 fail). Reverted → green.
  - Mutated the `cal-light-collision` s2 fp-guard paragraph by injecting the
    antonym anchor word ("blackout") → runner failed exactly
    `calibration cal-light-collision fp-guard s2 …` (13 pass / 1 fail).
    Reverted → green.
- `git diff --stat` vs base: only the allowed files (see "Region" below).

## Judgment calls and deviations (verbatim disclosure)

1. **ac-7 offline-scan roster — one-line additive extension of an existing
   test file (the single edit outside the spec's allowed-file list).**
   Adding the spec-mandated `packages/proof/test/calibration-corpus.test.ts`
   necessarily changes the exact file-list pin inside
   `packages/proof/test/acceptance-seeded-errors.test.ts`
   (`"acceptance: proof sources are offline, dependency-clean and
   deterministic by construction (ac-7)"`). The spec's ruling-v2 pin clause
   pre-authorizes "additive extension of full-roster pins … where this task
   intentionally adds roster entries" (its "expected: NONE" parenthetical
   names agent/tool rosters — respected: no fixture-roster, projectIds, or
   agent-roster pin was touched; `loadFixtures` output is unchanged because
   the corpus lives outside `fixtures/`). Landed precedent did exactly this:
   `implicit-proof.test.ts` entered the same roster the same way. The edit is
   one roster entry + a two-word comment update; nothing else in the file.
2. **fp-guard s2 note corrected during the sensitivity proof.** The original
   manifest note claimed the token-collision guard paragraph was kept silent
   partly by "polarity-matching ('No light…')". Debugging the failed
   sensitivity mutation showed bare "no" is not an engine negation cue, so
   the negation shape was never in reach; the antonym subject-anchor guard is
   the sole load-bearing guard for that paragraph. The manifest note was
   rewritten to state this; the seed's passage, class, kind and assertions
   were unchanged.
3. **Enabled-agent set per story: canon-lore, character-consistency,
   pov-consistency** (explicitly enabled in every story's settings.json; all
   eleven other agents explicitly disabled). These are the three agents the
   six classes live in. timeline/plot-thread/etc. have no seeded classes in
   this increment.
4. **Paragraph-level chunks.** Each paragraph is analyzed as its own chunk
   with real file-relative offsets (the established proof-suite pattern);
   catch quotes/offsets are sentence-level spans within the paragraph,
   asserted against `story.md` (spec: "quote/offsets … against the manifest's
   story text").
5. **Catch rows pinned at standard** (the project strictness in every
   settings.json); fp-guard/clean/miss asserted at gentle, standard and
   strict per the spec contract. Gentle presence of catch rows is not pinned
   (row-dependent confidence floors; e.g. name-variant rows are 0.72 and
   silent at gentle by design — the scratch run confirmed this matches the
   engine).
6. **No `miss` seeds authored.** The spec (O2) reserves `miss` for genuine
   engine gaps discovered while authoring; none were found — the two
   miss-class topics are `catch` rows per O2. The miss mechanism is fully
   implemented and its (currently empty) table is pinned manifest-derived.
   No gap was manufactured to populate it.
7. **Variant coverage: two of four edit operations.** The corpus pins
   end-to-end behavior for insertion ('Tamsine') and substitution ('Tamzin')
   occurrences; transposition/deletion variants are not seeded here (the
   develop acceptance suite covers all four operations exhaustively; the
   corpus contract needs the six classes, not the rule table).
8. **Base override honored (O1).** Spec base 9ff1b714 was stale; built on
   the verified develop head 65a278c per the orchestrator override.
   `ls-remote` showed exactly 65a278c at branch time.

## Content disclosure

All three stories, all canon/settings fixtures, and all seeds are original
repo-owned content authored by the builder for this corpus — fantasy-neutral,
no text, characters, places or events from Wolves of the Revolution or any
owner manuscript. Each triage file carries this disclosure verbatim.
Fully offline; nothing auto-confirms (corpus fixtures are test fixtures, not
user canon); corpus growth never requires editing existing stories.

## Known limitations

- The corpus seeds exactly the six required classes; more stories/classes
  are expected to arrive via the documented growth workflow.
- The runner pins catch rows at the field level but does not pin finding
  `id`/`createdAt` (non-deterministic by design, excluded like in every
  existing proof suite's stable projections).

## Shortcuts

None. No mocks, no partial spec, no coverage theater, no skipped edge cases;
every expect row was scratch-verified against a real `runAnalyzeTool` run
before being pinned (rows were generated from actual engine output and the
runner re-proves them).
