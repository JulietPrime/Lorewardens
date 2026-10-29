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

These are deliberate lexical-matcher behaviors from the task-3 review. The
fixture design depends on all of them; a matcher upgrade that changes them
must revisit `fixtures/` and the scenario table together:

1. **`cueBetween` uses the first occurrence of a sequence cue.** The seeded
   sequence sentences (E8, E9) contain their comparative cue ("before")
   exactly once, positioned between the two event mentions. Do not seed
   double-cue sentences.
2. **Ambiguity cues over-trigger.** Any sentence mentioning two canon events
   plus a hedge ("sometime", "around then", "roughly", ...) becomes an
   `unclear-time-jump`. E10 is the only paragraph allowed to pair two
   canon-event mentions with a hedge; clean passages never do.
3. **Location drift keys objects by `tags[0]`.** The S1 canon entry
   (`canon_fact_astrolabe`) has `tags[0] = "astrolabe"`, the word used in the
   relocation sentence, and a second `LOCATION_BINDING` entry
   (`canon_fact_harbor_ledger`) names the destination ("lighthouse"). S1's
   paragraph is the only relocation-style sentence in the manuscript.
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

## Out of scope here

Any change to agent or core behavior. If a seeded error cannot be caught
without touching the matchers, that is a stop-and-report condition, not a
fixture hack (see the builder prompt for `prove-agents-catch-seeded-errors`).
