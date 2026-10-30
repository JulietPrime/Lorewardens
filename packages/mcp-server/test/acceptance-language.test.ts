import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  AnalyzeInput,
  CanonContext,
  CanonEntry,
  Character,
  Finding,
  Strictness,
} from "@lorewardens/core";
import { createRegistry } from "@lorewardens/core";
import {
  ALL_AGENTS,
  CHARACTER_VOICE_AGENT,
  CONTINUITY_AGENTS,
  LANGUAGE_AGENTS,
  PERIOD_DIALECT_AGENT,
} from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { loadFixtures } from "../src/store.js";
import { validateFinding } from "../src/validate.js";
import { createLorewardensServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Independent QA acceptance suite for the five Language & Prose agents.
//
// Every prose sample and every canon fixture below is authored for this
// suite (nothing is reused from the seeded proof manuscripts), and every
// finding is driven through the real MCP tool path (runAnalyzeTool) against
// a purpose-built fixture store. Direct agent calls are used only where a
// fixture project cannot express the canon state (locked characters,
// proposed gates, writer intent). One test cross-checks the shipped proof
// fixtures, where the increment-1 projects must keep the language roster
// explicitly disabled.
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T09:00:00.000Z";
const QA_FILE = "qa/independent-chapter.md";

const LANGUAGE_IDS = [
  "grammar-mechanics",
  "vocabulary-repetition",
  "style-voice",
  "character-voice",
  "period-dialect",
] as const;
const CONTINUITY_IDS = ["canon-lore", "character-consistency", "timeline"] as const;

// -- Purpose-built fixture store -------------------------------------------

const PERIOD_RULE_TEXT = "The story is set in a medieval kingdom; the narrative keeps a formal, period voice.";

function entryJson(id: string, text: string, overrides: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id,
    projectId: "qa-language",
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

function characterJson(projectId: string, id: string, name: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    projectId,
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

const ELINOR_VOICE = "Dry and precise. She never says 'destiny'; she distrusts grand words.";
const TAM_VOICE = "Clipped and formal. He does not use contractions, even when hurried.";

const QA_CANON = {
  projectId: "qa-language",
  entries: [entryJson("canon_rule_qa_period", PERIOD_RULE_TEXT)],
  characters: [
    characterJson("qa-language", "char_qa_elinor", "Elinor", { voice: ELINOR_VOICE }),
    characterJson("qa-language", "char_qa_tam", "Tam", { voice: TAM_VOICE }),
    characterJson("qa-language", "char_qa_marda", "Marda"),
  ],
  events: [],
};

function settingsJson(projectId: string, agents: { agentId: string; enabled: boolean }[]) {
  return {
    projectId,
    agents: agents.map((a) => ({ ...a, strictness: "standard", options: {} })),
    exceptions: [],
    dismissed: [],
  };
}

const QA_SETTINGS = settingsJson("qa-language", [
  ...CONTINUITY_IDS.map((agentId) => ({ agentId, enabled: false })),
  ...LANGUAGE_IDS.map((agentId) => ({ agentId, enabled: true })),
]);

// A stand-in for an increment-1 project: the continuity roster runs, the
// language roster is explicitly off.
const LEGACY_SETTINGS = settingsJson("qa-legacy", [
  { agentId: "canon-lore", enabled: true },
  { agentId: "character-consistency", enabled: true },
  { agentId: "timeline", enabled: true },
  ...LANGUAGE_IDS.map((agentId) => ({ agentId, enabled: false })),
]);

const LEGACY_CANON = { projectId: "qa-legacy", entries: [], characters: [], events: [] };

const tmpRoot = mkdtempSync(join(tmpdir(), "lore-qa-language-"));
process.on("exit", () => rmSync(tmpRoot, { recursive: true, force: true }));
for (const [name, body] of [
  ["qa-language.canon.json", QA_CANON],
  ["qa-language.settings.json", QA_SETTINGS],
  ["qa-legacy.canon.json", LEGACY_CANON],
  ["qa-legacy.settings.json", LEGACY_SETTINGS],
] as const) {
  writeFileSync(join(tmpRoot, name), JSON.stringify(body, null, 2));
}

const { store, projectIds, skipped } = loadFixtures(tmpRoot);

// -- Helpers ----------------------------------------------------------------

const AGENT_BY_ID = new Map<string, (typeof ALL_AGENTS)[number]>(ALL_AGENTS.map((a) => [a.id, a]));
type Level = Exclude<Strictness, "off">;

async function analyzeTool(
  agentId: string,
  projectId: string,
  text: string,
  strictness?: Level,
  fixtureStore: typeof store = store,
): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  return (await runAnalyzeTool(agent, fixtureStore, {
    projectId,
    chunk: { text, file: QA_FILE, startOffset: 0, endOffset: text.length },
    ...(strictness ? { strictness } : {}),
  })) as AnalyzeToolResult;
}

function findingsOf(result: AnalyzeToolResult): Finding[] {
  return (result.findings ?? []) as Finding[];
}

function assertPinned(finding: Finding, pins: { severity: string; confidence: number; minStrictness: string }): void {
  assert.equal(finding.severity, pins.severity, "severity pin");
  assert.equal(finding.confidence, pins.confidence, "confidence pin");
  assert.equal(finding.minStrictness, pins.minStrictness, "minStrictness pin");
  assert.ok(finding.message.length > 0, "message explains the problem");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.endOffset > finding.location.startOffset, "location spans text");
  assert.deepEqual(validateFinding(finding), [], "finding is schema-valid per the MCP validator");
}

// Direct-agent fixtures for canon states the fixture projects cannot express.

function qaEntry(id: string, text: string, overrides: Partial<CanonEntry> = {}): CanonEntry {
  return entryJson(id, text, { projectId: "qa", ...overrides });
}

function qaCharacter(id: string, name: string, overrides: Partial<Character> = {}): Character {
  return characterJson("qa", id, name, overrides);
}

function directInput(text: string, context: CanonContext, strictness: Level): AnalyzeInput {
  return {
    projectId: "qa",
    chunk: { text, span: { file: QA_FILE, startOffset: 0, endOffset: text.length } },
    context,
    strictness,
    settings: { projectId: "qa", agents: [], exceptions: [], dismissed: [] },
  };
}

// ---------------------------------------------------------------------------
// ac-1 — contract and registration
// ---------------------------------------------------------------------------

test("acceptance: the five language agents are registered behind the unchanged contract (ac-1)", () => {
  const registry = createRegistry(ALL_AGENTS);
  assert.equal(registry.list().length, 14, "fourteen agents registered in total");
  assert.deepEqual(
    ALL_AGENTS.map((a) => a.id),
    [
      "canon-lore",
      "character-consistency",
      "timeline",
      ...LANGUAGE_IDS,
      "plot-thread",
      "pacing-tension",
      "pov-consistency",
      "show-vs-tell",
      "sensitivity-representation",
      "theme-motif",
    ],
    "the continuity trio keeps its order and shape; the language, narrative and optional rosters join in turn",
  );
  for (const id of LANGUAGE_IDS) {
    const agent = registry.get(id);
    assert.ok(agent, `${id} resolves from the registry`);
    assert.equal(typeof agent!.analyze, "function", `${id} implements analyze`);
    assert.equal(agent!.descriptor.family, "language", `${id} is in the language family`);
    assert.equal(agent!.descriptor.defaultStrictness, "standard", `${id} defaults to standard`);
    assert.deepEqual(agent!.descriptor.options, [], `${id} takes no options in v1`);
  }
  for (const agent of LANGUAGE_AGENTS) {
    assert.equal(AGENT_BY_ID.get(agent.id), agent, `${agent.id} is exported once`);
  }
});

test("acceptance: the MCP server exposes one analyze tool per language agent plus canon_list (ac-1)", () => {
  const bundle = createLorewardensServer();
  assert.deepEqual(
    bundle.tools.map((t) => t.name),
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
    ],
  );
});

