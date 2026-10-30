import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  AGENT_DESCRIPTORS,
  ALL_AGENTS,
  OPTIONAL_AGENTS,
  THEME_MOTIF_AGENT,
} from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { defaultSettings, loadFixtures } from "../src/store.js";
import { validateFinding } from "../src/validate.js";
import { createLorewardensServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Independent QA acceptance suite for the three Optional/Light agents.
//
// Every prose sample and every canon fixture below is authored for this suite
// (nothing is reused from the seeded proof manuscripts), and every finding is
// driven through the real MCP tool path (runAnalyzeTool) against a
// purpose-built fixture store. Direct agent calls are used only where a
// fixture project cannot express the canon state (a non-rule or unconfirmed
// motif entry, which the context selector never delivers). Tests cross-check
// the shipped proof fixtures, where the four existing projects must keep the
// optional roster off and proof-light must carry it on.
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T09:00:00.000Z";
const QA_FILE = "qa/independent-light-chapter.md";

const CONTINUITY_IDS = ["canon-lore", "character-consistency", "timeline"] as const;
const LANGUAGE_IDS = [
  "grammar-mechanics",
  "vocabulary-repetition",
  "style-voice",
  "character-voice",
  "period-dialect",
] as const;
const NARRATIVE_IDS = ["plot-thread", "pacing-tension", "pov-consistency"] as const;
const OPTIONAL_IDS = ["show-vs-tell", "sensitivity-representation", "theme-motif"] as const;
const ALL_IDS = [...CONTINUITY_IDS, ...LANGUAGE_IDS, ...NARRATIVE_IDS, ...OPTIONAL_IDS];
const EXISTING_IDS = [...CONTINUITY_IDS, ...LANGUAGE_IDS, ...NARRATIVE_IDS];

// -- Purpose-built fixture store -------------------------------------------

function entryJson(id: string, text: string, overrides: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id,
    projectId: "qa",
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

function emptyCanon(projectId: string): object {
  return { projectId, entries: [], characters: [], events: [] };
}

const MOTIF_HARBOR = entryJson(
  "qa_motif_harbor",
  "The harbor light stays lit every night the fleet is out.",
  { tags: ["motif"] },
);
const MOTIF_TIDE = entryJson(
  "qa_motif_tide",
  "The tide bell rings three times while the fleet is out.",
  { tags: ["motif"] },
);
const MOTIF_BRIDGE_LOCKED = entryJson(
  "qa_motif_bridge",
  "The bridge over the ravine stays open all winter.",
  { tags: ["motif"], locked: true, lockReason: "the writer locked this motif" },
);
const QA_MOTIF_CANON = {
  projectId: "qa-motif",
  entries: [MOTIF_HARBOR, MOTIF_TIDE, MOTIF_BRIDGE_LOCKED],
  characters: [],
  events: [],
};

const MOTIF_WRONG_KIND = entryJson(
  "qa_motif_wrongkind",
  "The tide bell rings three times while the fleet is out.",
  { kind: "fact", tags: ["motif"] },
);
const RULE_NOT_MOTIF = entryJson(
  "qa_rule_notmotif",
  "The bridge over the ravine stays open all winter.",
  { tags: ["paths"] },
);
const MOTIF_PROPOSED = entryJson(
  "qa_motif_proposed",
  "The harbor light stays lit every night the fleet is out.",
  { tags: ["motif"], status: "proposed" },
);
const QA_MOTIF_UNMARKED_CANON = {
  projectId: "qa-motif-unmarked",
  entries: [MOTIF_WRONG_KIND, RULE_NOT_MOTIF, MOTIF_PROPOSED],
  characters: [],
  events: [],
};

const RULE_OUTSIDERS_CLAIM = entryJson(
  "qa_rule_outsiders_claim",
  "The outsiders trade at the mole twice a year.",
  { tags: ["trade"] },
);
const RULE_FOREIGNERS_LOCKED = entryJson(
  "qa_rule_foreigners_claim",
  "The foreigners winter in the south harbor.",
  { tags: ["harbor"], locked: true, lockReason: "the writer locked this world rule" },
);
const QA_CULTURE_ENTRY_CANON = {
  projectId: "qa-culture-entry",
  entries: [RULE_OUTSIDERS_CLAIM, RULE_FOREIGNERS_LOCKED],
  characters: [],
  events: [],
};

const ELDERS_BODY = characterJson("qa-culture-name", "char_qa_elders", "Elders", {
  summary: "The council body of the cove, entered as one character.",
});
const QA_CULTURE_NAME_CANON = {
  projectId: "qa-culture-name",
  entries: [],
  characters: [ELDERS_BODY],
  events: [],
};

function settingsJson(projectId: string, enabledIds: readonly string[]): object {
  return {
    projectId,
    agents: ALL_IDS.map((agentId) => ({
      agentId,
      enabled: enabledIds.includes(agentId),
      strictness: "standard",
      options: {},
    })),
    exceptions: [],
    dismissed: [],
  };
}

const TRIO_ON = OPTIONAL_IDS;
const tmpRoot = mkdtempSync(join(tmpdir(), "lore-qa-light-"));
process.on("exit", () => rmSync(tmpRoot, { recursive: true, force: true }));
for (const [name, body] of [
  ["qa-bare.canon.json", emptyCanon("qa-bare")],
  ["qa-bare-plus.canon.json", emptyCanon("qa-bare-plus")],
  ["qa-bare-plus.settings.json", {
    projectId: "qa-bare-plus",
    agents: [
      { agentId: "plot-thread", enabled: false, strictness: "standard", options: {} },
      { agentId: "pacing-tension", enabled: true, strictness: "standard", options: {} },
    ],
    exceptions: [],
    dismissed: [],
  }],
  ["qa-craft.canon.json", emptyCanon("qa-craft")],
  ["qa-craft.settings.json", settingsJson("qa-craft", TRIO_ON)],
  ["qa-culture-entry.canon.json", QA_CULTURE_ENTRY_CANON],
  ["qa-culture-entry.settings.json", settingsJson("qa-culture-entry", TRIO_ON)],
  ["qa-culture-name.canon.json", QA_CULTURE_NAME_CANON],
  ["qa-culture-name.settings.json", settingsJson("qa-culture-name", TRIO_ON)],
  ["qa-light.canon.json", emptyCanon("qa-light")],
  ["qa-light.settings.json", settingsJson("qa-light", TRIO_ON)],
  ["qa-light-one-off.canon.json", emptyCanon("qa-light-one-off")],
  ["qa-light-one-off.settings.json", settingsJson("qa-light-one-off", ["sensitivity-representation", "theme-motif"])],
  ["qa-motif.canon.json", QA_MOTIF_CANON],
  ["qa-motif.settings.json", settingsJson("qa-motif", TRIO_ON)],
  ["qa-motif-unmarked.canon.json", QA_MOTIF_UNMARKED_CANON],
  ["qa-motif-unmarked.settings.json", settingsJson("qa-motif-unmarked", TRIO_ON)],
] as const) {
  writeFileSync(join(tmpRoot, name), JSON.stringify(body, null, 2));
}

const { store, skipped } = loadFixtures(tmpRoot);
assert.deepEqual(skipped, [], "no QA fixture fails to load");

// -- Helpers ----------------------------------------------------------------

const AGENT_BY_ID = new Map<string, (typeof ALL_AGENTS)[number]>(ALL_AGENTS.map((a) => [a.id, a]));
type Level = Exclude<Strictness, "off">;
const LEVELS: Level[] = ["gentle", "standard", "strict"];

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
  assert.ok(finding.message.length > 0, "message explains the observation");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.endOffset > finding.location.startOffset, "location spans text");
  assert.equal(finding.suggestion, null, "light findings never carry a suggestion");
  assert.deepEqual(validateFinding(finding), [], "finding is schema-valid per the MCP validator");
}

