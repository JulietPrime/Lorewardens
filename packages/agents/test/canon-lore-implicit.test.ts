// Task catch-implicit-contradictions-in-matchers — unit coverage for the
// implicit full-retention shape, the false-positive guards on the explicit
// shapes, and thought-tag attribution in the POV agent (owner FP evidence).
// Complements agents.test.ts; every guard is proven on both sides.

import assert from "node:assert/strict";
import { test } from "node:test";
import { surfacesAt, type CanonContext, type CanonEntry, type Character, type Finding, type TimelineEvent } from "@lorewardens/core";
import { CANON_LORE_AGENT, POV_CONSISTENCY_AGENT, TIMELINE_AGENT } from "../src/index.js";

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

function chunk(text: string, startOffset = 0) {
  return { text, span: { file: "ch5.md", startOffset, endOffset: startOffset + text.length } };
}

const EMPTY_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

async function canonLore(text: string, entries: CanonEntry[], strictness: "gentle" | "standard" | "strict" = "standard"): Promise<Finding[]> {
  const context: CanonContext = { entries, characters: [], events: [] };
  return CANON_LORE_AGENT.analyze({
    projectId: "p1",
    chunk: chunk(text),
    context,
    strictness,
    settings: EMPTY_SETTINGS,
  });
}

const MAGIC_RULE = "Every spell costs the caster one personal memory; the stronger the spell, the more precious the memory lost.";
const REPRO = "Mira cast a powerful spell and remembered every detail of it afterward.";
const README_REPRO = "She cast the ward and remembered every detail of it afterward.";

// ---------------------------------------------------------------------------
// The owner's repro is caught
// ---------------------------------------------------------------------------

