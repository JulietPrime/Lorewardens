// Acceptance suite — task implement-three-continuity-agents (ac-1..ac-6).
//
// Written independently against the accepted specification: the three
// Continuity agents must flag canon, character and timeline contradictions,
// honor strictness off/gentle/standard/strict, work incrementally on changed
// text plus minimal canon context, and produce non-destructive findings the
// writer can dismiss. Product code is never modified by these tests.
//
// Run: npm test (root) or npm run test -w @lorewardens/agents

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  filterFindings,
  selectRelevantContext,
  surfacesAt,
  type AnalyzeInput,
  type CanonContext,
  type CanonEntry,
  type CanonSnapshot,
  type Character,
  type Finding,
  type Strictness,
  type TimelineEvent,
} from "@lorewardens/core";
import {
  CANON_LORE_AGENT,
  CHARACTER_CONSISTENCY_AGENT,
  CONTINUITY_AGENTS,
  TIMELINE_AGENT,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T12:00:00.000Z";

function entry(id: string, text: string, overrides: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id,
    projectId: "p1",
    kind: "fact",
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

function event(id: string, description: string, order: number, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id,
    projectId: "p1",
    description,
    order,
    precision: "day",
    participants: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function chunk(text: string, startOffset = 0, file = "chapter_03.md") {
  return { text, span: { file, startOffset, endOffset: startOffset + text.length } };
}

const NO_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

function input(partial: Partial<AnalyzeInput>, strictness: Strictness): AnalyzeInput {
  return {
    projectId: "p1",
    chunk: chunk(""),
    context: { entries: [], characters: [], events: [] },
    strictness,
    settings: NO_SETTINGS,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Findings must validate against the shipped schema
// ---------------------------------------------------------------------------

const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function assertSchemaValid(finding: Finding): void {
  for (const field of schema.required) {
    assert.ok(field in finding, `finding missing required field '${field}'`);
  }
  for (const key of Object.keys(finding)) {
    assert.ok(key in schema.properties, `finding carries unknown field '${key}'`);
  }
  assert.match(finding.id, /^fnd_[0-9a-fA-F-]{36}$/, "finding id is stable and dismissible");
  assert.ok((schema.properties.agent.enum as string[]).includes(finding.agent), "agent enum");
  assert.ok((schema.properties.category.enum as string[]).includes(finding.category), "category enum");
  assert.ok((schema.properties.severity.enum as string[]).includes(finding.severity), "severity enum");
  assert.ok(
    (schema.properties.minStrictness.enum as string[]).includes(finding.minStrictness),
    "minStrictness enum",
  );
  assert.ok(finding.confidence >= 0 && finding.confidence <= 1, "confidence in [0,1]");
  assert.ok(finding.message.length > 0, "message explains the problem");
  assert.ok(finding.quote.length > 0, "quote is an exact excerpt");
  assert.ok(finding.location.file.length > 0, "location has a file");
  assert.ok(Number.isInteger(finding.location.startOffset) && finding.location.startOffset >= 0);
  assert.ok(Number.isInteger(finding.location.endOffset) && finding.location.endOffset > 0);
  assert.ok(finding.location.endOffset >= finding.location.startOffset, "span is ordered");
  assert.ok(Array.isArray(finding.canonRefs) && finding.canonRefs.length > 0, "canonRefs reference canon");
  assert.ok(finding.suggestion === null || typeof finding.suggestion === "string", "suggestion is nullable");
  assert.ok(!Number.isNaN(Date.parse(finding.createdAt)), "createdAt is a date-time");
}

function assertAllSchemaValid(findings: Finding[]): void {
  for (const finding of findings) assertSchemaValid(finding);
}

// ---------------------------------------------------------------------------
// ac-1 — Canon agent flags contradictions with established canon and honors
//        locked details
// ---------------------------------------------------------------------------

test("ac-1: canon agent flags an antonym contradiction with confirmed canon", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(findings.length, 1, "exactly one contradiction");
  const finding = findings[0];
  assert.equal(finding.agent, "canon-lore");
  assert.equal(finding.category, "canon");
  assert.equal(finding.type, "canon-contradiction");
  assert.deepEqual(finding.canonRefs, ["canon_river"]);
  assert.equal(finding.quote, "The river runs east of the old mill.");
  assert.match(finding.message, /west/, "the message names the canon side");
  assert.ok(finding.suggestion && finding.suggestion.includes("canon_river"), "suggestion points at the entry");
  assertSchemaValid(finding);
});

test("ac-1: canon agent honors locked details — contradiction is major and surfaces from gentle", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_gate", "The Weeping Gate is sealed since the siege.", {
        kind: "rule",
        locked: true,
        lockReason: "core premise",
      }),
    ],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The Weeping Gate stands open."), context }, "gentle"),
  );
  assert.equal(findings.length, 1, "locked contradictions must reach even the gentlest setting");
  const finding = findings[0];
  assert.ok(finding.severity === "major" || finding.severity === "critical", "locked detail is serious");
  assert.equal(finding.minStrictness, "gentle");
  assert.ok(finding.confidence >= 0.9, "locked-contradiction confidence is high");
  assert.equal(surfacesAt(finding, "gentle"), true);
  assert.equal(surfacesAt(finding, "standard"), true);
  assert.equal(surfacesAt(finding, "strict"), true);
  assertSchemaValid(finding);
});

