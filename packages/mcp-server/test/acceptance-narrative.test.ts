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
  NARRATIVE_AGENTS,
  PACING_TENSION_AGENT,
  PLOT_THREAD_AGENT,
  POV_CONSISTENCY_AGENT,
} from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { loadFixtures } from "../src/store.js";
import { validateFinding } from "../src/validate.js";
import { createLorewardensServer } from "../src/index.js";

// ---------------------------------------------------------------------------
// Independent QA acceptance suite for the three Narrative agents.
//
// Every prose sample and every canon fixture below is authored for this
// suite (nothing is reused from the seeded proof manuscripts), and every
// finding is driven through the real MCP tool path (runAnalyzeTool) against
// a purpose-built fixture store. Direct agent calls are used only where a
// fixture project cannot express the canon state (a locked POV rule, an
// omniscient declaration). One test cross-checks the shipped proof fixtures,
// where the three existing projects must keep the narrative roster
// explicitly disabled.
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T09:00:00.000Z";
const QA_FILE = "qa/independent-chapter.md";

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

const PROMISE_GATE = entryJson(
  "qa_promise_gate",
  "The sealed gate on the west wall stays closed until the courier returns.",
  { tags: ["plot-thread"] },
);
const PROMISE_COUNT = entryJson(
  "qa_promise_count",
  "The reliquary holds three keys, and the count is exact.",
  { tags: ["plot-thread"] },
);
const PROMISE_TOMB = entryJson("qa_promise_tomb", "The map shows the tomb lies beneath the chapel.", {
  tags: ["plot-thread"],
});
const PROMISE_LIGHT = entryJson("qa_promise_light", "The chapel light stays lit until the wedding.", {
  tags: ["plot-thread"],
  locked: true,
  lockReason: "the writer locked this promise",
});

const QA_PLOT_CANON = { projectId: "qa-plot", entries: [PROMISE_GATE, PROMISE_COUNT, PROMISE_TOMB, PROMISE_LIGHT], characters: [], events: [] };
const QA_PACING_CANON = { projectId: "qa-pacing", entries: [], characters: [], events: [] };

const QA_RULE_POV = entryJson("qa_rule_pov", "The narration follows Brother Aldous and no one else.", {
  projectId: "qa-pov",
  tags: ["pov"],
});
const ALDOUS = characterJson("qa-pov", "char_qa_aldous", "Aldous");
const SERA = characterJson("qa-pov", "char_qa_sera", "Sera");
const TOVAN = characterJson("qa-pov", "char_qa_tovan", "Tovan");
const QA_POV_CANON = { projectId: "qa-pov", entries: [QA_RULE_POV], characters: [ALDOUS, SERA, TOVAN], events: [] };

const QA_POV_OPEN_CANON = {
  projectId: "qa-pov-open",
  entries: [],
  characters: [
    characterJson("qa-pov-open", "char_qa_aldous", "Aldous"),
    characterJson("qa-pov-open", "char_qa_sera", "Sera"),
    characterJson("qa-pov-open", "char_qa_tovan", "Tovan"),
  ],
  events: [],
};

function settingsJson(projectId: string) {
  return {
    projectId,
    agents: ALL_IDS.map((agentId) => ({
      agentId,
      enabled: (NARRATIVE_IDS as readonly string[]).includes(agentId),
      strictness: "standard",
      options: {},
    })),
    exceptions: [],
    dismissed: [],
  };
}

const tmpRoot = mkdtempSync(join(tmpdir(), "lore-qa-narrative-"));
process.on("exit", () => rmSync(tmpRoot, { recursive: true, force: true }));
for (const [name, body] of [
  ["qa-plot.canon.json", QA_PLOT_CANON],
  ["qa-plot.settings.json", settingsJson("qa-plot")],
  ["qa-pacing.canon.json", QA_PACING_CANON],
  ["qa-pacing.settings.json", settingsJson("qa-pacing")],
  ["qa-pov.canon.json", QA_POV_CANON],
  ["qa-pov.settings.json", settingsJson("qa-pov")],
  ["qa-pov-open.canon.json", QA_POV_OPEN_CANON],
  ["qa-pov-open.settings.json", settingsJson("qa-pov-open")],
] as const) {
  writeFileSync(join(tmpRoot, name), JSON.stringify(body, null, 2));
}

