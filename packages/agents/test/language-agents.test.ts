import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalyzeInput, CanonContext, CanonEntry, Character, Finding } from "@lorewardens/core";
import {
  AGENT_DESCRIPTORS,
  ALL_AGENTS,
  CHARACTER_VOICE_AGENT,
  CONTINUITY_AGENTS,
  GRAMMAR_MECHANICS_AGENT,
  LANGUAGE_AGENTS,
  NARRATIVE_AGENTS,
  OPTIONAL_AGENTS,
  PERIOD_DIALECT_AGENT,
  STYLE_VOICE_AGENT,
  VOCABULARY_REPETITION_AGENT,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T09:00:00.000Z";

function entry(id: string, text: string, overrides: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id,
    projectId: "p1",
    kind: "rule",
    text,
    tags: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function character(id: string, name: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    projectId: "p1",
    name,
    aliases: [],
    summary: "",
    traits: [],
    abilities: [],
    injuries: [],
    goals: [],
    relationships: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function chunk(text: string, startOffset = 0) {
  return { text, span: { file: "ch1.md", startOffset, endOffset: startOffset + text.length } };
}

const EMPTY_CONTEXT: CanonContext = { entries: [], characters: [], events: [] };
const EMPTY_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

function analyzeInput(partial: Partial<AnalyzeInput>, strictness: "gentle" | "standard" | "strict"): AnalyzeInput {
  return {
    projectId: "p1",
    chunk: chunk(""),
    context: EMPTY_CONTEXT,
    strictness,
    settings: EMPTY_SETTINGS,
    ...partial,
  };
}

function assertShape(finding: Finding, pins: { severity: string; confidence: number; minStrictness: string }) {
  assert.ok(finding.message.length > 0, "message explains the problem");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.file.length > 0, "location has a file");
  assert.ok(finding.location.endOffset > finding.location.startOffset, "location spans text");
  assert.equal(finding.severity, pins.severity, "severity pin");
  assert.equal(finding.confidence, pins.confidence, "confidence pin");
  assert.equal(finding.minStrictness, pins.minStrictness, "minStrictness pin");
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test("the five language agents are exported behind the same contract", () => {
  assert.deepEqual(
    LANGUAGE_AGENTS.map((a) => a.id),
    ["grammar-mechanics", "vocabulary-repetition", "style-voice", "character-voice", "period-dialect"],
  );
  assert.deepEqual(ALL_AGENTS.map((a) => a.id), [
    ...CONTINUITY_AGENTS.map((a) => a.id),
    ...LANGUAGE_AGENTS.map((a) => a.id),
    ...NARRATIVE_AGENTS.map((a) => a.id),
    ...OPTIONAL_AGENTS.map((a) => a.id),
  ]);
  for (const agent of LANGUAGE_AGENTS) {
    assert.equal(typeof agent.analyze, "function");
    assert.equal(agent.descriptor, AGENT_DESCRIPTORS.find((d) => d.id === agent.id));
    assert.equal(agent.descriptor.family, "language");
    assert.equal(agent.descriptor.defaultStrictness, "standard");
    assert.deepEqual(agent.descriptor.options, []);
  }
});

// ---------------------------------------------------------------------------
// Grammar / Mechanics
// ---------------------------------------------------------------------------

test("grammar: doubled word is gentle-eligible and survives every level", async () => {
  const chunkText = chunk("The herald read the the proclamation twice.");
  for (const level of ["gentle", "standard", "strict"] as const) {
    const findings = await GRAMMAR_MECHANICS_AGENT.analyze(analyzeInput({ chunk: chunkText }, level));
    assert.equal(findings.length, 1, `doubled word surfaces at ${level}`);
    assert.equal(findings[0].type, "grammar-mechanical-error");
    assertShape(findings[0], { severity: "minor", confidence: 0.9, minStrictness: "gentle" });
  }
});

test("grammar: each mechanical pattern fires, and the excluded shapes stay silent", async () => {
  const cases: [string, boolean][] = [
    ["She counted the coins , tied the purse , and left.", true],
    ["He stammered ,, then gave up.", true],
    ["Wait .. what did she mean.", true],
    ["The candles burned low... until dawn.", false],
    ["A shout, then?! Nothing.", false],
    ["he whispered that i was late.", true],
    ["he said i'd regret it.", true],
    ["She knew that I was right.", false],
    ["A clean sentence with no mechanical error at all.", false],
  ];
  for (const [text, shouldFlag] of cases) {
    const findings = await GRAMMAR_MECHANICS_AGENT.analyze(analyzeInput({ chunk: chunk(text) }, "gentle"));
    assert.equal(
      findings.some((f) => f.type === "grammar-mechanical-error"),
      shouldFlag,
      `mechanical-error ${shouldFlag ? "expected" : "not expected"}: '${text}'`,
    );
  }
});

test("grammar: odd straight quotes flagged chunk-scoped at standard, silent at gentle", async () => {
  const odd = chunk('"Room\'s warm," the innkeeper said, "and the stew is hot until the bell.');
  const standard = await GRAMMAR_MECHANICS_AGENT.analyze(analyzeInput({ chunk: odd }, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "grammar-unbalanced-quotes");
  assertShape(standard[0], { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  const gentle = await GRAMMAR_MECHANICS_AGENT.analyze(analyzeInput({ chunk: odd }, "gentle"));
  assert.deepEqual(gentle, [], "unbalanced quotes are a standard-pinned note");

  const balanced = chunk('The innkeeper said, "Room\'s warm," and slid the key across the bar.');
  assert.deepEqual(
    await GRAMMAR_MECHANICS_AGENT.analyze(analyzeInput({ chunk: balanced }, "strict")),
    [],
    "even quote count stays silent",
  );
});

// ---------------------------------------------------------------------------
// Vocabulary / Repetition
// ---------------------------------------------------------------------------

test("vocabulary: a stem three times in the chunk is overuse at standard, not at gentle", async () => {
  const text = chunk("The old lantern by the docks went out. A second lantern took its place. By midnight even that lantern burned low.");
  const standard = await VOCABULARY_REPETITION_AGENT.analyze(analyzeInput({ chunk: text }, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "vocabulary-overuse");
  assertShape(standard[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.match(standard[0].message, /'lantern'/);
  assert.match(standard[0].message, /3 times/);
  assert.deepEqual(standard[0].canonRefs, []);
  const gentle = await VOCABULARY_REPETITION_AGENT.analyze(analyzeInput({ chunk: text }, "gentle"));
  assert.deepEqual(gentle, [], "overuse is a standard-pinned note");
});

test("vocabulary: confirmed names are excluded from repetition counting", async () => {
  const context: CanonContext = { entries: [], characters: [character("char_marda", "Marda")], events: [] };
  const text = chunk("Marda had warned them about the ford. Marda knew the water best. Trust Marda and cross at dawn.");
  const findings = await VOCABULARY_REPETITION_AGENT.analyze(analyzeInput({ chunk: text, context }, "strict"));
  assert.deepEqual(findings, [], "a repeated character name is never a repetition finding");
});

test("vocabulary: a stem twice in one sentence is an echo, strict only", async () => {
  const text = chunk("He whispered the name again, the name that had started all of this.");
  const standard = await VOCABULARY_REPETITION_AGENT.analyze(analyzeInput({ chunk: text }, "standard"));
  assert.deepEqual(standard, [], "echo stays below the standard floor");
  const strict = await VOCABULARY_REPETITION_AGENT.analyze(analyzeInput({ chunk: text }, "strict"));
  assert.equal(strict.length, 1);
  assert.equal(strict[0].type, "vocabulary-echo");
  assertShape(strict[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
});

// ---------------------------------------------------------------------------
// Style / Voice
// ---------------------------------------------------------------------------

test("style: a rhythm outlier against the chunk median is strict only", async () => {
  const text = chunk(
    "The bell rang. Servants scattered. Horses were pulled from the stable line. Everyone knew what the long bell meant, and the yard emptied in moments, leaving only the steward standing alone with the arrival list clutched against his chest, reading it again as if a second look could change the name at the bottom.",
  );
  const standard = await STYLE_VOICE_AGENT.analyze(analyzeInput({ chunk: text }, "standard"));
  assert.deepEqual(standard, [], "rhythm shift stays below the standard floor");
  const strict = await STYLE_VOICE_AGENT.analyze(analyzeInput({ chunk: text }, "strict"));
  assert.equal(strict.length, 1);
  assert.equal(strict[0].type, "style-rhythm-shift");
  assertShape(strict[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.ok(strict[0].quote.startsWith("Everyone knew"), "the outlier sentence is quoted");
  assert.deepEqual(strict[0].canonRefs, []);
});

test("style: short chunks never produce rhythm findings", async () => {
  const text = chunk("One huge enormously long sentence with a great many words would be here if it were present in this very short chunk of prose.");
  assert.deepEqual(await STYLE_VOICE_AGENT.analyze(analyzeInput({ chunk: text }, "strict")), []);
});

test("style: a contraction-driven formality shift fires at standard", async () => {
  const text = chunk(
    "The council convened at dawn. Each member took the seat reserved for his office. The record was read aloud without comment. Judgment would follow the evidence, as the law required. " +
      "Then the youngest of them stood. He said the record doesn't tell the whole truth. Two of the old guard whispered that they'd seen a page altered. Someone shouted that he won't sit quietly for it.",
  );
  const standard = await STYLE_VOICE_AGENT.analyze(analyzeInput({ chunk: text }, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "style-formality-shift");
  assertShape(standard[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.ok(standard[0].quote.startsWith("Then the youngest"), "finding sits at the first sentence of the deviant half");
  const gentle = await STYLE_VOICE_AGENT.analyze(analyzeInput({ chunk: text }, "gentle"));
  assert.deepEqual(gentle, [], "formality shift is a standard-pinned note");
});

// ---------------------------------------------------------------------------
// Character Voice
// ---------------------------------------------------------------------------

const ELINOR = character("char_elinor", "Elinor", {
  voice: "Scholarly and warm. She never says 'destiny'; she prefers 'the road that made us'.",
});
const TAM = character("char_tam", "Tam", { voice: "Blunt and clipped. He doesn't use contractions, even when angry." });

test("character-voice: avoid-phrase in attributed dialogue drifts at standard", async () => {
  const context: CanonContext = { entries: [], characters: [ELINOR], events: [] };
  const text = chunk('Elinor smoothed the map and said, "Call it destiny if you like, but the road decides."');
  const findings = await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: text, context }, "standard"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "voice-drift");
  assertShape(findings[0], { severity: "minor", confidence: 0.8, minStrictness: "standard" });
  assert.deepEqual(findings[0].canonRefs, ["char_elinor"]);
  const gentle = await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: text, context }, "gentle"));
  assert.deepEqual(gentle, [], "unlocked voice drift is a standard-pinned note");
});

test("character-voice: no-contraction cue plus contracted dialogue drifts", async () => {
  const context: CanonContext = { entries: [], characters: [TAM], events: [] };
  const text = chunk('Tam crossed his arms and said, "I won\'t ride out tonight."');
  const findings = await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: text, context }, "standard"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "voice-drift");
  assert.deepEqual(findings[0].canonRefs, ["char_tam"]);
  const clean = chunk('Tam crossed his arms and said, "The gate holds."');
  assert.deepEqual(
    await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: clean, context }, "strict")),
    [],
    "dialogue that honors the voice stays silent",
  );
});

test("character-voice: locked characters escalate to major/0.95/gentle", async () => {
  const context: CanonContext = { entries: [], characters: [{ ...TAM, locked: true }], events: [] };
  const text = chunk('Tam crossed his arms and said, "I won\'t ride out tonight."');
  const findings = await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: text, context }, "gentle"));
  assert.equal(findings.length, 1, "locked drift reaches gentle");
  assertShape(findings[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
});

test("character-voice: attribution heuristic — alias counts, bare narration and unattributed quotes do not", async () => {
  const aliased = character("char_elinor", "Elinor", { aliases: ["the cartographer"], voice: ELINOR.voice });
  const context: CanonContext = { entries: [], characters: [aliased], events: [] };
  const byAlias = chunk('The cartographer frowned and said, "Call it destiny if you like."');
  const findings = await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: byAlias, context }, "standard"));
  assert.equal(findings.length, 1, "dialogue attributed through an alias still drifts");

  const noQuotes = chunk("Elinor said that destiny was a lazy word for hope.");
  assert.deepEqual(
    await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: noQuotes, context }, "strict")),
    [],
    "a sentence without quoted speech is not attributed dialogue",
  );

  const unattributed = chunk('Someone at the table said, "Call it destiny if you like."');
  assert.deepEqual(
    await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: unattributed, context }, "strict")),
    [],
    "a quoted span with no character mention is not attributed",
  );
});

