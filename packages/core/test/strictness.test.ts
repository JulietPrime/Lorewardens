import assert from "node:assert/strict";
import { test } from "node:test";
import { atLeastStrictness, surfacesAt, STRICTNESS_ORDER } from "../src/strictness.js";
import { makeFinding } from "../src/findings.js";
import type { FindingDraft } from "../src/findings.js";
import type { Severity } from "../src/types.js";

function draft(overrides: Partial<FindingDraft> = {}): FindingDraft {
  return {
    agent: "canon-lore",
    category: "canon",
    type: "canon-contradiction",
    severity: "major" satisfies Severity,
    confidence: 0.95,
    minStrictness: "standard",
    message: "Contradicts confirmed canon",
    quote: "the river ran east",
    location: { file: "ch1.md", startOffset: 10, endOffset: 30 },
    canonRefs: ["canon_1"],
    suggestion: null,
    ...overrides,
  };
}

test("strictness ordering is off < gentle < standard < strict", () => {
  assert.ok(STRICTNESS_ORDER.off < STRICTNESS_ORDER.gentle);
  assert.ok(STRICTNESS_ORDER.gentle < STRICTNESS_ORDER.standard);
  assert.ok(STRICTNESS_ORDER.standard < STRICTNESS_ORDER.strict);
  assert.ok(atLeastStrictness("standard", "gentle"));
  assert.ok(!atLeastStrictness("gentle", "standard"));
});

test("off never surfaces findings", () => {
  const finding = makeFinding(draft());
  assert.equal(surfacesAt(finding, "off"), false);
});

test("a standard finding surfaces at standard and strict but not gentle", () => {
  const finding = makeFinding(draft({ minStrictness: "standard", confidence: 0.95 }));
  assert.equal(surfacesAt(finding, "gentle"), false);
  assert.equal(surfacesAt(finding, "standard"), true);
  assert.equal(surfacesAt(finding, "strict"), true);
});

test("confidence floor gates findings at each level", () => {
  const soft = makeFinding(draft({ minStrictness: "standard", confidence: 0.75 }));
  assert.equal(surfacesAt(soft, "standard"), true);
  const speculative = makeFinding(draft({ minStrictness: "strict", confidence: 0.5 }));
  assert.equal(surfacesAt(speculative, "standard"), false);
  assert.equal(surfacesAt(speculative, "strict"), true);
  const borderline = makeFinding(draft({ minStrictness: "strict", confidence: 0.35 }));
  assert.equal(surfacesAt(borderline, "strict"), false);
});
