import assert from "node:assert/strict";
import { test } from "node:test";
import type { AnalyzeInput, CanonContext, CanonEntry, Character, Finding } from "@lorewardens/core";
import {
  AGENT_DESCRIPTORS,
  ALL_AGENTS,
  CONTINUITY_AGENTS,
  LANGUAGE_AGENTS,
  NARRATIVE_AGENTS,
  PACING_TENSION_AGENT,
  PLOT_THREAD_AGENT,
  POV_CONSISTENCY_AGENT,
} from "../src/index.js";
import { pacingTensionFindings } from "../src/pacing-tension.js";
import { plotThreadFindings } from "../src/plot-thread.js";
import { povConsistencyFindings } from "../src/pov-consistency.js";

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

function assertShape(finding: Finding, pins: { severity: string; confidence: number; minStrictness: string }) {
  assert.ok(finding.message.length > 0, "message explains the observation");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.file.length > 0, "location has a file");
  assert.ok(finding.location.endOffset > finding.location.startOffset, "location spans text");
  assert.equal(finding.severity, pins.severity, "severity pin");
  assert.equal(finding.confidence, pins.confidence, "confidence pin");
  assert.equal(finding.minStrictness, pins.minStrictness, "minStrictness pin");
}

function categoryOf(finding: Finding, agent: string) {
  assert.equal(finding.agent, agent, `finding belongs to ${agent}`);
  assert.equal(finding.category, "narrative", "narrative findings carry the narrative category");
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

test("the three narrative agents are exported behind the same contract", () => {
  assert.deepEqual(
    NARRATIVE_AGENTS.map((a) => a.id),
    ["plot-thread", "pacing-tension", "pov-consistency"],
  );
  assert.deepEqual(ALL_AGENTS.map((a) => a.id), [
    ...CONTINUITY_AGENTS.map((a) => a.id),
    ...LANGUAGE_AGENTS.map((a) => a.id),
    ...NARRATIVE_AGENTS.map((a) => a.id),
  ]);
  for (const agent of NARRATIVE_AGENTS) {
    assert.equal(typeof agent.analyze, "function");
    assert.equal(agent.descriptor, AGENT_DESCRIPTORS.find((d) => d.id === agent.id));
    assert.equal(agent.descriptor.family, "narrative");
    assert.equal(agent.descriptor.defaultStrictness, "standard");
    assert.deepEqual(agent.descriptor.options, []);
  }
});

// ---------------------------------------------------------------------------
// plot-thread
// ---------------------------------------------------------------------------

const BLADE_PROMISE = entry("canon_promise_blade", "Maren swore to always guard the eastern bridge.", {
  tags: ["plot-thread"],
});

test("plot-thread: antonym conflict caught at standard with the entry as canonRef", async () => {
  const context: CanonContext = { entries: [BLADE_PROMISE], characters: [], events: [] };
  const findings = await PLOT_THREAD_AGENT.analyze(
    analyzeInput(
      { chunk: chunk("Maren told the council she would never guard the eastern bridge."), context },
      "standard",
    ),
  );
  assert.equal(findings.length, 1);
  const finding = findings[0];
  categoryOf(finding, "plot-thread");
  assert.equal(finding.type, "plot-promise-conflict");
  assertShape(finding, { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  assert.deepEqual(finding.canonRefs, ["canon_promise_blade"]);
});

test("plot-thread: negation-of-affirmed conflict caught via aboutStatement + negation", async () => {
  const beacon = entry("canon_promise_beacon", "The beacon on Harrow Tower burns every night so the valley can find the ford.", {
    tags: ["plot-thread"],
  });
  const context: CanonContext = { entries: [beacon], characters: [], events: [] };
  const findings = await PLOT_THREAD_AGENT.analyze(
    analyzeInput({ chunk: chunk("The beacon on Harrow Tower does not burn at night."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "plot-promise-conflict");
  assert.deepEqual(findings[0].canonRefs, ["canon_promise_beacon"]);
});

test("plot-thread: numeric conflict caught when the passage counts differently", async () => {
  const ferry = entry("canon_promise_ferry", "The ferry carries three riders and no more.", { tags: ["plot-thread"] });
  const context: CanonContext = { entries: [ferry], characters: [], events: [] };
  const findings = await PLOT_THREAD_AGENT.analyze(
    analyzeInput({ chunk: chunk("The ferry carried five riders at dawn."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "plot-promise-conflict");
  assert.deepEqual(findings[0].canonRefs, ["canon_promise_ferry"]);
});

test("plot-thread: one finding per entry per chunk, located at the first offending sentence", async () => {
  const context: CanonContext = { entries: [BLADE_PROMISE], characters: [], events: [] };
  const text = "Osric said the road was open. Maren told the crowd she would never guard the eastern bridge.";
  const findings = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "strict"));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].quote, "Maren told the crowd she would never guard the eastern bridge.");
});

test("plot-thread: locked promise escalates to major/gentle and surfaces at gentle", async () => {
  const locked = entry("canon_promise_oath", "Gwyn swore an oath to protect the heir at all times.", {
    tags: ["plot-thread"],
    locked: true,
    lockReason: "The oath holds until the sequel.",
  });
  const context: CanonContext = { entries: [locked], characters: [], events: [] };
  const text = "Gwyn did not protect the heir when the riot came.";
  const standard = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(standard.length, 1);
  assertShape(standard[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  const gentle = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "gentle"));
  assert.equal(gentle.length, 1);
  assert.equal(gentle[0].type, "plot-promise-conflict");
});

test("plot-thread: planted promises are strict-only info notes that name the cue", async () => {
  const text = "She promised the ferryman her silver ring if he would wait past midnight.";
  const standard = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: EMPTY_CONTEXT }, "standard"));
  assert.deepEqual(standard, [], "strict-only note stays below the standard floor");
  const strict = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: EMPTY_CONTEXT }, "strict"));
  assert.equal(strict.length, 1);
  const finding = strict[0];
  categoryOf(finding, "plot-thread");
  assert.equal(finding.type, "plot-promise-planted");
  assertShape(finding, { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.deepEqual(finding.canonRefs, []);
  assert.ok(finding.message.includes("promised"), "message names the cue");
  assert.ok(!/will be tracked/.test(finding.message), "never asserts the promise will be tracked");
  assert.ok(finding.suggestion?.includes("plot-thread"), "suggestion points at a plot-thread canon entry");
  assert.ok(finding.suggestion?.includes("dismiss"), "suggestion offers dismissal");
});

test("plot-thread: a promise spoken in dialogue is not a planted narration cue", async () => {
  const text = 'He vowed to return. "I promised the ferryman," Maren said.';
  const strict = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: EMPTY_CONTEXT }, "strict"));
  const planted = strict.filter((f) => f.type === "plot-promise-planted");
  assert.equal(planted.length, 1, "only the narration sentence plants a promise");
  assert.equal(planted[0].quote, "He vowed to return.");
});