test("ac-1: canon agent only flags against established canon — proposed and retired entries stay silent", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_draft", "The river runs west of the old mill.", { status: "proposed" }),
      entry("canon_old", "The river runs west of the old mill.", { status: "retired" }),
    ],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.deepEqual(findings, [], "unconfirmed canon is not established canon");
});

test("ac-1: canon agent catches numeric conflicts against canon counts", async () => {
  const context: CanonContext = {
    entries: [entry("canon_bells", "The bell tower holds seven bells.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The bell tower holds four bells."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /states 4 where canon states 7/);
  assertSchemaValid(findings[0]);
});

// ---------------------------------------------------------------------------
// ac-2 — Character agent flags knowledge, trait and behavior contradictions
// ---------------------------------------------------------------------------

test("ac-2: character agent flags a trait contradiction", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_mira", "Mira", { traits: ["methodical"] })],
    events: [],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    input({ chunk: chunk("Mira was careless with the survey notes."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].agent, "character-consistency");
  assert.equal(findings[0].category, "character");
  assert.equal(findings[0].type, "trait-contradiction");
  assert.deepEqual(findings[0].canonRefs, ["char_mira"]);
  assert.match(findings[0].message, /methodical/);
  assertSchemaValid(findings[0]);
});

test("ac-2: character agent flags knowledge of an event the character did not witness", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_mira", "Mira"), character("char_oren", "Oren")],
    events: [event("ev_siege", "The siege that sealed the Weeping Gate.", 0, { participants: ["char_oren"] })],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    input({ chunk: chunk("Mira knew about the siege that sealed the Weeping Gate."), context }, "standard"),
  );
  assert.equal(findings.length, 1, "knowledge without a canon way of learning is flagged");
  const finding = findings[0];
  assert.equal(finding.type, "knowledge-violation");
  assert.deepEqual(finding.canonRefs, ["char_mira", "ev_siege"]);
  assertSchemaValid(finding);
});

