import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRelevantContext, type CanonContext, type CanonSnapshot, type Character, type Finding } from "@lorewardens/core";
import { CHARACTER_CONSISTENCY_AGENT } from "../src/index.js";
import type { AnalyzeInput } from "@lorewardens/core";

// ---------------------------------------------------------------------------
// Fixtures (self-contained; mirrors the agents.test.ts helper shapes)
// ---------------------------------------------------------------------------

const NOW = "2026-10-29T09:00:00.000Z";

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

const EMPTY_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

function analyzeInput(partial: Partial<AnalyzeInput>, strictness: "gentle" | "standard" | "strict"): AnalyzeInput {
  return {
    projectId: "p1",
    chunk: chunk(""),
    context: { entries: [], characters: [], events: [] },
    strictness,
    settings: EMPTY_SETTINGS,
    ...partial,
  };
}

function ownerSnapshot(): CanonSnapshot {
  return {
    projectId: "p1",
    entries: [],
    characters: [character("char_haze", "Hazledown")],
    events: [],
  };
}

// Minimal schema mirror (schemas/finding.schema.json): type is a free string,
// agent/category/severity/minStrictness are closed enums.
function assertSchemaValid(finding: Finding): void {
  assert.match(finding.id, /^fnd_[0-9a-fA-F-]{36}$/);
  assert.equal(finding.agent, "character-consistency");
  assert.equal(finding.category, "character");
  assert.ok(["info", "minor", "major", "critical"].includes(finding.severity), "severity enum");
  assert.ok(["gentle", "standard", "strict"].includes(finding.minStrictness), "minStrictness enum");
  assert.ok(finding.confidence >= 0 && finding.confidence <= 1, "confidence in [0,1]");
}

// ---------------------------------------------------------------------------
// name-variant-drift
// ---------------------------------------------------------------------------

const OWNER_TEXT = "Hazeldown watched the road. Hazeldown said nothing more.";

test("name-variant drift fires at standard with the exact finding rows (owner scenario, selector-fed)", async () => {
  const context = selectRelevantContext(OWNER_TEXT, ownerSnapshot());
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_haze"],
    "variant-only chunk pulls the character into context",
  );
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk(OWNER_TEXT, 40), context }, "standard"),
  );
  assert.equal(findings.length, 2, "stateless: every variant occurrence flags");
  const first = findings[0];
  assert.equal(first.type, "name-variant-drift");
  assert.equal(first.severity, "minor");
  assert.equal(first.confidence, 0.72);
  assert.equal(first.minStrictness, "standard");
  assert.deepEqual(first.canonRefs, ["char_haze"]);
  assert.equal(first.message, "Passage spells Hazledown as 'Hazeldown' (canon: 'Hazledown').");
  assert.equal(first.quote, "Hazeldown watched the road.");
  assert.equal(first.location.startOffset, 40);
  assert.equal(first.location.endOffset, 67);
  assert.equal(
    first.suggestion,
    "Character proposal (advisory): align the passage with the canon spelling, " +
      "or lock the variant as an alias of Hazledown if it is deliberate.",
  );
  assertSchemaValid(first);
  assert.equal(findings[1].location.startOffset, 68);
  assert.equal(findings[1].location.endOffset, 96);
  assert.equal(findings[1].quote, "Hazeldown said nothing more.");
});

test("name-variant drift stays silent at gentle (confidence below the 0.9 floor)", async () => {
  const context = selectRelevantContext(OWNER_TEXT, ownerSnapshot());
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk(OWNER_TEXT, 40), context }, "gentle"),
  );
  assert.deepEqual(findings, []);
});

test("a variant locked as an alias never flags (dismissal path)", async () => {
  const snap = ownerSnapshot();
  snap.characters = [character("char_haze", "Hazledown", { aliases: ["Hazeldown"] })];
  const context = selectRelevantContext(OWNER_TEXT, snap);
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_haze"],
    "exact alias mention still selects the character",
  );
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk(OWNER_TEXT, 0), context }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("distance-2 typos stay silent end to end", async () => {
  const context = selectRelevantContext("Hazldwn watched the road.", ownerSnapshot());
  assert.deepEqual(context.characters, [], "distance-2 does not even select the character");
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Hazldwn watched the road.", 0), context }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("clean canon text stays silent", async () => {
  const context = selectRelevantContext("Hazledown watched the road.", ownerSnapshot());
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Hazledown watched the road.", 0), context }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("place-name guard: canon name evidenced as a confirmed setting suppresses drift", async () => {
  const snap = ownerSnapshot();
  snap.entries = [
    {
      id: "canon_place",
      projectId: "p1",
      kind: "setting",
      text: "The Hazledown valley narrows past the mill.",
      tags: [],
      status: "confirmed",
      locked: false,
      sources: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  const context = selectRelevantContext("Hazeldown walked the valley road.", snap);
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_haze"],
    "the character still enters context",
  );
  assert.deepEqual(context.placeNames, ["Hazledown"]);
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Hazeldown walked the valley road.", 0), context }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("place-name guard: variant token evidenced as a confirmed setting suppresses drift", async () => {
  const snap = ownerSnapshot();
  snap.entries = [
    {
      id: "canon_place",
      projectId: "p1",
      kind: "setting",
      text: "Above the pass, Hazeldown shelf drops away.",
      tags: [],
      status: "confirmed",
      locked: false,
      sources: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  ];
  const context = selectRelevantContext("Hazeldown shelf edge crumbled.", snap);
  assert.deepEqual(context.placeNames, ["Above", "Hazeldown"]);
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Hazeldown shelf edge crumbled.", 0), context }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("place-name guard also reads a hand-built context's placeNames field", async () => {
  const context: CanonContext = {
    entries: [],
    characters: [character("char_haze", "Hazledown")],
    events: [],
    placeNames: ["Hazeldown"],
  };
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Hazeldown watched the road.", 0), context }, "standard"),
  );
  assert.deepEqual(findings, []);
});

test("substitution variant flags against the primary canon name", async () => {
  const snap: CanonSnapshot = {
    projectId: "p1",
    entries: [],
    characters: [character("char_wex", "Wexford")],
    events: [],
  };
  const context = selectRelevantContext("Wexfard led the charge.", snap);
  assert.deepEqual(context.characters.map((c) => c.id), ["char_wex"]);
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Wexfard led the charge.", 0), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Wexford as 'Wexfard' (canon: 'Wexford').");
  assertSchemaValid(findings[0]);
});

test("a variant of an alias flags against the primary canon name", async () => {
  const snap: CanonSnapshot = {
    projectId: "p1",
    entries: [],
    characters: [character("char_bram", "Daven", { aliases: ["Bramwell"] })],
    events: [],
  };
  const context = selectRelevantContext("Bramwel stood at the gate.", snap);
  assert.deepEqual(context.characters.map((c) => c.id), ["char_bram"]);
  const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
    analyzeInput({ chunk: chunk("Bramwel stood at the gate.", 0), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Daven as 'Bramwel' (canon: 'Daven').");
  assert.deepEqual(findings[0].canonRefs, ["char_bram"]);
});

test("determinism: two runs produce identical finding tables (stable fields)", async () => {
  const run = async (): Promise<Omit<Finding, "id" | "createdAt">[]> => {
    const context = selectRelevantContext(OWNER_TEXT, ownerSnapshot());
    const findings = await CHARACTER_CONSISTENCY_AGENT.analyze(
      analyzeInput({ chunk: chunk(OWNER_TEXT, 40), context }, "standard"),
    );
    return findings.map(({ id: _id, createdAt: _createdAt, ...rest }) => rest);
  };
  assert.deepEqual(await run(), await run());
});