const { store, skipped } = loadFixtures(tmpRoot);

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
  assert.ok(finding.message.length > 0, "message explains the observation");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.endOffset > finding.location.startOffset, "location spans text");
  assert.deepEqual(validateFinding(finding), [], "finding is schema-valid per the MCP validator");
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

// Representative QA chunks (asserted against every agent's tripwires so the
// only finding each one produces is the one the test names).

const ANTONYM_CHUNK = "Wren pried at the gate until it stood open, and the wind came through.";
const NUMERIC_CHUNK = "The reliquary holds five keys behind the altar. Wren counted them twice.";
const NEGATION_CHUNK = "The map shows the tomb never lay beneath the chapel; the monks moved it.";
const LOCKED_PROMISE_CHUNK = "Inside, the chapel was dark and cold.";
const PLANTED_CHUNK =
  "On the third night, Wren promised to carry the letter herself. Why had the harbor master left his ledger unlocked?";

const STATIC_CHUNK = [
  "The road north of the ford had been empty since the third watch of the night.",
  "Mist gathered in the ditches and crept up the banks toward the hedgerows.",
  "Far off, a dog barked twice at the dark and then fell silent.",
  "Somewhere beyond the hills a bell counted the hour and stopped.",
  "Rain came in from the west, fine at first, then steady, then certain.",
  "The horse plodded on through it, ears flat, mane heavy with water.",
  "By the time the ford appeared the rider was soaked to the skin.",
  "He dismounted, led the animal up the bank, and looked for the track.",
].join(" ");

const WORD_GATE_CHUNK = [
  "The ford was empty at first light.",
  "Mist hung low above the pale reeds.",
  "A heron stood in the shallows, unmoving.",
  "The far bank stayed a gray suggestion.",
  "Rain drifted in from the western hills.",
  "It beaded on the leather of the tack.",
  "The rider let the animal pick its way.",
  "Behind them the road stayed empty and dark.",
].join(" ");

const RUSHED_CHUNK = 'Run. The gate. They saw us. "Down the stairs." Fast.';
const RUSHED_SHORT_CHUNK = "Run. The gate. They saw us. Fast.";
const TURN_FALL_CHUNK = "The door slammed. The room went quiet.";
const TURN_RISE_CHUNK = "The room went quiet. Then the door slammed.";
const TURN_CHAIN_CHUNK = "The door slammed. The room went quiet. Then the door slammed again.";

const HEADHOP_CHUNK =
  'Sera wondered if the tide had turned. Brother Aldous read the tide table twice. ' +
  'Tovan feared the crossing would be delayed. Sera said, "The ferry waits for no one."';
const HEADHOP_DIALOGUE_CHUNK =
  'Sera wondered if the tide had turned. Brother Aldous read the tide table twice. ' +
  'Tovan said, "I feared the ferry had gone."';
const HEADHOP_OPEN_CHUNK =
  "Aldous hoped the letter had arrived. Sera suspected the ferryman kept it. Tovan remembered the crossing of the year before.";

const DISTANCE_CHUNK =
  "I counted the coins twice before I paid. My boots were worn through at the heel. " +
  "We kept to the shadow of the wall. I did not look back at the harbor. " +
  "The ferryman took the fare without a word. The tide turned against the crossing. " +
  "Gulls wheeled over the mast in the dusk. The harbor bell rang the hour twice.";
const DISTANCE_DELTA2_CHUNK =
  "I paid the ferryman at the plank. I shouldered the pack and walked. " +
  "My knee ached on the stairs to the hall. The room above held one bed and a chair. " +
  "I hung the lantern by the door. The lamp burned low through the night. " +
  "Rain tapped the shutter until morning. The road below stayed empty and dark.";
const DISTANCE_SHORT_CHUNK =
  "I counted the coins twice before I paid. My boots were worn through at the heel. " +
  "We kept to the shadow of the wall. I did not look back at the harbor. " +
  "The ferryman took the fare without a word. The tide turned against the crossing. " +
  "Gulls wheeled over the mast in the dusk.";
const DISTANCE_DIALOGUE_CHUNK =
  'She handed him the ledger without comment. He signed his name beneath hers. ' +
  'She watched him count it twice. He stacked the coins in rows. "I keep nothing back," she said. ' +
  "She turned toward the window. He gathered the papers into the case. She paused at the door. " +
  "He followed her into the hall.";

