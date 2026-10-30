# @lorewardens/proof — Seeded-Error Proof Suite

Automated proof that the three shipped Continuity agents catch real writing
errors through the real MCP tool path (`runAnalyzeTool`) while canon-consistent
passages stay silent. No network, no mocks: fixtures are seeded with
`loadFixtures` and every scenario paragraph is analyzed as its own changed
chunk with real file-relative offsets.

## Run

```bash
npm test          # repo root; builds in dependency order, includes this workspace
```

## What is proven

| Assertion | Test |
| --- | --- |
| Catch table: E1–E10 caught at standard by the expected agent, type and canonRefs | `catch table at standard` |
| Strict-only notes (S1 location drift, S2 relationship drift) fire at strict, silent at standard | `strict-only checks (S1/S2)` |
| Strictness matrix: at gentle exactly the locked-severity seeds (E1, E9) surface, nothing else | `strictness matrix at gentle` |
| Silence: 6 clean passages produce zero findings for all three agents at gentle, standard and strict | `silence on clean passages` |
| Schema + offsets: every finding validates and its quote slices exactly from `fixtures/manuscript/ch4.md` | `every finding ... schema-valid` |
| Determinism: two full passes yield identical finding type/canonRef/location tables | `determinism` |

## Fixtures

- `fixtures/proof.canon.json` + `proof.settings.json` — project `proof`:
  all three agents at `standard`, optional checks off.
- `fixtures/proof-strict.canon.json` + `proof-strict.settings.json` — project
  `proof-strict`: identical canon content (own `projectId`), all agents at
  `strict`, `objectLocationChecks: true` and `relationshipState: true`.
- `fixtures/manuscript/ch4.md` — one paragraph per scenario, one sentence per
  paragraph. The world is chapter 4 of the demo novel (Mira, Daven, the
  Weeping Gate, the siege); new proof-only canon: the Karth ferry, the glass
  astrolabe, the harbor ledger, Calla (siege participant), Bren & Oskar
  (canon `ally` pair), and the harbor-lanterns event.

## Behaviors the fixtures pin (matcher cautions)

These are the lexical-matcher behaviors the fixture design depends on. Items
1–3 were pinned as cautions by the task-3 review and have since been fixed by
`catch-implicit-contradictions-in-matchers`; the descriptions below state the
FIXED behavior and why it holds. A matcher change that alters them must
revisit `fixtures/` and the scenario table together:

1. **`cueBetween` considers every occurrence of a sequence cue inside the
   mention window.** The seeded sequence sentences (E8, E9) still contain
   their comparative cue ("before") exactly once, positioned between the two
   event mentions, so their outcomes are unchanged — but a sentence whose
   first cue occurrence falls outside the mention window and a later one
   inside it now asserts a sequence too. Rationale: first-occurrence-only
   matching made the assertion depend on unrelated earlier text.
2. **Ambiguity cues are mention-gated.** An `unclear-time-jump` fires only
   when a hedge is present, no comparative cue sits between the two event
   mentions (a comparative there asserts an order instead), and the hedge
   does not trail the second event mention. When the two events share a
   participant, the first-mention indices collapse onto the shared name, so
   the gate falls back to each event's first distinguishing keyword to build
   the mention window. E10 ("...the harbor lanterns sometime around her
   survey...") still fires — its hedge sits between the lanterns mention and
   the survey mention; clean passages never pair two canon-event mentions
   with a hedge. Rationale: any hedge anywhere in a two-event sentence used
   to become an `unclear-time-jump`.
3. **Location drift derives the object from the entry's own text.** The
   object identity comes from the subject words before the binding verb
   ("The glass astrolabe rests..." → glass/astrolabe), with `tags[0]` as
   fallback, and the drift carries its own reason (distinct finding message)
   instead of reusing the antonym shape. S1 still keys on the astrolabe
   entry, whose sentence mentions "astrolabe", and the harbor-ledger entry
   still names the destination ("lighthouse"). S1's paragraph remains the
   only relocation-style sentence in the manuscript. Rationale: keying by
   `tags[0]` alone and borrowing the antonym reason (`word === opposite`)
   made drift detection fragile and its output misleading.
4. **Context selection is participant-intersection based.**
   `selectRelevantContext` only includes a timeline event when one of its
   participants is a mentioned character, so every timeline scenario's
   paragraph names a participant of each event it references (Calla for the
   siege, Mira for the survey/lanterns). Related: the timeline matcher's
   first-mention index collapses to the first occurrence of a shared
   participant name, so seeded sequence sentences place event keywords so the
   two mention indices differ and the comparative cue sits between them.
5. **Confidence floors are load-bearing.** Gentle requires confidence ≥ 0.9;
   the non-locked seeds sit at 0.7–0.8 so they surface only at standard and
   above, and the strict-only notes at 0.55 so they never surface below
   strict.

## Chapter 5 — implicit contradictions and false-positive guards (proof-implicit)

`catch-implicit-contradictions-in-matchers` adds a fourth canon-lore shape —
`canon-implicit-contradiction` — and meaning-level false-positive guards on
the three explicit shapes. The dedicated fixture project `proof-implicit`
(`fixtures/proof-implicit.canon.json`, `proof-implicit.settings.json`,
`manuscript/ch5-implicit.md`) proves both directions through `runAnalyzeTool`
in `test/implicit-proof.test.ts`:

| Assertion | Test |
| --- | --- |
| Owner repro FIRST ("Mira cast a powerful spell and remembered every detail of it afterward.") plus three further implicit catches (wove/invoked/channelled cue-table entries) → `canon-implicit-contradiction`, major/0.95/gentle (locked rule) | `catch table at standard` |
| Guard firing-sides: antonym with subject anchor, negation beyond the subject anchor, numerals sharing an adjacent unit → `canon-contradiction`, minor/0.8/standard | `catch table at standard` |
| Owner FP classes — token collision ('light in every window'), stray numeral ('1' vs '30'), negation on shared keywords ('wolves'), verbatim canon agreement, confirmed-setting co-mention — zero findings for every agent | `owner false-positive classes ... stay silent` |
| Clean cast-only / remember-only / paid-cost / spellbook passages — zero findings | `owner false-positive classes ... stay silent` |
| Layout: ch5 starts with the owner repro; one single-sentence paragraph per scenario | `ch5 maps every paragraph ...` |
| Determinism: two full passes identical | `determinism: two identical ch5 passes` |

The ch4 scenario table is untouched; ch5 lives in its own file and project so
the seeded-error chapter's byte-pins stay exact.

## Out of scope here

Any change to agent or core behavior. If a seeded error cannot be caught
without touching the matchers, that is a stop-and-report condition, not a
fixture hack (see the builder prompt for `prove-agents-catch-seeded-errors`).

## Calibration corpus (standing)

`calibration/` is the standing, growing library of repo-owned purpose-built
stories run through the agents as ongoing calibration: triaged findings
become permanent regression fixtures (`catch` / `fp-guard` / `miss` seeds +
`cleanPassages` per `manifest.json`), and the data-driven runner in
`test/calibration-corpus.test.ts` enforces every manifest as part of root
`npm test`. Unlike the fixtures above, the corpus is additive by design: a
new story is a new directory, and existing stories are never edited except by
the conversion rules in `docs/calibration.md` (the deep triage workflow lives
there). See `calibration/README.md` for the layout.
