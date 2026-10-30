import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  nameVariantOf,
  selectRelevantContext,
  type AnalyzeInput,
  type CanonContext,
  type CanonEntry,
  type CanonSnapshot,
  type Character,
  type Finding,
} from "@lorewardens/core";
import { CHARACTER_CONSISTENCY_AGENT } from "../src/index.js";

// ---------------------------------------------------------------------------
// Independent acceptance suite for flag-character-name-spelling-variants.
//
// Covers the six accepted criteria (ac-1..ac-6) for the name-variant drift
// flagger, its closed rule table, the variant-tolerant context selector and
// the place-name guard. Self-contained fixtures; scenarios are distinct from
// the builder's suites and exercise the public surface only (core exports +
// the character-consistency agent). No product code is changed by this file.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const NOW = "2026-01-01T00:00:00Z";

function character(id: string, name: string, overrides: Partial<Character> = {}): Character {
  return {
    id,
    projectId: "p_acc",
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

function settingEntry(id: string, text: string, status: "confirmed" | "proposed" | "retired" = "confirmed"): CanonEntry {
  return {
    id,
    projectId: "p_acc",
    kind: "setting",
    text,
    tags: [],
    status,
    locked: false,
    sources: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function chunk(text: string, startOffset = 0) {
  return { text, span: { file: "ch09.md", startOffset, endOffset: startOffset + text.length } };
}

function contextOf(characters: Character[], entries: CanonEntry[] = [], placeNames?: string[]): CanonContext {
  return { entries, characters, events: [], ...(placeNames === undefined ? {} : { placeNames }) };
}

const EMPTY_SETTINGS = { projectId: "p_acc", agents: [], exceptions: [], dismissed: [] };

async function driftFindings(text: string, context: CanonContext, strictness: AnalyzeInput["strictness"] = "standard", startOffset = 0): Promise<Finding[]> {
  return CHARACTER_CONSISTENCY_AGENT.analyze({
    projectId: "p_acc",
    chunk: chunk(text, startOffset),
    context,
    strictness,
    settings: EMPTY_SETTINGS,
  });
}

function stable(findings: Finding[]): Omit<Finding, "id" | "createdAt">[] {
  return findings.map(({ id: _id, createdAt: _createdAt, ...rest }) => rest);
}

const WICK = "Wickifeld led the retreat. Wickifeld never looked back.";

// ---------------------------------------------------------------------------
// ac-1 — closed rule table: enumerated edit operations, bounds, surfaces
// ---------------------------------------------------------------------------

test("ac-1: transposition variant fires end to end and matching is case-insensitive on a capitalized token", async () => {
  const context = contextOf([character("char_wick", "Wickfield")]);
  const findings = await driftFindings("Wickifeld stood at the ford.", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Wickfield as 'Wickifeld' (canon: 'Wickfield').");
  const allCaps = await driftFindings("WICKIFELD stood at the ford.", context);
  assert.equal(allCaps.length, 1);
  assert.equal(allCaps[0].message, "Passage spells Wickfield as 'WICKIFELD' (canon: 'Wickfield').");
});

test("ac-1: each enumerated edit operation fires exactly once — substitution, insertion, deletion, transposition", async () => {
  const context = contextOf([
    character("char_wick", "Wickfield"), // transposition: Wickifeld
    character("char_els", "Elspeth"), // substitution: Elspith
    character("char_cor", "Corvane"), // insertion: Corvanes
    character("char_bran", "Brannock"), // deletion: Brannck
  ]);
  const text = "Wickifeld rode out. Elspith waited. Corvanes spoke. Brannck fell.";
  const findings = await driftFindings(text, context);
  assert.deepEqual(findings.map((f) => f.type), [
    "name-variant-drift",
    "name-variant-drift",
    "name-variant-drift",
    "name-variant-drift",
  ]);
  assert.deepEqual(findings.map((f) => f.message), [
    "Passage spells Wickfield as 'Wickifeld' (canon: 'Wickfield').",
    "Passage spells Elspeth as 'Elspith' (canon: 'Elspeth').",
    "Passage spells Corvane as 'Corvanes' (canon: 'Corvane').",
    "Passage spells Brannock as 'Brannck' (canon: 'Brannock').",
  ]);
});

test("ac-1: distance 2 never flags even when the character is already in context", async () => {
  const context = contextOf([character("char_wick", "Wickfield"), character("char_els", "Elspeth")]);
  const findings = await driftFindings("Wickifld rode past Alspoth mill.", context);
  assert.deepEqual(findings, []);
});

test("ac-1: min length four is the closed table's bound — three-letter candidates never match", () => {
  assert.equal(nameVariantOf("Nol", ["Nolan"]), null, "min(len 3, 5) < 4");
  assert.notEqual(nameVariantOf("Noln", ["Nolan"]), null, "min(len 4, 5) = 4 exactly");
  assert.equal(nameVariantOf("Edmu", ["Edmund"]), null, "length 4 but distance 2");
  assert.equal(nameVariantOf("Ori", ["Orin"]), null);
});

test("ac-1: min length holds end to end — a three-letter drift surface stays silent", async () => {
  const context = contextOf([character("char_orin", "Orin")]);
  assert.deepEqual(await driftFindings("Ori smiled at the crowd.", context), []);
});

test("ac-1: only capitalized whole tokens surface — lowercase drift spelling is not a proper-noun surface", async () => {
  const context = contextOf([character("char_wick", "Wickfield")]);
  assert.deepEqual(await driftFindings("The wickifeld road bends.", context), []);
});

test("ac-1: possessive surfaces compare stripped — canon possessive silent, variant possessive flags", async () => {
  const context = contextOf([character("char_bran", "Brannock")]);
  assert.deepEqual(await driftFindings("Brannock's sword gleamed.", context), []);
  const findings = await driftFindings("Brannck's sword gleamed.", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Brannock as 'Brannck' (canon: 'Brannock').");
});

test("ac-1: the closed rule table and its bounds are documented in docs/agent-contract.md", () => {
  const doc = readFileSync(path.join(REPO_ROOT, "docs", "agent-contract.md"), "utf8").replace(/\s+/g, " ");
  for (const needle of [
    "## Name-variant drift",
    "restricted Damerau-Levenshtein",
    "single substitution",
    "single insertion",
    "single deletion",
    "adjacent transposition",
    "min(len(T), len(N)) >= 4",
    "CAPITALIZED whole word token",
    "possessive",
  ]) {
    assert.ok(doc.includes(needle), `agent contract must document: ${needle}`);
  }
});

// ---------------------------------------------------------------------------
// ac-2 — the drift finding row and its strictness posture
// ---------------------------------------------------------------------------

test("ac-2: drift finding carries the exact pinned row (agent, category, type, severity, confidence, floor, refs, message, quote, offsets, suggestion)", async () => {
  const sentence = "Elspith reached the gate.";
  const startOffset = 120;
  const findings = await driftFindings(sentence, contextOf([character("char_els", "Elspeth")]), "standard", startOffset);
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.match(f.id, /^fnd_[0-9a-fA-F-]{36}$/);
  assert.equal(f.agent, "character-consistency");
  assert.equal(f.category, "character");
  assert.equal(f.type, "name-variant-drift");
  assert.equal(f.severity, "minor");
  assert.equal(f.confidence, 0.72);
  assert.equal(f.minStrictness, "standard");
  assert.deepEqual(f.canonRefs, ["char_els"]);
  assert.equal(f.message, "Passage spells Elspeth as 'Elspith' (canon: 'Elspeth').");
  assert.equal(f.quote, sentence);
  assert.equal(f.location.file, "ch09.md");
  assert.equal(f.location.startOffset, startOffset);
  assert.equal(f.location.endOffset, startOffset + sentence.length);
  assert.equal(
    f.suggestion,
    "Character proposal (advisory): align the passage with the canon spelling, " +
      "or lock the variant as an alias of Elspeth if it is deliberate.",
  );
});

test("ac-2: drift surfaces at standard and strict, silent at gentle and off", async () => {
  const context = contextOf([character("char_wick", "Wickfield")]);
  assert.deepEqual(await driftFindings("Wickifeld stood at the ford.", context, "off"), []);
  assert.deepEqual(await driftFindings("Wickifeld stood at the ford.", context, "gentle"), []);
  assert.equal((await driftFindings("Wickifeld stood at the ford.", context, "standard")).length, 1);
  assert.equal((await driftFindings("Wickifeld stood at the ford.", context, "strict")).length, 1);
});

test("ac-2: the finding validates against schemas/finding.schema.json — free-form type, closed agent/category enums", async () => {
  const schema = JSON.parse(readFileSync(path.join(REPO_ROOT, "schemas", "finding.schema.json"), "utf8"));
  const findings = await driftFindings("Elspith reached the gate.", contextOf([character("char_els", "Elspeth")]));
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.ok(!("enum" in schema.properties.type), "finding type must stay a free string so additive types need no schema change");
  assert.ok(schema.properties.agent.enum.includes("character-consistency"), "agent enum");
  assert.ok(schema.properties.category.enum.includes("character"), "category enum");
  assert.ok(schema.properties.severity.enum.includes(f.severity), "severity enum");
  assert.ok(schema.properties.minStrictness.enum.includes(f.minStrictness), "minStrictness enum");
  const propertyNames = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(f)) {
    assert.ok(propertyNames.has(key), `finding key '${key}' must be declared in the schema properties`);
  }
  for (const key of schema.required) {
    assert.ok(key in f, `required schema key '${key}' must be present on the finding`);
  }
  assert.equal(schema.additionalProperties, false);
});

// ---------------------------------------------------------------------------
// ac-3 — aliases honored by construction; dismissal path documented
// ---------------------------------------------------------------------------

test("ac-3: an exact alias never flags by construction even when it is itself a rule-table variant of the primary name", async () => {
  // 'Corvan' is distance 1 from 'Corvane' (deletion) — only the exact-match
  // rule keeps the locked alias silent, while 'Corvanes' still flags.
  const context = contextOf([character("char_cor", "Corvane", { aliases: ["Corvan"] })]);
  const findings = await driftFindings("Corvan and Corvanes met.", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Corvane as 'Corvanes' (canon: 'Corvane').");
});

test("ac-3: locking the variant as an alias silences the owner scenario end to end — no store plumbing", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [],
    characters: [character("char_wick", "Wickfield", { aliases: ["Wickifeld"] })],
    events: [],
  };
  const context = selectRelevantContext("Wickifeld led the retreat.", snap);
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_wick"],
    "the exact alias still selects the character",
  );
  assert.deepEqual(await driftFindings("Wickifeld led the retreat.", context), []);
});

test("ac-3: the dismissal path (add the variant as an alias, or correct canon; no new store plumbing) is documented", () => {
  const doc = readFileSync(path.join(REPO_ROOT, "docs", "agent-contract.md"), "utf8");
  for (const needle of [
    "add the variant as an alias",
    "no new store plumbing",
  ]) {
    assert.ok(doc.includes(needle), `agent contract must document the dismissal path: ${needle}`);
  }
});

// ---------------------------------------------------------------------------
// ac-4 — place-name guard
// ---------------------------------------------------------------------------

test("ac-4: guard suppresses drift when the canon name is place-evidenced in a confirmed setting", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [settingEntry("canon_set_wick", "The Wickfield road climbs past the mill.")],
    characters: [character("char_wick", "Wickfield")],
    events: [],
  };
  const context = selectRelevantContext("Wickifeld walked the road.", snap);
  assert.deepEqual(context.placeNames, ["Wickfield"]);
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_wick"],
    "the character still enters context; the guard, not the selector, suppresses",
  );
  assert.deepEqual(await driftFindings("Wickifeld walked the road.", context), []);
});