function assertQuoteMatchesLocation(finding: Finding, text: string): void {
  assert.equal(finding.location.startOffset, 0, "the QA chunk starts at offset 0");
  assert.equal(
    text.slice(finding.location.startOffset, finding.location.endOffset),
    finding.quote,
    "location offsets are manuscript-exact",
  );
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

// Representative QA chunks (each asserted so the named agent produces exactly
// the findings the test states, and the other two produce none).

const EMOTION_FELT = "Nera felt anxious as the tide turned.";
const EMOTION_WAS = "He was furious about the berth.";
const EMOTION_ADVERB = "She was suddenly terrified by the swell.";
const EMOTION_DIALOGUE = 'Nera said, "I felt anxious about the crossing."';

const EXPOSITION_BLOCK = [
  "The ferry town had always lived by the tide, hauling its boats above the winter line.",
  "For as long as anyone could remember, the bell had marked the hours from the tower by the mole.",
  "Everyone knew which lanes flooded in spring and which stayed dry through the driest summer.",
  "Over the years the pilings had been replaced twice, and the seawall had been raised once more.",
  "In those days the salt stayed on every sill, and the nets dried along the upper rails.",
  "It was said the harbor kept its own accounts, and that the water remembered every debt.",
].join(" ");
const EXPOSITION_SHORT_RUN = [
  "For as long as anyone could remember, the ferry had run on the morning tide, and the town had kept the bell polished for the crossing.",
  "Everyone knew the order of the day.",
  "Over the years the route had shortened by a mile.",
  "The fares stayed the same.",
].join(" ");
const EXPOSITION_LEAN_RUN = [
  "For as long as anyone could remember, the bell rang at six.",
  "Everyone knew the signal.",
  "Over the years the pier shrank.",
  "In those days fish were plenty.",
  "The town kept the custom.",
  "It was said the bell never missed.",
].join(" ");
const EXPOSITION_SINGLE_CUE = [
  "The keeper walked the gallery at dusk and counted the ships that waited for the tide.",
  "He trimmed the wick and weighed the oil against the hours of dark.",
  "The wind came up from the southwest after supper and pushed the fog against the headland.",
  "He wrote the weather in the log, as his father had done before him.",
  "The lamp turned through the night, and the beam touched the water once each pass.",
  "For as long as the light had turned, the ledger of ships had hung by the door of the lamp room.",
].join(" ");

const FILTER_CHUNK = "From the gallery she could see the whole harbor. She watched as the ferry pulled away.";
const FILTER_NEGATIVES = "She saw the ferry leave the mole. He watched the tide turn.";
const FILTER_DIALOGUE = 'She said, "I could see the storm coming."';

const STEREOTYPE_CHUNK = "The harbormaster said people like that never last in a salvage town.";
const STEREOTYPE_DIALOGUE = 'The harbormaster said, "People like that never last here."';
const BROAD_BRUSH_CHUNK = "All the villagers came up the old path at dusk.";
const BROAD_BRUSH_DIALOGUE = 'The keeper said, "All the villagers came up the path."';
const GUARD_VILLAGERS = "All the villagers came up the old path at dusk.";
const GUARD_OUTSIDERS = "All the outsiders waited by the mole.";
const GUARD_FOREIGNERS = "All the foreigners camped on the quay.";
const GUARD_COMBINED = [GUARD_VILLAGERS, GUARD_OUTSIDERS, GUARD_FOREIGNERS].join(" ");
const ELDERS_CHUNK = "All the elders gathered at the stone.";
const DIALOGUE_SWEEP =
  'The harbormaster said, "People like that never last." ' +
  'Nera said, "I felt anxious about the crossing." ' +
  'She said, "I could see the storm coming."';

const MOTIF_CONFLICT_ANTONYM = "Wren doused the harbor light and the quay went dark.";
const MOTIF_CONFLICT_NUMERIC = "The tide bell rang five strokes, and Mira counted them out.";
const MOTIF_LOCKED_CHUNK = "The bridge was shut before the thaw.";
const MOTIF_RECURRENCE_CHUNK =
  "The fleet came home past the harbor light, and the town watched from the wall. " +
  "The light burned until the fleet was in, and the night passed quietly.";
const MOTIF_UNMARKED_CHUNK =
  "The bridge was shut before the thaw. The tide bell rang five strokes, and Mira counted them out. " +
  "The harbor light went dark.";
const MOTIF_LOADED_UNMARKED_CHUNK = "The bridge was shut before the thaw. The tide bell rang five strokes.";

const PROOF_LIGHT_EMOTION = "Sela felt miserable as the berth emptied.";
const PROOF_LIGHT_STEREOTYPE = "People like that never last in a salvage town.";
const PROOF_LIGHT_MOTIF = "The lighthouse never lit while the ships rode at anchor.";
const PROOF_LIGHT_GUARD = "All the villagers came up the old path at dusk.";

const MODULAR_CHUNK = `${EMOTION_FELT} ${BROAD_BRUSH_CHUNK}`;

const CLEAN_CRAFT_CHUNK =
  "The ferry crossed at first light and the water held calm. Nera coiled the line and stowed the lantern. " +
  "By noon the wind eased and the crew ate in the shade.";
const CLEAN_MOTIF_CHUNK = "The harbor light showed once through the fog.";

// ---------------------------------------------------------------------------
// ac-1 — contract, registration, MCP tools
// ---------------------------------------------------------------------------

test("acceptance: the three optional agents are registered behind the unchanged contract, off by default (ac-1, ac-2)", () => {
  const registry = createRegistry(ALL_AGENTS);
  assert.equal(registry.list().length, 14, "fourteen agents registered in total");
  assert.deepEqual(
    ALL_AGENTS.map((a) => a.id),
    [...CONTINUITY_IDS, ...LANGUAGE_IDS, ...NARRATIVE_IDS, ...OPTIONAL_IDS],
    "the prior rosters keep their order; the three optional agents close the roster",
  );
  for (const id of OPTIONAL_IDS) {
    const agent = registry.get(id);
    assert.ok(agent, `${id} resolves from the registry`);
    assert.equal(typeof agent!.analyze, "function", `${id} implements analyze`);
    assert.equal(agent!.descriptor.family, "optional", `${id} is in the optional family`);
    assert.equal(agent!.descriptor.defaultStrictness, "standard", `${id} defaults to standard`);
    assert.equal(agent!.descriptor.defaultEnabled, false, `${id} is off by default`);
    assert.deepEqual(agent!.descriptor.options, [], `${id} takes no options in v1`);
    assert.equal(AGENT_BY_ID.get(id), agent, `${id} is exported once`);
  }
  assert.deepEqual(
    OPTIONAL_AGENTS.map((a) => a.id),
    [...OPTIONAL_IDS],
    "OPTIONAL_AGENTS exports exactly the trio in roster order",
  );
  assert.equal(AGENT_DESCRIPTORS.length, 14, "the descriptor roster holds all fourteen agents");
  assert.deepEqual(
    AGENT_DESCRIPTORS.slice(0, 11).map((d) => d.id),
    EXISTING_IDS,
    "the eleven existing descriptor rows keep their order",
  );
  for (const d of AGENT_DESCRIPTORS.slice(0, 11)) {
    assert.equal(d.defaultEnabled, undefined, `${d.id} carries no defaultEnabled override`);
  }
  assert.deepEqual(
    AGENT_DESCRIPTORS.slice(11).map((d) => ({
      id: d.id,
      family: d.family,
      title: d.title,
      defaultStrictness: d.defaultStrictness,
      defaultEnabled: d.defaultEnabled,
      options: d.options,
    })),
    [
      { id: "show-vs-tell", family: "optional", title: "Show vs Tell / Craft", defaultStrictness: "standard", defaultEnabled: false, options: [] },
      { id: "sensitivity-representation", family: "optional", title: "Sensitivity / Representation", defaultStrictness: "standard", defaultEnabled: false, options: [] },
      { id: "theme-motif", family: "optional", title: "Theme / Motif", defaultStrictness: "standard", defaultEnabled: false, options: [] },
    ],
    "the three optional descriptor rows close the roster, off by default",
  );
});

test("acceptance: the MCP server exposes one analyze tool per optional agent (ac-1)", () => {
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
    "the fifteen tools include the three optional analyze tools before canon_list",
  );
});

