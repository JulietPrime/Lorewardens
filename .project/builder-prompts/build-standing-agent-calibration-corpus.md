# build-standing-agent-calibration-corpus — Builder Specification

AGENT_ROLE: builder
PROJECT: Lorewardens
BASE: develop 9ff1b714d8753c494ebd8aa39772bffd9e56e898 (zero-trust: verify with `git ls-remote origin refs/heads/develop` before starting; see RIDER)

## Purpose

The owner wants purpose-built stories run through the agents as ONGOING calibration: spot issues, triage findings (true positive / false positive / missed), and turn each triaged item into a permanent regression fixture. The agents are deterministic (cue tables + guards), so "training out" issues means matcher changes proven against the whole corpus — this makes those changes safe and catches regressions the moment they appear. The task extends the existing seeded-error proof pattern (`packages/proof`) into a standing, growing library. The owner filed this HIGH priority and plans to keep feeding stories indefinitely — the corpus is additive by design.

Hard governance rules: repo-owned stories ONLY (no private novel content — nothing from Wolves of the Revolution or any owner manuscript); fully offline; nothing auto-confirms (corpus fixtures are test fixtures, not user canon); corpus growth never requires editing existing stories.

## Design Approach

A data-driven corpus subtree + one runner test in `packages/proof`, plus a triage-workflow doc. No engine changes: every package's `src/` is out of region. If corpus authoring reveals an engine gap, the gap is RECORDED (as a `miss` seed or a task proposal to the architect), not fixed here.

Structure:

```
packages/proof/calibration/
  README.md                     # what the corpus is, how to add a story (short; deep workflow lives in docs/calibration.md)
  stories/
    <story-id>/
      story.md                  # repo-owned purpose-built story (6-12 paragraphs, natural prose)
      canon.json                # fixture shape: { projectId, entries, characters, events } — same schema as packages/proof/fixtures/*.canon.json
      settings.json             # same schema as packages/proof/fixtures/*.settings.json
      manifest.json             # seeded issues + expectations (the regression contract)
  triage/
    <story-id>.triage.json      # triage records (seeded with the builder's own initial run)
```

`<story-id>`: kebab-case, stable, never renamed once a story exists (additive-by-design). Each story is its own projectId (e.g. `cal-light-collision`), namespaced `cal-` so no existing fixture projectId can collide.

## Key Implementation Details

### 1. Manifest format — the regression contract

`manifest.json` per story:

```json
{
  "projectId": "cal-<name>",
  "story": "story.md",
  "seeds": [
    {
      "id": "s1",
      "class": "token-collision",
      "kind": "fp-guard",
      "paragraph": 3,
      "note": "why this passage must stay silent"
    },
    {
      "id": "s2",
      "class": "implicit-contradiction",
      "kind": "catch",
      "paragraph": 5,
      "expect": { "agent": "canon-lore", "type": "canon-implicit-contradiction", "canonRefs": ["canon_..."] }
    },
    {
      "id": "s3",
      "class": "name-variant",
      "kind": "miss",
      "paragraph": 7,
      "expect": null,
      "note": "known gap: no name-variant flagger on develop at authoring time"
    }
  ],
  "cleanPassages": [4]
}
```

