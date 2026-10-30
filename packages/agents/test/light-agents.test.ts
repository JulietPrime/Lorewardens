import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { AnalyzeInput, CanonContext, CanonEntry, Character, Finding } from "@lorewardens/core";
import { surfacesAt } from "@lorewardens/core";
import {
  AGENT_DESCRIPTORS,
  ALL_AGENTS,
  CONTINUITY_AGENTS,
  LANGUAGE_AGENTS,
  NARRATIVE_AGENTS,
  OPTIONAL_AGENTS,
  SENSITIVITY_REPRESENTATION_AGENT,
  SHOW_VS_TELL_AGENT,
  THEME_MOTIF_AGENT,
} from "../src/index.js";
import { defaultOffStoreHelpers } from "./default-off-store.js";

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

function analyzeInput(partial: Partial<AnalyzeInput>, strictness: "off" | "gentle" | "standard" | "strict"): AnalyzeInput {
  return {
    projectId: "p1",
    chunk: chunk(""),
    context: EMPTY_CONTEXT,
    strictness,
    settings: EMPTY_SETTINGS,
    ...partial,
  };
}

const LIGHT_AGENT_IDS = ["show-vs-tell", "sensitivity-representation", "theme-motif"] as const;

// ---------------------------------------------------------------------------
// Schema validation (mirrors schemas/finding.schema.json)
// ---------------------------------------------------------------------------

const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function assertLightShape(finding: Finding, pins: { severity: string; confidence: number; minStrictness: string }): void {
  for (const field of schema.required) assert.ok(field in finding, `finding missing required field '${field}'`);
  assert.match(finding.id, /^fnd_[0-9a-fA-F-]{36}$/);
  assert.ok(schema.properties.agent.enum.includes(finding.agent), "agent enum");
  assert.ok(schema.properties.category.enum.includes(finding.category), "category enum");
  assert.equal(finding.category, "optional", "light findings carry the optional category");
  assert.equal(finding.severity, pins.severity, "severity pin");
  assert.equal(finding.confidence, pins.confidence, "confidence pin");
  assert.equal(finding.minStrictness, pins.minStrictness, "minStrictness pin");
  assert.ok(finding.message.length > 0, "message explains the observation");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.endOffset > finding.location.startOffset, "location spans text");
  assert.equal(finding.suggestion, null, "light findings are observational: suggestion is null");
  assert.ok(!Number.isNaN(Date.parse(finding.createdAt)));
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test("the three optional agents are exported behind the same contract, off by default", () => {
  assert.deepEqual(
    OPTIONAL_AGENTS.map((a) => a.id),
    ["show-vs-tell", "sensitivity-representation", "theme-motif"],
  );
  assert.deepEqual(ALL_AGENTS.map((a) => a.id), [
    ...CONTINUITY_AGENTS.map((a) => a.id),
    ...LANGUAGE_AGENTS.map((a) => a.id),
    ...NARRATIVE_AGENTS.map((a) => a.id),
    ...OPTIONAL_AGENTS.map((a) => a.id),
  ]);
  for (const agent of OPTIONAL_AGENTS) {
    assert.equal(typeof agent.analyze, "function");
    assert.equal(agent.descriptor, AGENT_DESCRIPTORS.find((d) => d.id === agent.id));
    assert.equal(agent.descriptor.family, "optional", `${agent.id} is in the optional family`);
    assert.equal(agent.descriptor.defaultStrictness, "standard");
    assert.equal(agent.descriptor.defaultEnabled, false, `${agent.id} is off by default`);
    assert.deepEqual(agent.descriptor.options, []);
  }
  for (const d of AGENT_DESCRIPTORS.slice(0, 11)) {
    assert.equal(d.defaultEnabled, undefined, `${d.id} is untouched: absent defaultEnabled means enabled`);
  }
});

// ---------------------------------------------------------------------------
// Show vs Tell
// ---------------------------------------------------------------------------

test("show-vs-tell: emotion labels are standard-pinned info with null suggestion", async () => {
  const findings = await SHOW_VS_TELL_AGENT.analyze(
    analyzeInput({ chunk: chunk("She felt terrified as the door swung open.") }, "standard"),
  );
  assert.equal(findings.length, 1);
  assertLightShape(findings[0], { severity: "info", confidence: 0.75, minStrictness: "standard" });
  assert.equal(findings[0].type, "craft-emotion-label");
  assert.match(findings[0].message, /terrified/);
});

