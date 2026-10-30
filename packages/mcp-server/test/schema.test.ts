import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { makeFinding, type Category, type ContinuityAgentId } from "@lorewardens/core";
import { assertValidFindings, validateFinding } from "../src/validate.js";

const schemaPath = fileURLToPath(new URL("../../../../schemas/finding.schema.json", import.meta.url));

function validDraft() {
  return {
    agent: "canon-lore" as const,
    category: "canon" as const,
    type: "canon-contradiction",
    severity: "major" as const,
    confidence: 0.95,
    minStrictness: "standard" as const,
    message: "Contradicts confirmed canon.",
    quote: "the river ran east",
    location: { file: "demo/ch1.md", startOffset: 0, endOffset: 18 },
    canonRefs: ["canon_fact_weeping_gate"],
    suggestion: null,
  };
}

test("validator constants agree with schemas/finding.schema.json", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const required = new Set(schema.required);
  for (const field of [
    "id",
    "agent",
    "category",
    "type",
    "severity",
    "confidence",
    "minStrictness",
    "message",
    "quote",
    "location",
    "canonRefs",
    "suggestion",
    "createdAt",
  ]) {
    assert.ok(required.has(field), `schema requires '${field}'`);
  }
  assert.deepEqual(schema.properties.severity.enum, ["info", "minor", "major", "critical"]);
  assert.deepEqual(schema.properties.minStrictness.enum, ["gentle", "standard", "strict"]);
  assert.deepEqual(schema.properties.suggestion.type, ["string", "null"], "suggestion is advisory/nullable");
  assert.deepEqual(schema.properties.location.required, ["file", "startOffset", "endOffset"]);
});

test("a makeFinding-produced finding validates", () => {
  const finding = makeFinding(validDraft());
  assert.deepEqual(validateFinding(finding), []);
  assert.doesNotThrow(() => assertValidFindings([finding]));
});

test("malformed findings are rejected before they can reach a client", () => {
  assert.ok(validateFinding({}).length >= 5, "an empty object reports the missing fields");
  const bad = { ...makeFinding(validDraft()), severity: "catastrophic", suggestion: { autoApply: true } };
  const problems = validateFinding(bad);
  assert.match(problems.join("; "), /severity/);
  assert.match(problems.join("; "), /suggestion/);
  assert.throws(() => assertValidFindings([bad]), /finding.schema/);
});

test("empty agent output (stub behavior) is trivially valid", () => {
  assert.doesNotThrow(() => assertValidFindings([]));
});

test("validator accepts the language-roster agents and categories (additive)", () => {
  for (const [agent, category] of [
    ["grammar-mechanics", "language"],
    ["vocabulary-repetition", "language"],
    ["period-dialect", "language"],
    ["style-voice", "prose"],
    ["character-voice", "prose"],
  ] as const) {
    const finding = makeFinding({ ...validDraft(), agent, category });
    assert.deepEqual(validateFinding(finding), [], `${agent}/${category} validates`);
  }
  const unknown = makeFinding({ ...validDraft(), agent: "poetry-rhyme" as ContinuityAgentId });
  assert.ok(validateFinding(unknown).length > 0, "unknown agents are still rejected");
});

test("validator accepts the narrative-roster agents and category (additive)", () => {
  for (const agent of ["plot-thread", "pacing-tension", "pov-consistency"] as const) {
    const finding = makeFinding({ ...validDraft(), agent, category: "narrative" });
    assert.deepEqual(validateFinding(finding), [], `${agent}/narrative validates`);
  }
  const unknownAgent = makeFinding({ ...validDraft(), agent: "theme-tracker" as ContinuityAgentId });
  assert.ok(validateFinding(unknownAgent).length > 0, "unknown agents are still rejected");
  const unknownCategory = makeFinding({ ...validDraft(), category: "theme" as unknown as Category });
  assert.ok(validateFinding(unknownCategory).length > 0, "unknown categories are still rejected");
});

test("validator accepts the optional-roster agents and category (additive)", () => {
  for (const [agent, category] of [
    ["show-vs-tell", "optional"],
    ["sensitivity-representation", "optional"],
    ["theme-motif", "optional"],
  ] as const) {
    const finding = makeFinding({ ...validDraft(), agent, category });
    assert.deepEqual(validateFinding(finding), [], `${agent}/${category} validates`);
  }
  const unknownAgent = makeFinding({ ...validDraft(), agent: "ethics-engine" as ContinuityAgentId });
  assert.ok(validateFinding(unknownAgent).length > 0, "unknown agents are still rejected");
  const unknownCategory = makeFinding({ ...validDraft(), category: "sensitivity" as unknown as Category });
  assert.ok(validateFinding(unknownCategory).length > 0, "unknown categories are still rejected");
});