test("implicit: the owner's repro is caught against the locked memory rule at standard", async () => {
  const findings = await canonLore(REPRO, [entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"], locked: true })]);
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding.type, "canon-implicit-contradiction");
  assert.equal(finding.agent, "canon-lore");
  assert.equal(finding.category, "canon");
  assert.equal(finding.severity, "major", "locked rule escalates");
  assert.equal(finding.confidence, 0.95);
  assert.equal(finding.minStrictness, "gentle", "locked rule is gentle-eligible");
  assert.deepEqual(finding.canonRefs, ["canon_rule_magic_memory"]);
  assert.equal(finding.quote, REPRO);
  assert.equal(surfacesAt(finding, "gentle"), true);
  assert.equal(surfacesAt(finding, "standard"), true);
});

test("implicit: the README variant ('She cast the ward...') is caught through the same shape", async () => {
  const findings = await canonLore(README_REPRO, [entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"], locked: true })]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-implicit-contradiction");
  assert.deepEqual(findings[0].canonRefs, ["canon_rule_magic_memory"]);
});

test("implicit: unlocked rule yields minor/0.8/standard and stays below the gentle floor", async () => {
  const findings = await canonLore(REPRO, [entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"] })]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "minor");
  assert.equal(findings[0].confidence, 0.8);
  assert.equal(findings[0].minStrictness, "standard");
  assert.equal(surfacesAt(findings[0], "gentle"), false);
  assert.equal(surfacesAt(findings[0], "standard"), true);
});

test("implicit: different cue-table entries catch further shapes (wove, invoked, channelled)", async () => {
  const rule = entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"], locked: true });
  const cases = [
    "She wove the warding circle at dusk and kept every memory she had.",
    "Daven invoked the old rite and recalled every detail of the working.",
    "The hedge-witch channelled the storm's power and nothing was lost of her own mind.",
  ];
  for (const text of cases) {
    const findings = await canonLore(text, [rule]);
    assert.equal(findings.length, 1, text);
    assert.equal(findings[0].type, "canon-implicit-contradiction", text);
  }
});

// ---------------------------------------------------------------------------
// Eligibility gates — each alone keeps the shape silent
// ---------------------------------------------------------------------------

test("implicit gates: casting alone, remembering alone, paying the cost, spell book — all silent", async () => {
  const rule = entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"], locked: true });
  const clean = [
    "Mira cast a ward over the harbor map before dawn.",
    "She remembered every detail of the tide tables.",
    "She paid a memory for the small ward, as the rule demands.",
    "She remembered every detail of the spell book.",
  ];
  for (const text of clean) {
    assert.deepEqual(await canonLore(text, [rule]), [], `clean passage must stay silent: '${text}'`);
  }
});

test("implicit gates: a rule without a cost cue stays silent even with casting, retention and domain", async () => {
  const rule = entry("canon_rule_wards", "Every ward must be redrawn at each full moon.", { kind: "rule", tags: ["ward"] });
  assert.deepEqual(
    await canonLore("She cast the ward at the full moon and remembered every detail of it.", [rule]),
    [],
    "no cost/loss cue in the rule: no implicit finding",
  );
});

test("implicit gates: no domain link between the casting cue and the rule stays silent", async () => {
  const rule = entry("canon_rule_gates", "Every gate in the city is barred from dusk until dawn.", { kind: "rule", tags: ["gate"] });
  assert.deepEqual(
    await canonLore("Daven invoked the gate ward and remembered everything about it.", [rule]),
    [],
    "invoked/ward cannot bind to a gate-bar rule: no implicit finding",
  );
});

test("implicit gates: non-rule canon kinds are unaffected by the implicit shape", async () => {
  const fact = entry("canon_fact_magic_memory", MAGIC_RULE, { kind: "fact", tags: ["magic", "cost"] });
  assert.deepEqual(await canonLore(REPRO, [fact]), [], "fact-kind entry never yields the implicit shape");
});

test("implicit gates: proposed entries are skipped entirely", async () => {
  const rule = entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"], status: "proposed" });
  assert.deepEqual(await canonLore(REPRO, [rule]), [], "proposed rule: no findings");
});

test("implicit: the explicit negation catch keeps precedence — no double fire on the seeded sentence", async () => {
  // ch4 line 1: explicit negation-polarity conflict, not an implicit one.
  const rule = entry("canon_rule_magic_memory", MAGIC_RULE, { kind: "rule", tags: ["magic", "cost"], locked: true });
  const findings = await canonLore("Mira cast the warding spell without giving up a single memory.", [rule]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-contradiction");
  assert.equal(findings[0].severity, "major");
});

// ---------------------------------------------------------------------------
// False-positive guard: antonym conflicts need the entry's subject anchor
// ---------------------------------------------------------------------------

const BLACKOUT = "The capital goes dark during the great blackout; no light shows in any window.";

test("antonym guard, suppressed side: 'light in every window' does not collide with dark canon on 'light'", async () => {
  const blackout = entry("canon_fact_blackout", BLACKOUT, { tags: ["blackout"] });
  assert.deepEqual(
    await canonLore("Light burned in every window that night.", [blackout]),
    [],
    "token collision on 'light' without the entry's subject anchor: silent",
  );
});

test("antonym guard, firing side: a sentence that mentions the subject and flips it still fires", async () => {
  const blackout = entry("canon_fact_blackout", BLACKOUT, { tags: ["blackout"] });
  const findings = await canonLore("The capital blazed with light during the blackout.", [blackout]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-contradiction");
  assert.match(findings[0].message, /light/);
});

// ---------------------------------------------------------------------------
// False-positive guard: negation-polarity needs shared content beyond the anchor
// ---------------------------------------------------------------------------

const WOLVES = "The north wolves grow winter coats and hunt in packs.";

test("negation guard, suppressed side: negation on shared subject keywords without a trait conflict is silent", async () => {
  const wolves = entry("canon_fact_wolves", WOLVES, { tags: ["wolves"] });
  assert.deepEqual(
    await canonLore("The north wolves did not come down from the hills that spring.", [wolves]),
    [],
    "polarity co-occurrence on the subject anchor alone: silent",
  );
});

test("negation guard, firing side: negating the canon predicate still fires", async () => {
  const wolves = entry("canon_fact_wolves", WOLVES, { tags: ["wolves"] });
  const findings = await canonLore("The north wolves did not hunt in packs that spring.", [wolves]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-contradiction");
});

// ---------------------------------------------------------------------------
// False-positive guard: numeric conflicts need a unit word adjacent to each numeral
// ---------------------------------------------------------------------------

const BRIDGE_WATCH = "The bridge watch changes at 30 past each hour.";

test("numeric guard, suppressed side: a stray numeral cannot match canon numbers without a shared adjacent unit", async () => {
  const watch = entry("canon_fact_bridge_watch", BRIDGE_WATCH, { tags: ["bridge"] });
  assert.deepEqual(
    await canonLore("She waited 1 hour on the bridge.", [watch]),
    [],
    "stray '1' vs canon '30' with no shared adjacent unit: silent",
  );
});

test("numeric guard, firing side: differing numerals sharing the adjacent unit word still fire", async () => {
  const watch = entry("canon_fact_bridge_watch", BRIDGE_WATCH, { tags: ["bridge"] });
  const findings = await canonLore("The bridge watch changed at 15 past each hour.", [watch]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-contradiction");
  assert.match(findings[0].message, /15/);
});

// ---------------------------------------------------------------------------
// False-positive guard: verbatim canon agreement is never a conflict
// ---------------------------------------------------------------------------

const WEEPING_GATE = "The Weeping Gate is the only gate in the city's north wall, and it is sealed since the siege.";

test("agreement guard, suppressed side: a verbatim restatement with an incidental negation stays silent", async () => {
  const gate = entry("canon_fact_weeping_gate", WEEPING_GATE, { tags: ["weeping-gate", "city", "north-wall"] });
  assert.deepEqual(
    await canonLore(`The gate was not merely symbolic: ${WEEPING_GATE}`, [gate]),
    [],
    "the sentence agrees with canon verbatim: silent",
  );
});

test("agreement guard, firing side: a genuine negation of the entry still fires", async () => {
  const gate = entry("canon_fact_weeping_gate", WEEPING_GATE, { tags: ["weeping-gate", "city", "north-wall"] });
  const findings = await canonLore("The Weeping Gate is not the only gate in the city wall.", [gate]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-contradiction");
});

// ---------------------------------------------------------------------------
// Owner FP evidence #2: thought-tag attribution resolves to the named subject
// ---------------------------------------------------------------------------

const POV_SETTINGS = EMPTY_SETTINGS;

async function pov(text: string, entries: CanonEntry[], characters: Character[]): Promise<Finding[]> {
  const context: CanonContext = { entries, characters, events: [] };
  return POV_CONSISTENCY_AGENT.analyze({
    projectId: "p1",
    chunk: chunk(text),
    context,
    strictness: "standard",
    settings: POV_SETTINGS,
  });
}

test("pov thought-tag, declared rule: 'Liniel thought about it.' stays silent when Liniel is the POV character", async () => {
  const rule = entry("canon_rule_pov", "The story is told from Liniel's point of view.", { tags: ["pov"] });
  const liniel = character("char_liniel", "Liniel");
  const oren = character("char_oren", "Oren");
  assert.deepEqual(
    await pov("Liniel thought about it.", [rule], [liniel, oren]),
    [],
    "the named subject is the focal character: no head-hop",
  );
});

test("pov thought-tag, declared rule: interiority of a different non-focal character still escalates", async () => {
  const rule = entry("canon_rule_pov", "The story is told from Liniel's point of view.", { tags: ["pov"] });
  const liniel = character("char_liniel", "Liniel");
  const oren = character("char_oren", "Oren");
  const findings = await pov("Oren realized the truth.", [rule], [liniel, oren]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "pov-head-hop");
  assert.deepEqual(findings[0].canonRefs, ["canon_rule_pov"]);
});

test("pov thought-tag, absent rule: a single thought-tag attribution is not a head-hop", async () => {
  const liniel = character("char_liniel", "Liniel");
  const oren = character("char_oren", "Oren");
  assert.deepEqual(
    await pov("Liniel thought about it.", [], [liniel, oren]),
    [],
    "one named viewpoint, no rule: silent",
  );
});

// ---------------------------------------------------------------------------
// Timeline caution fix 1: cueBetween considers every cue occurrence
// ---------------------------------------------------------------------------

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

async function timeline(text: string, events: TimelineEvent[], characters: Character[] = []): Promise<Finding[]> {
  const context: CanonContext = { entries: [], characters, events };
  return TIMELINE_AGENT.analyze({
    projectId: "p1",
    chunk: chunk(text),
    context,
    strictness: "standard",
    settings: EMPTY_SETTINGS,
  });
}

test("timeline cueBetween: a second cue occurrence inside the mention window asserts the sequence", async () => {
  const events = [
    event("ev_coronation", "The coronation of the queen.", 0),
    event("ev_envoy", "The envoy departs for the coast.", 1),
  ];
  // First "before" sits before both mentions; the second sits between them.
  // First-occurrence-only matching missed it; every-occurrence matching
  // asserts envoy-before-coronation, which contradicts canon order.
  const findings = await timeline(
    "Before the war the envoy departed for the coast, well before the coronation of the queen.",
    events,
  );
  assert.equal(findings.length, 1, "the in-window cue occurrence now asserts the reversed sequence");
  assert.equal(findings[0].type, "timeline-contradiction");
  assert.deepEqual(findings[0].canonRefs, ["ev_coronation", "ev_envoy"]);
});

test("timeline cueBetween: cues outside the mention window still assert nothing", async () => {
  const events = [
    event("ev_coronation", "The coronation of the queen.", 0),
    event("ev_envoy", "The envoy departs for the coast.", 1),
  ];
  assert.deepEqual(
    await timeline("Long before the war, long before the siege even, the coronation of the queen.", events),
    [],
    "both 'before' occurrences sit before the second mention: no assertion",
  );
});

// ---------------------------------------------------------------------------
// Timeline caution fix 2: ambiguity cues are mention-gated
// ---------------------------------------------------------------------------

const AMBIGUITY_EVENTS = [
  event("ev_siege", "The siege that sealed the Weeping Gate.", 0),
  event("ev_survey", "The survey of the north wall began at the Weeping Gate.", 1),
];

test("timeline ambiguity: a hedge between the two event mentions still fires", async () => {
  const findings = await timeline(
    "The survey of the north wall happened sometime around the siege that sealed the Weeping Gate.",
    AMBIGUITY_EVENTS,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "unclear-time-jump");
});

test("timeline ambiguity: a hedge trailing both event mentions no longer fires", async () => {
  assert.deepEqual(
    await timeline(
      "The survey of the north wall outlasted the siege that sealed the Weeping Gate, or so the records say.",
      AMBIGUITY_EVENTS,
    ),
    [],
    "the trailing 'or so' describes the records, not the ordering: silent",
  );
});

test("timeline ambiguity: a comparative cue between the mentions wins over a hedge elsewhere", async () => {
  assert.deepEqual(
    await timeline(
      "The survey of the north wall began sometime after the siege that sealed the Weeping Gate.",
      AMBIGUITY_EVENTS,
    ),
    [],
    "'after' between the mentions asserts the (canon-consistent) order; the hedge does not create ambiguity",
  );
});

// ---------------------------------------------------------------------------
// Caution fix 3: location drift derives object identity from the entry text
// ---------------------------------------------------------------------------

const DRIFT_SETTINGS = {
  projectId: "p1",
  agents: [{ agentId: "canon-lore" as const, enabled: true, strictness: "strict" as const, options: { objectLocationChecks: true } }],
  exceptions: [],
  dismissed: [],
};

async function canonLoreStrict(text: string, entries: CanonEntry[]): Promise<Finding[]> {
  const context: CanonContext = { entries, characters: [], events: [] };
  return CANON_LORE_AGENT.analyze({
    projectId: "p1",
    chunk: chunk(text),
    context,
    strictness: "strict",
    settings: DRIFT_SETTINGS,
  });
}

test("location drift: object identity comes from the entry's subject words, not tags[0]", async () => {
  const entries = [
    entry("canon_astrolabe", "The silver astrolabe rests on the surveyor's bench in the map room.", { tags: ["instrument"] }),
    entry("canon_lantern", "The signal lantern hangs in the lighthouse.", { tags: ["lantern"] }),
  ];
  const findings = await canonLoreStrict("Daven moved the astrolabe to the lighthouse during the storm.", entries);
  assert.equal(findings.length, 1, "tags[0] ('instrument') is absent from the sentence; the subject word 'astrolabe' carries the match");
  assert.equal(findings[0].type, "canon-location-drift");
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].confidence, 0.55);
  assert.equal(findings[0].minStrictness, "strict");
  assert.match(findings[0].message, /astrolabe/);
  assert.match(findings[0].message, /lighthouse/);
});

test("location drift: tags[0] remains the fallback when the subject words are empty", async () => {
  const entries = [
    entry("canon_compass", "It rests in the satchel.", { tags: ["compass"] }),
    entry("canon_chart", "The harbor chart lies on the office desk.", { tags: ["chart"] }),
  ];
  const findings = await canonLoreStrict("Daven moved the compass to the office during the storm.", entries);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "canon-location-drift");
  assert.match(findings[0].message, /compass/);
});

test("location drift: the drift reason is distinct — no antonym-shaped message leaks through", async () => {
  const entries = [
    entry("canon_astrolabe", "The silver astrolabe rests on the surveyor's bench in the map room.", { tags: ["astrolabe"] }),
    entry("canon_lantern", "The signal lantern hangs in the lighthouse.", { tags: ["lantern"] }),
  ];
  const findings = await canonLoreStrict("Daven moved the astrolabe to the lighthouse during the storm.", entries);
  assert.equal(findings.length, 1);
  assert.ok(!/says the opposite of canon/.test(findings[0].message), "the antonym reason text must not appear");
  assert.match(findings[0].message, /relocates it toward 'lighthouse'/);
});