test("show-vs-tell: felt and was constructions both carry the label, one finding per sentence", async () => {
  const findings = await SHOW_VS_TELL_AGENT.analyze(
    analyzeInput({ chunk: chunk("She felt terrified as the door swung open. He was furious about the letter.") }, "strict"),
  );
  assert.equal(findings.length, 2, "one finding per labeled sentence");
  assert.ok(findings[0].quote.startsWith("She felt terrified"));
  assert.ok(findings[1].quote.startsWith("He was furious"));
});

test("show-vs-tell: two labels in one sentence deduplicate to the first table hit", async () => {
  const findings = await SHOW_VS_TELL_AGENT.analyze(
    analyzeInput({ chunk: chunk("She felt terrified and furious at once.") }, "strict"),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /terrified/, "the first table-ordered label names the finding");
});

test("show-vs-tell: emotion labels stay below the gentle floor but surface at standard and strict", async () => {
  const input = { chunk: chunk("She felt terrified as the door swung open.") };
  assert.deepEqual(await SHOW_VS_TELL_AGENT.analyze(analyzeInput(input, "gentle")), [], "0.75 is below the gentle floor");
  assert.equal((await SHOW_VS_TELL_AGENT.analyze(analyzeInput(input, "standard"))).length, 1);
  assert.equal((await SHOW_VS_TELL_AGENT.analyze(analyzeInput(input, "strict"))).length, 1);
  assert.deepEqual(await SHOW_VS_TELL_AGENT.analyze(analyzeInput(input, "off")), [], "off is silent");
});

test("show-vs-tell: exposition block is strict-effective as pinned, one finding per run at the run's first sentence", async () => {
  const run = [
    "The harbor town had always been a place of waiting, patient and gray.",
    "The families mended their nets in the same salt-stained sheds by the seawall.",
    "The tide bell rang three times each morning, and the whole town rose with it.",
    "Over the years the old customs had hardened into habit, and the habit into law.",
    "The boats came home heavy with fish, and the gulls followed them in.",
    "The town believed the sea gave nothing freely, and it paid for what it took.",
  ].join(" ");
  const findings = await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(run) }, "strict"));
  assert.equal(findings.length, 1);
  assertLightShape(findings[0], { severity: "info", confidence: 0.6, minStrictness: "strict" });
  assert.equal(findings[0].type, "craft-exposition-block");
  assert.equal(findings[0].quote, "The harbor town had always been a place of waiting, patient and gray.");
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(run) }, "standard")),
    [],
    "strict-effective: silent at standard",
  );
});

test("show-vs-tell: exposition thresholds — sentences, words and distinct cues each gate the run", async () => {
  const six = [
    "The harbor town had always been a place of waiting, patient and gray.",
    "The families mended their nets in the same salt-stained sheds by the seawall.",
    "The tide bell rang three times each morning, and the whole town rose with it.",
    "Over the years the old customs had hardened into habit, and the habit into law.",
    "The boats came home heavy with fish, and the gulls followed them in.",
    "The town believed the sea gave nothing freely, and it paid for what it took.",
  ];
  const five = six.slice(0, 5).join(" ");
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(five) }, "strict")),
    [],
    "five consecutive narration sentences stay below the run threshold",
  );
  const shortWords = [
    "The town had always been gray.",
    "The nets dried on the wall.",
    "The bell rang at dawn.",
    "Over the years it faded.",
    "The boats came home.",
    "The gulls followed them.",
  ].join(" ");
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(shortWords) }, "strict")),
    [],
    "a run under 80 words stays silent",
  );
  const oneCue = [
    "The harbor town had always been a place of waiting, patient and gray.",
    "The families mended their nets in the same salt-stained sheds by the seawall.",
    "The tide bell rang three times each morning, and the whole town rose with it.",
    "The harbormaster kept the ledgers himself, in a hand like knotted rope.",
    "The boats came home heavy with fish, and the gulls followed them in.",
    "The town believed the sea gave nothing freely, and it paid for what it took.",
  ].join(" ");
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(oneCue) }, "strict")),
    [],
    "one distinct cue is not enough",
  );
});