// ---------------------------------------------------------------------------
// ac-2 — default-off mechanics
// ---------------------------------------------------------------------------

test("acceptance: defaultSettings resolves the trio disabled and every existing agent unchanged (ac-2)", () => {
  const defaults = defaultSettings("qa-defaults");
  assert.equal(defaults.agents.length, 14, "one settings row per registered agent");
  for (const d of AGENT_DESCRIPTORS.slice(0, 11)) {
    const row = defaults.agents.find((a) => a.agentId === d.id);
    assert.ok(row, `defaultSettings carries a row for ${d.id}`);
    assert.equal(row!.enabled, true, `${d.id} stays enabled by default`);
    assert.equal(row!.strictness, d.defaultStrictness, `${d.id} keeps its default strictness`);
  }
  for (const id of OPTIONAL_IDS) {
    const row = defaults.agents.find((a) => a.agentId === id);
    assert.ok(row, `defaultSettings carries a row for ${id}`);
    assert.equal(row!.enabled, false, `${id} resolves disabled`);
    assert.equal(row!.strictness, "standard", `${id} resolves standard strictness`);
  }
  const canonLore = defaults.agents.find((a) => a.agentId === "canon-lore")!;
  assert.deepEqual(canonLore.options, { objectLocationChecks: false }, "canon-lore option defaults preserved");
  const characterConsistency = defaults.agents.find((a) => a.agentId === "character-consistency")!;
  assert.deepEqual(characterConsistency.options, { relationshipState: false }, "character-consistency option defaults preserved");
});

test("acceptance: a project with no settings file, and one without light rows, keeps the trio disabled (ac-2)", async () => {
  for (const projectId of ["qa-bare", "qa-bare-plus"]) {
    for (const id of OPTIONAL_IDS) {
      const result = await analyzeTool(id, projectId, MODULAR_CHUNK, "strict");
      assert.equal(result.invoked, false, `${id} is not invoked on ${projectId}`);
      assert.match(result.reason ?? "", /disabled/);
      assert.deepEqual(result.findings, []);
      assert.equal(result.findingsCount, 0);
    }
  }
  const pacing = await analyzeTool("pacing-tension", "qa-bare-plus", "Run. The gate. They saw us. Fast.", "strict");
  assert.equal(pacing.invoked, true, "the explicitly enabled row still runs on qa-bare-plus");
  assert.deepEqual(findingsOf(await analyzeTool("plot-thread", "qa-bare-plus", "The gate stood open.", "standard")), [],
    "the explicitly disabled row stays disabled on qa-bare-plus");
});

