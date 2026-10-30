# Self-Check Report — add-the-three-optional-light-agents

- **Revision submitted:** `c34f861b6642f24374ab83a2845d119de2010b22` (branch `build/add-the-three-optional-light-agents`)
- **Base:** `8d30c4be8bc3f828f8a15832ce1982338c0d7cf3` (develop tip at branch time; narrative trio landed, increment-2 sequencing clause satisfied)
- **Baseline verified at branch time:** 11 agents / 12 tools. **After this task:** 14 agents / 15 tools.
- **Confidence:** 88

## Worktree anomaly (disclosed)

The platform seeded the task checkout at the increment-1 tip (`34c18ae`), which does not contain the
language or narrative rosters. The mandated base commit `8d30c4be` was present in the local object
store and verifiably carries the narrative trio (commit `b4b04f3`) and the 11/12 baseline, so the
task branch was moved to it (`git reset --hard 8d30c4be`) before any work began. No other branch was
created or switched to; all work is on the platform-assigned task branch.

## What shipped

Three Optional/Light agents behind the unchanged agent contract, off by default:

- `show-vs-tell` — light craft notes on narration only: `craft-emotion-label` (info/0.75/standard),
  `craft-exposition-block` (info/0.6/strict, strict-effective as declared),
  `craft-filter-phrase` (info/0.55/strict). Closed tables; one finding per sentence / per run at the
  run's first sentence; dialogue excluded; everything info severity with `suggestion: null`.
- `sensitivity-representation` — advisory only: `sensitivity-stereotype-phrase`
  (minor/0.9/gentle, gentle-effective), `sensitivity-broad-brush` (info/0.7/standard). Narration
  only; fictional-culture guard (canon entry text or confirmed character name/alias claiming a group
  term silences it); closed-table v1 limit documented in the file header; messages describe, never
  prescribe.
- `theme-motif` — silent until the writer marks motifs: confirmed kind-`"rule"` entries tagged
  `motif` (selector constraint respected; selector untouched). `motif-conflict`
  (minor/0.75/standard; locked escalates major/0.95/gentle) reuses the increment-1 helpers
  (`antonymConflict`, `aboutStatement`+`hasNegation`, `numericConflict`); `motif-recurrence`
  (info/0.55/strict, ≥3 word-boundary occurrences of significant terms in narration, names the
  terms). v1 limits documented in the file header.

Default-off mechanics: `AgentDescriptor.defaultEnabled?: boolean` (absent = true, no existing
descriptor changed); `defaultSettings()` resolves `enabled: d.defaultEnabled ?? true`;
`loadFixtureBundle` merges fixture settings over defaults so the four existing fixtures resolve the
trio disabled with zero edits to their settings files. `runAnalyzeTool` needed no change.

New files: `packages/agents/src/{show-vs-tell,sensitivity-representation,theme-motif,light-helpers}.ts`,
`packages/agents/test/{light-agents.test.ts,default-off-store.ts}`,
`packages/proof/test/light-proof.test.ts`,
`packages/proof/fixtures/proof-light.{canon,settings}.json`,
`packages/proof/fixtures/manuscript/ch-light.md`. `lexical.ts` untouched; selector untouched; no
existing agent implementation touched.

## Acceptance criteria

- **ac-1** ✅ Three agents implement the contract, exported (`OPTIONAL_AGENTS`, `ALL_AGENTS` extended
  in roster order), family `optional`, `defaultEnabled: false`, `defaultStrictness: "standard"`,
  `options: []`; MCP tools `analyze_show_vs_tell`, `analyze_sensitivity_representation`,
  `analyze_theme_motif` exist via programmatic registration (roster tool-list pins extended).
- **ac-2** ✅ `defaultSettings()` resolves the trio `enabled: false` and all 11 existing agents
  unchanged (pinned row-by-row); the four existing proof fixtures carry no light settings entries
  (asserted raw) and yield zero light findings at every level (not-invoked path plus a direct
  `agent.analyze` sweep over every paragraph of their manuscripts at gentle/standard/strict); no
  code path other than writer project settings writes `enabled: true` for a light agent.
- **ac-3** ✅ Emotion label surfaces at standard (0.75 ≥ 0.7, below gentle floor 0.9);
  exposition-block and filter-phrase strict-effective as pinned; all show-vs-tell findings info with
  `suggestion: null`; quoted dialogue excluded everywhere (unit + fixture).
- **ac-4** ✅ Stereotype phrase surfaces at gentle (0.9), broad-brush at standard (0.7); dialogue
  excluded; fictional-culture guard proven (canon entry, locked canon entry, character alias, and
  the claimed-term-skipped-unclaimed-reported case); no-prescription asserted by regex; v1 limit in
  the file header.
