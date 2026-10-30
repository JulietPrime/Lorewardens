import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  surfacesAt,
  type CanonContext,
  type Character,
  type Finding,
  type TimelineEvent,
} from "@lorewardens/core";
import type { AnalyzeInput } from "@lorewardens/core";
import { TIMELINE_AGENT } from "../src/index.js";

// ---------------------------------------------------------------------------
// Tests for the timeline date and age checks (TimelineEvent.date and
// Character.birthDate): date-contradiction, duration-contradiction and
// impossible-age findings, locked-canon escalation, tolerance rules and the
// undated-canon silence guarantee. Conventions mirror agents.test.ts; the
// schema assertions below cross-check the same schemas/finding.schema.json.
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

function chunk(text: string, startOffset = 0) {
  return { text, span: { file: "ch1.md", startOffset, endOffset: startOffset + text.length } };
}

const EMPTY_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

function analyzeInput(partial: Partial<AnalyzeInput>, strictness: "off" | "gentle" | "standard" | "strict"): AnalyzeInput {
  return {
    projectId: "p1",
    chunk: chunk(""),
    context: { entries: [], characters: [], events: [] },
    strictness,
    settings: EMPTY_SETTINGS,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Schema validation (mirrors agents.test.ts against the same schema file)
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
  assert.ok(finding.confidence >= 0 && finding.confidence <= 1, "confidence within [0,1]");
  assert.ok(finding.location.startOffset >= 0 && finding.location.endOffset >= finding.location.startOffset);
  assert.ok(Array.isArray(finding.canonRefs));
  assert.ok(finding.suggestion === null || typeof finding.suggestion === "string");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MIRA = (overrides: Partial<Character> = {}) => character("char_mira", "Mira", overrides);

const SURVEY_DATED = (overrides: Partial<TimelineEvent> = {}) =>
  event("ev_survey", "Mira begins the survey of the north wall.", 1, {
    date: "1192-05",
    participants: ["char_mira"],
    ...overrides,
  });

const SIEGE_DATED = (overrides: Partial<TimelineEvent> = {}) =>
  event("ev_siege", "The siege that sealed the Weeping Gate.", 0, { date: "1191", ...overrides });

function contextWith(...items: (Character | TimelineEvent)[]): CanonContext {
  return {
    entries: [],
    characters: items.filter((i): i is Character => "aliases" in i),
    events: items.filter((i): i is TimelineEvent => "precision" in i),
  };
}

// ---------------------------------------------------------------------------
// date-contradiction
// ---------------------------------------------------------------------------

test("date-contradiction: conflicting year caught at standard", async () => {
  const context = contextWith(MIRA(), SURVEY_DATED());
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("In 1191, Mira began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.type, "date-contradiction");
  assert.equal(f.agent, "timeline");
  assert.equal(f.category, "timeline");
  assert.equal(f.severity, "minor");
  assert.equal(f.confidence, 0.8);
  assert.equal(f.minStrictness, "standard");
  assert.deepEqual(f.canonRefs, ["ev_survey"]);
  assert.match(f.message, /the year 1191/);
  assertSchemaValid(f);
});

test("date-contradiction: conflicting month caught, by preposition and by day-of-month frame", async () => {
  const context = contextWith(SURVEY_DATED({ date: "1192-05-12" }));
  const byPreposition = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began in March."), context }, "standard"),
  );
  assert.equal(byPreposition.length, 1);
  assert.equal(byPreposition[0].type, "date-contradiction");
  assert.match(byPreposition[0].message, /March/);
  assertSchemaValid(byPreposition[0]);

  const byDayNumber = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began on March 12."), context }, "standard"),
  );
  assert.equal(byDayNumber.length, 1);
  assert.equal(byDayNumber[0].type, "date-contradiction");
  assertSchemaValid(byDayNumber[0]);
});

test("date-contradiction: conflicting season caught at standard", async () => {
  const context = contextWith(SURVEY_DATED({ date: "1192-03-01" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began that winter."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "date-contradiction");
  assert.match(findings[0].message, /winter/);
  assertSchemaValid(findings[0]);
});

test("consistent month and season assertions stay silent", async () => {
  const context = contextWith(SURVEY_DATED({ date: "1192-03-01" }));
  const spring = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began in the spring."), context }, "standard"),
  );
  assert.deepEqual(spring, []);
  const march = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began in March."), context }, "standard"),
  );
  assert.deepEqual(march, []);
});

test("coarsest common granularity: year-only canon compares years only", async () => {
  const context = contextWith(MIRA(), SURVEY_DATED({ date: "1192" }));
  const month = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began in March."), context }, "standard"),
  );
  assert.deepEqual(month, [], "a month assertion cannot contradict a year-only canon date");
  const season = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began that winter."), context }, "standard"),
  );
  assert.deepEqual(season, [], "a season assertion cannot contradict a year-only canon date");
  const year = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("In 1191, Mira began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(year.length, 1, "a year assertion still compares at year granularity");
  assert.equal(year[0].type, "date-contradiction");
});

test("coarsest common granularity: month-precision canon vs containing season stays silent", async () => {
  const context = contextWith(SURVEY_DATED({ date: "1192-05" }));
  const spring = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began in the spring."), context }, "standard"),
  );
  assert.deepEqual(spring, [], "May is inside meteorological spring");
  const year = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("In 1193, Mira began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(year.length, 1, "the year assertion still compares");
  assert.equal(year[0].type, "date-contradiction");
});

// ---------------------------------------------------------------------------
// duration-contradiction
// ---------------------------------------------------------------------------

test("duration-contradiction: wrong elapsed years caught at standard", async () => {
  const context = contextWith(SIEGE_DATED(), SURVEY_DATED());
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began three years after the siege."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.type, "duration-contradiction");
  assert.equal(f.severity, "minor");
  assert.equal(f.confidence, 0.8);
  assert.equal(f.minStrictness, "standard");
  assert.deepEqual(f.canonRefs, ["ev_siege", "ev_survey"], "pair canonicalized by canon order");
  assert.match(f.message, /asserts 3 years/);
  assert.match(f.message, /1 year apart/);
  assertSchemaValid(f);
});

test("duration-contradiction: direction reversal caught even when amounts match", async () => {
  const context = contextWith(SIEGE_DATED(), SURVEY_DATED());
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began one year before the siege."), context }, "standard"),
  );
  // The same sentence is also an order (sequence) contradiction against canon
  // order; both finding types are expected here.
  assert.equal(findings.length, 2);
  const duration = findings.filter((f) => f.type === "duration-contradiction");
  assert.equal(duration.length, 1);
  assert.equal(duration[0].severity, "minor");
  assert.deepEqual(duration[0].canonRefs, ["ev_siege", "ev_survey"]);
  assert.match(duration[0].message, /the other way round/);
  for (const f of findings) assertSchemaValid(f);
});