// ---------------------------------------------------------------------------
// ac-5 — schema and MCP validation enums
// ---------------------------------------------------------------------------

test("acceptance: the finding schema and MCP validation accept the new agent ids and categories (ac-5)", () => {
  const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const agentEnum: string[] = schema.properties.agent.enum;
  assert.deepEqual(
    [...agentEnum].sort(),
    [
      ...LANGUAGE_IDS,
      ...CONTINUITY_IDS,
      "pacing-tension",
      "plot-thread",
      "pov-consistency",
      "show-vs-tell",
      "sensitivity-representation",
      "theme-motif",
    ].sort(),
    "the schema agent enum carries exactly the fourteen registered ids",
  );
  const categoryEnum: string[] = schema.properties.category.enum;
  assert.deepEqual([...categoryEnum].sort(), ["canon", "character", "language", "narrative", "optional", "prose", "timeline"]);
  assert.ok(categoryEnum.includes("language"), "language category present");
  assert.ok(categoryEnum.includes("prose"), "prose category present");
  assert.ok(categoryEnum.includes("optional"), "optional category present");
});

test("acceptance: MCP validation accepts language/prose findings and rejects unknown values (ac-5)", async () => {
  // One real finding per category from the tool path: language (grammar) and prose (style).
  const grammar = findingsOf(
    await analyzeTool("grammar-mechanics", "qa-language", "The the courier handed Elinor the letter.", "standard"),
  );
  assert.equal(grammar.length, 1);
  assert.equal(grammar[0].category, "language");
  const style = findingsOf(
    await analyzeTool(
      "style-voice",
      "qa-language",
      "Doors slammed. Boots echoed. Someone shouted for the gate guard. The whole courtyard emptied before the bell finished swinging, and by the time its echo died the only sound left was the wind worrying the banner over the gatehouse.",
      "strict",
    ),
  );
  assert.equal(style.length, 1);
  assert.equal(style[0].category, "prose");

  for (const finding of [grammar[0], style[0]]) {
    assert.deepEqual(validateFinding(finding), [], "real finding validates");
  }
  const unknownAgent = { ...grammar[0], agent: "grammar-spelling" };
  assert.ok(validateFinding(unknownAgent).some((p) => p.includes("agent")), "unknown agent id is rejected");
  const unknownCategory = { ...grammar[0], category: "stylistics" };
  assert.ok(validateFinding(unknownCategory).some((p) => p.includes("category")), "unknown category is rejected");
});