- **ac-5** ✅ Zero confirmed motif entries → silent at every level; kind rule + tag motif constraint
  proven (wrong kind / wrong tag / proposed → silent); conflict at standard with locked escalation
  major/0.95/gentle (surfaces at gentle); antonym and numeric paths fire through reused helpers;
  recurrence strict-only info at first matching sentence with named terms; `lexical.ts` untouched.
- **ac-6** ✅ `proof-light` enables exactly the trio at standard with all 11 other agents explicitly
  disabled; disabling any of the three in settings yields not-invoked `/disabled/` with zero
  findings and re-enabling restores findings; the trio contributes zero findings to all four
  existing proof projects at every level.
- **ac-7** ✅ Every finding validated against `schemas/finding.schema.json` in both new suites
  (`validateFinding` on the tool path; schema cross-check in the unit suite).
- **ac-8** ✅ All pre-authorized pin updates applied as described; every edit disclosed verbatim
  below; nothing outside the allowed list changed except the four standing-clause full-roster pins
  and one test helper, both disclosed below.
- **ac-9** ✅ `npm run build && npm test` at repo root, run twice, identical results:
  core 26 pass / 0 fail; agents 118 pass / 0 fail; mcp-server 69 pass / 0 fail (2 pre-existing
  skips, present before this task); proof 42 pass / 0 fail.

## Per-workspace test counts (both runs identical)

| Workspace   | tests | pass | fail | skipped |
| ----------- | ----- | ---- | ---- | ------- |
| core        | 26    | 26   | 0    | 0       |
| agents      | 118   | 118  | 0    | 0       |
| mcp-server  | 71    | 69   | 0    | 2 (pre-existing) |
| proof       | 42    | 42   | 0    | 0       |

## Pin-update disclosure (verbatim, per standing ruling v2)