test("show-vs-tell: quoted dialogue breaks an exposition run and is excluded everywhere", async () => {
  const withDialogue = [
    "The harbor town had always been a place of waiting, patient and gray.",
    "The families mended their nets in the same salt-stained sheds by the seawall.",
    '"The bell will ring at dawn," the harbormaster said.',
    "Over the years the old customs had hardened into habit, and the habit into law.",
    "The boats came home heavy with fish, and the gulls followed them in.",
    "The town believed the sea gave nothing freely, and it paid for what it took.",
    "The tide bell rang three times each morning, and the whole town rose with it.",
    "The watch was set and the lamps were trimmed, and the ledger closed for the night.",
  ].join(" ");
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(withDialogue) }, "strict")),
    [],
    "the quoted sentence splits the run into sub-threshold halves",
  );
  const labeledDialogue = 'He said, "I felt terrified of the dark." The hall stayed quiet.';
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(labeledDialogue) }, "strict")),
    [],
    "a quoted emotion label never fires",
  );
  const filteredDialogue = 'She said, "I saw that the gate was open." The yard stayed empty.';
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk(filteredDialogue) }, "strict")),
    [],
    "a quoted filter phrase never fires",
  );
});

test("show-vs-tell: filter phrases are strict-only, one per sentence, deduplicated", async () => {
  const two = await SHOW_VS_TELL_AGENT.analyze(
    analyzeInput({ chunk: chunk("She saw that the gate was open. He could hear the bells.") }, "strict"),
  );
  assert.equal(two.length, 2, "one finding per sentence");
  for (const finding of two) {
    assertLightShape(finding, { severity: "info", confidence: 0.55, minStrictness: "strict" });
    assert.equal(finding.type, "craft-filter-phrase");
  }
  const dedup = await SHOW_VS_TELL_AGENT.analyze(
    analyzeInput({ chunk: chunk("She saw that the gate was open and could hear the bells.") }, "strict"),
  );
  assert.equal(dedup.length, 1, "two phrases in one sentence yield one finding");
  assert.deepEqual(
    await SHOW_VS_TELL_AGENT.analyze(analyzeInput({ chunk: chunk("She saw that the gate was open.") }, "standard")),
    [],
    "0.55 is below the standard floor: strict-effective as pinned",
  );
});

// ---------------------------------------------------------------------------
// Sensitivity / Representation
// ---------------------------------------------------------------------------

test("sensitivity: stereotype phrases surface at gentle as declared, advisory only", async () => {
  const input = { chunk: chunk("He had learned they are all the same.") };
  const findings = await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput(input, "gentle"));
  assert.equal(findings.length, 1, "gentle-effective: fires as soon as the writer enables the agent");
  assertLightShape(findings[0], { severity: "minor", confidence: 0.9, minStrictness: "gentle" });
  assert.equal(findings[0].type, "sensitivity-stereotype-phrase");
  assert.equal((await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput(input, "standard"))).length, 1);
  assert.equal((await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput(input, "strict"))).length, 1);
  assert.deepEqual(await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput(input, "off")), [], "off is silent");
  assert.doesNotMatch(findings[0].message, /must|should|rewrite/i, "the message describes, never prescribes");
});

test("sensitivity: broad-brush generalizations surface at standard, silent at gentle", async () => {
  const input = { chunk: chunk("All the villagers gathered at the well.") };
  assert.deepEqual(
    await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput(input, "gentle")),
    [],
    "0.7 is below the gentle floor",
  );
  const findings = await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput(input, "standard"));
  assert.equal(findings.length, 1);
  assertLightShape(findings[0], { severity: "info", confidence: 0.7, minStrictness: "standard" });
  assert.equal(findings[0].type, "sensitivity-broad-brush");
  assert.match(findings[0].message, /villagers/);
  assert.doesNotMatch(findings[0].message, /must|should|rewrite/i, "the message describes, never prescribes");
});

test("sensitivity: a frame without a group term, and a group term without a frame, both stay silent", async () => {
  const frameOnly = await SENSITIVITY_REPRESENTATION_AGENT.analyze(
    analyzeInput({ chunk: chunk("All the doors were barred.") }, "standard"),
  );
  assert.deepEqual(frameOnly, [], "essentialist frame over objects is not a group generalization");
  const termOnly = await SENSITIVITY_REPRESENTATION_AGENT.analyze(
    analyzeInput({ chunk: chunk("The villagers gathered at the well.") }, "standard"),
  );
  assert.deepEqual(termOnly, [], "naming a group without an essentialist frame is not flagged");
});