const CLEAN_CHUNK =
  'Tomas said, "I swore the oath at Midwinter, and I meant it." ' +
  "The ferry crossed at dawn without incident. The water stayed low and the crossing held. " +
  "Rain followed them up the valley road. By noon the wind eased and the air settled. " +
  "The road climbed through pines toward the ridge. " +
  "Evening found the party below the ridge, tired but unhurt. " +
  "Tomas counted the lamps in the village below. " +
  "It was good to see smoke rising from the chimneys again.";

// ---------------------------------------------------------------------------
// ac-1 — contract and registration
// ---------------------------------------------------------------------------

test("acceptance: the three narrative agents are registered behind the unchanged contract (ac-1)", () => {
  const registry = createRegistry(ALL_AGENTS);
  assert.equal(registry.list().length, 14, "fourteen agents registered in total");
  assert.deepEqual(
    ALL_AGENTS.map((a) => a.id),
    [...CONTINUITY_IDS, ...LANGUAGE_IDS, ...NARRATIVE_IDS, ...OPTIONAL_IDS],
    "the prior rosters keep their order; the three optional agents close the roster",
  );
  for (const id of NARRATIVE_IDS) {
    const agent = registry.get(id);
    assert.ok(agent, `${id} resolves from the registry`);
    assert.equal(typeof agent!.analyze, "function", `${id} implements analyze`);
    assert.equal(agent!.descriptor.family, "narrative", `${id} is in the narrative family`);
    assert.equal(agent!.descriptor.defaultStrictness, "standard", `${id} defaults to standard`);
    assert.deepEqual(agent!.descriptor.options, [], `${id} takes no options in v1`);
  }
  for (const agent of NARRATIVE_AGENTS) {
    assert.equal(AGENT_BY_ID.get(agent.id), agent, `${agent.id} is exported once`);
  }
});

test("acceptance: the disclosed narrative descriptor rows sit ahead of the optional rows (ac-1, ac-7)", () => {
  assert.equal(AGENT_DESCRIPTORS.length, 14);
  assert.deepEqual(
    AGENT_DESCRIPTORS.slice(0, 8).map((d) => d.id),
    [...CONTINUITY_IDS, ...LANGUAGE_IDS],
    "the continuity and language rows are byte-identical in order ahead of the narrative rows",
  );
  assert.deepEqual(
    AGENT_DESCRIPTORS.slice(8, 11).map((d) => ({
      id: d.id,
      family: d.family,
      title: d.title,
      defaultStrictness: d.defaultStrictness,
      options: d.options,
    })),
    [
      { id: "plot-thread", family: "narrative", title: "Plot Thread / Promise", defaultStrictness: "standard", options: [] },
      { id: "pacing-tension", family: "narrative", title: "Pacing / Tension", defaultStrictness: "standard", options: [] },
      { id: "pov-consistency", family: "narrative", title: "POV Consistency", defaultStrictness: "standard", options: [] },
    ],
    "the three narrative descriptor rows match the disclosed pre-authorized shape exactly",
  );
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
  for (const d of AGENT_DESCRIPTORS.slice(8)) {
    assert.ok(d.description.length > 0, `${d.id} carries a description`);
  }
});

