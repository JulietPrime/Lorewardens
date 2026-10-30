# Calibration corpus — the standing triage workflow

The corpus lives in `packages/proof/calibration/`: purpose-built, repo-owned
stories run through the real agents as ONGOING calibration. Each triaged
finding becomes a permanent regression fixture. The agents are deterministic
(cue tables + guards), so "training out" issues means matcher changes proven
against the whole corpus — which makes those changes safe and catches
regressions the moment they appear.

- `packages/proof/calibration/stories/<story-id>/` — `story.md` (natural
  prose), `canon.json` + `settings.json` (same schemas as
  `packages/proof/fixtures/*.canon.json` / `*.settings.json`), and
  `manifest.json` — the regression contract: `catch` seeds (the engine MUST
  surface the pinned finding row), `fp-guard` seeds (a passage that looks
  like a known FP class and MUST stay silent), `miss` seeds (a known engine
  gap that MUST stay silent today; flips to `catch` in the same change that
  teaches the engine), and `cleanPassages` (silent at gentle, standard and
  strict).
- `packages/proof/calibration/triage/<story-id>.triage.json` — the triage
  record for each story.
- `packages/proof/test/calibration-corpus.test.ts` — the runner. Data-driven;
  it knows nothing about individual stories.

Hard governance: repo-owned stories only (no private novel content);
fully offline; nothing auto-confirms (corpus fixtures are test fixtures, not
user canon); paragraph numbers are 1-based over the non-empty paragraphs of
`story.md`.

## 1. RUN

```bash
npm test -w @lorewardens/proof -t calibration   # or root npm test
```

Corpus green means manifest matches engine. A failure is either real engine
drift or manifest drift — triage decides which.

## 2. TRIAGE

The owner (or architect relaying the owner) records findings triage in
`calibration/triage/<story-id>.triage.json`:

```json
{ "storyId": "cal-<name>", "triagedAt": "<ISO>", "triagedBy": "owner",
  "items": [ { "ref": "s3", "verdict": "tp|fp|missed", "note": "...", "action": "..." } ] }
```

## 3. CONVERT

The conversion rules, which are the whole point:

- confirmed FALSE POSITIVE → file/extend an `fp-guard` seed pinning the
  lookalike passage as silent, and the matcher/cue-table/guard fix that makes
  it silent lands in the SAME change; corpus green proves the guard.
- confirmed MISSED → add a `catch` seed whose expect row describes the
  DESIRED finding; it stays a failing `miss`/known-gap until the engine
  change that learns it lands with the corpus green in the same change.
- confirmed TRUE POSITIVE → extend the `catch` expect row (or leave as-is).

A `miss` never silently becomes a `catch`: the manifest edit IS the
regression-proof moment.

## 4. GATE

Every matcher/cue-table/guard change MUST run the full corpus before landing
— mechanically enforced because the runner lives in root `npm test` (extends
the existing proof gate).

## 5. GROWTH

New stories are added as new directories; existing stories, manifests and
triage files are never edited except by the conversion rules above (a flip is
a manifest edit + the engine change, never a silent test loosening). Story
ids are kebab-case and never renamed once a story exists; each story is its
own `cal-`-namespaced projectId so no existing fixture projectId can collide.
