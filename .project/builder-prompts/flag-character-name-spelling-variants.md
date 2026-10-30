# flag-character-name-spelling-variants — Builder Specification

AGENT_ROLE: builder
PROJECT: Lorewardens
BASE: develop 9ff1b714d8753c494ebd8aa39772bffd9e56e898 (zero-trust: verify with `git ls-remote origin refs/heads/develop` before starting; see RIDER)

## Purpose

Owner manual testing found the one real defect the matchers missed in a real chapter: canon says 'Hazledown' but the chapter spells it 'Hazeldown' in three places after the first mention. Name spelling drift is exactly the continuity error writers want caught, and deterministic name-variant matching is feasible offline. This task also folds in the place-name guard accepted as a non-blocking design flag during the bootstrap-canon review (receipt 9c934bd4): recurring proper-noun places can be proposed as characters by the bootstrap extractor, and without a guard the new variant flagger would compound that into a false-positive storm of drift findings against place names. One builder pass carries both.

## Design Approach

The engine is deterministic (cue tables + guards), sentence-wise and stateless, offline. The flagger extends the existing `character-consistency` agent (category `character`) — it is NOT a new agent: no roster, registry, tool, or schema-enum changes. Spelling drift is a new issue type emitted through the existing `makeFinding` path with the same shape as the agent's other issues.

Three moving parts:

1. A CLOSED variant rule table (new core module) — the only spelling tolerance that exists. Documented, enumerated, no fuzzy thresholds beyond the enumerated edit operations.
2. Variant-tolerant context selection — a character must reach the agent even when a chunk contains ONLY a variant spelling (otherwise the feature fails its own acceptance case: the drifted paragraphs never pull the character into context).
3. The place-name guard — variant flagging is suppressed when the name collides with place evidence in confirmed setting canon, so a place mis-proposed as a character cannot generate drift findings.

## Key Implementation Details

### 1. Closed variant rule table — `packages/core/src/name-variants.ts` (new file)

Deterministic, pure, offline, side-effect free. Rules, exactly:

- A candidate text token T is a spelling VARIANT of a canon name N iff ALL hold:
  - T and N are case-insensitively unequal (exact matches — canon name or alias — are never variants);
  - restricted Damerau-Levenshtein distance between `lower(T)` and `lower(N)` is exactly 1: ONE of — single substitution, single insertion, single deletion, adjacent transposition. No other operation, no distance 2, no phonetic rules;
  - `min(len(T), len(N)) >= 4` (short names never variant-match; avoids 'Ed'/'Edw' noise);
  - T appears as a CAPITALIZED whole word token in the sentence text (proper-noun surfaces only; tokenization: `[A-Za-z0-9'’]+` runs, strip possessive `'s`/`'s` before comparing, compare the stripped token);
  - T is not inside the stoplist semantics below (reuse the guard inputs).
- Canon name sources per character: `namesOf(character)` semantics = `[character.name, ...character.aliases]`, each length > 1. Aliases are honored BY CONSTRUCTION: an exact case-insensitive alias match is never a variant, so a writer who locks a deliberate variant as an alias silences it permanently. Writer dismissal path = add the variant as an alias (or correct canon). No new store plumbing, no exception plumbing — documented in the agent contract.
- Export from `packages/core/src/index.ts`: a predicate used by both the selector and the agent, e.g. `nameVariantOf(token: string, canonNames: string[]): { variantOf: string; canonical: string } | null` and a sentence-level helper. `packages/agents/src/lexical.ts` may re-export for call-site convenience (thin wrapper only, no logic duplication).

### 2. Variant-tolerant context selection — `packages/core/src/context.ts`

`selectRelevantContext(chunkText, snapshot)` changes:

- Characters: current filter is `mentions(c.name) || c.aliases.some(mentions)` with exact tokens/substrings. EXTEND it: a confirmed character also enters context when any capitalized whole token in the chunk text is a table-variant of the character's name or one of its aliases (same rule table, same helpers — import from the new core module, do not fork the logic).
- CanonContext gains an OPTIONAL field `placeNames?: string[]` in `packages/core/src/types.ts`:
  ```ts
  export interface CanonContext {
    entries: CanonEntry[];
    characters: Character[];
    events: TimelineEvent[];
    /** Capitalized proper-noun tokens evidenced in confirmed setting entries (place-name guard source). */
    placeNames?: string[];
  }
  ```
  Optional field = additive; existing constructions keep compiling.
