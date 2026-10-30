import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  surfacesAt,
  type CanonContext,
  type CanonEntry,
  type Character,
  type Finding,
  type TimelineEvent,
} from "@lorewardens/core";
import {
  AGENT_DESCRIPTORS,
  CANON_LORE_AGENT,
  CHARACTER_CONSISTENCY_AGENT,
  CONTINUITY_AGENTS,
  TIMELINE_AGENT,
} from "../src/index.js";
import type { AnalyzeInput } from "@lorewardens/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T09:00:00.000Z";

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

const EMPTY_CHUNK = { text: "", span: { file: "ch1.md", startOffset: 0, endOffset: 0 } };

function chunk(text: string, startOffset = 0) {
  return { text, span: { file: "ch1.md", startOffset, endOffset: startOffset + text.length } };
}

const EMPTY_CONTEXT: CanonContext = { entries: [], characters: [], events: [] };
const EMPTY_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

function analyzeInput(partial: Partial<AnalyzeInput>, strictness: "gentle" | "standard" | "strict"): AnalyzeInput {
  return {
    projectId: "p1",
    chunk: EMPTY_CHUNK,
    context: EMPTY_CONTEXT,
    strictness,
    settings: EMPTY_SETTINGS,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Schema validation (mirrors schemas/finding.schema.json; cross-checked below)
// ---------------------------------------------------------------------------

const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

function assertSchemaValid(finding: Finding): void {
  for (const field of schema.required) {
    assert.ok(field in finding, `finding missing required field '${field}'`);
  }
  assert.match(finding.id, /^fnd_[0-9a-fA-F-]{36}$/);
  assert.ok(schema.properties.agent.enum.includes(finding.agent), "agent enum");
  assert.ok(schema.properties.category.enum.includes(finding.category), "category enum");
  assert.ok(schema.properties.severity.enum.includes(finding.severity), "severity enum");
  assert.ok(schema.properties.minStrictness.enum.includes(finding.minStrictness), "minStrictness enum");
  assert.ok(
    finding.confidence >= 0 && finding.confidence <= 1,
    "confidence within [0,1]",
  );
  assert.equal(typeof finding.message, "string");
  assert.ok(finding.message.length > 0);
  assert.equal(typeof finding.quote, "string");
  for (const field of ["file", "startOffset", "endOffset"] as const) {
    assert.ok(field in finding.location, `location missing '${field}'`);
  }
  assert.equal(typeof finding.location.file, "string");
  assert.ok(finding.location.file.length > 0);
  assert.ok(Number.isInteger(finding.location.startOffset) && finding.location.startOffset >= 0);
  assert.ok(Number.isInteger(finding.location.endOffset) && finding.location.endOffset >= 0);
  assert.ok(Array.isArray(finding.canonRefs));
  assert.ok(finding.suggestion === null || typeof finding.suggestion === "string");
  assert.ok(!Number.isNaN(Date.parse(finding.createdAt)));
}

function assertAllSchemaValid(findings: Finding[]): void {
  for (const finding of findings) assertSchemaValid(finding);
}

// ---------------------------------------------------------------------------
// Agent identity and contract shape
// ---------------------------------------------------------------------------

test("all three continuity agents are exported and implement the contract", () => {
  assert.deepEqual(
    AGENT_DESCRIPTORS.map((d) => [d.id, d.family, d.title, d.defaultStrictness]),
    [
      ["canon-lore", "continuity", "Canon / Lore", "standard"],
      ["character-consistency", "continuity", "Character Consistency", "standard"],
      ["timeline", "continuity", "Timeline / Chronology", "standard"],
      ["grammar-mechanics", "language", "Grammar / Mechanics", "standard"],
      ["vocabulary-repetition", "language", "Vocabulary / Repetition", "standard"],
      ["style-voice", "language", "Style / Voice Consistency", "standard"],
      ["character-voice", "language", "Character Voice", "standard"],
      ["period-dialect", "language", "Period / Dialect / Language", "standard"],
      ["plot-thread", "narrative", "Plot Thread / Promise", "standard"],
      ["pacing-tension", "narrative", "Pacing / Tension", "standard"],
      ["pov-consistency", "narrative", "POV Consistency", "standard"],
      ["show-vs-tell", "optional", "Show vs Tell / Craft", "standard"],
      ["sensitivity-representation", "optional", "Sensitivity / Representation", "standard"],
      ["theme-motif", "optional", "Theme / Motif", "standard"],
    ],
    "AGENT_DESCRIPTORS pin the full registered roster (continuity + language + narrative + optional)",
  );
  assert.deepEqual(CONTINUITY_AGENTS.map((a) => a.id), ["canon-lore", "character-consistency", "timeline"]);
  for (const agent of CONTINUITY_AGENTS) {
    assert.equal(typeof agent.analyze, "function");
    assert.equal(agent.descriptor, AGENT_DESCRIPTORS.find((d) => d.id === agent.id));
  }
});

// ---------------------------------------------------------------------------
// canon-lore
// ---------------------------------------------------------------------------

test("canon-lore: unlocked contradiction caught at standard", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-contradiction");
  assert.equal(findings[0].severity, "minor");
  assert.equal(findings[0].minStrictness, "standard");
  assert.ok(findings[0].confidence >= 0.7);
  assert.deepEqual(findings[0].canonRefs, ["canon_river"]);
  assert.ok(findings[0].quote.startsWith("The river runs east"));
  assertSchemaValid(findings[0]);
});

test("canon-lore: locked-canon contradiction surfaces at gentle with severity major+", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_gate", "The Weeping Gate is sealed since the siege.", {
        locked: true,
        lockReason: "core premise",
      }),
    ],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The Weeping Gate stands open."), context }, "gentle"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity === "major" || findings[0].severity === "critical", true);
  assert.equal(findings[0].minStrictness, "gentle");
  assert.ok(findings[0].confidence >= 0.9);
  assert.equal(surfacesAt(findings[0], "gentle"), true);
  assert.match(findings[0].suggestion ?? "", /CanonProposal/i);
  assertSchemaValid(findings[0]);
});

