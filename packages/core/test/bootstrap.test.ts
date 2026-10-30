import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  BOOTSTRAP_TEXT_CAP,
  bootstrapCanon,
  type BootstrapInput,
  type BootstrapResult,
} from "../src/bootstrap.js";
import type { CanonEntry, Character, TimelineEvent } from "../src/types.js";

function run(text: string, overrides: Partial<BootstrapInput> = {}): BootstrapResult {
  return bootstrapCanon({
    projectId: "qa",
    source: { text, label: "pasted-text" },
    generatedAt: "1970-01-01T00:00:00.000Z",
    ...overrides,
  });
}

function asEntry(item: unknown): CanonEntry {
  return item as CanonEntry;
}

function asCharacter(item: unknown): Character {
  return item as Character;
}

function asEvent(item: unknown): TimelineEvent {
  return item as TimelineEvent;
}

// ---------------------------------------------------------------------------
// governance pins: draft shape, all-proposed, no writer-confirmed fields
// ---------------------------------------------------------------------------

test("draft snapshot is the exact fixture shape and every item is proposed (ac-1)", () => {
  const { snapshot, notes } = run(
    "Daven sat with Mira, and Mira carried the lamp. Mira found the lamp at the tent. Every gate closes at dusk.",
  );
  assert.equal(snapshot.projectId, "qa");
  assert.ok(Array.isArray(snapshot.entries));
  assert.ok(Array.isArray(snapshot.characters));
  assert.ok(Array.isArray(snapshot.events));
  assert.ok(snapshot.entries.length > 0);
  assert.ok(snapshot.characters.length > 0);
  assert.ok(snapshot.events.length > 0);
  for (const item of [...snapshot.entries, ...snapshot.characters, ...snapshot.events]) {
    assert.equal(item.status, "proposed");
    assert.equal(item.locked, false);
    assert.equal("lockReason" in item, false);
    assert.equal(item.createdAt, "1970-01-01T00:00:00.000Z");
    assert.equal(item.updatedAt, "1970-01-01T00:00:00.000Z");
    assert.equal(item.projectId, "qa");
  }
  for (const event of snapshot.events) {
    assert.equal(event.precision, "fuzzy");
    assert.equal("date" in event, false, "a bootstrap draft never fabricates a date");
    assert.equal("location" in event, false);
  }
  for (const character of snapshot.characters) {
    assert.equal("birthDate" in character, false, "birthDate is writer-confirmed");
    assert.equal("voice" in character, false);
    assert.deepEqual(character.traits, []);
    assert.deepEqual(character.abilities, []);
    assert.deepEqual(character.injuries, []);
    assert.deepEqual(character.goals, []);
    assert.deepEqual(character.relationships, []);
  }
  assert.ok(notes.length > 0);
  assert.match(notes[0]!, /proposed/);
});

test("event order is monotonic in textual sentence order starting at 1 (ac-1)", () => {
  const { snapshot } = run(
    "Daven watched Mira work while Mira smiled. Mira left the tent. Mira entered the gate. Mira found the lamp.",
  );
  assert.equal(snapshot.events.length, 3);
  assert.deepEqual(
    snapshot.events.map((e) => e.order),
    [1, 2, 3],
  );
  for (const event of snapshot.events) {
    assert.deepEqual(event.participants, ["char_mira"]);
  }
});

// ---------------------------------------------------------------------------
// characters: evidence gate, attribution, recurrence, stoplist, aliases
// ---------------------------------------------------------------------------

test("dialogue attribution proposes a character (X said, and said X)", () => {
  const direct = run("Mira said the gate was sealed.");
  assert.equal(direct.snapshot.characters.length, 1);
  const mira = asCharacter(direct.snapshot.characters[0]);
  assert.equal(mira.name, "Mira");
  assert.equal(mira.id, "char_mira");
  assert.equal(mira.summary, "Mira said the gate was sealed.");

  const inverted = run('"Lovely," said Mira.');
  assert.equal(inverted.snapshot.characters.length, 1);
  assert.equal(asCharacter(inverted.snapshot.characters[0]).name, "Mira");
});

test("two non-sentence-initial mentions propose a character; a single mention stays silent", () => {
  const recurring = run("Daven walked with Mira, and Mira carried the lamp.");
  const names = recurring.snapshot.characters.map((c) => c.name);
  assert.deepEqual(names, ["Mira"], "Daven appears once non-initially and stays silent");

  const single = run("Daven walked with Mira.");
  assert.deepEqual(single.snapshot.characters, []);

  const initialOnly = run("Mira smiled. Mira waved.");
  assert.deepEqual(initialOnly.snapshot.characters, [], "only-ever sentence-initial names stay silent");
});

test("stoplisted words never become characters (kinship titles, days, Chapter)", () => {
  const { snapshot } = run("Mother said the road was closed. Chapter Two began on Monday.");
  assert.deepEqual(snapshot.characters, []);
});

test("possessives collapse onto the base name", () => {
  const { snapshot } = run("Daven's map lay open while Daven laughed. Mira watched Daven work.");
  assert.equal(snapshot.characters.length, 1);
  const daven = asCharacter(snapshot.characters[0]);
  assert.equal(daven.name, "Daven", "canonical name comes from the first occurrence, unpossessed");
  assert.equal(daven.id, "char_daven");
});