- `kind: "catch"` — the engine MUST surface the seeded issue; `expect` pins the full finding row (agent, type, canonRefs, and quote/offsets are asserted against the manifest's story text).
- `kind: "fp-guard"` — a passage seeded to LOOK like a known FP class that MUST stay silent (invoked=true, zero findings on that paragraph's span). This is the regression pin against FP recurrence.
- `kind: "miss"` — a known engine gap: MUST stay silent TODAY, with a note. Flips to `catch` in the SAME change that teaches the engine (see triage workflow). A `miss` never silently becomes a catch without a manifest edit — that edit IS the regression-proof moment.
- `cleanPassages` — paragraphs with no seeded issues: silent at gentle, standard and strict.

### 2. Runner — `packages/proof/test/calibration-corpus.test.ts` (new)

Data-driven: walk `packages/proof/calibration/stories/*` (sorted deterministically), per story drive the REAL MCP tool path (`runAnalyzeTool`) exactly like the existing proof suites do (import via the established deep paths; no mocks; offline). Assert per story:

- every `catch` seed: exact finding row per the manifest expect block;
- every `fp-guard` seed: the paragraph span produces zero findings;
- every `miss` seed: still silent, and reported in a stable "known misses" table (test name/listing includes the seed ids so the flip is visible in CI output);
- clean passages: silent at gentle, standard, strict;
- determinism: the whole corpus run executes twice in the suite and the finding tables must be byte-identical;
- structural guard: every story dir contains all four files; manifest projectId matches canon.json projectId; seed paragraph references resolve inside story.md (fail loudly on drift).

The runner is part of the proof workspace, so root `npm test` runs it — which is what makes acceptance criterion "every matcher change validated against the full corpus before landing" mechanically enforced by the existing receipt chain (self-check, architect review, and QA all run the root suite).

### 3. Seed stories — at least three, covering the six known classes

Three (or more) repo-owned stories. The six classes that MUST be covered across them:

- FP classes (as `fp-guard` seeds): token collisions (`'light'` the magic system vs dark/light adjectives — the owner's Wolves-of-the-Revolution FP class, re-authored as repo-owned content), negation-on-shared-keywords, verbatim-agreement-flagged-as-contradiction, POV thought-tags.
- Miss classes: implicit contradictions (`catch` — the implicit shape landed with the matcher upgrade; pin a real catch row), name variants (`kind` decided by your base: see the parallel-lane clause in the RIDER).

Authoring rules: natural prose (no comment markers in the story text — seeds are located by paragraph number, mirroring the existing proof fixtures); every paragraph maps to exactly one seed or cleanPassages entry; canon fixtures are complete enough for the expected agents to fire (confirmed entries/characters/events where needed); stories are fantasy-neutral original content authored by you, disclosed as original in the triage file.

### 4. Triage workflow — `docs/calibration.md` (new)

The durable process document. Contents, exactly:

1. RUN: `npm test -w @lorewardens/proof -t calibration` (or root npm test) — corpus green means manifest matches engine.
2. TRIAGE: the owner (or architect relaying the owner) records findings triage in `calibration/triage/<story-id>.triage.json`:
   ```json
   { "storyId": "cal-<name>", "triagedAt": "<ISO>", "triagedBy": "owner",
     "items": [ { "ref": "s3", "verdict": "tp|fp|missed", "note": "...", "action": "..." } ] }
   ```
3. CONVERT — the conversion rules, which are the whole point:
   - confirmed FALSE POSITIVE → file/extend an `fp-guard` seed pinning the lookalike passage as silent, and the matcher/cue-table/guard fix that makes it silent lands in the SAME change; corpus green proves the guard.
   - confirmed MISSED → add a `catch` seed whose expect row describes the DESIRED finding; it stays a failing `miss`/known-gap until the engine change that learns it lands with the corpus green in the same change.
   - confirmed TRUE POSITIVE → extend the `catch` expect row (or leave as-is).
4. GATE: every matcher/cue-table/guard change MUST run the full corpus before landing — mechanically enforced because the runner lives in root `npm test`; state this rule verbatim in the doc ("extends the existing proof gate").
5. GROWTH: new stories are added as new directories; existing stories, manifests and triage files are never edited except by the conversion rules above (a flip is a manifest edit + the engine change, never a silent test loosening).

### 5. Region, pins, stability

- Out of region: every `src/` directory in every package (core, agents, mcp-server, bridge, docs-extension, proof src), `schemas/`, all EXISTING test files, `packages/proof/fixtures/**` (untouched by construction — the corpus lives in a separate subtree so existing fixture-roster/projectIds deepEquals cannot break).
- If any existing test fails on your branch, that is a defect in the corpus authoring (leakage into existing surfaces) — STOP and report; do not edit the existing test.
- Byte-stable: root `npm install && npm run build && npm test` exit 0; run the calibration runner twice more — identical tables; offline everywhere (the proof dependency-scan pattern applies to corpus story-reading code if any is added under proof/test).
- Ruling-v2 pin clause: pre-authorized additive extension of full-roster pins ONLY where this task intentionally adds roster entries — expected: NONE (no new agents/tools). If a pin fails, STOP and report.

### Allowed files (complete list — nothing else may change)

- NEW: `packages/proof/calibration/**` (README, stories/*, triage/*), `packages/proof/test/calibration-corpus.test.ts`, `docs/calibration.md`
- EDIT: `packages/proof/README.md` (short section pointing at the corpus) — optional, allowed
- FORBIDDEN: everything else, including all existing test files, all `src/` trees, `packages/proof/fixtures/**`, `packages/core/**`, `packages/agents/**`.

## Acceptance Criteria

- [ ] ac-1: Corpus structure exists — repo-owned purpose-built stories each paired with canon/settings fixtures and a manifest of seeded issues and expected findings (catch / fp-guard / miss kinds, clean passages).
- [ ] ac-2: Triage workflow exists and is documented: run → triage record format → conversion rules (FP → guard pin + fix; miss → catch on landing; TP → row extension), with the landing-gate rule stated.
- [ ] ac-3: At least three seed stories covering the known FP classes (token collisions, negation-on-shared-keywords, verbatim-agreement, POV thought-tags) and miss classes (implicit contradictions, name variants).
- [ ] ac-4: Every matcher change is validated against the full corpus before landing — enforced mechanically by the corpus runner being part of root `npm test` (extends the existing proof gate), and stated in docs/calibration.md.
- [ ] ac-5: The corpus grows indefinitely: new stories/manifests/triage files are additive by design; runner asserts structural integrity; whole-corpus determinism (twice-identical tables); fully offline; repo-owned content only.

## Test Instructions

1. `git ls-remote origin refs/heads/develop` — must show 9ff1b714d8753c494ebd8aa39772bffd9e56e898; branch from it.
2. `npm install && npm run build && npm test` at repo root — exit 0, including the new calibration runner.
3. `git diff --stat` vs base — only the allowed files above; zero existing test files modified; zero `src/` changes anywhere.
4. Run the calibration runner twice more — identical tables.
5. Spot-check: flip one `catch` expect row to a wrong type in a scratch edit — the runner must fail (sensitivity proof); revert. Same for one `fp-guard` (mutate story paragraph → silence assertion fails).

## RIDER — process rules (binding)

1. ZERO-TRUST BASE: verify `git ls-remote origin refs/heads/develop` == 9ff1b714d8753c494ebd8aa39772bffd9e56e898 before branching. If it differs, STOP and report to the architect via comm.
2. EXPLICIT-REFSPEC FETCH (proven sandbox fix): your sandbox's fetch refspec may be single-branch; network-visible SHAs can be invisible to local verification. Run `git fetch origin refs/heads/develop:refs/remotes/origin/develop` and, before any self-check submission, `git fetch origin refs/heads/build/build-standing-agent-calibration-corpus:refs/remotes/origin/build/build-standing-agent-calibration-corpus`.
3. REPORTING: report to the architect session (lor_jeremiahtheobald_archi-add-timeline-date-and-age-checks) via orq comm ONLY. Task comments do not reach your terminal; comm is the delivery channel.
4. SELF-CHECK: submit via the CLI at your branch tip; the CLI records the pushed tip. If a gate refuses (anchor/origin-family errors are known), do ONE verified retry (re-run the explicit-refspec fetch, re-verify with ls-remote, resubmit); if it refuses again, STOP and report — no retry loops.
5. BYTE-STABLE + DISCLOSURE: full suite green twice identical before self-check; verbatim disclosure of any judgment call or deviation in the self-check report; stories disclosed as original repo-owned content in the triage files.
6. PARALLEL-LANE COORDINATION: a sibling builder is building the name-variant flagger in `packages/core/**` + `packages/agents/**` in parallel. Your region excludes both. The coupling point: IF the name-variant flagger is already on develop at your base (it is NOT as of 9ff1b714), name-variant seeds are `catch` rows pinning type `name-variant-drift`; as of this base they are `miss` seeds with the flip note. Whichever task lands second rebases onto the landed develop head (second-lander rule): if YOU land second and the flagger landed first, flip the name-variant `miss` seeds to `catch` rows and report to the architect before pushing; if the flagger lands second, ITS builder owns that flip in its rebase. Report to the architect via comm before pushing a rebased branch.