test("ac-4: guard suppresses drift when the variant token is place-evidenced in a confirmed setting", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [settingEntry("canon_set_variant", "Beneath Wickifeld crag the river turns.")],
    characters: [character("char_wick", "Wickfield")],
    events: [],
  };
  const context = selectRelevantContext("Wickifeld crag trail washed out.", snap);
  assert.deepEqual(context.placeNames, ["Wickifeld"]);
  assert.deepEqual(await driftFindings("Wickifeld crag trail washed out.", context), []);
});

test("ac-4: proposed and retired settings are not place evidence — the drift still fires", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [
      settingEntry("canon_set_proposed", "Wickifeld marsh is unmapped.", "proposed"),
      settingEntry("canon_set_retired", "Wickfield hall burned.", "retired"),
    ],
    characters: [character("char_wick", "Wickfield")],
    events: [],
  };
  const context = selectRelevantContext("Wickifeld marsh mist thickened.", snap);
  assert.deepEqual(context.placeNames ?? [], []);
  const findings = await driftFindings("Wickifeld marsh mist thickened.", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Wickfield as 'Wickifeld' (canon: 'Wickfield').");
});

test("ac-4: guard reads hand-built placeNames case-insensitively; unrelated place evidence does not suppress", async () => {
  const text = "Wickifeld watched the ford.";
  const upper = await driftFindings(text, contextOf([character("char_wick", "Wickfield")], [], ["WICKIFELD"]));
  assert.deepEqual(upper, [], "casing of the place evidence must not matter");
  const lower = await driftFindings(text, contextOf([character("char_wick", "Wickfield")], [], ["wickifeld"]));
  assert.deepEqual(lower, []);
  const unrelated = await driftFindings(text, contextOf([character("char_wick", "Wickfield")], [], ["Embervale"]));
  assert.equal(unrelated.length, 1, "unrelated place evidence must not suppress the drift");
});