test("quoted nickname apposition yields an alias on the merged name", () => {
  const { snapshot } = run('Mira "Miri" Halvard said nothing.');
  assert.equal(snapshot.characters.length, 1);
  const mira = asCharacter(snapshot.characters[0]);
  assert.equal(mira.name, "Mira Halvard");
  assert.equal(mira.id, "char_mira-halvard");
  assert.deepEqual(mira.aliases, ["Miri"]);
});

test("epithet apposition (Name, the X,) yields an alias and counts toward evidence", () => {
  const { snapshot } = run(
    "Mira, the cartographer, unrolled her map. Daven sat with Mira, and Mira carried the lamp.",
  );
  const mira = snapshot.characters.find((c) => c.name === "Mira");
  assert.ok(mira);
  assert.deepEqual(mira.aliases, ["the cartographer"]);
});

test("character sources cover exactly the sentences that mention the name (ac-7)", () => {
  const text = "Daven watched Mira work while Mira smiled. Mira left the tent.";
  const { snapshot } = run(text);
  const mira = snapshot.characters.find((c) => c.name === "Mira")!;
  assert.equal(mira.sources.length, 2);
  for (const span of mira.sources) {
    assert.equal(span.file, "pasted-text");
    const sliced = text.slice(span.startOffset, span.endOffset);
    assert.ok(
      /^(Daven watched Mira work while Mira smiled|Mira left the tent)\.$/.test(sliced),
      `unexpected span slice: ${sliced}`,
    );
  }
});

// ---------------------------------------------------------------------------
// canon entries: rule / history / setting / fact, dialogue skip, dedupe, tags
// ---------------------------------------------------------------------------

test("sentence-initial quantifier fires a rule and outranks the place cue", () => {
  const { snapshot } = run("Every gate closes at dusk.");
  assert.equal(snapshot.entries.length, 1);
  assert.equal(asEntry(snapshot.entries[0]).kind, "rule");

  const noRule = run("No ships leave the harbor in winter.");
  assert.equal(noRule.snapshot.entries.length, 1);
  assert.equal(asEntry(noRule.snapshot.entries[0]).kind, "rule");
});

test("law/modal cues fire a rule", () => {
  const mayOnly = run("The city wall may only be opened at dawn.");
  assert.equal(asEntry(mayOnly.snapshot.entries[0]).kind, "rule");

  const must = run("One must pay a memory for each spell.");
  assert.equal(asEntry(must.snapshot.entries[0]).kind, "rule");

  const cannot = run("The dead cannot cross the river.");
  assert.equal(asEntry(cannot.snapshot.entries[0]).kind, "rule");
});

test("past-tense copular plus era cue fires history; plain past does not", () => {
  const history = run("The siege had lasted nine years.");
  assert.equal(asEntry(history.snapshot.entries[0]).kind, "history");

  const plainPast = run("The gate was closed.");
  assert.equal(plainPast.snapshot.entries.length, 1);
  assert.equal(asEntry(plainPast.snapshot.entries[0]).kind, "setting", "was without an era cue falls through to the place cue");
});

test("place-cue noun fires setting and outranks the copular fact fallback", () => {
  const setting = run("The village has a stone bridge.");
  assert.equal(asEntry(setting.snapshot.entries[0]).kind, "setting");
});

test("copular declarations without any other cue become facts", () => {
  const fact = run("Mira has a scar on her left hand.");
  assert.equal(fact.snapshot.entries.length, 1);
  assert.equal(asEntry(fact.snapshot.entries[0]).kind, "fact");
  assert.deepEqual(fact.snapshot.characters, [], "sentence-initial-only Mira stays silent");
});

test("non-copular sentences without place cues produce no entry", () => {
  const { snapshot } = run("Daven dropped the measuring line again.");
  assert.deepEqual(snapshot.entries, []);
});

test("sentences inside double quotes are skipped for entry extraction", () => {
  const quoted = run('The herald said, "Every gate closes at dusk."');
  assert.deepEqual(quoted.snapshot.entries, []);
  assert.ok(quoted.notes.some((n) => /double quotes/.test(n)));

  const pureQuote = run('"Every gate closes at dusk." The herald bowed.');
  assert.deepEqual(pureQuote.snapshot.entries, []);
});

test("exact-text dedupe keeps one proposal per unique sentence", () => {
  const { snapshot } = run("The gate is sealed. The gate is sealed.");
  assert.equal(snapshot.entries.length, 1);
  const entry = asEntry(snapshot.entries[0]);
  assert.equal(entry.text, "The gate is sealed.");
  assert.equal(entry.sources.length, 1);
});

test("tags are the first content words, lowercased, stoplist removed", () => {
  const { snapshot } = run("The Weeping Gate is sealed since the siege.");
  assert.deepEqual(asEntry(snapshot.entries[0]).tags, ["weeping", "gate", "sealed"]);
});

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