test("ac-2: character agent flags behavior contradictions — negated ability", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_mira", "Mira", { abilities: ["map-drawing"] })],
    events: [],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    input({ chunk: chunk("Mira had never learned to draw."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "ability-contradiction");
  assertSchemaValid(findings[0]);
});

test("ac-2: character agent flags behavior contradictions — canon injury treated as healed", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_daven", "Daven", { injuries: ["sprained wrist"] })],
    events: [],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    input({ chunk: chunk("Daven's wrist had fully healed by morning."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "injury-contradiction");
  assert.match(findings[0].message, /sprained wrist/);
  assertSchemaValid(findings[0]);
});

// ---------------------------------------------------------------------------
// ac-3 — Timeline agent flags impossible or unclear time jumps
// ---------------------------------------------------------------------------

const TIMELINE_CONTEXT: CanonContext = {
  entries: [],
  characters: [character("char_mira", "Mira")],
  events: [
    event("ev_siege", "The siege that sealed the Weeping Gate.", 0),
    event("ev_survey", "Mira begins the survey of the north wall.", 1, { participants: ["char_mira"] }),
  ],
};

test("ac-3: timeline agent flags an impossible (reversed) sequence", async () => {
  const findings = await TIMELINE_AGENT.analyze(
    input({ chunk: chunk("The survey happened before the siege."), context: TIMELINE_CONTEXT }, "standard"),
  );
  assert.equal(findings.length, 1, "canon order is siege then survey; the passage asserts the reverse");
  const finding = findings[0];
  assert.equal(finding.agent, "timeline");
  assert.equal(finding.category, "timeline");
  assert.equal(finding.type, "timeline-contradiction");
  assert.deepEqual(finding.canonRefs, ["ev_siege", "ev_survey"], "the referenced pair is canon-ordered");
  assert.match(finding.message, /reverse/);
  assertSchemaValid(finding);
});

test("ac-3: timeline agent stays silent when the sequence matches canon", async () => {
  const findings = await TIMELINE_AGENT.analyze(
    input({ chunk: chunk("The siege came before the survey."), context: TIMELINE_CONTEXT }, "standard"),
  );
  assert.deepEqual(findings, [], "correct order is not a time jump");
});

test("ac-3: timeline agent flags an unclear time jump as unclear-time-jump", async () => {
  const findings = await TIMELINE_AGENT.analyze(
    input(
      { chunk: chunk("Sometime before or after the survey, the siege was remembered."), context: TIMELINE_CONTEXT },
      "standard",
    ),
  );
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.type, "unclear-time-jump");
  assert.equal(finding.severity, "minor", "ambiguity is minor, not a hard contradiction");
  assert.equal(finding.minStrictness, "standard", "ambiguity never surfaces at gentle");
  assert.equal(surfacesAt(finding, "gentle"), false);
  assert.equal(surfacesAt(finding, "standard"), true);
  assertSchemaValid(finding);
});

test("ac-3: timeline agent escalates contradictions of locked events", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [],
    events: [
      event("ev_coronation", "The coronation of the queen.", 0, { locked: true }),
      event("ev_envoy", "The envoy departs for the coast.", 1),
    ],
  };
  const findings = await TIMELINE_AGENT.analyze(
    input({ chunk: chunk("The envoy departed before the coronation of the queen."), context }, "gentle"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "major", "locked timeline is inviolable");
  assert.equal(findings[0].minStrictness, "gentle");
  assertSchemaValid(findings[0]);
});

// ---------------------------------------------------------------------------
// ac-4 — Each supports off/gentle/standard/strict strictness
// ---------------------------------------------------------------------------

test("ac-4: strictness off never produces findings from any agent", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [character("char_mira", "Mira", { traits: ["methodical"] })],
    events: [
      event("ev_siege", "The siege that sealed the Weeping Gate.", 0),
      event("ev_survey", "Mira begins the survey of the north wall.", 1),
    ],
  };
  const contradictory = chunk(
    "The river runs east of the old mill. Mira was careless with the survey notes. The survey happened before the siege.",
  );
  for (const agent of CONTINUITY_AGENTS) {
    const findings = await agent.analyze(input({ chunk: contradictory, context }, "off"));
    assert.deepEqual(findings, [], `${agent.id} at off must produce nothing`);
  }
});

test("ac-4: every agent is silent on clean text at gentle, standard and strict", async () => {
  const cleanContext: CanonContext = {
    entries: [entry("canon_harbor", "The harbor closes each winter.")],
    characters: [character("char_mira", "Mira")],
    events: [
      event("ev_siege", "The siege that sealed the Weeping Gate.", 0),
      event("ev_survey", "Mira begins the survey of the north wall.", 1, { participants: ["char_mira"] }),
    ],
  };
  const clean = chunk("Mira walked the sea wall and sketched the winter harbor.");
  for (const agent of CONTINUITY_AGENTS) {
    for (const strictness of ["gentle", "standard", "strict"] as const) {
      const findings = await agent.analyze(input({ chunk: clean, context: cleanContext }, strictness));
      assert.deepEqual(findings, [], `${agent.id} at ${strictness} must stay silent on clean text`);
    }
  }
});