test("plot-thread: open questions are strict-only, one per sentence", async () => {
  const text = "No one knew where the blade had gone. What had the shrine kept all these years?";
  const standard = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: EMPTY_CONTEXT }, "standard"));
  assert.deepEqual(standard, []);
  const strict = await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(text), context: EMPTY_CONTEXT }, "strict"));
  assert.equal(strict.length, 2, "one finding per sentence");
  assert.ok(strict.every((f) => f.type === "plot-open-question"));
  assert.ok(strict.every((f) => f.severity === "info" && f.confidence === 0.55 && f.minStrictness === "strict"));
  assert.ok(strict.every((f) => f.suggestion === null));
});

test("plot-thread: entries without the plot-thread tag stay silent for conflicts, detection still works", async () => {
  const untagged = entry("canon_lore_blade", "Maren swore to always guard the eastern bridge.", { tags: ["lore"] });
  const proposed = entry("canon_promise_draft", "Maren swore to always guard the eastern bridge.", {
    tags: ["plot-thread"],
    status: "proposed",
  });
  const context: CanonContext = { entries: [untagged, proposed], characters: [], events: [] };
  const conflict = await PLOT_THREAD_AGENT.analyze(
    analyzeInput({ chunk: chunk("Maren told the council she would never guard the eastern bridge."), context }, "strict"),
  );
  assert.deepEqual(conflict, [], "conflict paths are tag-gated to confirmed plot-thread entries");
  const planted = await PLOT_THREAD_AGENT.analyze(
    analyzeInput({ chunk: chunk("He vowed to return by the harvest moon."), context }, "strict"),
  );
  assert.equal(planted.length, 1, "planted detection needs no canon");
  assert.equal(planted[0].type, "plot-promise-planted");
});

test("plot-thread: clean text and strictness off stay silent", async () => {
  const context: CanonContext = { entries: [BLADE_PROMISE], characters: [], events: [] };
  const clean = "Maren walked the wall road and counted the bells with Osric.";
  assert.deepEqual(await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: chunk(clean), context }, "strict")), []);
  assert.deepEqual(
    await PLOT_THREAD_AGENT.analyze(
      analyzeInput({ chunk: chunk("Maren told the crowd she would never guard the eastern bridge."), context }, "off"),
    ),
    [],
    "off never emits",
  );
});