test("sensitivity: the fictional-culture guard stays silent when canon or characters claim the term", async () => {
  const text = "All the villagers gathered at the well.";
  const claimedByCanon: CanonContext = {
    entries: [entry("canon_paths", "The villagers of the cove keep the old paths.")],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await SENSITIVITY_REPRESENTATION_AGENT.analyze(
      analyzeInput({ chunk: chunk(text), context: claimedByCanon }, "strict"),
    ),
    [],
    "a canon entry that names the group claims the term for the fictional world",
  );
  const claimedByLockedCanon: CanonContext = {
    entries: [entry("canon_paths", "The villagers of the cove keep the old paths.", { locked: true })],
    characters: [],
    events: [],
  };
  assert.deepEqual(
    await SENSITIVITY_REPRESENTATION_AGENT.analyze(
      analyzeInput({ chunk: chunk(text), context: claimedByLockedCanon }, "strict"),
    ),
    [],
    "locked world rules are never treated as violations",
  );
  const claimedByCharacter: CanonContext = {
    entries: [],
    characters: [character("char_speaker", "Ade", { aliases: ["speaker for the villagers"] })],
    events: [],
  };
  assert.deepEqual(
    await SENSITIVITY_REPRESENTATION_AGENT.analyze(
      analyzeInput({ chunk: chunk(text), context: claimedByCharacter }, "strict"),
    ),
    [],
    "a character name or alias that names the group claims the term",
  );
});

test("sensitivity: a claimed term is skipped but an unclaimed term in the same sentence still reports", async () => {
  const context: CanonContext = {
    entries: [entry("canon_paths", "The villagers of the cove keep the old paths.")],
    characters: [],
    events: [],
  };
  const findings = await SENSITIVITY_REPRESENTATION_AGENT.analyze(
    analyzeInput({ chunk: chunk("All the villagers and strangers came up from the shore.") , context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /strangers/, "the unclaimed term is the one reported");
  assert.doesNotMatch(findings[0].message, /villagers/, "the claimed term stays out of the finding");
});

test("sensitivity: quoted dialogue is excluded — characters speak in their own voice", async () => {
  const dialogue = '"They are all the same," the harbor master said, and spat into the water. Mira paid him and walked on.';
  assert.deepEqual(
    await SENSITIVITY_REPRESENTATION_AGENT.analyze(analyzeInput({ chunk: chunk(dialogue) }, "strict")),
    [],
    "the stereotype phrase lives inside a quoted span",
  );
});

// ---------------------------------------------------------------------------
// Theme / Motif
// ---------------------------------------------------------------------------

const LIGHTHOUSE_TEXT = "The lighthouse is lit every night while ships are at sea.";
const STORM_TEXT = "The storm passes before the festival begins.";

function motifContext(entries: CanonEntry[]): CanonContext {
  return { entries, characters: [], events: [] };
}

test("theme-motif: with zero confirmed motif entries the agent is silent at every level", async () => {
  const text = "The lighthouse never burned while the ships sheltered in the harbor.";
  for (const level of ["gentle", "standard", "strict"] as const) {
    assert.deepEqual(
      await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: EMPTY_CONTEXT }, level)),
      [],
      `no marked motifs: silent at ${level}`,
    );
  }
});

test("theme-motif: only confirmed, kind-rule, motif-tagged entries drive findings", async () => {
  const text = "The lighthouse never burned while the ships sheltered in the harbor.";
  const wrongKind = motifContext([entry("m1", LIGHTHOUSE_TEXT, { kind: "fact", tags: ["motif"] })]);
  const wrongTag = motifContext([entry("m2", LIGHTHOUSE_TEXT, { tags: ["plot-thread"] })]);
  const proposed = motifContext([entry("m3", LIGHTHOUSE_TEXT, { status: "proposed" })]);
  for (const context of [wrongKind, wrongTag, proposed]) {
    assert.deepEqual(
      await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "strict")),
      [],
      "the kind-rule + tag-motif selector constraint holds",
    );
  }
  const right = motifContext([entry("m4", LIGHTHOUSE_TEXT, { tags: ["motif"] })]);
  assert.equal((await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: right }, "standard"))).length, 1);
});

