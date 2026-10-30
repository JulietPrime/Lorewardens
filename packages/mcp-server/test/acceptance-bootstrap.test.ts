// Independent acceptance suite (test-designer authored) for
// bootstrap-canon-from-a-pasted-story.
//
// Written against the accepted specification and its nine acceptance
// criteria, exercised through the real tool path (runCanonBootstrapTool, the
// registered ToolDef handler, runCanonListTool, loadFixtureBundle) plus the
// deterministic extractor itself. The story fixtures below were designed
// against the reviewed engine and pinned sentence by sentence; product code
// is untouched.
//
// Criteria map:
//   ac-1  tests 1, 2   — exact fixture shape, all proposed, no date/birthDate,
//                        monotonic event order; text and file sources
//   ac-2  test 3       — canon_list byte-identical before/after, store
//                        registration unchanged, no confirmed item
//   ac-3  tests 4, 5   — draft written only on outputPath, existing file
//                        refused untouched, no network module in the new path
//   ac-4  tests 5, 6   — byte-identical reruns, content-derived ids with
//                        deterministic collision suffixes, no clock/random/
//                        locale API in extraction
//   ac-5  test 7       — the written draft loads through loadFixtureBundle
//                        and loadFixtures from a TEMP fixtures dir
//   ac-6  tests 1, 8   — every cue class fires on a positive example, every
//                        FP guard holds on its negative
//   ac-7  tests 2, 9   — every source span slices exactly its source
//                        sentence; label default and custom label
//   ac-8  test 10      — 16-tool roster with canon_bootstrap last, registry
//                        pin intact, no new package / agents change / seeded
//                        fixture file, docs updated
//   ac-9  (suite run)  — npm install && npm run build && npm test green at
//                        repo root, run twice with identical results

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  bootstrapCanon,
  createRegistry,
  DEFAULT_GENERATED_AT,
  type CanonEntry,
  type CanonSnapshot,
  type Character,
  type TimelineEvent,
} from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { buildTools, runCanonListTool, type ToolDef } from "../src/tools.js";
import { defaultFixturesDir, loadFixtureBundle, loadFixtures } from "../src/store.js";
import { runCanonBootstrapTool } from "../src/bootstrap.js";
import { createLorewardensServer } from "../src/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> @lorewardens/mcp-server -> packages -> repo root
const REPO_ROOT = path.resolve(HERE, "../../../..");
const PROOF_FIXTURES = path.join(REPO_ROOT, "packages", "proof", "fixtures");
const DEMO_FIXTURES = path.join(REPO_ROOT, "packages", "mcp-server", "fixtures");

// ---------------------------------------------------------------------------
// The story: 22 one-line sentences joined by single spaces. Each sentence is
// a curated probe: a positive for one extraction cue class, or a negative for
// one false-positive guard. EXPECTED_* tables below were derived from the
// accepted specification's taxonomy and verified against the reviewed engine.
// ---------------------------------------------------------------------------

const SENTENCES = [
  "Every gate in the old city closes at dusk, and the watch never opens it before dawn.", // rule: sentence-initial quantifier
  "Mira said the wards hold until the moon turns.", // character: dialogue-attribution verb
  "Mira, the cartographer, unrolled the map at her desk.", // alias: Name, the <epithet>, apposition
  "Mira found the lantern in the archive.", // event: action verb with a proposed participant
  "Daven asked about the toll.", // character: attribution verb after the name run
  "Daven found the iron key.",
  "Daven found the silver coin.", // event id collision with the sentence above
  "They gave the sealed letter to Kess.", // character: recurrence, non-sentence-initial #1
  "The crowd followed Kess across the yard.", // character: recurrence, non-sentence-initial #2
  "The old seal is cracked down the middle.", // fact: copular fallback
  "The old seal is warm to the touch.", // fact id collision
  "The old seal is polished smooth.", // fact id collision (third)
  "The west tower may only be entered with the steward's leave.", // rule: modal cue beats place cue
  "The harbor walls were rebuilt centuries ago.", // history: past copular + era cue beats place cue
  "The sealed gate stands in the north wall.", // setting: place-cue noun
  "Mira and Daven found the hidden stair.", // event: two participants in appearance order
  "Daven won the archery trial.", // event: 'won' fires
  "Daven won't attend the feast.", // FP guard: 'won't' never fires 'won'
  "Raven returned before dawn.", // FP guard: single sentence-initial mention; action verb without a proposed character
  "Uncle Bren kept the ledger.", // FP guard: kinship title stoplisted, single mention
  '"Every door in the keep is barred," the steward said.', // FP guard: quoted speech skipped for entries
  "Mira waited by the window until dawn.", // FP guard: non-action sentence, no event
];