All pin edits are additive: existing values byte-identical in existing order, new entries appended
in the order the shipped artifact emits, numeric pins take exact new values, no assertion loosened,
no runtime-derived expectation introduced. Items 1–11 are the spec's pre-authorized list; items
12–15 are additional full-roster pins covered by the standing clause ("any other full-roster pin …
extend additively and disclose verbatim"); item 16 is a new test helper file.

1. `packages/agents/test/agents.test.ts` — exhaustive `AGENT_DESCRIPTORS` deepEqual: 11 existing
   rows byte-identical and in order, appended:
   `["show-vs-tell", "optional", "Show vs Tell / Craft", "standard"]`,
   `["sensitivity-representation", "optional", "Sensitivity / Representation", "standard"]`,
   `["theme-motif", "optional", "Theme / Motif", "standard"]`; pin message reworded to
   `"AGENT_DESCRIPTORS pin the full registered roster (continuity + language + narrative + optional)"`.
2. `packages/agents/test/language-agents.test.ts` — `ALL_AGENTS` deepEqual extended with
   `...OPTIONAL_AGENTS.map((a) => a.id)`; `OPTIONAL_AGENTS` added to the existing import.
3. `packages/mcp-server/test/acceptance-language.test.ts` (ac-1) — `registry.list().length` pin
   `11` → `14`; message `"eleven agents registered in total"` → `"fourteen agents registered in
   total"`; roster array extended with `"show-vs-tell"`, `"sensitivity-representation"`,
   `"theme-motif"` after `"pov-consistency"`; message reworded.
4. `packages/mcp-server/test/acceptance-language.test.ts` (ac-1 tool list) —
   `"analyze_show_vs_tell"`, `"analyze_sensitivity_representation"`, `"analyze_theme_motif"`
   appended before `"canon_list"`.
5. `packages/mcp-server/test/acceptance-language.test.ts` (ac-5 schema enums) — agent enum expected
   array extended with the three light ids; message `"…the eleven registered ids"` → `"…the
   fourteen registered ids"`; category enum expected array extended with `"optional"` in sorted
   position: `["canon", "character", "language", "narrative", "optional", "prose", "timeline"]`;
   added `assert.ok(categoryEnum.includes("optional"), "optional category present")`.
6. `packages/mcp-server/test/acceptance-language.test.ts` (ac-6) — shipped-proof-projects
   `projectIds` deepEqual: `["proof", "proof-language", "proof-light", "proof-narrative",
   "proof-strict"]` (`"proof-light"` in the loader's sorted position, between `"proof-language"`
   and `"proof-narrative"`).
7. `packages/mcp-server/test/tools.test.ts` — full-roster tool-list pin gains the three
   `analyze_*` tools before `"canon_list"`; title reworded to "…plus optional tools".
8. `packages/mcp-server/test/schema.test.ts` — new additive test "validator accepts the
   optional-roster agents and category (additive)": the three agent ids with category `optional`
   validate; unknown agent `"ethics-engine"` and unknown category `"sensitivity"` still rejected.
9. `packages/proof/test/proof.test.ts` — `projectIds` pin gains `"proof-light"` (sorted).
10. `packages/proof/test/acceptance-seeded-errors.test.ts` — `projectIds` pin gains
    `"proof-light"` (sorted; message reworded "language, narrative and optional proof projects");
    `Record<Category, number>` literal gains `optional: 0` and the counts deepEqual gains
    `optional: 0` (`{ canon: 3, character: 4, timeline: 3, language: 0, prose: 0, narrative: 0,
    optional: 0 }`); ac-7 offline-scan labels array gains `"test/light-proof.test.ts"` in sorted
    position.
11. `packages/proof/test/language-proof.test.ts` — `projectIds` deepEqual gains `"proof-light"`
    (sorted); test title reworded "all four projects" → "all five projects".
12. **(standing clause)** `packages/agents/test/narrative-agents.test.ts` — `ALL_AGENTS` deepEqual
    extended with `...OPTIONAL_AGENTS.map((a) => a.id)`; `OPTIONAL_AGENTS` added to the existing
    import.
13. **(standing clause)** `packages/mcp-server/test/acceptance-narrative.test.ts` — five pin edits:
    `OPTIONAL_IDS` const added and `ALL_IDS` extended additively (the QA fixture settings builder
    consequently emits explicit `enabled: false` rows for the trio, matching default-off);
    registry length pin `11` → `14` with messages reworded ("fourteen agents registered in
    total"; roster message → "…the three optional agents close the roster"); `ALL_AGENTS` roster
    deepEqual extended with `...OPTIONAL_IDS`; `AGENT_DESCRIPTORS.length` pin `11` → `14` with the
    narrative rows now asserted as `slice(8, 11)` (byte-identical shape preserved) and a new
    additive assertion pinning the three optional rows at `slice(11)` including
    `defaultEnabled: false` (title reworded "sit ahead of the optional rows"); tool list gains the
    three `analyze_*` tools before `"canon_list"`; schema agent enum expected array gains
    `...OPTIONAL_IDS` (message → "fourteen registered ids") and category enum expected array gains
    `"optional"` in sorted position; shipped-`projectIds` deepEqual gains `"proof-light"` (sorted).
    The ac-7 disclosure-grep assertions (`/narrative: 0/`, `/"test\/narrative-proof\.test\.ts"/`,
    `/proof-narrative/` in proof.test.ts, `/continuity \+ language \+ narrative/` in agents.test.ts)
    all still pass unchanged.
14. **(standing clause)** `packages/mcp-server/test/store.test.ts` — descriptor-defaults pin: title
    reworded to "projects without a settings file default to descriptor defaults: existing agents
    enabled, optional agents off"; the enabled/strictness row pin is now
    `[...AGENT_DESCRIPTORS.slice(0, 11).map((d) => [true, d.defaultStrictness]),
    [false, "standard"], [false, "standard"], [false, "standard"]]` (existing 11 rows exact and in
    order; the trio pinned off at standard). The preceding `deepEqual(bundle.settings.agents,
    defaultSettings("bare").agents)` is unchanged.
15. **(standing clause)** `packages/proof/test/narrative-proof.test.ts` — `projectIds` deepEqual
    gains `"proof-light"` (sorted).
16. **(new helper, disclosed)** `packages/agents/test/default-off-store.ts` — required by the spec's
    placement of the default-off mechanics tests inside `packages/agents/test/light-agents.test.ts`:
    the agents workspace builds before `@lorewardens/mcp-server` in the root build order, so a
    static import of the store module would break clean checkouts. The helper loads the real
    shipped `@lorewardens/mcp-server/dist/src/store.js` through a computed dynamic specifier
    (resolved at test runtime, after the root `npm run build` step) and exposes
    `defaultSettings`/`loadFixtureBundle` unaltered. No behavior is mocked or reimplemented.

## Known limitations (declared, not shortcuts)

- Closed tables are deliberately narrow (emotion labels, exposition cues, filter phrases,
  stereotype phrases, real-group lexicon, motif stopwords) — v1 limits documented in each file
  header; the sensitivity agent is not an ethics engine.
- Motif recurrence is chunk-internal only (the incremental contract has no cross-chunk state);
  unmarked-motif discovery is out of scope and not faked.
- Pin `confidence`/`minStrictness` values are strictly effective per the floors (gentle 0.9,
  standard 0.7, strict 0.4): exposition-block (0.6) and filter-phrase (0.55) are strict-effective;
  emotion-label (0.75) and broad-brush (0.7) are silent at gentle. Declared per spec; no confidence
  was inflated.

## Shortcuts

`[]` — none.