// ---------------------------------------------------------------------------
// ac-2 — grammar flags clear mechanical errors, never voice or style
// ---------------------------------------------------------------------------

test("acceptance: grammar flags each mechanical error shape and stays silent on style judgments (ac-2)", async () => {
  const flagged: string[] = [
    "The herald unrolled the scroll and read the the same line twice.", // doubled word
    "She cinched the saddlebags tighter , then mounted.", // whitespace before punctuation
    "He opened his mouth,, thought better of it, and bowed.", // doubled comma
    "The candle guttered.. The room went dark.", // doubled period
    "he whispered that i was late.", // lowercase standalone i
    "she said i'd regret it.", // lowercase i-contraction
  ];
  for (const text of flagged) {
    const findings = findingsOf(await analyzeTool("grammar-mechanics", "qa-language", text, "gentle"));
    assert.equal(findings.length, 1, `mechanical error expected: '${text}'`);
    assert.equal(findings[0].type, "grammar-mechanical-error");
    assert.equal(findings[0].category, "language");
    assertPinned(findings[0], { severity: "minor", confidence: 0.9, minStrictness: "gentle" });
    assert.equal(findings[0].suggestion, null, "grammar findings carry no applied suggestion");
  }

  const silent: string[] = [
    "The gate opened, the yard was empty.", // comma splice — style, deliberately excluded
    "The bridge was built by the king's masons.", // passive voice — style, deliberately excluded
    "The herald read the proclamation", // missing terminal punctuation — incremental chunks
    "The candles burned low... until dawn.", // a real ellipsis is three dots
    "A shout, then?! Nothing more.", // ?! is a legitimate pairing
    "She knew that I was right.", // capitalized pronoun is correct
    'Tam said, "I won\'t sign it tonight."', // dialect flavor without a mechanical error
  ];
  for (const text of silent) {
    const findings = findingsOf(await analyzeTool("grammar-mechanics", "qa-language", text, "strict"));
    assert.deepEqual(findings, [], `no mechanical finding expected: '${text}'`);
  }
});

