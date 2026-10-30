# Canon Bootstrap — pasted story to draft canon

`canon_bootstrap` turns a pasted story chunk (or a local UTF-8 text file) into
a DRAFT canon proposal snapshot in the exact existing fixture shape
(`{ projectId, entries, characters, events }`), so a writer can start from a
real novel instead of hand-authoring a canon fixture. The draft feeds the
existing proposal -> writer-confirmation flow; it is an entry point, not a
shortcut around it.

## Governance (binding, non-negotiable)

1. **Nothing auto-confirms.** Every item the extractor produces carries
   `status: "proposed"`, `locked: false`, and no `lockReason`. The
   `CanonStore` is never read, never written, and never registered with a new
   project; there is no confirm path anywhere in the bootstrap code.
2. **Offline.** Zero network anywhere in the path. A grep-guard test scans
   the bootstrap sources (`packages/core/src/bootstrap.ts`,
   `packages/mcp-server/src/bootstrap.ts`) for network modules and fails the
   build if one appears.
3. **Local-only.** A draft is written to disk ONLY when the writer explicitly
   passes `outputPath`. An existing `outputPath` is refused with a clear
   error and the file is left untouched; the parent directory must already
   exist (no directory is ever created). There is no push, sync or share
   code path.
4. **Non-destructive.** The draft is additive output only: a tool response
   and, on explicit request, one new local file.
5. **Deterministic.** Same input -> byte-identical output. The extraction
   path uses no wall-clock (`generatedAt` defaults to the fixed constant
   `1970-01-01T00:00:00.000Z`), no randomness, and no locale-dependent APIs
   (all sorting and comparison is code-unit based). Ids are content-derived
   kebab-case with deterministic collision suffixes (`-2`, `-3`); no UUIDs,
   no timestamps in ids.

## Tool contract (summary)

- Input: `projectId`, `source` (`{ kind: "text", text, label? }` or
  `{ kind: "file", path }`), optional `generatedAt` (ISO 8601) and
  `outputPath`.
- Output: `{ projectId, source: {kind, label, length}, generatedAt, snapshot,
  counts: { entries: {fact, rule, history, setting}, characters, events },
  notes, writtenTo? }`.
- Cap: source text over 200,000 characters is rejected with an error that
  says to split the story and bootstrap it in parts.

## Draft item rules

- `sources: Span[]` slices exactly the source sentence(s) an item came from
  (`text.slice(start, end) === sentence`); `file` is the provided label
  (`"pasted-text"` by default) or the file path as given.
- Characters: `traits/abilities/injuries/goals/relationships` are `[]`; no
  `voice`; no `birthDate` (writer-confirmed field per the T1 contract).
- Events: `precision: "fuzzy"` always and **no `date` field ever** (dates are
  writer-confirmed and strict-validated by `parseCanonDate`; a bootstrap
  draft must never fabricate one), no `location`, `order` monotonic in
  textual sentence order starting at 1, `participants` = proposed characters
  named in the sentence in appearance order.

## Behaviors the tests pin (extractor cautions)

These are the deterministic rules the tests in
`packages/core/test/bootstrap.test.ts` and
`packages/mcp-server/test/bootstrap-tool.test.ts` pin. An extractor change
that alters any of them must revisit those tests and this list together.

1. **Segmentation** splits on `.`/`!`/`?` runs (a trailing closing `"` after
   the run belongs to the sentence) and on newlines; spans slice the trimmed
   sentence exactly.
2. **Dialogue skip**: any sentence containing a double-quote character is
   skipped for canon-ENTRY extraction (all four kinds) — dialogue is
   character voice, not established world fact. Characters and events are
   still extracted from such sentences (attribution lives there).
3. **Character evidence gate**: a character is proposed iff its name appears
   in a dialogue-attribution pattern (`said|asked|whispered|shouted|replied|
   muttered` immediately before or after the name) OR recurs >= 2 times as a
   non-sentence-initial capitalized token. Attribution alone is enough;
   single non-initial mentions and only-ever sentence-initial names stay
   silent.
4. **Name tokens**: capitalized tokens with internal apostrophes/hyphens;
   trailing `'s` is stripped (possessives collapse onto the base name).