test("character-voice: graceful degradation without a voice field or usable cues", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [
      character("char_marda", "Marda"),
      character("char_plain", "Corvin", { voice: "Speaks plainly and often." }),
    ],
    events: [],
  };
  const text = chunk('Marda said, "Whatever you like." Corvin said, "Whatever you like."');
  assert.deepEqual(
    await CHARACTER_VOICE_AGENT.analyze(analyzeInput({ chunk: text, context }, "strict")),
    [],
    "no voice field or cue-free voice stays silent",
  );
});

// ---------------------------------------------------------------------------
// Period / Dialect
// ---------------------------------------------------------------------------

const PERIOD_RULE = entry("canon_rule_period_voice", "The story is set in a medieval kingdom; the narrative keeps a formal, period voice.");

test("period: the gate requires a confirmed pre-1900 period entry", async () => {
  const anachronismChunk = chunk("The watchman spoke into his telephone and ordered the bridge opened.");

  const gated: CanonContext = { entries: [PERIOD_RULE], characters: [], events: [] };
  const findings = await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: anachronismChunk, context: gated }, "standard"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "period-anachronism");
  assertShape(findings[0], { severity: "minor", confidence: 0.85, minStrictness: "standard" });
  assert.deepEqual(findings[0].canonRefs, ["canon_rule_period_voice"]);

  const ungated: CanonContext = { entries: [], characters: [], events: [] };
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: anachronismChunk, context: ungated }, "strict")),
    [],
    "no period entry: the agent stays silent",
  );

  const proposedGate: CanonContext = {
    entries: [{ ...PERIOD_RULE, status: "proposed" }],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: anachronismChunk, context: proposedGate }, "strict")),
    [],
    "unconfirmed period entry: the agent stays silent",
  );
});