test("canon-lore: negated canon rule is caught (numeric-free negation path)", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_magic", "Every spell costs the caster one personal memory.", {
        kind: "rule",
        locked: true,
      }),
    ],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Her spell cost her nothing at all."), context }, "gentle"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "major");
  assertSchemaValid(findings[0]);
});

test("canon-lore: numeric conflict with a shared unit word", async () => {
  const context: CanonContext = {
    entries: [entry("canon_bridge", "The bridge holds three arches.")],
    characters: [],
    events: [],
  };
  const findings = await CANON_LORE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The bridge holds five arches."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /5/);
  assertSchemaValid(findings[0]);
});

test("canon-lore: objectLocationChecks fires only when enabled at strict", async () => {
  const context: CanonContext = {
    entries: [
      entry("canon_compass", "The silver compass rests in the satchel.", { tags: ["compass"] }),
      entry("canon_chart", "The harbor chart lies on the office desk.", { tags: ["chart"] }),
    ],
    characters: [],
    events: [],
  };
  const text = "The compass now lay on the office desk.";
  const input = (strictness: "standard" | "strict", enabled: boolean) =>
    analyzeInput(
      {
        chunk: chunk(text),
        context,
        settings: {
          projectId: "p1",
          agents: [{ agentId: "canon-lore", enabled: true, strictness, options: { objectLocationChecks: enabled } }],
          exceptions: [],
          dismissed: [],
        },
      },
      strictness,
    );

  assert.deepEqual(await CANON_LORE_AGENT.analyze(input("strict", false)), [], "option off: silent even at strict");
  assert.deepEqual(await CANON_LORE_AGENT.analyze(input("standard", true)), [], "below strict: silent");
  const strictFindings = await CANON_LORE_AGENT.analyze(input("strict", true));
  assert.equal(strictFindings.length, 1);
  assert.equal(strictFindings[0].type, "canon-location-drift");
  assert.equal(strictFindings[0].minStrictness, "strict");
  assert.equal(surfacesAt(strictFindings[0], "standard"), false, "strict-only note does not surface at standard");
  assertSchemaValid(strictFindings[0]);
});

// ---------------------------------------------------------------------------
// character-consistency
// ---------------------------------------------------------------------------

test("character-consistency: trait contradiction caught at standard", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_mira", "Mira", { traits: ["methodical"] })],
    events: [],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira was careless with the survey notes."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "trait-contradiction");
  assert.deepEqual(findings[0].canonRefs, ["char_mira"]);
  assertSchemaValid(findings[0]);
});

test("character-consistency: injury treated as healed contradicts canon", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_daven", "Daven", { injuries: ["sprained wrist"] })],
    events: [],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Daven's wrist had fully healed by morning."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "injury-contradiction");
  assertSchemaValid(findings[0]);
});

test("character-consistency: negated ability contradicts canon abilities", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_mira", "Mira", { abilities: ["map-drawing"] })],
    events: [],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira had never learned to draw."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "ability-contradiction");
  assertSchemaValid(findings[0]);
});

test("character-consistency: knowledge of an event the character did not witness", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_mira", "Mira")],
    events: [event("ev_siege", "The siege that sealed the Weeping Gate.", 0)],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira knew about the siege before she arrived."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "knowledge-violation");
  assert.deepEqual(findings[0].canonRefs, ["char_mira", "ev_siege"]);
  assertSchemaValid(findings[0]);
});