5. **Stoplist** (in `packages/core/src/bootstrap.ts`): common openers and
   function words (incl. copular/past forms), capitalized contractions,
   days, months, `Chapter`/`Prologue`/`Epilogue`/`Part`, honorifics
   (`Mr/Mrs/Ms/Dr/Sir/Lady/Lord/Madam`), and kinship titles
   (`Mother/Father/Mama/Papa/Mom/Dad/Uncle/Aunt/Grandmother/Grandfather/
   Grandma/Grandpa/Granny/Nana/Brother/Sister/Cousin/Nephew`). Stoplisted
   tokens never become characters.
6. **Merging**: same name (case-insensitive) merges into one Character;
   the canonical display name is the first-seen surface form. `aliases`
   come from explicit apposition only: `Name "Nickname"` (quoted nickname
   space-adjacent to the name) or `Name, the <epithet>,` (stored as
   `the <epithet>`, matching the demo fixture precedent).
7. **summary** = the first sentence mentioning the character, verbatim;
   `sources` = every sentence that mentions the name, in order.
8. **Entry kinds, in precedence order**: `rule` (sentence-initial
   quantifier `every|all|no|any|never|always|each`, OR the literal modal
   cues ` must `, ` may only `, ` cannot `, ` is forbidden `) -> `history`
   (past copular `was|were|had` AND an era cue `years|centuries|long ago|
   since the|during the`) -> `setting` (a place-cue noun: gate, wall,
   tower, harbor, city, village, forest, river, castle, keep, temple, inn,
   road, bridge, valley, mountain, sea, island, kingdom, street, market,
   tavern) -> `fact` (copular `is|are|has|have`). Anything else produces no
   entry.
9. **Entry dedupe**: one proposal per unique sentence
   (whitespace-collapsed, case-insensitive); the first occurrence wins and
   carries its span. `tags` = first <= 3 content words (stoplist removed,
   deduped, lowercased, appearance order).
10. **Events**: one max per sentence; needs a proposed character named in
    the sentence AND a curated action verb (went, came, left, arrived,
    returned, attacked, fled, fought, died, killed, married, traveled,
    sailed, rode, walked, entered, escaped, discovered, found, built,
    destroyed, betrayed, swore, cast, met, woke, fell, rose, seized, lost,
    won, surrendered, rescued, hid, revealed) NOT followed by an
    apostrophe (so `won't` never fires `won`).
11. **Advisory notes** are deterministic and ordered: the all-proposed
    reminder, the quoted-sentence skip count, and a silence note per empty
    subject kind.

## Known limits (by design; the writer edits the draft)

- **Precision over recall**: modest recall is intended — the extractor is a
  starting point, not a canon author.
- **Proper-noun places can be proposed as characters.** The evidence gate is
  name-shaped only: a recurring capitalized place name (e.g. "the Weeping
  Gate" used non-initially) can pass the 2-mention gate. There is no
  place-name guard in v1; the writer deletes such proposals.
- **No relationship, `date`, or `birthDate` extraction**; no `voice`
  extraction; `traits/abilities/injuries/goals` stay empty (v1: no cue
  extraction for these).
- **Dialogue rules are skipped** (see pinned behavior 2): a world rule
  spoken in dialogue will not become a `rule` entry.
- **Kinship-title characters are skipped** ("Mother" never becomes a
  Character proposal even when attributed).
- **English-only heuristics**: every cue table is English.
- **Simple sentence splitting**: decimals ("3.5"), abbreviations
  ("Mr."), and ellipses mid-thought split sentences more aggressively than
  a human would; modal cues require the surrounding spaces from the table,
  so a sentence-final `must.` is missed.
- **Indirect speech is not dialogue**: `Mira said the gate was sealed.`
  (no quotes) still yields entries if it matches cues — only quoted
  sentences are skipped.

## Where it lives

- Extraction engine: `packages/core/src/bootstrap.ts` (exported via the
  package index). Domain logic next to the context selector — NOT a 15th
  agent: it does not implement the ContinuityAgent contract, does not join
  the registry, and produces a draft snapshot, not findings. The roster
  stays at 14 agents.
- Tool: `canon_bootstrap` in `packages/mcp-server/src/bootstrap.ts`,
  registered in `createLorewardensServer` after `canon_list` (emission order
  = pin order; `buildTools()` keeps its registry-derived shape).