test("period: a modern-language intent entry switches the agent off", async () => {
  const context: CanonContext = {
    entries: [
      PERIOD_RULE,
      entry("canon_rule_modern_voice", "The narrator uses modern language on purpose.", { kind: "rule" }),
    ],
    characters: [],
    events: [],
  };
  const text = chunk("The watchman spoke into his telephone and said, okay, the bridge is open.");
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: text, context }, "strict")),
    [],
    "the writer said modern language is intentional",
  );
});

test("period: a locked gate entry escalates anachronisms to major/0.95/gentle", async () => {
  const context: CanonContext = { entries: [{ ...PERIOD_RULE, locked: true }], characters: [], events: [] };
  const text = chunk("The watchman spoke into his telephone and ordered the bridge opened.");
  const findings = await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: text, context }, "gentle"));
  assert.equal(findings.length, 1);
  assertShape(findings[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
});

test("period: slang is a register mismatch at standard, never escalated by the lock", async () => {
  const context: CanonContext = { entries: [{ ...PERIOD_RULE, locked: true }], characters: [], events: [] };
  const text = chunk("You gonna tell me the ferry is late again, or should I ask the harbor master myself?");
  const findings = await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: text, context }, "standard"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "period-register-mismatch");
  assertShape(findings[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.deepEqual(findings[0].canonRefs, ["canon_rule_period_voice"]);
  const gentle = await PERIOD_DIALECT_AGENT.analyze(analyzeInput({ chunk: text, context }, "gentle"));
  assert.deepEqual(gentle, [], "register mismatch is a standard-pinned note even under a locked gate");
});

// ---------------------------------------------------------------------------
// Strictness matrix: off never invokes
// ---------------------------------------------------------------------------

test("off strictness never invokes any of the five agents", async () => {
  for (const agent of LANGUAGE_AGENTS) {
    const result = await agent.analyze({
      projectId: "p1",
      chunk: chunk("The the telephone gonna i'm i've i'll i'd okay."),
      context: {
        entries: [PERIOD_RULE],
        characters: [{ ...TAM, voice: "He doesn't use contractions." }],
        events: [],
      },
      strictness: "off",
      settings: EMPTY_SETTINGS,
    });
    assert.deepEqual(result, [], `${agent.id} must not run at off`);
  }
});