test("acceptance: the four existing proof projects carry no light settings and yield zero light findings at every level (ac-2)", async () => {
  const proofFixturesDir = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));
  const { store: shipped, skipped: shippedSkipped } = loadFixtures(proofFixturesDir);
  assert.deepEqual(shippedSkipped, [], "no shipped fixture is skipped");
  for (const projectId of ["proof", "proof-language", "proof-narrative", "proof-strict"]) {
    const raw = JSON.parse(readFileSync(join(proofFixturesDir, `${projectId}.settings.json`), "utf8")) as {
      agents: { agentId: string; enabled: boolean }[];
    };
    for (const id of OPTIONAL_IDS) {
      const agentEntry = raw.agents.find((a) => a.agentId === id);
      assert.equal(agentEntry, undefined, `${projectId} carries no settings entry for ${id}`);
      for (const level of LEVELS) {
        const result = await analyzeTool(id, projectId, MOTIF_UNMARKED_CHUNK, level, shipped);
        assert.equal(result.invoked, false, `${id} is never invoked on ${projectId} at ${level}`);
        assert.match(result.reason ?? "", /disabled/);
        assert.deepEqual(result.findings, []);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// ac-3 — Show vs Tell stays light
// ---------------------------------------------------------------------------

test("acceptance: emotion labels are standard-level info notes on narration only (ac-3)", async () => {
  const felt = findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EMOTION_FELT, "standard"));
  assert.equal(felt.length, 1);
  assert.equal(felt[0].type, "craft-emotion-label");
  assert.equal(felt[0].category, "optional");
  assertPinned(felt[0], { severity: "info", confidence: 0.75, minStrictness: "standard" });
  assert.equal(felt[0].quote, EMOTION_FELT);
  assertQuoteMatchesLocation(felt[0], EMOTION_FELT);
  assert.match(felt[0].message, /names the emotion directly/);
  assert.match(felt[0].message, /'felt\/was anxious'/);
  assert.equal(felt[0].suggestion, null);
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EMOTION_FELT, "gentle")),
    [],
    "the 0.75 pin sits under the gentle floor, so labels never reach gentle",
  );
  const was = findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EMOTION_WAS, "standard"));
  assert.equal(was.length, 1);
  assert.equal(was[0].type, "craft-emotion-label");
  assert.match(was[0].message, /'felt\/was furious'/);

  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EMOTION_ADVERB, "strict")),
    [],
    "adverb-interrupted constructions are deliberately not matched",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EMOTION_DIALOGUE, "strict")),
    [],
    "a labeled emotion inside quoted dialogue is the character's voice, not narration",
  );
});

test("acceptance: exposition blocks fire at strict with the run's thresholds named (ac-3)", async () => {
  const strict = findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EXPOSITION_BLOCK, "strict"));
  assert.equal(strict.length, 1, "one finding per exposition block");
  assert.equal(strict[0].type, "craft-exposition-block");
  assert.equal(strict[0].category, "optional");
  assertPinned(strict[0], { severity: "info", confidence: 0.6, minStrictness: "strict" });
  assert.equal(
    strict[0].quote,
    "The ferry town had always lived by the tide, hauling its boats above the winter line.",
    "the finding sits at the run's first sentence",
  );
  assertQuoteMatchesLocation(strict[0], EXPOSITION_BLOCK);
  assert.match(strict[0].message, /6 consecutive narration sentences \(100 words\)/);
  assert.match(strict[0].message, /carrying 6 stock exposition cues/);
  assert.match(strict[0].message, /'for as long as', 'it was said', 'everyone knew', 'over the years', 'in those days', 'as long as anyone could remember'/);
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EXPOSITION_BLOCK, "standard")),
    [],
    "the 0.6 pin sits under the standard floor, so blocks surface at strict only",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EXPOSITION_BLOCK, "gentle")),
    [],
    "exposition blocks never reach gentle",
  );
});

test("acceptance: exposition thresholds hold — short runs, lean runs and single-cue runs stay silent (ac-3)", async () => {
  for (const [text, why] of [
    [EXPOSITION_SHORT_RUN, "a four-sentence run is below the six-sentence gate"],
    [EXPOSITION_LEAN_RUN, "six sentences under 80 words are below the word gate"],
    [EXPOSITION_SINGLE_CUE, "one distinct cue is below the two-cue gate"],
  ] as const) {
    assert.deepEqual(
      findingsOf(await analyzeTool("show-vs-tell", "qa-craft", text, "strict")),
      [],
      why,
    );
  }
});

test("acceptance: filter phrases are strict-only info notes (ac-3)", async () => {
  const strict = findingsOf(await analyzeTool("show-vs-tell", "qa-craft", FILTER_CHUNK, "strict"));
  assert.equal(strict.length, 2, "one finding per filtered sentence");
  assert.deepEqual(strict.map((f) => f.type), ["craft-filter-phrase", "craft-filter-phrase"]);
  for (const finding of strict) {
    assertPinned(finding, { severity: "info", confidence: 0.55, minStrictness: "strict" });
  }
  assert.equal(strict[0].quote, "From the gallery she could see the whole harbor.");
  assert.match(strict[0].message, /'could see'/);
  assert.equal(strict[1].quote, "She watched as the ferry pulled away.");
  assert.match(strict[1].message, /'watched as'/);
  assert.match(strict[0].message, /filters perception through the point-of-view character/);
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", FILTER_CHUNK, "standard")),
    [],
    "the 0.55 pin sits under the standard floor, so filter phrases surface at strict only",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", FILTER_NEGATIVES, "strict")),
    [],
    "bare 'saw' or 'watched' without the closed-table phrase is not a filter finding",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("show-vs-tell", "qa-craft", FILTER_DIALOGUE, "strict")),
    [],
    "a filter phrase inside quoted dialogue is excluded",
  );
});