const STORY = SENTENCES.join(" ");

interface SentenceSpan {
  text: string;
  startOffset: number;
  endOffset: number;
}

const SPANS: SentenceSpan[] = (() => {
  const spans: SentenceSpan[] = [];
  let cursor = 0;
  for (const text of SENTENCES) {
    spans.push({ text, startOffset: cursor, endOffset: cursor + text.length });
    cursor += text.length + 1;
  }
  return spans;
})();

const GENERATED_AT = "2026-10-30T00:00:00.000Z";
const BOOTSTRAP_INPUT = {
  projectId: "story-prover",
  source: { kind: "text" as const, text: STORY },
};

interface DraftItem {
  status: string;
  locked: boolean;
  sources: { file: string; startOffset: number; endOffset: number }[];
}

interface BootstrapResult {
  projectId: string;
  source: { kind: string; label: string; length: number };
  generatedAt: string;
  snapshot: CanonSnapshot;
  counts: {
    entries: { fact: number; rule: number; history: number; setting: number };
    characters: number;
    events: number;
  };
  notes: string[];
  writtenTo?: string;
}

async function bootstrapStory(overrides: Record<string, unknown> = {}): Promise<BootstrapResult> {
  return (await runCanonBootstrapTool({
    ...BOOTSTRAP_INPUT,
    generatedAt: GENERATED_AT,
    ...overrides,
  })) as BootstrapResult;
}

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "lore-acceptance-bootstrap-"));
}

function assertAllProposed(snapshot: CanonSnapshot, label: string): void {
  for (const item of [...snapshot.entries, ...snapshot.characters, ...snapshot.events] as DraftItem[]) {
    assert.equal(item.status, "proposed", `${label}: every draft item is status proposed`);
    assert.equal(item.locked, false, `${label}: every draft item is unlocked`);
    assert.ok(!("lockReason" in item), `${label}: no draft item carries a lockReason`);
  }
}

// ---------------------------------------------------------------------------
// 1 — ac-1, ac-6: the exact fixture draft shape and the full catch table
// ---------------------------------------------------------------------------