test("acceptance: unbalanced-quote notes are chunk-scoped, standard-pinned, silent at gentle (ac-2)", async () => {
  const odd = 'The innkeeper leaned across the bar. "Stew is hot until the bell.';
  const standard = findingsOf(await analyzeTool("grammar-mechanics", "qa-language", odd, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "grammar-unbalanced-quotes");
  assertPinned(standard[0], { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  assert.deepEqual(
    findingsOf(await analyzeTool("grammar-mechanics", "qa-language", odd, "gentle")),
    [],
    "unbalanced quotes do not surface at gentle",
  );
  const balanced = 'The innkeeper said, "Stew is hot until the bell," and slid the key across the bar.';
  assert.deepEqual(
    findingsOf(await analyzeTool("grammar-mechanics", "qa-language", balanced, "strict")),
    [],
    "an even quote count is not a note",
  );
});

// ---------------------------------------------------------------------------
// ac-3 — vocabulary flags patterns, never isolated word choices
// ---------------------------------------------------------------------------

test("acceptance: a stem three times in the passage is overuse; twice across sentences is not (ac-3)", async () => {
  const overuse = findingsOf(
    await analyzeTool(
      "vocabulary-repetition",
      "qa-language",
      "The harbor road was empty. Fog rolled into the harbor by noon. Every boat in the harbor stayed moored.",
      "standard",
    ),
  );
  assert.equal(overuse.length, 1);
  assert.equal(overuse[0].type, "vocabulary-overuse");
  assert.equal(overuse[0].category, "language");
  assertPinned(overuse[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.match(overuse[0].message, /'harbor'/, "the message names the repeated stem");
  assert.match(overuse[0].message, /3 times/, "the message states the pattern count");
  assert.equal(overuse[0].suggestion, null, "vocabulary findings never suggest replacement words");
  assert.deepEqual(overuse[0].canonRefs, []);

  assert.deepEqual(
    findingsOf(await analyzeTool(
      "vocabulary-repetition",
      "qa-language",
      "The harbor road was empty. Fog rolled into the harbor by noon.",
      "strict",
    )),
    [],
    "a stem used twice across sentences is an isolated choice, not a pattern",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool(
      "vocabulary-repetition",
      "qa-language",
      "The harbor road was empty. Fog rolled into the harbor by noon. Every boat in the harbor stayed moored.",
      "gentle",
    )),
    [],
    "overuse notes are standard-pinned, silent at gentle",
  );
});

test("acceptance: confirmed names never count as repetition; echoes are strict-only (ac-3)", async () => {
  const names = findingsOf(
    await analyzeTool(
      "vocabulary-repetition",
      "qa-language",
      "Marda took the morning ferry. Marda waved from the deck. The ferry carried Marda upriver.",
      "strict",
    ),
  );
  assert.deepEqual(names, [], "a repeated character name is never a repetition finding");

  const echoText = "She spoke the oath again, the oath her mother had spoken.";
  assert.deepEqual(
    findingsOf(await analyzeTool("vocabulary-repetition", "qa-language", echoText, "standard")),
    [],
    "echoes stay below the standard floor",
  );
  const strict = findingsOf(await analyzeTool("vocabulary-repetition", "qa-language", echoText, "strict"));
  assert.equal(strict.length, 1);
  assert.equal(strict[0].type, "vocabulary-echo");
  assertPinned(strict[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.match(strict[0].message, /'oath'/);
  assert.match(strict[0].message, /2 times/);
});

// ---------------------------------------------------------------------------
// ac-4 — style, character voice, period
// ---------------------------------------------------------------------------

test("acceptance: style flags rhythm outliers at strict and formality shifts at standard (ac-4)", async () => {
  const rhythmText =
    "Doors slammed. Boots echoed. Someone shouted for the gate guard. " +
    "The whole courtyard emptied before the bell finished swinging, and by the time its echo died the only sound left was the wind worrying the banner over the gatehouse.";
  assert.deepEqual(
    findingsOf(await analyzeTool("style-voice", "qa-language", rhythmText, "standard")),
    [],
    "rhythm outliers are strict-only",
  );
  const strict = findingsOf(await analyzeTool("style-voice", "qa-language", rhythmText, "strict"));
  assert.equal(strict.length, 1);
  assert.equal(strict[0].type, "style-rhythm-shift");
  assert.equal(strict[0].category, "prose");
  assertPinned(strict[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.ok(strict[0].quote.startsWith("The whole courtyard"), "the outlier sentence is the quoted evidence");
  assert.deepEqual(strict[0].canonRefs, [], "style observations carry no canon anchor");

  const shortChunk =
    "Doors slammed. Boots echoed. The whole courtyard emptied before the bell finished swinging, and by the time its echo died the only sound left was the wind worrying the banner over the gatehouse.";
  assert.deepEqual(
    findingsOf(await analyzeTool("style-voice", "qa-language", shortChunk, "strict")),
    [],
    "fewer than four sentences never produce rhythm findings",
  );

  const formalityText =
    "The council convened at first light. Each member took the seat assigned to his office. " +
    "The record was read aloud without comment. Judgment would follow the evidence, as the law required. " +
    "Then the youngest stood. He said the record doesn't hold the whole truth. " +
    "Two of the old guard muttered that they'd seen a page altered. Someone shouted that he won't sit for it.";
  assert.deepEqual(
    findingsOf(await analyzeTool("style-voice", "qa-language", formalityText, "gentle")),
    [],
    "formality shifts are standard-pinned, silent at gentle",
  );
  const standard = findingsOf(await analyzeTool("style-voice", "qa-language", formalityText, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "style-formality-shift");
  assertPinned(standard[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.ok(standard[0].quote.startsWith("Then the youngest"), "the finding sits at the deviant half's first sentence");
});

test("acceptance: character voice drift is anchored in voice canon with locked escalation (ac-4)", async () => {
  const avoidText = 'Elinor traced the road on her map and said, "Destiny is for priests and fools."';
  const standard = findingsOf(await analyzeTool("character-voice", "qa-language", avoidText, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "voice-drift");
  assert.equal(standard[0].category, "prose");
  assertPinned(standard[0], { severity: "minor", confidence: 0.8, minStrictness: "standard" });
  assert.deepEqual(standard[0].canonRefs, ["char_qa_elinor"], "drift references the confirmed character");
  assert.match(standard[0].message, /Elinor/);
  assert.match(standard[0].suggestion ?? "", /CanonProposal/i, "the proposal path is advisory");
  assert.deepEqual(
    findingsOf(await analyzeTool("character-voice", "qa-language", avoidText, "gentle")),
    [],
    "unlocked drift is a standard-pinned note",
  );

  const contractionText = 'Tam folded the roster and said, "I won\'t sign it tonight."';
  const tamDrift = findingsOf(await analyzeTool("character-voice", "qa-language", contractionText, "standard"));
  assert.equal(tamDrift.length, 1);
  assert.equal(tamDrift[0].type, "voice-drift");
  assert.deepEqual(tamDrift[0].canonRefs, ["char_qa_tam"]);
  assert.deepEqual(
    findingsOf(await analyzeTool(
      "character-voice",
      "qa-language",
      'Tam read the roster aloud and said, "I will not sign it tonight."',
      "strict",
    )),
    [],
    "dialogue that honors the recorded voice stays silent",
  );

  assert.deepEqual(
    findingsOf(await analyzeTool(
      "character-voice",
      "qa-language",
      'A voice in the crowd shouted, "Destiny is for priests and fools."',
      "strict",
    )),
    [],
    "a quoted span with no character mention is not attributed",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool(
      "character-voice",
      "qa-language",
      'Marda spat over the side and said, "Destiny is a lazy word."',
      "strict",
    )),
    [],
    "a character with no voice canon stays silent — graceful degradation",
  );

  const locked: CanonContext = {
    entries: [],
    characters: [
      qaCharacter("char_qa_bren", "Bren", {
        voice: "Blunt and gruff. He does not use contractions, even when angry.",
        locked: true,
        lockReason: "voice locked by the writer",
      }),
    ],
    events: [],
  };
  const lockedText = 'Bren folded his arms and said, "I won\'t ride out tonight."';
  const gentle = await CHARACTER_VOICE_AGENT.analyze(directInput(lockedText, locked, "gentle"));
  assert.equal(gentle.length, 1, "locked drift reaches gentle");
  assertPinned(gentle[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  assert.deepEqual(gentle[0].canonRefs, ["char_qa_bren"]);
});

test("acceptance: period findings are gated by a confirmed pre-1900 rule with locked escalation (ac-4)", async () => {
  const anachronismText = "The harbor master consulted his telephone before the ferry cast off.";
  const standard = findingsOf(await analyzeTool("period-dialect", "qa-language", anachronismText, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "period-anachronism");
  assert.equal(standard[0].category, "language");
  assertPinned(standard[0], { severity: "minor", confidence: 0.85, minStrictness: "standard" });
  assert.deepEqual(standard[0].canonRefs, ["canon_rule_qa_period"], "the finding cites the gate entry");
  assert.match(standard[0].message, /telephone/);
  assert.deepEqual(
    findingsOf(await analyzeTool("period-dialect", "qa-language", anachronismText, "gentle")),
    [],
    "unlocked anachronisms are standard-pinned",
  );

  const slangText = "You gonna tell me the ferry is late again, or should I ask the harbormaster myself?";
  const slang = findingsOf(await analyzeTool("period-dialect", "qa-language", slangText, "standard"));
  assert.equal(slang.length, 1);
  assert.equal(slang[0].type, "period-register-mismatch");
  assertPinned(slang[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.deepEqual(slang[0].canonRefs, ["canon_rule_qa_period"]);

  const ungated: CanonContext = { entries: [], characters: [], events: [] };
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(directInput(anachronismText, ungated, "strict")),
    [],
    "no confirmed period entry: the agent stays silent",
  );
  const proposed: CanonContext = {
    entries: [qaEntry("canon_qa_gate", "The story is set in a medieval kingdom.", { status: "proposed" })],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(directInput(anachronismText, proposed, "strict")),
    [],
    "an unconfirmed period entry is not a gate",
  );
  const modernIntent: CanonContext = {
    entries: [
      qaEntry("canon_qa_gate", "The story is set in a medieval kingdom."),
      qaEntry("canon_qa_modern", "The narrator uses modern language on purpose."),
    ],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(directInput(anachronismText, modernIntent, "strict")),
    [],
    "a confirmed modern-language intent switches the agent off",
  );

  const lockedGate: CanonContext = {
    entries: [qaEntry("canon_qa_gate", "The story is set in a medieval kingdom.", { locked: true })],
    characters: [],
    events: [],
  };
  const gentle = await PERIOD_DIALECT_AGENT.analyze(directInput(anachronismText, lockedGate, "gentle"));
  assert.equal(gentle.length, 1, "a locked gate escalates anachronisms to gentle");
  assertPinned(gentle[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  assert.deepEqual(gentle[0].canonRefs, ["canon_qa_gate"]);
  const slangUnderLock = await PERIOD_DIALECT_AGENT.analyze(directInput(slangText, lockedGate, "standard"));
  assert.equal(slangUnderLock.length, 1);
  assertPinned(slangUnderLock[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.deepEqual(
    await PERIOD_DIALECT_AGENT.analyze(directInput(slangText, lockedGate, "gentle")),
    [],
    "register mismatches are never escalated by the lock",
  );
});

// ---------------------------------------------------------------------------
// ac-6 — modular enable/disable
// ---------------------------------------------------------------------------

test("acceptance: the fixture project runs only the language roster; the continuity trio is off (ac-6)", async () => {
  const settings = await store.settings("qa-language");
  for (const agent of CONTINUITY_AGENTS) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, false, `${agent.id} is disabled`);
  }
  for (const id of LANGUAGE_IDS) {
    const agentSettings = settings.agents.find((s) => s.agentId === id);
    assert.ok(agentSettings, `${id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, true, `${id} is enabled`);
    assert.equal(agentSettings.strictness, "standard");
  }

  for (const agent of CONTINUITY_AGENTS) {
    const result = await analyzeTool(agent.id, "qa-language", "The the courier handed Elinor the letter.", "strict");
    assert.equal(result.invoked, false, `${agent.id} is not invoked`);
    assert.match(result.reason ?? "", /disabled/);
    assert.deepEqual(result.findings, []);
  }
  const grammar = await analyzeTool("grammar-mechanics", "qa-language", "The the courier handed Elinor the letter.");
  assert.equal(grammar.invoked, true, "language agents are invoked");
});

test("acceptance: the shipped increment-1 proof projects keep the language roster explicitly disabled (ac-6)", async () => {
  const proofFixturesDir = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));
  const { store: shipped, projectIds: shippedIds, skipped: shippedSkipped } = loadFixtures(proofFixturesDir);
  assert.deepEqual(shippedIds, ["proof", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);
  assert.deepEqual(shippedSkipped, [], "no shipped fixture is skipped");
  for (const projectId of ["proof", "proof-strict"]) {
    const raw = JSON.parse(readFileSync(join(proofFixturesDir, `${projectId}.settings.json`), "utf8")) as {
      agents: { agentId: string; enabled: boolean }[];
    };
    for (const id of LANGUAGE_IDS) {
      const agentEntry = raw.agents.find((a) => a.agentId === id);
      assert.ok(agentEntry, `${projectId} carries an explicit settings entry for ${id}`);
      assert.equal(agentEntry.enabled, false, `${projectId} disables ${id}`);
    }
    const result = await analyzeTool("grammar-mechanics", projectId, "The the courier handed Elinor the letter.", "strict", shipped);
    assert.equal(result.invoked, false, "the language agent never runs on an increment-1 proof project");
    assert.match(result.reason ?? "", /disabled/);
  }
  const increment1 = await analyzeTool("canon-lore", "proof", "The road stayed empty all morning.", "standard", shipped);
  assert.equal(increment1.invoked, true, "the increment-1 roster still runs on proof");
  assert.equal(increment1.findingsCount, 0, "and stays silent on clean prose");
  const languageRoster = await analyzeTool(
    "grammar-mechanics",
    "proof-language",
    "The the courier handed Elinor the letter.",
    "standard",
    shipped,
  );
  assert.equal(languageRoster.invoked, true, "the shipped proof-language project runs the language roster");
  assert.equal(languageRoster.findingsCount, 1, "and catches the seeded mechanical error");
});

// ---------------------------------------------------------------------------
// ac-7 — the strictness matrix
// ---------------------------------------------------------------------------

const MIXED_PARAGRAPH = [
  "The the courier handed Elinor the letter.", // gentle-pinned mechanical error
  "The letter described telephone wires across the valley.", // standard anachronism
  'Elinor read it twice and said, "Destiny is for priests and fools."', // standard voice drift
  "The courier gonna wait for a reply?", // standard register mismatch
].join(" ");

test("acceptance: the strictness matrix — gentle surfaces only the gentle pins (ac-7)", async () => {
  const gentle = findingsOf(await analyzeTool("grammar-mechanics", "qa-language", MIXED_PARAGRAPH, "gentle"));
  assert.equal(gentle.length, 1, "exactly the gentle-pinned mechanical error reaches gentle");
  assert.equal(gentle[0].type, "grammar-mechanical-error");

  const standardResults = await Promise.all(
    LANGUAGE_AGENTS.map(async (agent) => findingsOf(await analyzeTool(agent.id, "qa-language", MIXED_PARAGRAPH))),
  );
  const standard = standardResults.flat();
  assert.deepEqual(
    standard.map((f) => f.type).sort(),
    ["grammar-mechanical-error", "period-anachronism", "period-register-mismatch", "voice-drift"].sort(),
    "standard surfaces the full pinned set and nothing else",
  );
  const byType = new Map(standard.map((f) => [f.type, f]));
  assert.equal(byType.get("grammar-mechanical-error")?.category, "language");
  assert.equal(byType.get("voice-drift")?.category, "prose");
});

test("acceptance: strict adds only the strict-only notes on top of standard (ac-7)", async () => {
  for (const agent of LANGUAGE_AGENTS) {
    const standard = findingsOf(await analyzeTool(agent.id, "qa-language", MIXED_PARAGRAPH));
    const strict = findingsOf(await analyzeTool(agent.id, "qa-language", MIXED_PARAGRAPH, "strict"));
    assert.equal(
      strict.length,
      standard.length,
      `${agent.id}: no additional findings on the mixed paragraph at strict`,
    );
  }

  const strictOnlyText =
    "Night fell over the water. The watch changed. Wind came off the water. " +
    "The last lantern in the row gutted and died, and the lantern keeper stood alone in the dark, counting the steps back to the gatehouse stairs long after the flame was gone.";
  for (const agent of LANGUAGE_AGENTS) {
    const standard = findingsOf(await analyzeTool(agent.id, "qa-language", strictOnlyText));
    assert.deepEqual(standard, [], `${agent.id}: strict-only prose is silent at standard`);
  }
  const strict = findingsOf(await analyzeTool("vocabulary-repetition", "qa-language", strictOnlyText, "strict"));
  assert.equal(strict.length, 1, "the echo is added at strict");
  assert.equal(strict[0].type, "vocabulary-echo");
  const rhythm = findingsOf(await analyzeTool("style-voice", "qa-language", strictOnlyText, "strict"));
  assert.equal(rhythm.length, 1, "the rhythm outlier is added at strict");
  assert.equal(rhythm[0].type, "style-rhythm-shift");
});

test("acceptance: clean prose stays silent for all five agents at every level (ac-7)", async () => {
  const clean =
    'Tam walked the wall road at dusk. He stopped where the lantern hung and read the roster by its light. ' +
    '"The gate holds until the bell," he said, and wrote his name beneath it. The road beyond stayed quiet all night.';
  for (const level of ["gentle", "standard", "strict"] as const) {
    for (const agent of LANGUAGE_AGENTS) {
      const result = await analyzeTool(agent.id, "qa-language", clean, level);
      assert.deepEqual(
        findingsOf(result),
        [],
        `clean prose must be silent for ${agent.id} at ${level}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// ac-8 — determinism of the tool path (the green root build is verified by CI)
// ---------------------------------------------------------------------------

test("acceptance: language findings are deterministic across repeated passes (ac-8)", async () => {
  const stable = (result: AnalyzeToolResult) =>
    findingsOf(result).map((f) => ({
      agent: f.agent,
      category: f.category,
      type: f.type,
      severity: f.severity,
      confidence: f.confidence,
      minStrictness: f.minStrictness,
      canonRefs: [...f.canonRefs].sort(),
      quote: f.quote,
      suggestion: f.suggestion,
      location: { file: f.location.file, startOffset: f.location.startOffset, endOffset: f.location.endOffset },
    }));
  for (const agent of LANGUAGE_AGENTS) {
    const first = stable(await analyzeTool(agent.id, "qa-language", MIXED_PARAGRAPH));
    const second = stable(await analyzeTool(agent.id, "qa-language", MIXED_PARAGRAPH));
    assert.deepEqual(second, first, `${agent.id}: identical across passes`);
  }
});