test("acceptance: show-vs-tell findings are info with suggestion null everywhere (ac-3)", async () => {
  for (const [text, level] of [
    [EMOTION_FELT, "standard"],
    [EMOTION_WAS, "strict"],
    [EXPOSITION_BLOCK, "strict"],
    [FILTER_CHUNK, "strict"],
  ] as const) {
    const findings = findingsOf(await analyzeTool("show-vs-tell", "qa-craft", text, level));
    assert.ok(findings.length > 0, "the sample produces findings to inspect");
    for (const finding of findings) {
      assert.equal(finding.severity, "info", "show-vs-tell never issues minor-or-worse findings");
      assert.equal(finding.suggestion, null, "light craft notes never advise or rewrite");
      assert.equal(finding.category, "optional");
      assert.deepEqual(finding.canonRefs, [], "craft notes carry no canon anchor");
      assert.match(finding.message, /the writer owns/, "the message hands the choice back to the writer");
    }
  }
});

// ---------------------------------------------------------------------------
// ac-4 — Sensitivity is advisory only
// ---------------------------------------------------------------------------

test("acceptance: stereotype phrases surface at gentle as advisory notes (ac-4)", async () => {
  for (const level of LEVELS) {
    const findings = findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", STEREOTYPE_CHUNK, level));
    assert.equal(findings.length, 1, `the essentialist phrase surfaces at ${level}`);
    assert.equal(findings[0].type, "sensitivity-stereotype-phrase");
    assert.equal(findings[0].category, "optional");
    assertPinned(findings[0], { severity: "minor", confidence: 0.9, minStrictness: "gentle" });
    assert.equal(findings[0].quote, STEREOTYPE_CHUNK);
    assertQuoteMatchesLocation(findings[0], STEREOTYPE_CHUNK);
    assert.match(findings[0].message, /essentialist phrase \('people like that'\)/);
  }
  assert.deepEqual(
    findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", STEREOTYPE_DIALOGUE, "strict")),
    [],
    "essentialist phrasing inside quoted dialogue is the character's speech, never policed",
  );
});

test("acceptance: broad-brush generalizations surface at standard (ac-4)", async () => {
  const standard = findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", BROAD_BRUSH_CHUNK, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "sensitivity-broad-brush");
  assert.equal(standard[0].category, "optional");
  assertPinned(standard[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.equal(standard[0].quote, BROAD_BRUSH_CHUNK);
  assertQuoteMatchesLocation(standard[0], BROAD_BRUSH_CHUNK);
  assert.match(standard[0].message, /generalizes about villagers/);
  assert.match(standard[0].message, /essentialist frame \('all'\)/);
  assert.deepEqual(
    findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", BROAD_BRUSH_CHUNK, "gentle")),
    [],
    "the 0.7 pin sits under the gentle floor, so broad-brush notes never reach gentle",
  );
  assert.ok(
    (findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", BROAD_BRUSH_CHUNK, "strict"))).length === 1,
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", BROAD_BRUSH_DIALOGUE, "strict")),
    [],
    "a generalization inside quoted dialogue is excluded",
  );
});

test("acceptance: the fictional-culture guard silences terms the writer's world claims (ac-4)", async () => {
  const proofFixturesDir = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));
  const { store: shipped } = loadFixtures(proofFixturesDir);
  const combined = findingsOf(await analyzeTool("sensitivity-representation", "qa-culture-entry", GUARD_COMBINED, "strict"));
  assert.equal(combined.length, 1, "the claimed terms are skipped, the unclaimed term is reported");
  assert.equal(combined[0].type, "sensitivity-broad-brush");
  assert.match(combined[0].message, /generalizes about villagers/);

  for (const [projectId, text, fixtureStore, why] of [
    ["qa-culture-entry", GUARD_OUTSIDERS, store, "a confirmed canon entry claims 'outsiders'"],
    ["qa-culture-entry", GUARD_FOREIGNERS, store, "a locked world rule claims 'foreigners'"],
    ["qa-culture-name", ELDERS_CHUNK, store, "a confirmed character name claims 'elders'"],
    ["proof-light", PROOF_LIGHT_GUARD, shipped, "the shipped canon rule claims 'villagers'"],
  ] as const) {
    assert.deepEqual(
      findingsOf(await analyzeTool("sensitivity-representation", projectId, text, "strict", fixtureStore)),
      [],
      why,
    );
  }
  assert.equal(
    findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", ELDERS_CHUNK, "standard")).length,
    1,
    "the same phrasing fires where nothing in canon claims the term",
  );
});

test("acceptance: sensitivity messages describe, never prescribe (ac-4)", async () => {
  for (const [text, level] of [
    [STEREOTYPE_CHUNK, "gentle"],
    [BROAD_BRUSH_CHUNK, "standard"],
    [GUARD_COMBINED, "strict"],
  ] as const) {
    const findings = findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", text, level));
    assert.ok(findings.length > 0, "the sample produces findings to inspect");
    for (const finding of findings) {
      assert.equal(finding.suggestion, null, "advisory notes never prescribe a change");
      assert.match(finding.message, /Advisory note:/);
      assert.match(finding.message, /not a required change/);
      assert.match(finding.message, /the writer owns the decision/);
      assert.doesNotMatch(finding.message, /\b(must|should|rewrite|replace|remove)\b/i, "no imperative prescriptions");
      assert.deepEqual(finding.canonRefs, [], "sensitivity notes carry no canon anchor");
    }
  }
});

// ---------------------------------------------------------------------------
// ac-5 — Theme/Motif stays silent until the writer marks motifs
// ---------------------------------------------------------------------------

test("acceptance: theme-motif stays silent until the writer marks motifs (ac-5)", async () => {
  for (const projectId of ["qa-craft", "qa-light"]) {
    for (const level of LEVELS) {
      const result = await analyzeTool("theme-motif", projectId, MOTIF_LOADED_UNMARKED_CHUNK, level);
      assert.equal(result.invoked, true, `the agent is enabled on ${projectId}`);
      assert.deepEqual(findingsOf(result), [], `zero confirmed motif entries means silence at ${level}`);
    }
  }
  for (const level of LEVELS) {
    const result = await analyzeTool("theme-motif", "qa-motif-unmarked", MOTIF_UNMARKED_CHUNK, level);
    assert.equal(result.invoked, true, "the agent is enabled on qa-motif-unmarked");
    assert.deepEqual(findingsOf(result), [], `wrong kind, missing tag and proposed status never count as motifs at ${level}`);
  }
});

test("acceptance: motif conflicts fire at standard, cite the entry, and reuse the conflict shapes (ac-5)", async () => {
  const antonym = findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_CONFLICT_ANTONYM, "standard"));
  assert.equal(antonym.length, 1, "the antonym shape conflicts with the marked motif");
  assert.equal(antonym[0].type, "motif-conflict");
  assert.equal(antonym[0].category, "optional");
  assertPinned(antonym[0], { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  assert.deepEqual(antonym[0].canonRefs, ["qa_motif_harbor"], "the conflict cites the marked motif");
  assert.match(antonym[0].message, /a motif you marked/);
  assert.match(antonym[0].message, /'light' here stands opposite 'dark' from the motif/);
  assert.equal(antonym[0].quote, MOTIF_CONFLICT_ANTONYM);
  assertQuoteMatchesLocation(antonym[0], MOTIF_CONFLICT_ANTONYM);
  assert.deepEqual(
    findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_CONFLICT_ANTONYM, "gentle")),
    [],
    "unlocked motif conflicts are standard-pinned",
  );

  const numeric = findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_CONFLICT_NUMERIC, "standard"));
  assert.equal(numeric.length, 1, "the numeric shape conflicts with the marked motif");
  assert.equal(numeric[0].type, "motif-conflict");
  assert.deepEqual(numeric[0].canonRefs, ["qa_motif_tide"]);
  assert.match(numeric[0].message, /the motif counts 3/);
  assert.match(numeric[0].message, /the passage counts 5/);
});