test("test-authoring: pasted text returns the exact fixture draft shape, all proposed, with the full cue-class catch table (ac-1, ac-6)", async () => {
  const result = await bootstrapStory();

  assert.equal(result.projectId, "story-prover");
  assert.deepEqual(result.source, { kind: "text", label: "pasted-text", length: STORY.length });
  assert.equal(result.generatedAt, GENERATED_AT);
  assert.equal(result.writtenTo, undefined);

  // Exact fixture shape: the snapshot is {projectId, entries, characters, events}.
  const snapshot = result.snapshot;
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ["characters", "entries", "events", "projectId"],
    "the snapshot carries exactly the fixture-shape keys",
  );
  assert.equal(snapshot.projectId, "story-prover");

  // Exact item shapes: draft entries/characters/events use the fixture item
  // keys, no lockReason, no writer-confirmed fields (date, birthDate, voice).
  const ENTRY_KEYS = ["createdAt", "id", "kind", "locked", "projectId", "sources", "status", "tags", "text", "updatedAt"].sort();
  const CHARACTER_KEYS = [
    "abilities", "aliases", "createdAt", "goals", "id", "injuries", "locked", "name",
    "projectId", "relationships", "sources", "status", "summary", "traits", "updatedAt",
  ].sort();
  const EVENT_KEYS = [
    "createdAt", "description", "id", "locked", "order", "participants", "precision",
    "projectId", "sources", "status", "updatedAt",
  ].sort();
  for (const entry of snapshot.entries) {
    assert.deepEqual(Object.keys(entry).sort(), ENTRY_KEYS, "entry keys are the fixture entry keys");
    assert.ok(!("date" in entry), "entries never carry a date");
  }
  for (const character of snapshot.characters) {
    assert.deepEqual(Object.keys(character).sort(), CHARACTER_KEYS, "character keys are the fixture character keys");
    assert.ok(!("birthDate" in character), "draft characters carry no birthDate");
    assert.ok(!("voice" in character), "draft characters carry no voice");
  }
  for (const event of snapshot.events) {
    assert.deepEqual(Object.keys(event).sort(), EVENT_KEYS, "event keys are the fixture event keys");
    assert.ok(!("date" in event), "draft events never carry a date field");
    assert.ok(!("location" in event), "draft events never carry a location field");
    assert.equal(event.precision, "fuzzy", "every draft event is fuzzy-precision");
  }
  assertAllProposed(snapshot, "pasted text");

  // Counts match the catch table below.
  assert.deepEqual(result.counts, {
    entries: { fact: 3, rule: 2, history: 1, setting: 1 },
    characters: 3,
    events: 5,
  });

  // Catch table — entries in textual order, one per positive cue class.
  assert.deepEqual(
    snapshot.entries.map((e: CanonEntry) => ({ id: e.id, kind: e.kind, text: e.text })),
    [
      { id: "canon_rule_every-gate-in", kind: "rule", text: SENTENCES[0] },
      { id: "canon_fact_the-old-seal", kind: "fact", text: SENTENCES[9] },
      { id: "canon_fact_the-old-seal-2", kind: "fact", text: SENTENCES[10] },
      { id: "canon_fact_the-old-seal-3", kind: "fact", text: SENTENCES[11] },
      { id: "canon_rule_the-west-tower", kind: "rule", text: SENTENCES[12] },
      { id: "canon_history_the-harbor-walls", kind: "history", text: SENTENCES[13] },
      { id: "canon_setting_the-sealed-gate", kind: "setting", text: SENTENCES[14] },
    ],
    "entries: rule quantifier, fact fallback x3 with collision suffixes, rule modal, history era, setting place-cue",
  );

  // Characters: attribution-gated and recurrence-gated, alias apposition.
  assert.deepEqual(
    snapshot.characters.map((c: Character) => ({
      id: c.id,
      name: c.name,
      aliases: c.aliases,
      summary: c.summary,
      nSources: c.sources.length,
    })),
    [
      { id: "char_mira", name: "Mira", aliases: ["the cartographer"], summary: SENTENCES[1], nSources: 5 },
      { id: "char_daven", name: "Daven", aliases: [], summary: SENTENCES[4], nSources: 6 },
      { id: "char_kess", name: "Kess", aliases: [], summary: SENTENCES[7], nSources: 2 },
    ],
    "characters: attribution (Mira, Daven) and recurrence-only (Kess), epithet alias on Mira",
  );

  // Events: monotonic order in textual sequence, fuzzy, participants in
  // appearance order, one max per sentence.
  assert.deepEqual(
    snapshot.events.map((e: TimelineEvent) => ({
      id: e.id,
      order: e.order,
      participants: e.participants,
      description: e.description,
    })),
    [
      { id: "event_mira-found-the", order: 1, participants: ["char_mira"], description: SENTENCES[3] },
      { id: "event_daven-found-the", order: 2, participants: ["char_daven"], description: SENTENCES[5] },
      { id: "event_daven-found-the-2", order: 3, participants: ["char_daven"], description: SENTENCES[6] },
      { id: "event_mira-and-daven", order: 4, participants: ["char_mira", "char_daven"], description: SENTENCES[15] },
      { id: "event_daven-won-the", order: 5, participants: ["char_daven"], description: SENTENCES[16] },
    ],
    "events: one per action-verb sentence with proposed participants, collision suffix on the third",
  );
  const eventOffsets = snapshot.events.map((e: TimelineEvent) => e.sources[0]!.startOffset);
  assert.deepEqual(
    [...eventOffsets].sort((a, b) => a - b),
    eventOffsets,
    "event array order is monotonic in the textual sequence of its source sentences",
  );

  // Notes disclose the draft-only status and the skipped dialogue sentence.
  assert.ok(result.notes.some((n) => /nothing auto-confirms/i.test(n)), "notes disclose the draft-only status");
  assert.ok(result.notes.some((n) => /1 sentence\(s\) inside double quotes were skipped/.test(n)), "notes disclose the skipped dialogue");
});

