# Calibration corpus

A standing, growing library of repo-owned purpose-built stories run through
the real agents as ongoing calibration: seeded issues are triaged
(true positive / false positive / missed) and each triaged item becomes a
permanent regression fixture in `manifest.json`.

- `stories/<story-id>/` — `story.md` (natural prose), `canon.json` +
  `settings.json` (same schemas as `../fixtures/*.canon.json`), and
  `manifest.json` (the regression contract: `catch` / `fp-guard` / `miss`
  seeds + `cleanPassages`).
- `triage/<story-id>.triage.json` — the triage record per story.

Run: `npm test -w @lorewardens/proof -t calibration` (part of root
`npm test`). Adding a story = adding one directory plus its triage record;
existing stories are never edited except by the conversion rules in
`docs/calibration.md`, which owns the deep workflow (triage format,
conversion rules, landing gate, growth policy).

Rules: repo-owned content only (nothing from any private manuscript), fully
offline, nothing auto-confirms (corpus fixtures are test fixtures, not user
canon), paragraph numbers are 1-based over the non-empty paragraphs of
`story.md`.