test("theme-motif: motif-conflict is minor/0.75/standard, references the entry, suggestion null", async () => {
  const context = motifContext([entry("canon_motif_lighthouse", LIGHTHOUSE_TEXT, { tags: ["motif"] })]);
  const input = { chunk: chunk("The lighthouse never burned while the ships sheltered in the harbor."), context };
  const findings = await THEME_MOTIF_AGENT.analyze(analyzeInput(input, "standard"));
  assert.equal(findings.length, 1);
  assertLightShape(findings[0], { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  assert.equal(findings[0].type, "motif-conflict");
  assert.deepEqual(findings[0].canonRefs, ["canon_motif_lighthouse"]);
  assert.deepEqual(await THEME_MOTIF_AGENT.analyze(analyzeInput(input, "gentle")), [], "0.75 is below the gentle floor");
});

test("theme-motif: a locked motif escalates to major/0.95/gentle", async () => {
  const context = motifContext([
    entry("canon_motif_storm", STORM_TEXT, { tags: ["motif"], locked: true, lockReason: "core motif" }),
  ]);
  const input = { chunk: chunk("The storm never passed before the festival."), context };
  const findings = await THEME_MOTIF_AGENT.analyze(analyzeInput(input, "gentle"));
  assert.equal(findings.length, 1);
  assertLightShape(findings[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  assert.equal(surfacesAt(findings[0], "gentle"), true);
  assert.match(findings[0].message, /locked/);
});

test("theme-motif: antonym and numeric conflict paths fire through the reused helpers", async () => {
  const antonymContext = motifContext([entry("m_shut", "The door was shut since the accident.", { tags: ["motif"] })]);
  const antonym = await THEME_MOTIF_AGENT.analyze(
    analyzeInput({ chunk: chunk("The door stood open."), context: antonymContext }, "standard"),
  );
  assert.equal(antonym.length, 1);
  assert.match(antonym[0].message, /stands opposite/);
  const numericContext = motifContext([entry("m_days", "The festival lasts three days.", { tags: ["motif"] })]);
  const numeric = await THEME_MOTIF_AGENT.analyze(
    analyzeInput({ chunk: chunk("The festival lasted five days."), context: numericContext }, "standard"),
  );
  assert.equal(numeric.length, 1);
  assert.match(numeric[0].message, /counts/);
});

test("theme-motif: one conflict finding per entry per chunk, at the first offending sentence", async () => {
  const context = motifContext([entry("canon_motif_lighthouse", LIGHTHOUSE_TEXT, { tags: ["motif"] })]);
  const text = "The lighthouse never burned and the ships never came. No ship ever saw it lit again.";
  const findings = await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].quote, "The lighthouse never burned and the ships never came.");
});

test("theme-motif: recurrence is strict-only info naming the recurring terms at the first matching sentence", async () => {
  const context = motifContext([entry("canon_motif_lighthouse", LIGHTHOUSE_TEXT, { tags: ["motif"] })]);
  const text =
    "The keeper climbed to the lighthouse before dawn. From the gallery he counted the ships waiting for the tide. By noon every ship had passed, and the lighthouse beam swept the water.";
  const findings = await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "strict"));
  assert.equal(findings.length, 1);
  assertLightShape(findings[0], { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.equal(findings[0].type, "motif-recurrence");
  assert.deepEqual(findings[0].canonRefs, ["canon_motif_lighthouse"]);
  assert.match(findings[0].message, /lighthouse/);
  assert.match(findings[0].message, /ships/);
  assert.equal(findings[0].quote, "The keeper climbed to the lighthouse before dawn.");
  assert.deepEqual(
    await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard")),
    [],
    "recurrence is strict-only",
  );
});

test("theme-motif: recurrence stays silent below three occurrences and ignores quoted occurrences", async () => {
  const context = motifContext([entry("canon_motif_lighthouse", LIGHTHOUSE_TEXT, { tags: ["motif"] })]);
  const two = await THEME_MOTIF_AGENT.analyze(
    analyzeInput(
      { chunk: chunk("The lighthouse never burned while the ships sheltered in the harbor."), context },
      "strict",
    ),
  );
  assert.deepEqual(
    two.filter((f) => f.type === "motif-recurrence"),
    [],
    "two occurrences stay below the recurrence threshold",
  );
  const dialogueOnly = await THEME_MOTIF_AGENT.analyze(
    analyzeInput({ chunk: chunk('"Lighthouse," she said. "Lighthouse," he said. "Lighthouse," the child said.'), context }, "strict"),
  );
  assert.deepEqual(
    dialogueOnly.filter((f) => f.type === "motif-recurrence"),
    [],
    "quoted occurrences are not narration",
  );
});

test("theme-motif: both finding types for one entry stay independent and one-per-entry", async () => {
  const context = motifContext([
    entry("canon_motif_storm", STORM_TEXT, { tags: ["motif"] }),
    entry("canon_motif_lighthouse", LIGHTHOUSE_TEXT, { tags: ["motif"] }),
  ]);
  const text =
    "The storm never passed before the festival. The keeper climbed to the lighthouse before dawn. From the gallery he counted the ships waiting for the tide. By noon the ships had gone and the lighthouse beam swept the water.";
  const findings = await THEME_MOTIF_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "strict"));
  const conflicts = findings.filter((f) => f.type === "motif-conflict");
  const recurrences = findings.filter((f) => f.type === "motif-recurrence");
  assert.equal(conflicts.length, 1, "one conflict per entry per chunk");
  assert.deepEqual(conflicts[0].canonRefs, ["canon_motif_storm"]);
  assert.equal(recurrences.length, 1, "one recurrence per entry per chunk");
  assert.deepEqual(recurrences[0].canonRefs, ["canon_motif_lighthouse"]);
});