test("an event needs a proposed character plus an action verb; one max per sentence", () => {
  const text =
    "Daven sat with Mira, and Mira carried the lamp. Daven found Mira at the tent. Mira smiled at the map.";
  const { snapshot } = run(text);
  assert.equal(snapshot.events.length, 1, "one max per sentence, and the smile is not an action");
  const event = asEvent(snapshot.events[0]);
  assert.equal(event.description, "Daven found Mira at the tent.");
  assert.equal(event.order, 1);
  assert.deepEqual(event.participants, ["char_mira"], "only PROPOSED characters become participants");
});

test("participants are listed in appearance order", () => {
  const { snapshot } = run(
    "Daven watched Mira work while Mira smiled. Mira waved while Daven left the tent, and Daven laughed.",
  );
  const event = asEvent(snapshot.events[0]);
  assert.deepEqual(event.participants, ["char_mira", "char_daven"]);
});

test("non-action sentences produce no event", () => {
  const { snapshot } = run("Mira sat with Daven. Daven carried the lamp.");
  assert.deepEqual(snapshot.events, []);
});

test("contractions of action verbs do not fire events", () => {
  const { snapshot } = run("Daven sat with Mira, and Mira carried the lamp. Mira won't leave the tent.");
  assert.deepEqual(snapshot.events, [], "won't is not the action verb won");
});

// ---------------------------------------------------------------------------
// ids, provenance, cap, determinism
// ---------------------------------------------------------------------------

test("ids are content-derived kebab-case with deterministic collision suffixes", () => {
  const { snapshot } = run("The gate is sealed. The gate is sealed again.");
  assert.deepEqual(
    snapshot.entries.map((e) => e.id),
    ["canon_setting_the-gate-is", "canon_setting_the-gate-is-2"],
  );
});

test("every source span slices exactly its sentence from the given text (ac-7)", () => {
  const text =
    "Every gate closes at dusk. Daven walked with Mira, and Mira carried the lamp. Mira found the lamp at the tent.";
  const { snapshot } = run(text, {
    source: { text, label: "chapter-1.md" },
  });
  for (const entry of snapshot.entries) {
    for (const span of entry.sources) {
      assert.equal(span.file, "chapter-1.md");
      assert.equal(text.slice(span.startOffset, span.endOffset), entry.text);
    }
  }
  for (const character of snapshot.characters) {
    for (const span of character.sources) {
      const sliced = text.slice(span.startOffset, span.endOffset);
      assert.match(sliced, /Mira/);
      assert.ok(sliced.endsWith("."));
    }
  }
  for (const event of snapshot.events) {
    for (const span of event.sources) {
      assert.equal(text.slice(span.startOffset, span.endOffset), event.description);
    }
  }
});

test("the source cap rejects oversized text with a split-the-story error", () => {
  const over = "a".repeat(BOOTSTRAP_TEXT_CAP + 1);
  assert.throws(() => run(over), /Split the story and bootstrap it in parts/);
  const exact = "a".repeat(BOOTSTRAP_TEXT_CAP);
  assert.doesNotThrow(() => run(exact));
});

test("same input yields byte-identical output across runs (ac-4)", () => {
  const text =
    "Mira, the cartographer, unrolled her map. Daven sat with Mira, and Mira carried the lamp. " +
    'Mira "Miri" Halvard said nothing. Every gate closes at dusk. Mira found the lamp at the tent.';
  const first = run(text);
  const second = run(text);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("generatedAt stamps every item; the default is the fixed epoch constant", () => {
  const stamped = run("Every gate closes at dusk.", {
    generatedAt: "2026-10-30T09:30:00.000Z",
  });
  assert.equal(asEntry(stamped.snapshot.entries[0]).createdAt, "2026-10-30T09:30:00.000Z");
  assert.equal(asEntry(stamped.snapshot.entries[0]).updatedAt, "2026-10-30T09:30:00.000Z");

  const defaulted = run("Every gate closes at dusk.");
  assert.equal(asEntry(defaulted.snapshot.entries[0]).createdAt, "1970-01-01T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// source hygiene guards: no network, no nondeterminism in the extraction path
// ---------------------------------------------------------------------------

test("bootstrap source contains no network entry points and no nondeterministic APIs", () => {
  const sourcePath = fileURLToPath(new URL("../../src/bootstrap.ts", import.meta.url));
  const source = readFileSync(sourcePath, "utf8");
  const forbidden: [string, RegExp][] = [
    ["fetch(", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["axios", /\baxios\b/],
    ["undici", /\bundici\b/],
    ["node:http", /node:http/],
    ["node:net", /node:net\b/],
    ["node:tls", /node:tls\b/],
    ["node:dns", /node:dns\b/],
    ["URL", /\bhttps?:\/\//],
    ["Date.now", /\bDate\.now\b/],
    ["new Date", /\bnew Date\b/],
    ["Math.random", /\bMath\.random\b/],
    ["locale API", /\btoLocale[A-Za-z]*\b/],
    ["localeCompare", /\blocaleCompare\b/],
  ];
  const offenders = forbidden.filter(([, re]) => re.test(source)).map(([label]) => label);
  assert.deepEqual(offenders, []);
});