test("ac-4: confidence floors gate each strictness level", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_river", "The river runs west of the old mill."),
      entry("canon_gate", "The Weeping Gate is sealed since the siege.", { locked: true }),
    ],
    characters: [],
    events: [],
  };
  const east = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "gentle"),
  );
  assert.deepEqual(east, [], "unlocked contradiction (0.8) sits below the gentle floor (0.9)");
  const eastStandard = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(eastStandard.length, 1, "and clears the standard floor (0.7)");
  assertSchemaValid(eastStandard[0]);
  assert.equal(surfacesAt(eastStandard[0], "gentle"), false);
  assert.equal(surfacesAt(eastStandard[0], "standard"), true);
  assert.equal(surfacesAt(eastStandard[0], "strict"), true);
});

test("ac-4: locked-canon findings surface at every level above off", async () => {
  const lockedContext: CanonContext = {
    entries: [entry("canon_gate", "The Weeping Gate is sealed since the siege.", { locked: true })],
    characters: [],
    events: [],
  };
  const locked = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The Weeping Gate stands open."), context: lockedContext }, "gentle"),
  );
  assert.equal(locked.length, 1);
  assert.equal(surfacesAt(locked[0], "gentle"), true, "gentle-surfacing finding reaches gentle");
  assert.equal(surfacesAt(locked[0], "standard"), true);
  assert.equal(surfacesAt(locked[0], "strict"), true);
});

test("ac-4: strict-only location drift surfaces at strict and never at standard", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_compass", "The silver compass rests in the satchel.", { tags: ["compass"] }),
      entry("canon_chart", "The harbor chart lies on the office desk.", { tags: ["chart"] }),
    ],
    characters: [],
    events: [],
  };
  const settings = (strictness: Strictness) => ({
    projectId: "p1",
    agents: [{ agentId: "canon-lore" as const, enabled: true, strictness, options: { objectLocationChecks: true } }],
    exceptions: [],
    dismissed: [],
  });
  const text = "The compass now lay on the office desk.";
  const atStrict = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk(text), context, settings: settings("strict") }, "strict"),
  );
  assert.equal(atStrict.length, 1, "enabled strict check fires at strict");
  assert.equal(atStrict[0].type, "canon-location-drift");
  assert.equal(atStrict[0].minStrictness, "strict");
  assert.equal(surfacesAt(atStrict[0], "standard"), false, "strict-only note never reaches standard");
  assert.equal(surfacesAt(atStrict[0], "strict"), true);
  assertSchemaValid(atStrict[0]);
});

// ---------------------------------------------------------------------------
// ac-5 — Each works incrementally on changed text plus minimal canon context
// ---------------------------------------------------------------------------

test("ac-5: agents work incrementally — a chunk from mid-manuscript gets file-relative offsets", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const changedText = "The bridge held. The river runs east of the old mill.";
  const chunkStart = 4821; // deep inside a larger manuscript
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk(changedText, chunkStart), context }, "standard"),
  );
  assert.equal(findings.length, 1, "only the changed sentence is analyzed");
  const finding = findings[0];
  assert.equal(finding.quote, "The river runs east of the old mill.");
  const fileText = `${" ".repeat(chunkStart)}${changedText}`;
  const excerpt = fileText.slice(finding.location.startOffset, finding.location.endOffset);
  assert.equal(excerpt, finding.quote, "location points into the file, not the chunk");
  assert.ok(finding.location.startOffset > chunkStart);
  assertSchemaValid(finding);
});