// ---------------------------------------------------------------------------
// pacing-tension
// ---------------------------------------------------------------------------

function narrationRun(sentences: string[]): string {
  return sentences.join(" ");
}

const LONG_RUN = narrationRun([
  "The road climbed away from the river in long switchbacks.",
  "Twice the riders passed shrines older than the kingdom itself.",
  "Beyond the second shrine the trees thinned and the wind carried the smell of snow.",
  "Osric checked the packs at the next rise and said nothing about the missing rope.",
  "Maren rode with her collar up and her eyes on the ridge line.",
  "By late afternoon the light went copper over the western hills.",
  "They made camp below a shelf of stone, and the horses grazed the thin grass.",
  "The night came on without a sound, and the watch fires burned low along the line.",
]);

test("pacing: static stretch fires once per run at the run's first sentence", async () => {
  const standard = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(LONG_RUN) }, "standard"));
  assert.deepEqual(standard, [], "the 0.6 confidence note stays below the standard floor");
  const strict = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(LONG_RUN) }, "strict"));
  assert.equal(strict.length, 1);
  const finding = strict[0];
  categoryOf(finding, "pacing-tension");
  assert.equal(finding.type, "pacing-static-stretch");
  assertShape(finding, { severity: "info", confidence: 0.6, minStrictness: "standard" });
  assert.deepEqual(finding.canonRefs, []);
  assert.equal(finding.suggestion, null, "observational pacing notes never advise");
  assert.equal(finding.quote, "The road climbed away from the river in long switchbacks.");
});

test("pacing: dialogue breaks a static run and short runs stay silent", async () => {
  const first = narrationRun([
    "The road climbed away from the river in long switchbacks.",
    "Twice the riders passed shrines older than the kingdom.",
    "Beyond the shrine the trees thinned and the wind carried snow.",
    "Osric checked the packs at the next rise without a word.",
    "Maren rode with her collar up and her eyes on the ridge.",
    "By late afternoon the light went copper over the hills.",
    "They made camp below a shelf of stone near the water.",
  ]);
  const broken = `${first} "The ford will hold," she said. ${first}`;
  const findings = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(broken) }, "strict"));
  assert.deepEqual(findings, [], "dialogue splits the run below the eight-sentence threshold");
  const short = narrationRun([
    "The road climbed away from the river.",
    "Twice the riders passed the older shrines.",
    "Beyond the shrine the trees thinned out.",
    "Osric checked the packs at the rise.",
    "Maren rode with her collar turned up.",
    "The light went copper over the hills.",
    "They made camp below the shelf of stone.",
    "The night came on without a sound.",
  ]);
  assert.deepEqual(
    await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(short) }, "strict")),
    [],
    "eight sentences under the word floor stay silent",
  );
});

test("pacing: rushed passages fire once per run regardless of dialogue state", async () => {
  const text = "Boots on gravel. A door gave way. Torches flared. Steel met steel. Someone shouted. The line broke.";
  const strict = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(text) }, "strict"));
  assert.equal(strict.length, 1);
  const finding = strict[0];
  categoryOf(finding, "pacing-tension");
  assert.equal(finding.type, "pacing-rushed-passage");
  assertShape(finding, { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.equal(finding.suggestion, null);
  const fourShort = "Boots on gravel. A door gave way. Torches flared. Steel met steel.";
  assert.deepEqual(
    await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(fourShort) }, "strict")),
    [],
    "four short sentences stay below the threshold",
  );
  const quoted = '"Go." "Now." "Run." "Faster." "The gate!"';
  const dialogueRun = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(quoted) }, "strict"));
  assert.equal(dialogueRun.length, 1, "dialogue state does not exempt a rushed run");
  assert.equal(dialogueRun[0].type, "pacing-rushed-passage");
});

test("pacing: abrupt turns fire once per adjacent pair, in both directions", async () => {
  const down = "The gate slammed, and the riders screamed past the wall. Then the yard was calm again.";
  const strictDown = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(down) }, "strict"));
  assert.equal(strictDown.length, 1);
  const finding = strictDown[0];
  categoryOf(finding, "pacing-tension");
  assert.equal(finding.type, "tension-abrupt-shift");
  assertShape(finding, { severity: "info", confidence: 0.55, minStrictness: "strict" });
  assert.equal(finding.suggestion, null);
  const up = "The yard was calm again. Then the gate slammed.";
  const strictUp = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(up) }, "strict"));
  assert.equal(strictUp.length, 1, "the reverse turn is flagged too");
  const both = "The gate slammed. The yard went calm. Then the wall exploded.";
  assert.equal(
    (await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(both) }, "strict"))).length,
    2,
    "one finding per adjacency pair",
  );
  const apart = "The gate slammed. The horn blew twice. The yard went calm.";
  assert.deepEqual(
    await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(apart) }, "strict")),
    [],
    "non-adjacent cues do not turn",
  );
});