test("acceptance: a locked motif escalates to major and reaches gentle (ac-5)", async () => {
  for (const level of LEVELS) {
    const findings = findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_LOCKED_CHUNK, level));
    assert.equal(findings.length, 1, `the locked motif escalates the conflict to ${level}`);
    assert.equal(findings[0].type, "motif-conflict");
    assertPinned(findings[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
    assert.deepEqual(findings[0].canonRefs, ["qa_motif_bridge"]);
    assert.match(findings[0].message, /the motif you locked/);
    assert.match(findings[0].message, /'open' here stands opposite 'shut' from the motif/);
  }
});

test("acceptance: motif kind and tag constraints hold per the selector rule (ac-5)", async () => {
  const factKind: CanonContext = {
    entries: [MOTIF_WRONG_KIND],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await THEME_MOTIF_AGENT.analyze(directInput(MOTIF_CONFLICT_NUMERIC, factKind, "strict")),
    [],
    "a confirmed motif-tagged entry of the wrong kind is not a motif",
  );
  const proposed: CanonContext = {
    entries: [MOTIF_PROPOSED],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await THEME_MOTIF_AGENT.analyze(directInput(MOTIF_CONFLICT_ANTONYM, proposed, "strict")),
    [],
    "an unconfirmed motif-tagged rule is not a motif",
  );
  const confirmedRule: CanonContext = {
    entries: [MOTIF_TIDE],
    characters: [],
    events: [],
  };
  assert.equal(
    (await THEME_MOTIF_AGENT.analyze(directInput(MOTIF_CONFLICT_NUMERIC, confirmedRule, "strict"))).length,
    1,
    "the same entry confirmed, kind rule and tagged motif is a motif — the harness detects when entries count",
  );
});

test("acceptance: motif recurrence is strict-only info naming the recurring terms (ac-5)", async () => {
  const strict = findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_RECURRENCE_CHUNK, "strict"));
  assert.equal(strict.length, 1, "one recurrence finding for the marked motif");
  assert.equal(strict[0].type, "motif-recurrence");
  assert.equal(strict[0].category, "optional");
  assertPinned(strict[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.deepEqual(strict[0].canonRefs, ["qa_motif_harbor"]);
  assert.equal(
    strict[0].quote,
    "The fleet came home past the harbor light, and the town watched from the wall.",
    "the finding sits at the first narration sentence carrying a motif term",
  );
  assertQuoteMatchesLocation(strict[0], MOTIF_RECURRENCE_CHUNK);
  assert.match(strict[0].message, /recurs through this passage/);
  assert.match(strict[0].message, /'harbor' 1 time/);
  assert.match(strict[0].message, /'light' 2 times/);
  assert.match(strict[0].message, /'night' 1 time/);
  assert.match(strict[0].message, /'fleet' 2 times/);
  assert.match(strict[0].message, /The writer decides whether the recurrence is intentional/);
  assert.deepEqual(
    findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_RECURRENCE_CHUNK, "standard")),
    [],
    "recurrence notes are strict-only",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_RECURRENCE_CHUNK, "gentle")),
    [],
    "recurrence notes never reach gentle",
  );
});

// ---------------------------------------------------------------------------
// ac-6 — modular enable/disable, both directions
// ---------------------------------------------------------------------------

test("acceptance: modular enablement — one disabled row silences only that agent, re-enabling restores findings (ac-6)", async () => {
  const on = {
    craft: findingsOf(await analyzeTool("show-vs-tell", "qa-light", MODULAR_CHUNK, "standard")),
    sensitivity: findingsOf(await analyzeTool("sensitivity-representation", "qa-light", MODULAR_CHUNK, "standard")),
    theme: await analyzeTool("theme-motif", "qa-light", MODULAR_CHUNK, "standard"),
  };
  assert.equal(on.craft.length, 1, "show-vs-tell catches the emotion label on qa-light");
  assert.equal(on.craft[0].type, "craft-emotion-label");
  assert.equal(on.sensitivity.length, 1, "sensitivity catches the generalization on qa-light");
  assert.equal(on.sensitivity[0].type, "sensitivity-broad-brush");
  assert.equal(on.theme.invoked, true, "theme-motif is enabled on qa-light");
  assert.deepEqual(findingsOf(on.theme), [], "and stays silent with zero marked motifs");

  const off = {
    craft: await analyzeTool("show-vs-tell", "qa-light-one-off", MODULAR_CHUNK, "standard"),
    sensitivity: findingsOf(await analyzeTool("sensitivity-representation", "qa-light-one-off", MODULAR_CHUNK, "standard")),
    theme: await analyzeTool("theme-motif", "qa-light-one-off", MODULAR_CHUNK, "standard"),
  };
  assert.equal(off.craft.invoked, false, "the single disabled row silences show-vs-tell");
  assert.match(off.craft.reason ?? "", /disabled/);
  assert.deepEqual(off.craft.findings, []);
  assert.equal(off.sensitivity.length, 1, "the enabled rows still run");
  assert.equal(off.theme.invoked, true, "theme-motif is still enabled on qa-light-one-off");
  assert.deepEqual(findingsOf(off.theme), []);

  for (const agentId of ["canon-lore", "grammar-mechanics", "plot-thread"]) {
    const result = await analyzeTool(agentId, "qa-light", MODULAR_CHUNK, "strict");
    assert.equal(result.invoked, false, `${agentId} stays off on the QA light projects`);
    assert.match(result.reason ?? "", /disabled/);
  }
});