test("duration-contradiction: day units compare exactly", async () => {
  const context = contextWith(
    SIEGE_DATED({ date: "1191-03-01" }),
    SURVEY_DATED({ date: "1191-03-04" }),
  );
  const exact = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began three days after the siege."), context }, "standard"),
  );
  assert.deepEqual(exact, [], "day units must match exactly: 3 === 3 is silent");
  const wrong = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began two days after the siege."), context }, "standard"),
  );
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].type, "duration-contradiction");
  assertSchemaValid(wrong[0]);
});

test("duration-contradiction: unit must be representable on both canon dates", async () => {
  const context = contextWith(SIEGE_DATED({ date: "1191" }), SURVEY_DATED({ date: "1192-03" }));
  const months = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began two months after the siege."), context }, "standard"),
  );
  assert.deepEqual(months, [], "a month gap needs a month on both canon dates");
  const days = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began two days after the siege."), context }, "standard"),
  );
  assert.deepEqual(days, [], "a day gap needs a day on both canon dates");
});

// ---------------------------------------------------------------------------
// impossible-age
// ---------------------------------------------------------------------------

test("impossible-age: asserted age contradicted by birthDate + event date at standard", async () => {
  const context = contextWith(MIRA({ birthDate: "1170-05" }), SURVEY_DATED({ date: "1192-05" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, thirty years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.type, "impossible-age");
  assert.equal(f.agent, "timeline");
  assert.equal(f.category, "timeline");
  assert.equal(f.severity, "minor");
  assert.equal(f.confidence, 0.8);
  assert.equal(f.minStrictness, "standard");
  assert.deepEqual(f.canonRefs, ["ev_survey", "char_mira"], "involved event first, then the character");
  assert.match(f.message, /about 22/);
  assertSchemaValid(f);
});

test("impossible-age: +-1 birthday tolerance stays silent at year granularity", async () => {
  const context = contextWith(MIRA({ birthDate: "1170" }), SURVEY_DATED({ date: "1192" }));
  const plusOne = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, twenty-three years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.deepEqual(plusOne, [], "23 vs computed 22 is within the birthday-rounding tolerance");
  const minusOne = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, twenty-one years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.deepEqual(minusOne, [], "21 vs computed 22 is within the birthday-rounding tolerance");
  const beyond = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, twenty-five years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(beyond.length, 1, "25 vs computed 22 exceeds the tolerance");
  assert.equal(beyond[0].type, "impossible-age");
  assertSchemaValid(beyond[0]);
});

test("impossible-age: day-precision dates compare exactly (tolerance 0)", async () => {
  const context = contextWith(MIRA({ birthDate: "1170-05-10" }), SURVEY_DATED({ date: "1192-05-10" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, twenty-three years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(findings.length, 1, "at day precision the computed age is exact: 23 vs 22 flags");
  assert.equal(findings[0].type, "impossible-age");
  assertSchemaValid(findings[0]);
});

test("impossible-age: negative age is major at standard", async () => {
  const context = contextWith(MIRA({ birthDate: "1180" }), SURVEY_DATED({ date: "1170" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, twenty years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.type, "impossible-age");
  assert.equal(f.severity, "major");
  assert.equal(f.confidence, 0.9);
  assert.equal(f.minStrictness, "standard");
  assert.equal(surfacesAt(f, "standard"), true);
  assert.equal(surfacesAt(f, "gentle"), false);
  assert.match(f.message, /not be born yet/);
  assert.deepEqual(f.canonRefs, ["ev_survey", "char_mira"]);
  assertSchemaValid(f);
});

test("impossible-age: computed age above 150 is always flagged", async () => {
  const context = contextWith(MIRA({ birthDate: "1000" }), SURVEY_DATED({ date: "1192" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, 192 years old, began the survey of the north wall."), context }, "standard"),
  );
  assert.equal(findings.length, 1, "asserted 192 matches the computed 192 but is outside 0-150");
  const f = findings[0];
  assert.equal(f.type, "impossible-age");
  assert.equal(f.severity, "minor");
  assert.match(f.message, /0-150/);
  assertSchemaValid(f);
});

// ---------------------------------------------------------------------------
// Locked-canon escalation (mirrors the existing locked-event path)
// ---------------------------------------------------------------------------

test("locked event date escalates to major/0.95/gentle", async () => {
  const context = contextWith(MIRA(), SURVEY_DATED({ locked: true }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("In 1191, Mira began the survey of the north wall."), context }, "gentle"),
  );
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.type, "date-contradiction");
  assert.equal(f.severity, "major");
  assert.equal(f.confidence, 0.95);
  assert.equal(f.minStrictness, "gentle");
  assert.equal(surfacesAt(f, "gentle"), true);
  assertSchemaValid(f);
});

test("locked duration anchor escalates to major/0.95/gentle", async () => {
  const context = contextWith(SIEGE_DATED({ locked: true }), SURVEY_DATED());
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("The survey of the north wall began one year before the siege."), context }, "gentle"),
  );
  const duration = findings.filter((f) => f.type === "duration-contradiction");
  assert.equal(duration.length, 1);
  assert.equal(duration[0].severity, "major");
  assert.equal(duration[0].confidence, 0.95);
  assert.equal(duration[0].minStrictness, "gentle");
  assert.equal(surfacesAt(duration[0], "gentle"), true);
  for (const f of findings) assertSchemaValid(f);
});

test("locked character birthDate escalates age findings to major/0.95/gentle", async () => {
  const context = contextWith(MIRA({ locked: true, birthDate: "1170-05" }), SURVEY_DATED({ date: "1192-05" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira, thirty years old, began the survey of the north wall."), context }, "gentle"),
  );
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.type, "impossible-age");
  assert.equal(f.severity, "major");
  assert.equal(f.confidence, 0.95);
  assert.equal(f.minStrictness, "gentle");
  assert.equal(surfacesAt(f, "gentle"), true);
  assertSchemaValid(f);
});

// ---------------------------------------------------------------------------
// Silence guarantees
// ---------------------------------------------------------------------------

test("undated canon produces no date or age findings", async () => {
  const context = contextWith(
    MIRA(),
    SIEGE_DATED({ date: undefined }),
    SURVEY_DATED({ date: undefined }),
  );
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput(
      {
        chunk: chunk("In 1191, Mira, thirty years old, began the survey of the north wall three years after the siege."),
        context,
      },
      "strict",
    ),
  );
  assert.deepEqual(findings, []);
});

test("a fuzzy-precision event with a date is treated as undated (silent)", async () => {
  const context = contextWith(MIRA(), SURVEY_DATED({ precision: "fuzzy" }));
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("In 1191, Mira began the survey of the north wall."), context }, "strict"),
  );
  assert.deepEqual(findings, []);
});

test("off strictness returns nothing even with dated canon", async () => {
  const context = contextWith(MIRA(), SURVEY_DATED());
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("In 1191, Mira began the survey of the north wall."), context }, "off"),
  );
  assert.deepEqual(findings, []);
});

test("clean sentences stay silent with dated canon", async () => {
  const context = contextWith(MIRA({ birthDate: "1170-05" }), SURVEY_DATED(), SIEGE_DATED());
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk("Mira walked along the wall and sketched the old towers."), context }, "strict"),
  );
  assert.deepEqual(findings, []);
});

test("findings carry chunk-relative offsets and the exact sentence quote", async () => {
  const context = contextWith(MIRA(), SURVEY_DATED());
  const text = "Intro line. In 1191, Mira began the survey of the north wall.";
  const sentenceStart = text.indexOf("In 1191");
  const findings = await TIMELINE_AGENT.analyze(
    analyzeInput({ chunk: chunk(text, 25), context }, "standard"),
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].location.file, "ch1.md");
  assert.equal(findings[0].location.startOffset, 25 + sentenceStart);
  assert.equal(findings[0].location.endOffset, 25 + text.length);
  assert.equal(findings[0].quote, "In 1191, Mira began the survey of the north wall.");
  assertSchemaValid(findings[0]);
});