test("acceptance: the MCP server exposes one analyze tool per narrative agent plus canon_list (ac-1)", () => {
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
// ac-2 — plot thread: conflicts, escalation, strict-only notes
// ---------------------------------------------------------------------------

test("acceptance: plot conflicts with confirmed promises are caught at standard and cite the entry (ac-2)", async () => {
  const antonym = findingsOf(await analyzeTool("plot-thread", "qa-plot", ANTONYM_CHUNK, "standard"));
  assert.equal(antonym.length, 1, "the antonym shape conflicts with the gate promise");
  assert.equal(antonym[0].type, "plot-promise-conflict");
  assert.equal(antonym[0].category, "narrative");
  assertPinned(antonym[0], { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  assert.deepEqual(antonym[0].canonRefs, ["qa_promise_gate"], "the conflict cites the tracked promise");
  assert.match(antonym[0].message, /stands opposite/);
  assert.equal(antonym[0].quote, ANTONYM_CHUNK, "the quote is the first offending sentence");
  assert.equal(antonym[0].suggestion, null, "conflicts never carry a suggestion");
  assert.deepEqual(
    findingsOf(await analyzeTool("plot-thread", "qa-plot", ANTONYM_CHUNK, "gentle")),
    [],
    "unlocked conflicts are standard-pinned",
  );

  const numeric = findingsOf(await analyzeTool("plot-thread", "qa-plot", NUMERIC_CHUNK, "standard"));
  assert.equal(numeric.length, 1, "the numeric shape conflicts with the counted promise");
  assert.equal(numeric[0].type, "plot-promise-conflict");
  assert.deepEqual(numeric[0].canonRefs, ["qa_promise_count"]);
  assert.match(numeric[0].message, /counts 3/);
  assert.match(numeric[0].message, /counts 5/);

  const negation = findingsOf(await analyzeTool("plot-thread", "qa-plot", NEGATION_CHUNK, "standard"));
  assert.equal(negation.length, 1, "the negation shape conflicts with the affirmed promise");
  assert.equal(negation[0].type, "plot-promise-conflict");
  assert.deepEqual(negation[0].canonRefs, ["qa_promise_tomb"]);
  assert.match(negation[0].message, /negates what the promise affirms/);
});

test("acceptance: a locked promise escalates to major and reaches gentle (ac-2)", async () => {
  const gentle = findingsOf(await analyzeTool("plot-thread", "qa-plot", LOCKED_PROMISE_CHUNK, "gentle"));
  assert.equal(gentle.length, 1, "a locked promise escalates the conflict to gentle");
  assert.equal(gentle[0].type, "plot-promise-conflict");
  assertPinned(gentle[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  assert.deepEqual(gentle[0].canonRefs, ["qa_promise_light"]);
  assert.match(gentle[0].message, /you locked/);
  const standard = findingsOf(await analyzeTool("plot-thread", "qa-plot", LOCKED_PROMISE_CHUNK, "standard"));
  assert.equal(standard.length, 1);
  assertPinned(standard[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
});

test("acceptance: planted promises and open questions are strict-only notes that never prescribe outcomes (ac-2)", async () => {
  assert.deepEqual(
    findingsOf(await analyzeTool("plot-thread", "qa-plot", PLANTED_CHUNK, "standard")),
    [],
    "planted and open-question notes stay below standard",
  );
  const strict = findingsOf(await analyzeTool("plot-thread", "qa-plot", PLANTED_CHUNK, "strict"));
  assert.equal(strict.length, 2, "one planted promise and one open question");
  const planted = strict.find((f) => f.type === "plot-promise-planted");
  const open = strict.find((f) => f.type === "plot-open-question");
  assert.ok(planted, "the planted note is present");
  assert.ok(open, "the open-question note is present");
  assertPinned(planted!, { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assertPinned(open!, { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.deepEqual(planted!.canonRefs, []);
  assert.deepEqual(open!.canonRefs, []);
  assert.match(planted!.message, /plants a promise/);
  assert.match(planted!.message, /'promised'/, "the message names the cue");
  assert.match(planted!.suggestion ?? "", /plot-thread/, "the suggestion points at canon tracking");
  assert.match(planted!.suggestion ?? "", /dismiss/, "or at dismissing the note");
  assert.ok(!/will be tracked/.test(planted!.message + planted!.suggestion), "nothing asserts the promise will be tracked");
  assert.match(open!.message, /raises an open question/);
  assert.match(open!.message, /'why had'/);
  assert.equal(open!.suggestion, null);
  assert.equal(planted!.quote, "On the third night, Wren promised to carry the letter herself.");
  assert.equal(open!.quote, "Why had the harbor master left his ledger unlocked?");

  assert.deepEqual(
    findingsOf(await analyzeTool("plot-thread", "qa-plot", 'Wren said, "I promised the ferryman."', "strict")),
    [],
    "a promise spoken in dialogue is the character's, not a planted narration cue",
  );
});

// ---------------------------------------------------------------------------
// ac-3 — pacing: thresholds, turns, observational only
// ---------------------------------------------------------------------------

test("acceptance: pacing stretches and rushed passages fire at their pinned thresholds (ac-3)", async () => {
  const strict = findingsOf(await analyzeTool("pacing-tension", "qa-pacing", STATIC_CHUNK, "strict"));
  assert.equal(strict.length, 1, "one static stretch over the eight-sentence run");
  assert.equal(strict[0].type, "pacing-static-stretch");
  assert.equal(strict[0].category, "narrative");
  assertPinned(strict[0], { severity: "info", confidence: 0.6, minStrictness: "standard" });
  assert.equal(strict[0].quote, "The road north of the ford had been empty since the third watch of the night.",
    "the finding sits at the run's first sentence");
  assert.deepEqual(strict[0].canonRefs, []);
  assert.deepEqual(
    findingsOf(await analyzeTool("pacing-tension", "qa-pacing", STATIC_CHUNK, "standard")),
    [],
    "the 0.6 pin sits under the standard confidence floor, so the stretch surfaces at strict only",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("pacing-tension", "qa-pacing", STATIC_CHUNK, "gentle")),
    [],
    "static stretches never reach gentle",
  );

  assert.deepEqual(
    findingsOf(await analyzeTool("pacing-tension", "qa-pacing", WORD_GATE_CHUNK, "strict")),
    [],
    "eight sentences under 100 words are not a static stretch",
  );

  const rushed = findingsOf(await analyzeTool("pacing-tension", "qa-pacing", RUSHED_CHUNK, "strict"));
  assert.equal(rushed.length, 1, "five consecutive very short sentences form a rushed passage");
  assert.equal(rushed[0].type, "pacing-rushed-passage");
  assertPinned(rushed[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.equal(rushed[0].quote, "Run.", "the finding sits at the run's first sentence");
  assert.deepEqual(
    findingsOf(await analyzeTool("pacing-tension", "qa-pacing", RUSHED_CHUNK, "standard")),
    [],
    "rushed passages are strict-only",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("pacing-tension", "qa-pacing", RUSHED_SHORT_CHUNK, "strict")),
    [],
    "four short sentences are not a rushed passage",
  );
});

test("acceptance: abrupt tension turns fire once per adjacent pair in both directions (ac-3)", async () => {
  const falling = findingsOf(await analyzeTool("pacing-tension", "qa-pacing", TURN_FALL_CHUNK, "strict"));
  assert.equal(falling.length, 1);
  assert.equal(falling[0].type, "tension-abrupt-shift");
  assertPinned(falling[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.equal(falling[0].quote, TURN_FALL_CHUNK, "the quote spans the whole pair");
  assert.match(falling[0].message, /from an escalation beat into a de-escalation beat/);
  assert.deepEqual(falling[0].canonRefs, []);

  const rising = findingsOf(await analyzeTool("pacing-tension", "qa-pacing", TURN_RISE_CHUNK, "strict"));
  assert.equal(rising.length, 1);
  assert.equal(rising[0].type, "tension-abrupt-shift");
  assert.match(rising[0].message, /from a de-escalation beat into an escalation beat/);

  const chain = findingsOf(await analyzeTool("pacing-tension", "qa-pacing", TURN_CHAIN_CHUNK, "strict"));
  assert.equal(chain.length, 2, "one finding per adjacent pair");
  assert.deepEqual(
    findingsOf(await analyzeTool("pacing-tension", "qa-pacing", TURN_FALL_CHUNK, "standard")),
    [],
    "tension turns are strict-only",
  );
});

test("acceptance: pacing findings are purely observational — suggestion is null everywhere (ac-3)", async () => {
  for (const [text, level] of [
    [STATIC_CHUNK, "strict"],
    [RUSHED_CHUNK, "strict"],
    [TURN_CHAIN_CHUNK, "strict"],
  ] as const) {
    const findings = findingsOf(await analyzeTool("pacing-tension", "qa-pacing", text, level));
    assert.ok(findings.length > 0, "the sample produces findings to inspect");
    for (const finding of findings) {
      assert.equal(finding.suggestion, null, "pacing never advises, never rewrites");
      assert.equal(finding.severity, "info", "pacing notes are informational");
      assert.deepEqual(finding.canonRefs, [], "pacing observations carry no canon anchor");
      assert.match(finding.message, /^(Static stretch|Rushed passage|Tension turns here)/, "the message describes what the text does");
    }
  }
});

// ---------------------------------------------------------------------------
// ac-4 — POV: head-hops, locks, omniscient, distance drift
// ---------------------------------------------------------------------------

test("acceptance: pov head-hops are caught at standard against a declared rule, with dialogue excluded (ac-4)", async () => {
  const standard = findingsOf(await analyzeTool("pov-consistency", "qa-pov", HEADHOP_CHUNK, "standard"));
  assert.equal(standard.length, 2, "one head-hop per off-POV character");
  for (const finding of standard) {
    assert.equal(finding.type, "pov-head-hop");
    assert.equal(finding.category, "narrative");
    assertPinned(finding, { severity: "minor", confidence: 0.75, minStrictness: "standard" });
    assert.deepEqual(finding.canonRefs, ["qa_rule_pov"], "the finding cites the declared POV rule");
    assert.equal(finding.suggestion, null);
    assert.match(finding.message, /Aldous/, "the message names the declared POV character");
  }
  assert.deepEqual(standard.map((f) => f.quote), [
    "Sera wondered if the tide had turned.",
    "Tovan feared the crossing would be delayed.",
  ]);
  assert.deepEqual(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov", HEADHOP_CHUNK, "gentle")),
    [],
    "unlocked head-hops are standard-pinned",
  );

  assert.equal(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov", HEADHOP_DIALOGUE_CHUNK, "strict")).length,
    1,
    "a quoted line is never an inner-state attribution — only Sera's narration sentence counts",
  );
});

test("acceptance: pov head-hops without a declared rule flag every character after the first (ac-4)", async () => {
  const standard = findingsOf(await analyzeTool("pov-consistency", "qa-pov-open", HEADHOP_OPEN_CHUNK, "standard"));
  assert.equal(standard.length, 2, "one finding per extra character beyond the first entered");
  for (const finding of standard) {
    assert.equal(finding.type, "pov-head-hop");
    assertPinned(finding, { severity: "minor", confidence: 0.75, minStrictness: "standard" });
    assert.match(finding.message, /head-hop between viewpoints/);
  }
  assert.deepEqual(standard.map((f) => f.canonRefs), [["char_qa_sera"], ["char_qa_tovan"]]);

  assert.deepEqual(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov-open", "Aldous hoped the letter had arrived.", "strict")),
    [],
    "a single attributed character is not a head-hop",
  );
});

test("acceptance: a locked pov rule escalates to gentle; an omniscient rule silences the agent (ac-4)", async () => {
  const lockedContext: CanonContext = {
    entries: [
      entryJson("qa_rule_pov_locked", "The narration follows Sera and no one else.", {
        tags: ["pov"],
        locked: true,
        lockReason: "the writer locked the POV",
      }),
    ],
    characters: [SERA, TOVAN],
    events: [],
  };
  const lockedText = "Tovan feared the ferry would leave before dawn. Sera watched the water.";
  const gentle = await POV_CONSISTENCY_AGENT.analyze(directInput(lockedText, lockedContext, "gentle"));
  assert.equal(gentle.length, 1, "a locked POV rule escalates the head-hop to gentle");
  assertPinned(gentle[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  assert.deepEqual(gentle[0].canonRefs, ["qa_rule_pov_locked"]);
  assert.match(gentle[0].message, /locked POV rule/);

  const omniContext: CanonContext = {
    entries: [
      entryJson("qa_rule_pov_omni", "The narration is omniscient; head-hops are intentional.", {
        tags: ["pov"],
      }),
    ],
    characters: [SERA, TOVAN],
    events: [],
  };
  const omniText = "Sera wondered about the letter. Tovan feared the reply.";
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(directInput(omniText, omniContext, "strict")),
    [],
    "a declared omniscient narration silences head-hop detection entirely",
  );
});

test("acceptance: pov distance-shift fires at the pinned statistical gate over narration only (ac-4)", async () => {
  const standard = findingsOf(await analyzeTool("pov-consistency", "qa-pov", DISTANCE_CHUNK, "standard"));
  assert.equal(standard.length, 1);
  assert.equal(standard[0].type, "pov-distance-shift");
  assertPinned(standard[0], { severity: "minor", confidence: 0.7, minStrictness: "standard" });
  assert.equal(standard[0].quote, "I counted the coins twice before I paid.",
    "the finding sits at the deviant half's first sentence");
  assert.deepEqual(standard[0].canonRefs, []);
  assert.match(standard[0].message, /5 first-person/);
  assert.match(standard[0].message, /dialogue excluded/);
  assert.deepEqual(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov", DISTANCE_CHUNK, "gentle")),
    [],
    "distance shifts are standard-pinned",
  );

  assert.deepEqual(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov", DISTANCE_DELTA2_CHUNK, "strict")),
    [],
    "a delta of two stays under the statistical gate",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov", DISTANCE_SHORT_CHUNK, "strict")),
    [],
    "seven narration sentences never produce a distance finding",
  );
  assert.deepEqual(
    findingsOf(await analyzeTool("pov-consistency", "qa-pov", DISTANCE_DIALOGUE_CHUNK, "strict")),
    [],
    "first-person voice inside quoted dialogue does not drift the narration",
  );
});

// ---------------------------------------------------------------------------
// ac-5 — schema validation
// ---------------------------------------------------------------------------

test("acceptance: narrative findings validate against the finding schema (ac-5)", async () => {
  const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const agentEnum: string[] = schema.properties.agent.enum;
  assert.deepEqual(
    [...agentEnum].sort(),
    [...LANGUAGE_IDS, ...CONTINUITY_IDS, ...NARRATIVE_IDS, ...OPTIONAL_IDS].sort(),
    "the schema agent enum carries exactly the fourteen registered ids",
  );
  const categoryEnum: string[] = schema.properties.category.enum;
  assert.deepEqual([...categoryEnum].sort(), ["canon", "character", "language", "narrative", "optional", "prose", "timeline"]);

  const representatives: Finding[] = [
    ...findingsOf(await analyzeTool("plot-thread", "qa-plot", ANTONYM_CHUNK, "standard")),
    ...findingsOf(await analyzeTool("plot-thread", "qa-plot", PLANTED_CHUNK, "strict")),
    ...findingsOf(await analyzeTool("pacing-tension", "qa-pacing", STATIC_CHUNK, "strict")),
    ...findingsOf(await analyzeTool("pacing-tension", "qa-pacing", RUSHED_CHUNK, "strict")),
    ...findingsOf(await analyzeTool("pacing-tension", "qa-pacing", TURN_CHAIN_CHUNK, "strict")),
    ...findingsOf(await analyzeTool("pov-consistency", "qa-pov", HEADHOP_CHUNK, "standard")),
    ...findingsOf(await analyzeTool("pov-consistency", "qa-pov", DISTANCE_CHUNK, "standard")),
  ];
  assert.ok(representatives.length >= 9, "one representative of every narrative finding type");
  const types = new Set(representatives.map((f) => f.type));
  for (const type of [
    "plot-promise-conflict",
    "plot-promise-planted",
    "plot-open-question",
    "pacing-static-stretch",
    "pacing-rushed-passage",
    "tension-abrupt-shift",
    "pov-head-hop",
    "pov-distance-shift",
  ]) {
    assert.ok(types.has(type), `${type} is represented`);
  }
  for (const finding of representatives) {
    assert.equal(finding.category, "narrative", "narrative agents tag their findings narrative");
    assert.deepEqual(validateFinding(finding), [], `${finding.type} validates`);
  }
  const unknownAgent = { ...representatives[0], agent: "plot-threads" };
  assert.ok(validateFinding(unknownAgent).some((p) => p.includes("agent")), "unknown agent id is rejected");
  const unknownCategory = { ...representatives[0], category: "story" };
  assert.ok(validateFinding(unknownCategory).some((p) => p.includes("category")), "unknown category is rejected");
});

// ---------------------------------------------------------------------------
// ac-6 — modular enable/disable
// ---------------------------------------------------------------------------

test("acceptance: modular enablement — proof-narrative runs the narrative roster; the three existing proof projects keep it disabled (ac-6)", async () => {
  const proofFixturesDir = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));
  const { store: shipped, projectIds: shippedIds, skipped: shippedSkipped } = loadFixtures(proofFixturesDir);
  // Standing ruling v2 (additive): proof-implicit joins in the loader's
  // emission order (see packages/proof/test/proof.test.ts).
  assert.deepEqual(shippedIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);
  assert.deepEqual(shippedSkipped, [], "no shipped fixture is skipped");

  for (const projectId of ["proof", "proof-language", "proof-strict"]) {
    const raw = JSON.parse(readFileSync(join(proofFixturesDir, `${projectId}.settings.json`), "utf8")) as {
      agents: { agentId: string; enabled: boolean }[];
    };
    for (const id of NARRATIVE_IDS) {
      const agentEntry = raw.agents.find((a) => a.agentId === id);
      assert.ok(agentEntry, `${projectId} carries an explicit settings entry for ${id}`);
      assert.equal(agentEntry.enabled, false, `${projectId} disables ${id}`);
    }
    for (const id of NARRATIVE_IDS) {
      const result = await analyzeTool(id, projectId, RUSHED_CHUNK, "strict", shipped);
      assert.equal(result.invoked, false, `${id} is never invoked on ${projectId}`);
      assert.match(result.reason ?? "", /disabled/);
      assert.deepEqual(result.findings, []);
    }
  }

  const povOnShipped = await analyzeTool(
    "pov-consistency",
    "proof-narrative",
    "Maren wondered about the blade. Osric feared the bridge.",
    "standard",
    shipped,
  );
  assert.equal(povOnShipped.invoked, true, "the narrative roster runs on proof-narrative");
  assert.equal(povOnShipped.findingsCount, 1, "and catches the head-hop against the shipped POV rule");
  const povFinding = (povOnShipped.findings as Finding[])[0];
  assert.equal(povFinding.type, "pov-head-hop");
  assert.deepEqual(povFinding.canonRefs, ["canon_rule_pov_maren"]);

  const pacingOnShipped = await analyzeTool("pacing-tension", "proof-narrative", RUSHED_CHUNK, "strict", shipped);
  assert.equal(pacingOnShipped.invoked, true);
  assert.equal(pacingOnShipped.findingsCount, 1, "the shipped project catches the rushed passage");
  const plotOnShipped = await analyzeTool("plot-thread", "proof-narrative", CLEAN_CHUNK, "standard", shipped);
  assert.equal(plotOnShipped.invoked, true, "plot-thread is enabled on proof-narrative");

  const continuity = await analyzeTool("canon-lore", "qa-pov", HEADHOP_CHUNK, "strict");
  assert.equal(continuity.invoked, false, "the continuity roster is disabled on the QA narrative projects");
  assert.match(continuity.reason ?? "", /disabled/);
  const language = await analyzeTool("grammar-mechanics", "qa-plot", ANTONYM_CHUNK, "strict");
  assert.equal(language.invoked, false, "the language roster is disabled on the QA narrative projects");
  const narrative = await analyzeTool("plot-thread", "qa-plot", ANTONYM_CHUNK, "standard");
  assert.equal(narrative.invoked, true, "the narrative roster is enabled on the QA narrative projects");
});

// ---------------------------------------------------------------------------
// ac-7 — the pre-authorized pin updates, applied exactly as disclosed
// ---------------------------------------------------------------------------

test("acceptance: the pre-authorized pin updates are applied exactly as disclosed (ac-7)", () => {
  const seededErrorsPath = fileURLToPath(
    new URL("../../../proof/test/acceptance-seeded-errors.test.ts", import.meta.url),
  );
  const seededErrors = readFileSync(seededErrorsPath, "utf8");
  assert.match(seededErrors, /narrative: 0/, "the category Record pin seeds no narrative errors");
  assert.match(
    seededErrors,
    /"test\/narrative-proof\.test\.ts"/,
    "the offline scan covers the narrative proof suite",
  );

  const proofTestPath = fileURLToPath(new URL("../../../proof/test/proof.test.ts", import.meta.url));
  assert.match(readFileSync(proofTestPath, "utf8"), /proof-narrative/, "the projectIds pin gained proof-narrative");

  const agentsTestPath = fileURLToPath(new URL("../../../agents/test/agents.test.ts", import.meta.url));
  const agentsTest = readFileSync(agentsTestPath, "utf8");
  assert.match(agentsTest, /continuity \+ language \+ narrative/, "the descriptor pin message was reworded as disclosed");
});

// ---------------------------------------------------------------------------
// clean silence at every level
// ---------------------------------------------------------------------------

test("acceptance: clean prose stays silent for all three narrative agents at every level (ac-3, ac-4)", async () => {
  for (const level of ["gentle", "standard", "strict"] as const) {
    for (const id of NARRATIVE_IDS) {
      const result = await analyzeTool(id, "qa-plot", CLEAN_CHUNK, level);
      assert.deepEqual(findingsOf(result), [], `clean prose must be silent for ${id} at ${level}`);
    }
  }
});

// ---------------------------------------------------------------------------
// ac-8 — determinism of the tool path
// ---------------------------------------------------------------------------

test("acceptance: narrative findings are deterministic across repeated passes (ac-8)", async () => {
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
    ["plot-thread", "qa-plot", ANTONYM_CHUNK, "standard"],
    ["plot-thread", "qa-plot", PLANTED_CHUNK, "strict"],
    ["pacing-tension", "qa-pacing", STATIC_CHUNK, "strict"],
    ["pov-consistency", "qa-pov", HEADHOP_CHUNK, "standard"],
    ["pov-consistency", "qa-pov", DISTANCE_CHUNK, "standard"],
  ];
  for (const [agentId, projectId, text, level] of samples) {
    const first = stable(await analyzeTool(agentId, projectId, text, level));
    const second = stable(await analyzeTool(agentId, projectId, text, level));
    assert.deepEqual(second, first, `${agentId}: identical across passes`);
  }
});