test("acceptance: proof-light enables exactly the trio and carries their seeded findings (ac-6)", async () => {
  const proofFixturesDir = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));
  const { store: shipped, projectIds: shippedIds, skipped: shippedSkipped } = loadFixtures(proofFixturesDir);
  // Standing ruling v2 (additive): proof-implicit joins in the loader's
  // emission order (see packages/proof/test/proof.test.ts).
  assert.deepEqual(shippedIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);
  assert.deepEqual(shippedSkipped, [], "no shipped fixture is skipped");

  const raw = JSON.parse(readFileSync(join(proofFixturesDir, "proof-light.settings.json"), "utf8")) as {
    agents: { agentId: string; enabled: boolean; strictness: string }[];
  };
  for (const d of AGENT_DESCRIPTORS.slice(0, 11)) {
    const row = raw.agents.find((a) => a.agentId === d.id);
    assert.ok(row, `proof-light carries an explicit settings entry for ${d.id}`);
    assert.equal(row!.enabled, false, `proof-light disables ${d.id}`);
  }
  for (const id of OPTIONAL_IDS) {
    const row = raw.agents.find((a) => a.agentId === id);
    assert.ok(row, `proof-light carries an explicit settings entry for ${id}`);
    assert.equal(row!.enabled, true, `proof-light enables ${id}`);
    assert.equal(row!.strictness, "standard");
  }

  const emotion = findingsOf(await analyzeTool("show-vs-tell", "proof-light", PROOF_LIGHT_EMOTION, "standard", shipped));
  assert.equal(emotion.length, 1, "the shipped project catches the emotion label");
  assert.equal(emotion[0].type, "craft-emotion-label");

  const stereotype = findingsOf(await analyzeTool("sensitivity-representation", "proof-light", PROOF_LIGHT_STEREOTYPE, "gentle", shipped));
  assert.equal(stereotype.length, 1, "the shipped project catches the essentialist phrase at gentle");
  assert.equal(stereotype[0].type, "sensitivity-stereotype-phrase");

  const conflict = findingsOf(await analyzeTool("theme-motif", "proof-light", PROOF_LIGHT_MOTIF, "standard", shipped));
  assert.equal(conflict.length, 1, "the shipped project catches the motif conflict");
  assert.equal(conflict[0].type, "motif-conflict");
  assert.deepEqual(conflict[0].canonRefs, ["canon_motif_lighthouse"]);

  for (const agentId of [...EXISTING_IDS]) {
    const result = await analyzeTool(agentId, "proof-light", MODULAR_CHUNK, "standard", shipped);
    assert.equal(result.invoked, false, `${agentId} is disabled on proof-light`);
    assert.match(result.reason ?? "", /disabled/);
  }
});

// ---------------------------------------------------------------------------
// ac-7 — schema validation
// ---------------------------------------------------------------------------

test("acceptance: light findings validate against the finding schema (ac-7)", async () => {
  const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const agentEnum: string[] = schema.properties.agent.enum;
  assert.deepEqual(
    [...agentEnum].sort(),
    [...ALL_IDS].sort(),
    "the schema agent enum carries exactly the fourteen registered ids",
  );
  const categoryEnum: string[] = schema.properties.category.enum;
  assert.deepEqual(
    [...categoryEnum].sort(),
    ["canon", "character", "language", "narrative", "optional", "prose", "timeline"],
    "the schema category enum includes optional",
  );

  const representatives: Finding[] = [
    ...findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EMOTION_FELT, "standard")),
    ...findingsOf(await analyzeTool("show-vs-tell", "qa-craft", EXPOSITION_BLOCK, "strict")),
    ...findingsOf(await analyzeTool("show-vs-tell", "qa-craft", FILTER_CHUNK, "strict")),
    ...findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", STEREOTYPE_CHUNK, "gentle")),
    ...findingsOf(await analyzeTool("sensitivity-representation", "qa-craft", BROAD_BRUSH_CHUNK, "standard")),
    ...findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_CONFLICT_ANTONYM, "standard")),
    ...findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_CONFLICT_NUMERIC, "strict")),
    ...findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_LOCKED_CHUNK, "gentle")),
    ...findingsOf(await analyzeTool("theme-motif", "qa-motif", MOTIF_RECURRENCE_CHUNK, "strict")),
  ];
  const types = new Set(representatives.map((f) => f.type));
  for (const type of [
    "craft-emotion-label",
    "craft-exposition-block",
    "craft-filter-phrase",
    "sensitivity-stereotype-phrase",
    "sensitivity-broad-brush",
    "motif-conflict",
    "motif-recurrence",
  ]) {
    assert.ok(types.has(type), `${type} is represented`);
  }
  for (const finding of representatives) {
    assert.ok(
      ["show-vs-tell", "sensitivity-representation", "theme-motif"].includes(finding.agent),
      `${finding.type} is authored by an optional agent`,
    );
    assert.equal(finding.category, "optional", "optional agents tag their findings optional");
    assert.deepEqual(validateFinding(finding), [], `${finding.agent}/${finding.type} validates`);
  }
  const unknownAgent = { ...representatives[0], agent: "sensitivity-engine" };
  assert.ok(validateFinding(unknownAgent).some((p) => p.includes("agent")), "unknown agent id is rejected");
  const unknownCategory = { ...representatives[0], category: "sensitivity" };
  assert.ok(validateFinding(unknownCategory).some((p) => p.includes("category")), "unknown category is rejected");
});