test("pacing: strictness gating and off-silence", async () => {
  assert.deepEqual(await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(LONG_RUN) }, "off")), []);
  const gentle = await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: chunk(LONG_RUN) }, "gentle"));
  assert.deepEqual(gentle, [], "observational notes stay below the gentle floor");
});

// ---------------------------------------------------------------------------
// pov-consistency
// ---------------------------------------------------------------------------

const POV_RULE = entry("canon_rule_pov_maren", "The story is told from Lady Maren's point of view.", { tags: ["pov"] });
const MAREN = character("char_maren", "Maren", { aliases: ["Lady Maren"] });
const OSRIC = character("char_osric", "Osric");
const GWYN = character("char_gwyn", "Gwyn");

test("pov: head-hop against a declared POV rule at standard, one per character per chunk", async () => {
  const context: CanonContext = { entries: [POV_RULE], characters: [MAREN, OSRIC], events: [] };
  const text = "Maren stood at the window while the yard emptied below. Osric wondered whether the tide would turn before the bell.";
  const findings = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(findings.length, 1);
  const finding = findings[0];
  categoryOf(finding, "pov-consistency");
  assert.equal(finding.type, "pov-head-hop");
  assertShape(finding, { severity: "minor", confidence: 0.75, minStrictness: "standard" });
  assert.deepEqual(finding.canonRefs, ["canon_rule_pov_maren"]);
  assert.ok(finding.quote.startsWith("Osric wondered"));
  const twice = "Osric wondered about the tide. Later Osric hoped the storm would pass.";
  const repeat = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(twice), context }, "standard"));
  assert.equal(repeat.length, 1, "one finding per character per chunk");
  assert.equal(repeat[0].quote, "Osric wondered about the tide.");
});

test("pov: attribution resolves through aliases and tolerates the POV character herself", async () => {
  const context: CanonContext = { entries: [POV_RULE], characters: [MAREN, OSRIC], events: [] };
  const text = "Lady Maren wondered whether the bell would ring. Osric knew the answer and kept it.";
  const findings = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(findings.length, 1, "the POV character's own inner state is not a head-hop");
  assert.equal(findings[0].quote, "Osric knew the answer and kept it.");
});

test("pov: dialogue is excluded from inner-state attribution", async () => {
  const context: CanonContext = { entries: [POV_RULE], characters: [MAREN, OSRIC], events: [] };
  const text = '"Osric knew the answer," Maren said.';
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "strict")),
    [],
    "a quoted sentence never attributes inner state",
  );
});

test("pov: without a declared rule, two attributed characters yield one finding per extra character", async () => {
  const context: CanonContext = { entries: [], characters: [MAREN, OSRIC, GWYN], events: [] };
  const text = "Gwyn remembered the night the beacon went dark. Osric knew the price of her silence.";
  const findings = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(findings.length, 1, "the first character entered is the implicit POV");
  const finding = findings[0];
  assert.equal(finding.type, "pov-head-hop");
  assert.deepEqual(finding.canonRefs, ["char_osric"]);
  assert.equal(finding.quote, "Osric knew the price of her silence.");
  const single = "Osric wondered about the tide.";
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(single), context }, "standard")),
    [],
    "a single attribution without a rule is not a head-hop",
  );
});

test("pov: a locked POV rule escalates the head-hop to major/gentle", async () => {
  const locked = entry("canon_rule_pov_locked", "The story stays with Maren.", { tags: ["pov"], locked: true, lockReason: "Single-POV by design." });
  const context: CanonContext = { entries: [locked], characters: [MAREN, OSRIC], events: [] };
  const text = "Maren watched the yard. Osric wondered whether the tide would turn.";
  const standard = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(standard.length, 1);
  assertShape(standard[0], { severity: "major", confidence: 0.95, minStrictness: "gentle" });
  assert.deepEqual(standard[0].canonRefs, ["canon_rule_pov_locked"]);
  const gentle = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "gentle"));
  assert.equal(gentle.length, 1);
});