test("ac-5: minimal context — canon unrelated to the changed text stays out of the analysis", async () => {
  const context: CanonContext = {
    entries: [entry("canon_sky", "The sky above the harbor turns green before storms.")],
    characters: [character("char_oren", "Oren", { traits: ["boastful"] })],
    events: [event("ev_duel", "The duel on the ice bridge.", 0)],
  };
  // The chunk mentions none of the canon above: no finding may appear.
  const unrelated = chunk("The river runs east of the old mill.");
  assert.deepEqual(await CANON_LORE_AGENT.analyze(input({ chunk: unrelated, context }, "standard")), []);
  assert.deepEqual(await CHARACTER_CONSISTENCY_AGENT.analyze(input({ chunk: unrelated, context }, "standard")), []);
  assert.deepEqual(await TIMELINE_AGENT.analyze(input({ chunk: unrelated, context }, "standard")), []);
});

test("ac-5: each agent analyzes its own incremental chunk independently", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [character("char_mira", "Mira", { traits: ["methodical"] })],
    events: TIMELINE_CONTEXT.events,
  };
  const chunkA = chunk("The river runs east of the old mill.", 0, "ch05.md");
  const chunkB = chunk("Mira was careless with the survey notes.", 900, "ch05.md");
  const canonFindings = await CANON_LORE_AGENT.analyze(input({ chunk: chunkA, context }, "standard"));
  const characterFindings = await CHARACTER_CONSISTENCY_AGENT.analyze(input({ chunk: chunkB, context }, "standard"));
  assert.equal(canonFindings.length, 1);
  assert.equal(characterFindings.length, 1);
  assert.equal(canonFindings[0].location.file, "ch05.md");
  assert.equal(characterFindings[0].location.file, "ch05.md");
  assert.ok(canonFindings[0].location.startOffset < characterFindings[0].location.startOffset);
  assertAllSchemaValid([...canonFindings, ...characterFindings]);
});

test("ac-5: context selection is minimal and confirmed-only", () => {
  const snapshot: CanonSnapshot = {
    projectId: "p1",
    entries: [
      entry("canon_river", "The river bends at the old mill.", { tags: ["river"] }),
      entry("canon_sky", "The sky above the harbor turns green before storms.", { tags: ["harbor"] }),
      entry("canon_magic_rule", "Every spell costs one memory.", { kind: "rule" }),
      entry("canon_draft", "The river is poisonous.", { tags: ["river"], status: "proposed" }),
    ],
    characters: [
      character("char_mira", "Mira"),
      character("char_oren", "Oren"),
      character("char_petra", "Petra", { status: "proposed" }),
    ],
    events: [
      event("ev_survey", "Mira begins the survey of the north wall.", 1, { participants: ["char_mira"] }),
      event("ev_duel", "The duel on the ice bridge.", 0, { participants: ["char_oren"] }),
      event("ev_draft", "Mira burns the survey.", 2, { participants: ["char_mira"], status: "proposed" }),
    ],
  };
  const changed = "Mira sketched the river bend near the old mill.";
  const selected = selectRelevantContext(changed, snapshot);
  assert.deepEqual(
    selected.characters.map((c) => c.id),
    ["char_mira"],
    "only the mentioned, confirmed character",
  );
  assert.deepEqual(
    selected.entries.map((e) => e.id).sort(),
    ["canon_magic_rule", "canon_river"],
    "confirmed entries relevant by tag, plus standing rules; no proposals",
  );
  assert.deepEqual(
    selected.events.map((e) => e.id),
    ["ev_survey"],
    "only confirmed events with selected participants",
  );
  for (const item of [...selected.entries, ...selected.characters, ...selected.events]) {
    assert.equal(item.status, "confirmed", "selection never leaks unconfirmed canon");
  }
});

// ---------------------------------------------------------------------------
// ac-6 — Findings are non-destructive and the writer can dismiss them
// ---------------------------------------------------------------------------

test("ac-6: agents are non-destructive — analyze mutates neither input nor context", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [character("char_mira", "Mira", { traits: ["methodical"] })],
    events: TIMELINE_CONTEXT.events,
  };
  const analysisInput = input(
    {
      chunk: chunk("The river runs east of the old mill. Mira was careless with the survey notes."),
      context,
    },
    "standard",
  );
  const before = structuredClone(analysisInput);
  for (const agent of CONTINUITY_AGENTS) {
    await agent.analyze(analysisInput);
  }
  assert.deepEqual(analysisInput, before, "agents never mutate the manuscript chunk, context or settings");
});