- The selector populates `placeNames` deterministically from the snapshot: for every `status === "confirmed"` entry with `kind === "setting"`, take whole-word tokens of the entry text (`[A-Za-z0-9'’]+`, strip possessives) that (a) appear capitalized at least once in that entry text, (b) have length >= 4, (c) are not in `NAME_STOPLIST` from `packages/core/src/bootstrap.ts` (import it; if it is not exported, export it — that is an allowed change — or copy it verbatim with a comment naming the source). Deduplicate case-insensitively, keep the first-seen casing, sort deterministically (or preserve first-occurrence order — pick one, document it, tests pin it). This reuses the extractor's own evidence: a sentence became a `setting` entry because a place cue noun was present, so its capitalized tokens are place-name evidence.

### 3. The flagger — `packages/agents/src/character-consistency.ts`

New check `detectNameVariantDrift(chunkText, context)` inside the existing issue pipeline:

- For each confirmed character in context, for each sentence: for each capitalized whole-word token T of the sentence, let v = variant table lookup of T against `namesOf(character)`. If v is non-null AND T is not an exact case-insensitive member of `namesOf(character)` AND the guard (below) does not trip, emit an issue:
  - type: `name-variant-drift` (new string; additive to finding-type space, no schema enum change — verify the findings schema does not enumerate types; if it does, STOP and report instead of editing the schema);
  - severity: `minor`; confidence: `0.72`; minStrictness: `standard` (surfaces at standard floor 0.7, silent at gentle 0.9 — same posture as the agent's other minor issues);
  - message: `Passage spells ${character.name} as '${T}' (canon: '${v.canonical}').`;
  - canonRefs: `[character.id]`; quote: the sentence; offsets: sentence span exactly like the agent's other issues (chunk.span.startOffset + sentence start/end);
  - dedupe through the existing `pushIssue` seen-key (`character:type:start`);
  - suggestion: `Character proposal (advisory): align the passage with the canon spelling, or lock the variant as an alias of ${character.name} if it is deliberate.`
- PLACE-NAME GUARD: suppress the issue when EITHER the canon name OR the variant token T (case-insensitive) is a member of `context.placeNames ?? []`. Rationale (goes in the docs section): a proper noun evidenced as a place in confirmed setting canon must not be treated as a character name; this prevents the bootstrap extractor's documented v1 gap (recurring proper-noun places proposed as characters) from compounding into drift findings. The writer-side cleanup of a mis-proposal stays manual, exactly as `docs/canon-bootstrap.md` already documents.
- Wire the check into `characterConsistencyFindings` (it runs for the agent as configured; the standard gate via `gateForAgent` applies unchanged).
- Stateless semantics (disclosed judgment call, pinned in tests): canon spelling is the reference, so EVERY variant occurrence flags — there is no document-order "first mention" tracking. The owner's scenario (canon spelling first, drift later) is fully covered; a variant-first occurrence also flags, which is minor, advisory, and dismissible by locking the variant as an alias. Determinism and the chunk-wise contract outrank the literal "after first mention" wording.
- `packages/agents/src/timeline.ts` and `packages/core/src/bootstrap.ts` are OUT OF REGION: zero changes to either file.

### Pins, tests, docs

- ZERO byte changes to any EXISTING test file. New finding types must stay silent on all existing fixtures/acceptance corpora — that silence is the FP-safety proof, and it is enforced by the full suite passing unmodified.
- New tests, additive only:
  - `packages/core/test/name-variants.test.ts` (new): pin the closed table — each edit operation fires, distance-2 does not, length-3 names do not, lowercase tokens do not, exact alias never flags, possessive stripping, transposition.
  - `packages/core/test/context.test.ts` (additive cases only): variant-only chunk pulls the character into context; `placeNames` populated from confirmed setting entries; proposed/retired settings contribute nothing.
  - `packages/agents/test/name-variants.test.ts` (new): drift fires at standard with the exact finding row (agent `character-consistency`, type `name-variant-drift`, severity minor, confidence 0.72, canonRefs, message, sentence offsets); alias spelling silent; place-name guard suppression (character whose name is place-evidenced + variant of it = silent); silent on existing-shape clean text; determinism — run the full agent suite twice, byte-identical outcome tables.
- `docs/agent-contract.md`: new section for the name-variant flagger — the closed rule table verbatim, the guard, the stateless rationale, the alias/dismiss story. This is the "documented rules" half of the acceptance criteria.
- Ruling-v2 pin clause (pre-authorized, verbatim disclosure required if exercised): full-roster pins (ALL_AGENTS composition/order, registry length, MCP tool list, schema agent/category enums, fixture-roster/projectIds deepEquals) extend additively ONLY when this task intentionally adds such entries. This task adds NO agents and NO tools; expect NO pin changes. If any existing deepEqual pin fails, that is a defect in the flagger's FP safety or an unexpected surface — STOP and report, do not loosen a pin.
- Byte-stable requirement: root `npm install && npm run build && npm test` exit 0; run the new agent suite twice more — identical tables both times.

### Allowed files (complete list — nothing else may change)

- NEW: `packages/core/src/name-variants.ts`, `packages/core/test/name-variants.test.ts`, `packages/agents/test/name-variants.test.ts`
- EDIT: `packages/core/src/context.ts`, `packages/core/src/types.ts`, `packages/core/src/index.ts`, `packages/core/test/context.test.ts` (additive cases only), `packages/agents/src/character-consistency.ts`, `packages/agents/src/lexical.ts` (re-export only), `docs/agent-contract.md`
- FORBIDDEN: every other file — including all existing test files, `packages/agents/src/timeline.ts`, `packages/core/src/bootstrap.ts`, `schemas/`, all `packages/proof/**` (the calibration-corpus lane owns that subtree), `packages/mcp-server/**` unless a compile error proves otherwise, in which case STOP and report.

## Acceptance Criteria

- [ ] ac-1: Names in text are matched against confirmed character canon with tolerance for common spelling variants, via a documented closed rule table (single substitution / insertion / deletion / adjacent transposition, distance exactly 1, min length 4, capitalized whole tokens) documented in docs/agent-contract.md.
- [ ] ac-2: A spelling mismatch is flagged as a minor continuity finding (type `name-variant-drift`, severity minor, confidence 0.72, standard floor) referencing the canon spelling and the character canon id.
- [ ] ac-3: Deliberate variants the writer locks are honored (aliases never flag by construction); the dismissal path (alias/correct canon) is documented. No new store plumbing.
- [ ] ac-4: Place-name guard: variant flagging is suppressed when the canon name or the variant token is place-evidenced in confirmed setting canon (`placeNames`), preventing the documented bootstrap mis-proposal gap from compounding into drift findings.
- [ ] ac-5: A chunk containing ONLY a variant spelling still pulls the character into context (selector variant tolerance) so the flag fires on the owner's real scenario (drifted paragraphs with no canon spelling present).
- [ ] ac-6: Determinism and FP safety: root suite green with ZERO modified existing test files; new suites green twice with byte-identical tables; offline (no network anywhere in the path).

## Test Instructions

1. `git ls-remote origin refs/heads/develop` — must show 9ff1b714d8753c494ebd8aa39772bffd9e56e898; branch from it.
2. `npm install && npm run build && npm test` at repo root — exit 0.
3. `git diff --stat` vs base — only the allowed files above; zero existing test files modified.
4. Run `packages/agents/test/name-variants.test.ts` and `packages/core/test/name-variants.test.ts` twice each — identical outcomes.
5. Manually verify the owner scenario in a scratch test: canon character 'Hazledown', text paragraph with only 'Hazeldown' — finding fires at standard; add 'Hazeldown' as alias — silent; canon 'Hazledown' also evidenced as a confirmed setting entry — silent.

## RIDER — process rules (binding)

1. ZERO-TRUST BASE: verify `git ls-remote origin refs/heads/develop` == 9ff1b714d8753c494ebd8aa39772bffd9e56e898 before branching. If it differs, STOP and report to the architect via comm.
2. EXPLICIT-REFSPEC FETCH (proven sandbox fix): your sandbox's fetch refspec may be single-branch; network-visible SHAs can be invisible to local verification. Run `git fetch origin refs/heads/develop:refs/remotes/origin/develop` and, before any self-check submission, `git fetch origin refs/heads/build/flag-character-name-spelling-variants:refs/remotes/origin/build/flag-character-name-spelling-variants`.
3. REPORTING: report to the architect session (lor_jeremiahtheobald_archi-add-timeline-date-and-age-checks) via orq comm ONLY. Task comments do not reach your terminal; comm is the delivery channel.
4. SELF-CHECK: submit via the CLI at your branch tip; the CLI records the pushed tip. If a gate refuses (anchor/origin-family errors are known), do ONE verified retry (re-run the explicit-refspec fetch, re-verify with ls-remote, resubmit); if it refuses again, STOP and report — no retry loops.
5. BYTE-STABLE: full suite green twice identical before self-check; verbatim disclosure of any judgment call, deviation, or pin update in the self-check report.
6. PARALLEL-LANE COORDINATION: a sibling builder is building the calibration corpus in `packages/proof/calibration/**` in parallel. Your region excludes all of `packages/proof/**`; theirs excludes `packages/core/**` and `packages/agents/**` source. Whichever task lands second rebases onto the landed develop head (second-lander rule) and reports to the architect before pushing.