test("ac-4: place evidence for one proper noun does not suppress other characters' drift", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [settingEntry("canon_set_embervale", "Embervale market burns.")],
    characters: [character("char_cor", "Corvane")],
    events: [],
  };
  const context = selectRelevantContext("Corvanes led the Embervale watch.", snap);
  assert.deepEqual(context.placeNames, ["Embervale"]);
  const findings = await driftFindings("Corvanes led the Embervale watch.", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Corvane as 'Corvanes' (canon: 'Corvane').");
});

// ---------------------------------------------------------------------------
// ac-5 — variant-tolerant selection; the owner scenario
// ---------------------------------------------------------------------------

test("ac-5: a chunk containing only a variant spelling pulls the character into context and fires (owner scenario, no canon spelling present)", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [],
    characters: [character("char_wick", "Wickfield")],
    events: [],
  };
  assert.ok(!WICK.toLowerCase().includes("wickfield"), "scenario precondition: the canon spelling never appears");
  const context = selectRelevantContext(WICK, snap);
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_wick"],
  );
  const findings = await driftFindings(WICK, context, "standard", 400);
  assert.equal(findings.length, 2, "stateless: every drifted occurrence flags");
  assert.deepEqual(findings.map((f) => f.message), [
    "Passage spells Wickfield as 'Wickifeld' (canon: 'Wickfield').",
    "Passage spells Wickfield as 'Wickifeld' (canon: 'Wickfield').",
  ]);
  assert.deepEqual(findings.map((f) => f.quote), [
    "Wickifeld led the retreat.",
    "Wickifeld never looked back.",
  ]);
  const first = WICK.indexOf("Wickifeld led the retreat.");
  const second = WICK.indexOf("Wickifeld never looked back.");
  assert.equal(findings[0].location.startOffset, 400 + first);
  assert.equal(findings[0].location.endOffset, 400 + first + "Wickifeld led the retreat.".length);
  assert.equal(findings[1].location.startOffset, 400 + second);
  assert.equal(findings[1].location.endOffset, 400 + second + "Wickifeld never looked back.".length);
});