// ---------------------------------------------------------------------------
// Default-off mechanics
// ---------------------------------------------------------------------------

test("defaultSettings resolves the trio disabled and every existing agent unchanged", async () => {
  const { defaultSettings } = await defaultOffStoreHelpers();
  const settings = defaultSettings("p1");
  assert.equal(settings.agents.length, 14);
  for (const d of AGENT_DESCRIPTORS.slice(0, 11)) {
    const row = settings.agents.find((a) => a.agentId === d.id);
    assert.ok(row, `${d.id} keeps its settings row`);
    assert.deepEqual(
      { agentId: row.agentId, enabled: row.enabled, strictness: row.strictness, options: row.options },
      {
        agentId: d.id,
        enabled: true,
        strictness: d.defaultStrictness,
        options: Object.fromEntries((d.options ?? []).map((o) => [o.key, o.default])),
      },
      `${d.id} resolves enabled with its descriptor defaults, unchanged`,
    );
  }
  for (const id of LIGHT_AGENT_IDS) {
    const row = settings.agents.find((a) => a.agentId === id);
    assert.ok(row, `${id} has a settings row`);
    assert.equal(row.enabled, false, `${id} is disabled by default`);
    assert.equal(row.strictness, "standard");
  }
});

test("loadFixtureBundle keeps existing fixtures light-free and resolves the trio disabled", async () => {
  const { loadFixtureBundle } = await defaultOffStoreHelpers();
  const fixturesDir = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));
  for (const projectId of ["proof", "proof-language", "proof-narrative", "proof-strict"]) {
    const raw = JSON.parse(readFileSync(`${fixturesDir}/${projectId}.settings.json`, "utf8")) as {
      agents: { agentId: string; enabled: boolean }[];
    };
    for (const id of LIGHT_AGENT_IDS) {
      assert.equal(
        raw.agents.find((a) => a.agentId === id),
        undefined,
        `${projectId} settings carry no light-agent entry (zero fixture edits is the default-off proof)`,
      );
    }
    const bundle = loadFixtureBundle(fixturesDir, projectId);
    assert.equal(bundle.settings.agents.length, 14, `${projectId} resolves the full roster`);
    for (const id of LIGHT_AGENT_IDS) {
      const row = bundle.settings.agents.find((a) => a.agentId === id);
      assert.ok(row, `${projectId}: ${id} resolved from defaults`);
      assert.equal(row.enabled, false, `${projectId}: ${id} is disabled through the merge`);
    }
    for (const rawRow of raw.agents) {
      const resolved = bundle.settings.agents.find((a) => a.agentId === rawRow.agentId);
      assert.ok(resolved, `${projectId}: ${rawRow.agentId} still resolves`);
      assert.equal(resolved.enabled, rawRow.enabled, `${projectId}: ${rawRow.agentId} enabled state untouched`);
    }
  }
});