test("ac-6: agents write nothing — no fs or network entry points in agent sources", () => {
  const srcDir = fileURLToPath(new URL("../../src", import.meta.url));
  const forbidden = [
    /node:fs/, /node:http/, /node:https/, /node:net/, /node:dns/, /node:tls/,
    /require\(['"]fs/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /axios/, /undici/,
    /\bwriteFile\b/, /\bappendFile\b/, /\bmkdir\b/, /\brm\b\s*\(/, /\bunlink\b/,
  ];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith(".ts")) continue;
    const source = readFileSync(`${srcDir}/${name}`, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${name} must not perform writes or network calls`);
    }
  }
});

test("ac-6: suggestions are advisory only — findings never auto-apply a change", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.ok(typeof finding.suggestion === "string" && finding.suggestion.length > 0);
  assert.match(finding.suggestion, /advisory/i, "the suggestion says it is advisory");
  assert.match(finding.suggestion, /CanonProposal|Canon proposal/, "it proposes, it does not apply");
});

test("ac-6: the writer can dismiss a finding by id", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(surfacesAt(findings[0], "standard"), true, "before dismissal the finding surfaces");
  const dismissedSettings = {
    projectId: "p1",
    agents: [],
    exceptions: [],
    dismissed: [{ findingId: findings[0].id, projectId: "p1", agentId: "canon-lore" as const, dismissedAt: NOW }],
  };
  const afterDismissal = filterFindings(findings, {
    strictness: "standard",
    settings: dismissedSettings,
    agentId: "canon-lore",
  });
  assert.deepEqual(afterDismissal, [], "a dismissed finding never comes back at the same strictness");
});

test("ac-6: the writer can silence a recurring nuisance via exceptions", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    input({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  const finding = findings[0];
  const exception = (scope: "finding" | "passage" | "rule", ref: string, reason: string) => ({
    id: `exc_${scope}`,
    projectId: "p1",
    scope,
    ref,
    reason,
    createdAt: NOW,
  });
  const base = { projectId: "p1", agents: [], dismissed: [] };
  const byRule = filterFindings(findings, {
    strictness: "standard",
    settings: { ...base, exceptions: [exception("rule", finding.type, "known intentional")] },
    agentId: "canon-lore",
  });
  assert.deepEqual(byRule, [], "a rule-scoped exception silences this finding type");
  const byPassage = filterFindings(findings, {
    strictness: "standard",
    settings: { ...base, exceptions: [exception("passage", finding.location.file, "dream sequence")] },
    agentId: "canon-lore",
  });
  assert.deepEqual(byPassage, [], "a passage-scoped exception silences findings in that file");
  const byFinding = filterFindings(findings, {
    strictness: "standard",
    settings: { ...base, exceptions: [exception("finding", finding.id, "one-off")] },
    agentId: "canon-lore",
  });
  assert.deepEqual(byFinding, [], "a finding-scoped exception silences exactly this finding");
});

test("ac-6: findings from all agents are schema-valid and dismissible by their stable ids", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [character("char_mira", "Mira", { traits: ["methodical"] })],
    events: TIMELINE_CONTEXT.events,
  };
  const everything = chunk(
    "The river runs east of the old mill. Mira was careless with the survey notes. The survey happened before the siege.",
  );
  const all: Finding[] = [];
  for (const agent of CONTINUITY_AGENTS) {
    all.push(...(await agent.analyze(input({ chunk: everything, context }, "standard"))));
  }
  assert.ok(all.length >= 3, "each of the three agents contributed a finding");
  assertAllSchemaValid(all);
  for (const finding of all) {
    const dismissed = filterFindings(all, {
      strictness: "standard",
      settings: { projectId: "p1", agents: [], exceptions: [], dismissed: [{ findingId: finding.id, projectId: "p1", dismissedAt: NOW }] },
      agentId: finding.agent,
    });
    assert.ok(
      dismissed.every((f) => f.id !== finding.id),
      `finding ${finding.id} from ${finding.agent} is dismissible`,
    );
  }
});