test("ac-5: a chunk containing only a variant of an alias also selects and flags against the primary canon name", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [],
    characters: [character("char_iso", "Isolde", { aliases: ["Ravenne"] })],
    events: [],
  };
  const context = selectRelevantContext("Ravenn stood alone.", snap);
  assert.deepEqual(
    context.characters.map((c) => c.id),
    ["char_iso"],
  );
  const findings = await driftFindings("Ravenn stood alone.", context);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Passage spells Isolde as 'Ravenn' (canon: 'Isolde').");
  assert.deepEqual(findings[0].canonRefs, ["char_iso"]);
});

// ---------------------------------------------------------------------------
// ac-6 — determinism and FP safety
// ---------------------------------------------------------------------------

test("ac-6: two runs produce byte-identical outcome tables and identical contexts", async () => {
  const snap: CanonSnapshot = {
    projectId: "p_acc",
    entries: [settingEntry("canon_set_embervale", "Embervale market burns.")],
    characters: [character("char_wick", "Wickfield")],
    events: [],
  };
  const run = async () => {
    const context = selectRelevantContext(WICK, snap);
    const findings = await driftFindings(WICK, context, "standard", 40);
    return { context, findings: stable(findings) };
  };
  const a = await run();
  const b = await run();
  assert.deepEqual(a.context, b.context);
  assert.deepEqual(a.findings, b.findings);
  assert.equal(a.findings.length, 2);
  assert.deepEqual((b.context.placeNames ?? []).length, 1, "placeNames participate in the compared context");
});

test("ac-6: the new check stays silent on existing-shape clean text at every strictness level", async () => {
  const clean = character("char_wick", "Wickfield", {
    traits: ["loyal"],
    abilities: ["ward-sight"],
    injuries: ["cracked ribs"],
  });
  const text = "Wickfield kept her word and held the line.";
  const context = selectRelevantContext(text, {
    projectId: "p_acc",
    entries: [],
    characters: [clean],
    events: [],
  });
  assert.deepEqual(context.placeNames ?? [], []);
  assert.deepEqual(await driftFindings(text, context, "gentle"), []);
  assert.deepEqual(await driftFindings(text, context, "standard"), []);
  assert.deepEqual(await driftFindings(text, context, "strict"), []);
});

test("ac-6: the variant table, selector and flagger are offline — no network APIs in the touched sources", () => {
  const sources = [
    path.join(REPO_ROOT, "packages", "core", "src", "name-variants.ts"),
    path.join(REPO_ROOT, "packages", "core", "src", "context.ts"),
    path.join(REPO_ROOT, "packages", "agents", "src", "character-consistency.ts"),
  ];
  const networkApi = /fetch\s*\(|XMLHttpRequest|WebSocket|node:(http|https|net|tls|dns|dgram)|require\(\s*["'](http|https|net|tls)|\baxios\b|\bundici\b/;
  for (const file of sources) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, networkApi, `${path.basename(file)} must not use network APIs (offline contract)`);
  }
});