test("character-consistency: relationshipState drift fires only at strict when enabled", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [
      character("char_mira", "Mira", {
        relationships: [{ targetCharacterId: "char_daven", type: "ally" }],
      }),
      character("char_daven", "Daven"),
    ],
    events: [],
  };
  const settings = (enabled: boolean) => ({
    projectId: "p1",
    agents: [{ agentId: "character-consistency" as const, enabled: true, strictness: "strict" as const, options: { relationshipState: enabled } }],
    exceptions: [],
    dismissed: [],
  });
  const text = "Daven and Mira became rivals after the argument.";
  assert.deepEqual(
    await CHARACTER_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context, settings: settings(false) }, "strict")),
    [],
  );
  assert.deepEqual(
    await CHARACTER_CONSISTENCY_AGENT.analyze(analyzeInput({ chunk: chunk(text), context, settings: settings(true) }, "standard")),
    [],
    "strict-only note does not surface at standard",
  );
  const strictFindings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk(text), context, settings: settings(true) }, "strict"),
  );
  assert.equal(strictFindings.length, 1);
  assert.equal(strictFindings[0].type, "relationship-drift");
  assertSchemaValid(strictFindings[0]);
});

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

const TIMELINE_CONTEXT: CanonContext = {
  entries: [],
  characters: [character("char_mira", "Mira")],
  events: [
    event("ev_siege", "The siege that sealed the Weeping Gate.", 0),
    event("ev_survey", "Mira begins the survey of the north wall.", 1, { participants: ["char_mira"] }),
  ],
};

test("timeline: reversed sequence caught at standard", async () => {
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey happened before the siege."), context: TIMELINE_CONTEXT }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "timeline-contradiction");
  assert.equal(findings[0].severity, "minor");
  assert.deepEqual(findings[0].canonRefs, ["ev_siege", "ev_survey"], "pair is canonicalized by canon order");
  assertSchemaValid(findings[0]);
});

test("timeline: correct sequence produces no finding", async () => {
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The siege came before the survey."), context: TIMELINE_CONTEXT }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("timeline: locked event sequence contradicts at gentle with major severity", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [],
    events: [
      event("ev_a", "The coronation of the queen.", 0, { locked: true }),
      event("ev_b", "The envoy departs for the coast.", 1),
    ],
  };
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The envoy departed before the coronation of the queen."), context }, "gentle"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "major");
  assert.equal(findings[0].minStrictness, "gentle");
  assertSchemaValid(findings[0]);
});

test("timeline: genuinely ambiguous sequence becomes unclear-time-jump (minor), never gentle", async () => {
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput(
      { chunk: chunk("Sometime before or after the survey, the siege was remembered."), context: TIMELINE_CONTEXT },
      "standard",
    ),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "unclear-time-jump");
  assert.equal(findings[0].severity, "minor");
  assert.equal(findings[0].minStrictness, "standard");
  assert.equal(surfacesAt(findings[0], "gentle"), false, "ambiguity does not surface at gentle");
  assert.equal(surfacesAt(findings[0], "standard"), true);
  assertSchemaValid(findings[0]);
});

// ---------------------------------------------------------------------------
// Cross-cutting contract behavior
// ---------------------------------------------------------------------------

test("clean passages return [] at gentle, standard and strict for all agents", async () => {
  const cleanChunk = chunk("Mira walked along the wall and sketched the old towers.");
  for (const agent of CONTINUITY_AGENTS) {
    for (const strictness of ["gentle", "standard", "strict"] as const) {
      const findings = await agent.analyze(analyzeInput({ chunk: cleanChunk }, strictness));
      assert.deepEqual(findings, [], `${agent.id} at ${strictness} must stay silent on clean text`);
    }
  }
});

test("agents self-gate: below-floor findings are not emitted at lower strictness", async () => {
  // Unlocked contradiction (standard floor 0.7, confidence 0.8) must not be
  // emitted by the agent itself when asked for gentle (floor 0.9).
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const gentle = await CANON_LORE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The river runs east of the old mill."), context }, "gentle"),
  );
  assert.deepEqual(gentle, [], "unlocked contradiction stays below the gentle floor");
  const standard = await CANON_LORE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The river runs east of the old mill."), context }, "standard"),
  );
  assert.equal(standard.length, 1);
});

test("findings carry file-relative offsets and exact quotes from the chunk", async () => {
  const context: CanonContext = {
    entries: [entry("canon_river", "The river runs west of the old mill.")],
    characters: [],
    events: [],
  };
  const text = "First sentence is fine. The river runs east of the old mill.";
  const findings = await CANON_LORE_AGENT.analyze(analyzeInput({ chunk: chunk(text, 100), context }, "standard"));
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.quote, "The river runs east of the old mill.");
  assert.equal(finding.location.file, "ch1.md");
  assert.ok(finding.location.startOffset >= 100, "offset is relative to the file, not the chunk");
  const fileText = `${" ".repeat(100)}${text}`;
  assert.equal(fileText.slice(finding.location.startOffset, finding.location.endOffset), finding.quote);
});