// ---------------------------------------------------------------------------
// ac-8 — the pre-authorized pin updates, applied exactly as disclosed
// ---------------------------------------------------------------------------

test("acceptance: the pre-authorized pin updates are applied exactly as disclosed (ac-8)", () => {
  const readRepo = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  const agentsTest = readRepo("../../../agents/test/agents.test.ts");
  assert.match(agentsTest, /continuity \+ language \+ narrative \+ optional/, "the descriptor pin message was reworded as disclosed");

  for (const rel of [
    "../../../agents/test/language-agents.test.ts",
    "../../../agents/test/narrative-agents.test.ts",
  ] as const) {
    assert.match(readRepo(rel), /OPTIONAL_AGENTS/, `${rel} extends its roster pin with the optional ids`);
  }

  const languageAcceptance = readRepo("../../../mcp-server/test/acceptance-language.test.ts");
  assert.match(languageAcceptance, /fourteen agents registered in total/, "the registry length pin took the new count");
  assert.match(languageAcceptance, /analyze_show_vs_tell/, "the tool-list pin gained the optional tools");
  assert.match(languageAcceptance, /"optional"/, "the category enum pin gained optional");
  assert.match(languageAcceptance, /proof-light/, "the shipped projectIds pin gained proof-light");

  const narrativeAcceptance = readRepo("../../../mcp-server/test/acceptance-narrative.test.ts");
  assert.match(narrativeAcceptance, /fourteen agents registered in total/, "the registry length pin took the new count");
  assert.match(narrativeAcceptance, /optional agents close the roster/, "the roster message was reworded as disclosed");
  assert.match(narrativeAcceptance, /analyze_sensitivity_representation/, "the tool-list pin gained the optional tools");

  assert.match(readRepo("../../../mcp-server/test/tools.test.ts"), /analyze_theme_motif/, "the roster tool pin gained the optional tools");
  assert.match(readRepo("../../../mcp-server/test/schema.test.ts"), /optional-roster/, "the additive validator test is present");
  assert.match(readRepo("../../../mcp-server/test/store.test.ts"), /optional agents off/, "the descriptor-defaults pin message was reworded as disclosed");

  assert.match(readRepo("../../../proof/test/proof.test.ts"), /proof-light/, "the projectIds pin gained proof-light");
  const seededErrors = readRepo("../../../proof/test/acceptance-seeded-errors.test.ts");
  assert.match(seededErrors, /optional: 0/, "the category Record pin seeds no optional errors");
  assert.match(seededErrors, /"test\/light-proof\.test\.ts"/, "the offline scan covers the light proof suite");
  assert.match(seededErrors, /proof-light/, "the projectIds pin gained proof-light");
  assert.match(readRepo("../../../proof/test/language-proof.test.ts"), /all five projects/, "the projectIds message was reworded as disclosed");
  assert.match(readRepo("../../../proof/test/narrative-proof.test.ts"), /proof-light/, "the projectIds pin gained proof-light");
});

// ---------------------------------------------------------------------------
// quoted dialogue excluded everywhere; clean silence at every level
// ---------------------------------------------------------------------------

test("acceptance: quoted dialogue is excluded from show-vs-tell and sensitivity everywhere (ac-3, ac-4)", async () => {
  for (const id of ["show-vs-tell", "sensitivity-representation"] as const) {
    const result = await analyzeTool(id, "qa-craft", DIALOGUE_SWEEP, "strict");
    assert.deepEqual(findingsOf(result), [], `quoted dialogue never trips ${id}`);
    assert.equal(result.invoked, true, `${id} is enabled and ran`);
  }
});

test("acceptance: clean prose stays silent for all three optional agents at every level (ac-3, ac-4, ac-5)", async () => {
  for (const level of LEVELS) {
    for (const id of OPTIONAL_IDS) {
      const result = await analyzeTool(id, "qa-craft", CLEAN_CRAFT_CHUNK, level);
      assert.equal(result.invoked, true, `${id} is enabled on qa-craft`);
      assert.deepEqual(findingsOf(result), [], `clean prose must be silent for ${id} at ${level}`);
    }
    const motifClean = await analyzeTool("theme-motif", "qa-motif", CLEAN_MOTIF_CHUNK, level);
    assert.equal(motifClean.invoked, true, "theme-motif is enabled on qa-motif");
    assert.deepEqual(findingsOf(motifClean), [], `marked motifs that neither conflict nor recur stay silent at ${level}`);
  }
});

// ---------------------------------------------------------------------------
// ac-9 — determinism of the tool path
// ---------------------------------------------------------------------------

test("acceptance: light findings are deterministic across repeated passes (ac-9)", async () => {
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
  const samples: [string, string, string, Level][] = [
    ["show-vs-tell", "qa-craft", EMOTION_FELT, "standard"],
    ["show-vs-tell", "qa-craft", EXPOSITION_BLOCK, "strict"],
    ["show-vs-tell", "qa-craft", FILTER_CHUNK, "strict"],
    ["sensitivity-representation", "qa-craft", BROAD_BRUSH_CHUNK, "standard"],
    ["sensitivity-representation", "qa-craft", GUARD_COMBINED, "strict"],
    ["theme-motif", "qa-motif", MOTIF_CONFLICT_ANTONYM, "standard"],
    ["theme-motif", "qa-motif", MOTIF_LOCKED_CHUNK, "gentle"],
    ["theme-motif", "qa-motif", MOTIF_RECURRENCE_CHUNK, "strict"],
  ];
  for (const [agentId, projectId, text, level] of samples) {
    const first = stable(await analyzeTool(agentId, projectId, text, level));
    assert.ok(first.length > 0 || agentId === "theme-motif", "the sample produces findings to compare");
    const second = stable(await analyzeTool(agentId, projectId, text, level));
    assert.deepEqual(second, first, `${agentId}: identical across passes`);
  }
});