// ---------------------------------------------------------------------------
// 2 — ac-1, ac-7: a local file source, labeled with the path as given
// ---------------------------------------------------------------------------

test("test-authoring: a local file source returns the same draft labeled with the path as given (ac-1, ac-7)", async () => {
  const dir = tempDir();
  try {
    const storyPath = path.join(dir, "wolves-chapter-1.txt");
    writeFileSync(storyPath, STORY, "utf8");
    const fromFile = (await runCanonBootstrapTool({
      projectId: "story-prover",
      source: { kind: "file", path: storyPath },
      generatedAt: GENERATED_AT,
    })) as BootstrapResult;
    assert.deepEqual(fromFile.source, { kind: "file", label: storyPath, length: STORY.length });

    // Pasting the same text under the same label is byte-identical draft output.
    const fromText = await bootstrapStory({ source: { kind: "text", text: STORY, label: storyPath } });
    assert.equal(
      JSON.stringify(fromFile.snapshot),
      JSON.stringify(fromText.snapshot),
      "file source === pasted text with the same label (draft byte-identical)",
    );

    assertAllProposed(fromFile.snapshot, "file source");
    assert.equal(fromFile.snapshot.entries.length, 7);
    assert.equal(fromFile.snapshot.characters.length, 3);
    assert.equal(fromFile.snapshot.events.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3 — ac-2: nothing auto-confirms, the canon store is untouched
// ---------------------------------------------------------------------------

test("test-authoring: a full bootstrap call leaves the canon store byte-identical and nothing confirmed (ac-2)", async () => {
  const dir = tempDir();
  try {
    const { store, projectIds } = loadFixtures(defaultFixturesDir());
    const before = await runCanonListTool(store, { projectId: "demo" });
    const settingsBefore = await store.settings("demo");

    const result = await bootstrapStory({
      outputPath: path.join(dir, "story-prover.canon.json"),
    });

    const after = await runCanonListTool(store, { projectId: "demo" });
    const settingsAfter = await store.settings("demo");
    assert.deepEqual(after, before, "canon_list output is byte-identical before and after a bootstrap call");
    assert.deepEqual(settingsAfter, settingsBefore, "project settings are unchanged");
    assert.deepEqual(projectIds, ["demo"], "bootstrap registers no project in the store");

    // The write paths of the proposal flow are still closed on the MCP surface.
    await assert.rejects(() => store.applyConfirmed({} as never), /read-only/i);
    await assert.rejects(() => store.addException({} as never), /read-only/i);

    // Nothing in the draft is confirmed and the store's demo canon is untouched.
    assertAllProposed(result.snapshot, "store-untouched probe");
    const demo = await store.read("demo");
    assert.ok(demo.entries.length > 0, "the demo project still seeds its canon");
    assert.ok(
      demo.entries.some((e) => e.status === "confirmed" && e.locked),
      "the demo project's confirmed locked canon is intact",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4 — ac-3: the draft is written only on outputPath; an existing file is
//     refused untouched
// ---------------------------------------------------------------------------

test("test-authoring: the draft is written only when outputPath is passed and an existing file is refused untouched (ac-3)", async () => {
  const dir = tempDir();
  try {
    // Without outputPath: nothing is written, ever.
    const responseOnly = await bootstrapStory();
    assert.equal(responseOnly.writtenTo, undefined);
    assert.deepEqual(readdirSync(dir), [], "no file is created without outputPath");

    // With outputPath: the file appears and carries exactly the snapshot.
    const draftPath = path.join(dir, "story-prover.canon.json");
    const written = await bootstrapStory({ outputPath: draftPath });
    assert.equal(written.writtenTo, draftPath);
    assert.ok(existsSync(draftPath), "the draft file exists after the outputPath call");
    const fileContent = readFileSync(draftPath, "utf8");
    assert.equal(fileContent, JSON.stringify(written.snapshot, null, 2) + "\n", "the file carries exactly the draft snapshot");
    assert.deepEqual(JSON.parse(fileContent), written.snapshot);

    // An existing outputPath is refused with a clear error; the file is untouched.
    await assert.rejects(
      () => bootstrapStory({ outputPath: draftPath }),
      (err: Error) => {
        assert.match(err.message, /already exists/);
        assert.match(err.message, /never\s+overwrite/i);
        return true;
      },
      "an existing outputPath is refused with a clear error",
    );
    assert.equal(readFileSync(draftPath, "utf8"), fileContent, "the existing draft file is byte-identical after the refusal");

    // A missing parent directory is refused and nothing is created.
    await assert.rejects(
      () => bootstrapStory({ outputPath: path.join(dir, "no-such-dir", "draft.canon.json") }),
      /Parent directory/,
    );
    assert.ok(!existsSync(path.join(dir, "no-such-dir")), "no directory is created for the draft");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5 — ac-3, ac-4: no network module and no nondeterministic API anywhere in
//     the new path
// ---------------------------------------------------------------------------

test("test-authoring: the new bootstrap path contains no network module and no clock/random/locale API (ac-3, ac-4)", () => {
  const coreSource = readFileSync(path.join(REPO_ROOT, "packages", "core", "src", "bootstrap.ts"), "utf8");
  const serverSource = readFileSync(path.join(REPO_ROOT, "packages", "mcp-server", "src", "bootstrap.ts"), "utf8");
  const forbidden: [string, RegExp][] = [
    ["fetch", /\bfetch\b/],
    ["http(s) URL", /https?:\/\//],
    ["http/https/net/tls/dns module", /\bnode:(?:http|https|net|tls|dns|dgram)\b/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["axios", /\baxios\b/],
    ["undici", /\bundici\b/],
    ["Intl", /\bIntl\b/],
    ["Date.now", /\bDate\.now\b/],
    ["new Date", /\bnew Date\b/],
    ["performance.now", /\bperformance\.now\b/],
    ["process.hrtime", /\bprocess\.hrtime\b/],
    ["Math.random", /\bMath\.random\b/],
    ["toLocale*", /\btoLocale[A-Za-z]*\b/],
    ["localeCompare", /\blocaleCompare\b/],
    ["crypto.randomUUID", /\brandomUUID\b/],
  ];
  const offenders: string[] = [];
  for (const [file, content] of [
    ["packages/core/src/bootstrap.ts", coreSource],
    ["packages/mcp-server/src/bootstrap.ts", serverSource],
  ] as const) {
    for (const [label, re] of forbidden) {
      if (re.test(content)) offenders.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(offenders, [], "the new path is offline and deterministic by source inspection");

  // The extractor alone stays pure: the default generatedAt is a fixed epoch.
  assert.equal(DEFAULT_GENERATED_AT, "1970-01-01T00:00:00.000Z");
  const probe = bootstrapCanon({
    projectId: "determinism",
    source: { text: "The old seal is cracked down the middle.", label: "probe" },
  });
  assert.equal(probe.snapshot.entries[0]!.createdAt, DEFAULT_GENERATED_AT, "no wall-clock leaks into the extractor");
});

// ---------------------------------------------------------------------------
// 6 — ac-4: byte-identical reruns; content-derived ids with deterministic
//     collision suffixes
// ---------------------------------------------------------------------------

test("test-authoring: the same input yields byte-identical output and ids are content-derived with deterministic collision suffixes (ac-4)", async () => {
  const first = await bootstrapStory();
  const second = await bootstrapStory();
  assert.equal(JSON.stringify(first), JSON.stringify(second), "two consecutive runs are byte-identical (explicit generatedAt)");

  const defaultFirst = (await runCanonBootstrapTool(BOOTSTRAP_INPUT)) as BootstrapResult;
  const defaultSecond = (await runCanonBootstrapTool(BOOTSTRAP_INPUT)) as BootstrapResult;
  assert.equal(JSON.stringify(defaultFirst), JSON.stringify(defaultSecond), "two consecutive runs are byte-identical (default generatedAt)");
  assert.equal(defaultFirst.generatedAt, DEFAULT_GENERATED_AT, "the default generatedAt is the fixed epoch");

  // Ids are content-derived: char_<kebab name>, canon_<kind>_<first 3 words>,
  // event_<first 3 words>; collisions get deterministic -2/-3 suffixes in
  // textual order.
  const snapshot = first.snapshot;
  assert.deepEqual(
    snapshot.characters.map((c: Character) => c.id),
    ["char_mira", "char_daven", "char_kess"],
    "character ids derive from the canonical names",
  );
  assert.ok(snapshot.entries.every((e: CanonEntry) => e.id.startsWith(`canon_${e.kind}_`)), "entry ids start canon_<kind>_");
  assert.deepEqual(
    snapshot.entries.map((e: CanonEntry) => e.id),
    [
      "canon_rule_every-gate-in",
      "canon_fact_the-old-seal",
      "canon_fact_the-old-seal-2",
      "canon_fact_the-old-seal-3",
      "canon_rule_the-west-tower",
      "canon_history_the-harbor-walls",
      "canon_setting_the-sealed-gate",
    ],
    "entry id collisions get -2 then -3 in textual order",
  );
  assert.deepEqual(
    snapshot.events.map((e: TimelineEvent) => e.id),
    ["event_mira-found-the", "event_daven-found-the", "event_daven-found-the-2", "event_mira-and-daven", "event_daven-won-the"],
    "event id collisions get -2 in textual order",
  );
});

// ---------------------------------------------------------------------------
// 7 — ac-5: the written draft loads through the existing fixture validation
// ---------------------------------------------------------------------------

test("test-authoring: the draft written into a TEMP fixtures dir loads through loadFixtureBundle and loadFixtures (ac-5)", async () => {
  const dir = tempDir();
  try {
    const result = await bootstrapStory({ outputPath: path.join(dir, "story-prover.canon.json") });

    const bundle = loadFixtureBundle(dir, "story-prover");
    assert.deepEqual(bundle.snapshot, result.snapshot, "the draft loads with the exact snapshot it was written from");
    assert.ok(bundle.snapshot.entries.length > 0, "the loaded draft has entries");
    assert.ok(bundle.snapshot.characters.length > 0, "the loaded draft has characters");
    assert.ok(bundle.snapshot.events.length > 0, "the loaded draft has events");
    assert.equal(bundle.settings.projectId, "story-prover", "default settings are derived for the loaded draft");

    const loaded = loadFixtures(dir);
    assert.deepEqual(loaded.projectIds, ["story-prover"], "the draft is discovered as a fixture project");
    assert.deepEqual(loaded.skipped, [], "nothing is skipped: the draft passes the fixture validation");
    assert.deepEqual(await loaded.store.read("story-prover"), result.snapshot, "the store serves the loaded draft");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 8 — ac-6: every FP guard holds on its negative (positives are pinned by
//     the catch table in test 1)
// ---------------------------------------------------------------------------

test("test-authoring: every false-positive guard stays silent on its negative sentence (ac-6)", async () => {
  const result = await bootstrapStory();
  const snapshot = result.snapshot;
  const entryTexts = snapshot.entries.map((e: CanonEntry) => e.text);
  const eventDescriptions = snapshot.events.map((e: TimelineEvent) => e.description);
  const characterNames = snapshot.characters.map((c: Character) => c.name);

  // Single-mention, sentence-initial names are silent (Raven), and a kinship
  // title is stripped from the candidate with its single mention silent (Bren).
  assert.ok(!characterNames.includes("Raven"), "single sentence-initial mention: no character");
  assert.ok(!characterNames.includes("Bren"), "kinship-titled single mention: no character");
  assert.ok(!characterNames.includes("Uncle Bren"), "the kinship title never joins the name");

  // Quoted speech is skipped for entry extraction: the quoted rule-shaped
  // sentence yields no entry (nor any other).
  assert.ok(!entryTexts.includes(SENTENCES[20]), "quoted speech yields no canon entry");
  assert.ok(!entryTexts.some((t) => t.includes("Every door in the keep is barred")), "no entry echoes the quoted rule");
  assert.ok(
    !eventDescriptions.some((d) => d.includes("Every door in the keep is barred")),
    "the quoted steward sentence proposes no event either",
  );

  // The contraction guard: 'won't' never fires the action verb 'won'.
  assert.ok(!eventDescriptions.includes(SENTENCES[17]), "'won't attend' proposes no event");

  // Non-action sentences stay silent even for proposed characters
  // (Mira waited...), and an action verb without a proposed participant
  // stays silent (Raven returned...).
  assert.ok(!eventDescriptions.includes(SENTENCES[21]), "'waited' is not an action verb: no event");
  assert.ok(!eventDescriptions.includes(SENTENCES[18]), "an action verb with no proposed character proposes no event");

  // The modal rule's action-verb overlap ('be entered') still proposes no
  // event: no proposed participant is named in that sentence.
  assert.ok(!eventDescriptions.includes(SENTENCES[12]), "the modal rule sentence proposes no event despite 'entered'");

  // The extractor alone agrees with the tool path on the negatives.
  const direct = bootstrapCanon({
    projectId: "story-prover",
    source: { text: STORY, label: "pasted-text" },
    generatedAt: GENERATED_AT,
  });
  assert.equal(JSON.stringify(direct.snapshot), JSON.stringify(snapshot), "the extractor and the tool path agree on the catch table");
});

// ---------------------------------------------------------------------------
// 9 — ac-7: provenance — spans slice exactly the source sentence, label flows
// ---------------------------------------------------------------------------

test("test-authoring: every source span slices exactly its source sentence and carries the provided label (ac-7)", async () => {
  const defaultLabeled = await bootstrapStory();
  const snapshot = defaultLabeled.snapshot;

  for (const entry of snapshot.entries) {
    assert.equal(entry.sources.length, 1, `entry ${entry.id}: one source span`);
    const span = entry.sources[0]!;
    assert.equal(span.file, "pasted-text", `entry ${entry.id}: default label is pasted-text`);
    assert.equal(
      STORY.slice(span.startOffset, span.endOffset),
      entry.text,
      `entry ${entry.id}: text.slice(start,end) is exactly the source sentence`,
    );
  }
  for (const event of snapshot.events) {
    assert.equal(event.sources.length, 1, `event ${event.id}: one source span`);
    const span = event.sources[0]!;
    assert.equal(span.file, "pasted-text", `event ${event.id}: default label is pasted-text`);
    assert.equal(
      STORY.slice(span.startOffset, span.endOffset),
      event.description,
      `event ${event.id}: text.slice(start,end) is exactly the source sentence`,
    );
  }
  for (const character of snapshot.characters) {
    assert.ok(character.sources.length >= 1, `character ${character.id}: at least one source span`);
    for (const span of character.sources) {
      assert.equal(span.file, "pasted-text", `character ${character.id}: default label is pasted-text`);
      const sentence = STORY.slice(span.startOffset, span.endOffset);
      assert.ok(
        new RegExp(`\\b${character.name}\\b`).test(sentence),
        `character ${character.id}: every source span slices a sentence mentioning the name`,
      );
    }
    assert.equal(
      STORY.slice(character.sources[0]!.startOffset, character.sources[0]!.endOffset),
      character.summary,
      `character ${character.id}: the summary is the first source sentence`,
    );
  }

  // A custom label flows into every span of every item.
  const customLabel = "test-designer/chapter-7.md";
  const custom = await bootstrapStory({ source: { kind: "text", text: STORY, label: customLabel } });
  for (const item of [...custom.snapshot.entries, ...custom.snapshot.characters, ...custom.snapshot.events] as DraftItem[]) {
    for (const span of item.sources) {
      assert.equal(span.file, customLabel, "the custom label reaches every source span");
    }
  }
  // Spans stay sentence-exact under the custom label.
  const firstEntry = custom.snapshot.entries[0] as CanonEntry;
  assert.equal(
    STORY.slice(firstEntry.sources[0]!.startOffset, firstEntry.sources[0]!.endOffset),
    firstEntry.text,
    "custom label: the span still slices exactly the source sentence",
  );
});

// ---------------------------------------------------------------------------
// 10 — ac-8: pins, roster, packages, seeded fixtures, docs
// ---------------------------------------------------------------------------

test("test-authoring: the 16-tool roster pins canon_bootstrap last, the registry pin is intact, no new package or seeded fixture, docs updated (ac-8)", async () => {
  // The four extended tool-list pins, verified at runtime: 15 -> 16 tools,
  // canon_bootstrap appended last after canon_list.
  const bundle = createLorewardensServer();
  assert.deepEqual(
    bundle.tools.map((t: ToolDef) => t.name),
    [
      "analyze_canon_lore",
      "analyze_character_consistency",
      "analyze_timeline",
      "analyze_grammar_mechanics",
      "analyze_vocabulary_repetition",
      "analyze_style_voice",
      "analyze_character_voice",
      "analyze_period_dialect",
      "analyze_plot_thread",
      "analyze_pacing_tension",
      "analyze_pov_consistency",
      "analyze_show_vs_tell",
      "analyze_sensitivity_representation",
      "analyze_theme_motif",
      "canon_list",
      "canon_bootstrap",
    ],
    "the server bundle registers the 16-tool roster with canon_bootstrap last",
  );

  // The registry-derived pin stays byte-identical: continuity agents plus the
  // read-only canon_list, nothing else.
  const { store } = loadFixtures(defaultFixturesDir());
  const registry = createRegistry(CONTINUITY_AGENTS);
  assert.deepEqual(
    buildTools(registry, store).map((t: ToolDef) => t.name),
    ["analyze_canon_lore", "analyze_character_consistency", "analyze_timeline", "canon_list"],
    "the registry-derived pin is byte-identical",
  );

  // The registered ToolDef handler is wired to the bootstrap tool.
  const tool = bundle.tools.find((t: ToolDef) => t.name === "canon_bootstrap")!;
  const throughBundle = (await tool.handler(BOOTSTRAP_INPUT)) as BootstrapResult;
  assert.equal(throughBundle.projectId, "story-prover", "the registered handler serves the bootstrap tool");
  assert.equal(throughBundle.snapshot.entries.length, 7, "the registered handler returns the draft snapshot");

  // No new package: the workspace inventory is unchanged.
  assert.deepEqual(
    readdirSync(path.join(REPO_ROOT, "packages")).sort(),
    ["agents", "bridge", "core", "docs-extension", "mcp-server", "proof"],
    "no new package was added",
  );

  // No changes to packages/agents: no bootstrap code there.
  const agentsDir = path.join(REPO_ROOT, "packages", "agents", "src");
  const offenders: string[] = [];
  for (const file of readdirSync(agentsDir)) {
    if (!file.endsWith(".ts")) continue;
    if (/bootstrap/i.test(readFileSync(path.join(agentsDir, file), "utf8"))) offenders.push(`packages/agents/src/${file}`);
  }
  assert.deepEqual(offenders, [], "packages/agents carries no bootstrap code");

  // No new seeded-fixture files: the demo fixtures dir is exactly the two
  // seeded files, and the proof fixtures still seed exactly the six known
  // projects with nothing skipped.
  assert.deepEqual(
    readdirSync(DEMO_FIXTURES).sort(),
    ["demo.canon.json", "demo.settings.json"],
    "the seeded demo fixtures dir is unchanged",
  );
  const proof = loadFixtures(PROOF_FIXTURES);
  assert.deepEqual(
    proof.projectIds,
    ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"],
    "the proof fixtures still seed exactly the six known projects",
  );
  assert.deepEqual(proof.skipped, [], "no proof fixture is skipped or malformed");

  // Docs: the governance doc, the architecture row, the README tool row and
  // the data-model note all exist and carry the governance substance.
  const gov = readFileSync(path.join(REPO_ROOT, "docs", "canon-bootstrap.md"), "utf8");
  assert.match(gov, /nothing auto-confirms/i, "canon-bootstrap.md documents the governance binding");
  assert.match(gov, /outputPath/, "canon-bootstrap.md documents the outputPath write rule");
  assert.match(gov, /offline|no network/i, "canon-bootstrap.md documents the offline guarantee");
  const architecture = readFileSync(path.join(REPO_ROOT, "docs", "architecture.md"), "utf8");
  assert.match(architecture, /canon[ _-]?bootstrap/i, "architecture.md carries the canon bootstrap component row");
  const readme = readFileSync(path.join(REPO_ROOT, "packages", "mcp-server", "README.md"), "utf8");
  assert.match(readme, /canon_bootstrap/, "the mcp-server README documents the canon_bootstrap tool");
  assert.match(readme, /#.*Canon bootstrap|## Canon bootstrap/i, "the mcp-server README carries the canon bootstrap section");
  const dataModel = readFileSync(path.join(REPO_ROOT, "docs", "living-canon-data-model.md"), "utf8");
  assert.match(dataModel, /bootstrap/i, "the data model doc notes the bootstrap draft");
  assert.match(dataModel, /birthDate|date/i, "the data model note covers the date/birthDate rule for drafts");
});