test("pov: a declared omniscient narration silences head-hop detection entirely", async () => {
  const omniscient = entry("canon_rule_pov_omni", "The narration is omniscient; head-hops are intentional.", {
    tags: ["pov"],
    locked: true,
  });
  const context: CanonContext = { entries: [omniscient], characters: [MAREN, OSRIC], events: [] };
  const text = "Maren wondered about the storm. Osric knew the passes were closed.";
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "gentle")),
    [],
    "the writer said the shifts are intentional",
  );
});

test("pov: distance shift fires at the pinned statistical gate over narration only", async () => {
  const context: CanonContext = { entries: [], characters: [], events: [] };
  const text = [
    "I climbed the north stair with my hand on the wall.",
    "My lamp made a small circle, and I kept to the middle.",
    "We had agreed that I would count the turns aloud.",
    "The chalk rode in my sleeve past the sixth turn.",
    "At the ninth stair the wall opened into a guardroom.",
    "A table stood where the garrison had left it.",
    "Dust held the shape of the boots that left a season before.",
    "The sea spoke against the rock, and the room waited.",
  ].join(" ");
  const findings = await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "standard"));
  assert.equal(findings.length, 1);
  const finding = findings[0];
  categoryOf(finding, "pov-consistency");
  assert.equal(finding.type, "pov-distance-shift");
  assertShape(finding, { severity: "minor", confidence: 0.7, minStrictness: "standard" });
  assert.deepEqual(finding.canonRefs, []);
  assert.equal(finding.quote, "I climbed the north stair with my hand on the wall.");
  assert.equal(finding.suggestion, null);
});

test("pov: the distance gate rejects small deltas, short passages and dialogue-only drift", async () => {
  const context: CanonContext = { entries: [], characters: [], events: [] };
  const deltaTwo = [
    "I took the north road alone.",
    "My boots gave out by the ford.",
    "We rested at the shrine.",
    "The bell rang twice.",
    "I watched the road turn east.",
    "A cart passed without a word.",
    "Rain filled the wheel ruts.",
    "The night came down.",
  ].join(" ");
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(deltaTwo), context }, "strict")),
    [],
    "a delta of two stays below the gate",
  );
  const short = "I walked. I waited. I watched the ford. The riders came at dusk. The horn sounded twice. The ferry ran late. Rain fell.";
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(short), context }, "strict")),
    [],
    "seven narration sentences stay below the gate",
  );
  const dialogueDrift = '"I told you I would come." "We waited all the same." "My horse is spent." "The riders came at dusk."';
  assert.deepEqual(
    await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(dialogueDrift), context }, "strict")),
    [],
    "first-person dialogue never counts toward narration drift",
  );
});

test("pov: strictness gating and off-silence", async () => {
  const context: CanonContext = { entries: [POV_RULE], characters: [MAREN, OSRIC], events: [] };
  const text = "Maren stood at the window. Osric wondered whether the tide would turn.";
  assert.deepEqual(await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "off")), []);
  assert.deepEqual(await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context }, "gentle")), []);
});

// ---------------------------------------------------------------------------
// Shared behavior
// ---------------------------------------------------------------------------

test("all three narrative agents stay silent on clean text without any canon at every level", async () => {
  const clean = chunk("Maren walked the wall road. Osric counted the bells. The ford held until morning.");
  for (const level of ["gentle", "standard", "strict"] as const) {
    assert.deepEqual(await PLOT_THREAD_AGENT.analyze(analyzeInput({ chunk: clean }, level)), []);
    assert.deepEqual(await PACING_TENSION_AGENT.analyze(analyzeInput({ chunk: clean }, level)), []);
    assert.deepEqual(await POV_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: clean }, level)), []);
  }
});

test("agents run through the findings functions return findings sorted deterministically", async () => {
  const context: CanonContext = {
    entries: [BLADE_PROMISE],
    characters: [MAREN, OSRIC, GWYN],
    events: [],
  };
  const text =
    "Maren said she would never guard the eastern bridge. Osric wondered about the tide. Gwyn knew the price of silence.";
  const plotFindings = await plotThreadFindings(chunk(text), context, "standard");
  assert.equal(plotFindings.length, 1);
  assert.equal(plotFindings[0].type, "plot-promise-conflict");
  const povFindings = await povConsistencyFindings(chunk(text), context, "standard");
  assert.equal(povFindings.length, 1);
  assert.deepEqual(povFindings[0].canonRefs, ["char_gwyn"], "Osric is entered first, Gwyn is the head-hop");
  const pacingFindings = await pacingTensionFindings(chunk(text), EMPTY_CONTEXT, "standard");
  assert.deepEqual(pacingFindings, []);
});
