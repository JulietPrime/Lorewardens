// Independent acceptance suite (test-designer authored) for
// catch-implicit-contradictions-in-matchers.
//
// Written against the accepted specification and its nine acceptance
// criteria, verified through the real MCP tool path (runAnalyzeTool) over the
// demo fixtures and the dedicated proof-implicit fixture project, plus direct
// agent calls for the synthetic gate/guard/caution cases. Product code is
// untouched: every expectation here was pinned against the reviewed engine.
//
// Criteria map:
//   ac-1  tests 1, 2   — owner repro caught on demo fixtures and the ch5 seed
//   ac-2  test 3       — finding type, severity/confidence/minStrictness pattern
//   ac-3  test 4       — eligibility gates, one-sentence scope, explicit precedence
//   ac-4  test 5       — four FP guards on both sides, owner FP classes silenced
//   ac-5  test 6       — cueBetween all-occurrences, ambiguity window gate, drift reason
//   ac-6  test 7       — increment-1 ch4 outcomes byte-stable (E1-E10, gentle, S1/S2)
//   ac-7  tests 2, 8   — proof-implicit fixture through the tool path, deterministic
//   ac-8  test 8       — README parity: caught-shape doc + machine-proven try-this row
//   ac-9  (suite run)  — full build+test green; suite changes no product code

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CanonContext, CanonEntry, Finding, Strictness, TimelineEvent } from "@lorewardens/core";
import { surfacesAt } from "@lorewardens/core";
import { CANON_LORE_AGENT, CONTINUITY_AGENTS, TIMELINE_AGENT } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { defaultFixturesDir, loadFixtures } from "../src/store.js";
import { validateFinding } from "../src/validate.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> @lorewardens/mcp-server -> packages -> repo root
const REPO_ROOT = path.resolve(HERE, "../../../..");
const PROOF_FIXTURES = path.join(REPO_ROOT, "packages", "proof", "fixtures");
const CH5_LABEL = "manuscript/ch5-implicit.md";
const CH4_LABEL = "manuscript/ch4.md";

const { store: demoStore } = loadFixtures(defaultFixturesDir());
const { store: proofStore, projectIds, skipped } = loadFixtures(PROOF_FIXTURES);

interface Paragraph {
  text: string;
  startOffset: number;
  endOffset: number;
}

/** Loads a manuscript fixture and computes each paragraph's real file offsets. */
function paragraphsOf(file: string): { content: string; paragraphs: Paragraph[] } {
  const content = readFileSync(path.join(PROOF_FIXTURES, file), "utf8");
  const paragraphs: Paragraph[] = [];
  let cursor = 0;
  for (const raw of content.split("\n\n")) {
    const text = raw.trim();
    if (text.length > 0) {
      const startOffset = cursor + (raw.length - raw.trimStart().length);
      paragraphs.push({ text, startOffset, endOffset: startOffset + text.length });
    }
    cursor += raw.length + 2;
  }
  return { content, paragraphs };
}

const CH5 = paragraphsOf(CH5_LABEL);
const CH4 = paragraphsOf(CH4_LABEL);

function paragraphOf(list: { paragraphs: Paragraph[] }, sentence: string): Paragraph {
  const matches = list.paragraphs.filter((p) => p.text === sentence);
  assert.equal(matches.length, 1, `scenario sentence must match exactly one paragraph: '${sentence}'`);
  return matches[0] as Paragraph;
}

const AGENT_BY_ID = new Map<string, (typeof CONTINUITY_AGENTS)[number]>(
  CONTINUITY_AGENTS.map((a) => [a.id, a] as const),
);

type Level = Exclude<Strictness, "off">;

/** Runs one agent through the real tool path with an ad-hoc (or given) chunk. */
async function runTool(
  agentId: string,
  store: (typeof demoStore | typeof proofStore),
  projectId: string,
  text: string,
  strictness?: Level,
  span?: { file: string; startOffset: number; endOffset: number },
): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  const { file, startOffset, endOffset } = span ?? {
    file: "test-authoring/ad-hoc.md",
    startOffset: 0,
    endOffset: text.length,
  };
  return (await runAnalyzeTool(agent, store, {
    projectId,
    chunk: { text, file, startOffset, endOffset },
    ...(strictness ? { strictness } : {}),
  })) as AnalyzeToolResult;
}

/** Runs every continuity agent over one sentence through the real tool path. */
async function runAllAgents(
  store: typeof demoStore | typeof proofStore,
  projectId: string,
  text: string,
  strictness?: Level,
): Promise<Map<string, AnalyzeToolResult>> {
  const results = new Map<string, AnalyzeToolResult>();
  for (const agent of CONTINUITY_AGENTS) {
    const result = (await runAnalyzeTool(agent, store, {
      projectId,
      chunk: { text, file: "test-authoring/ad-hoc.md", startOffset: 0, endOffset: text.length },
      ...(strictness ? { strictness } : {}),
    })) as AnalyzeToolResult;
    results.set(agent.id, result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Synthetic canon helpers for the direct agent calls (deterministic context).
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

function event(id: string, description: string, order: number): TimelineEvent {
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
  };
}

const EMPTY_SETTINGS = { projectId: "p1", agents: [], exceptions: [], dismissed: [] };

const DRIFT_SETTINGS = {
  projectId: "p1",
  agents: [{ agentId: "canon-lore" as const, enabled: true, strictness: "strict" as const, options: { objectLocationChecks: true } }],
  exceptions: [],
  dismissed: [],
};

function chunkOf(text: string): { text: string; span: { file: string; startOffset: number; endOffset: number } } {
  return { text, span: { file: "test-authoring/ad-hoc.md", startOffset: 0, endOffset: text.length } };
}

async function canonDirect(
  text: string,
  entries: CanonEntry[],
  strictness: Level = "standard",
  settings: typeof EMPTY_SETTINGS | typeof DRIFT_SETTINGS = EMPTY_SETTINGS,
): Promise<Finding[]> {
  const context: CanonContext = { entries, characters: [], events: [] };
  return CANON_LORE_AGENT.analyze({
    projectId: "p1",
    chunk: chunkOf(text),
    context,
    strictness,
    settings,
  });
}

async function timelineDirect(text: string, events: TimelineEvent[]): Promise<Finding[]> {
  const context: CanonContext = { entries: [], characters: [], events };
  return TIMELINE_AGENT.analyze({
    projectId: "p1",
    chunk: chunkOf(text),
    context,
    strictness: "standard",
    settings: EMPTY_SETTINGS,
  });
}

// ---------------------------------------------------------------------------
// Shared expectations
// ---------------------------------------------------------------------------

const MAGIC_RULE_TEXT =
  "Every spell costs the caster one personal memory; the stronger the spell, the more precious the memory lost.";
const OWNER_REPRO = "Mira cast a powerful spell and remembered every detail of it afterward.";
const README_REPRO = "She cast the ward and remembered every detail of it afterward.";

interface Row {
  agent: string;
  type: string;
  canonRefs: string[];
  severity: string;
  confidence: number;
  minStrictness: string;
  quote?: string;
}

/** Asserts one finding carries exactly the expected row (plus optional quote). */
function assertRow(label: string, finding: Finding, row: Row): void {
  assert.deepEqual(validateFinding(finding), [], `${label}: finding schema-valid`);
  assert.equal(finding.agent, row.agent, `${label}: agent`);
  assert.equal(finding.type, row.type, `${label}: type`);
  assert.deepEqual([...finding.canonRefs].sort(), row.canonRefs, `${label}: canonRefs`);
  assert.equal(finding.severity, row.severity, `${label}: severity`);
  assert.equal(finding.confidence, row.confidence, `${label}: confidence`);
  assert.equal(finding.minStrictness, row.minStrictness, `${label}: minStrictness`);
  if (row.quote !== undefined) assert.equal(finding.quote, row.quote, `${label}: quote`);
}

// ---------------------------------------------------------------------------
// ac-1 — the owner's repro, demo fixtures
// ---------------------------------------------------------------------------

test("test-authoring: the owner's repro is flagged against the locked magic-memory rule at standard on the demo fixtures (ac-1)", async () => {
  const demoCanon = await demoStore.read("demo");
  const magicRule = demoCanon.entries.find((e) => e.id === "canon_rule_magic_memory");
  assert.ok(magicRule, "the demo project seeds the magic-memory rule");
  assert.equal(magicRule.kind, "rule", "the flagship entry is rule-kind");
  assert.equal(magicRule.status, "confirmed", "the flagship rule is confirmed");
  assert.ok(magicRule.locked, "the flagship rule is writer-locked");

  for (const repro of [OWNER_REPRO, README_REPRO]) {
    const results = await runAllAgents(demoStore, "demo", repro);
    assert.equal(results.size, CONTINUITY_AGENTS.length, "every continuity agent ran");
    for (const [agentId, result] of results) {
      assert.equal(result.invoked, true, `${repro.slice(0, 30)}: ${agentId} invoked`);
      assert.equal(result.strictness, "standard", `${repro.slice(0, 30)}: project strictness applies`);
      const findings = (result.findings ?? []) as Finding[];
      if (agentId === "canon-lore") {
        assert.equal(findings.length, 1, `${agentId}: exactly one finding`);
        assertRow(repro, findings[0] as Finding, {
          agent: "canon-lore",
          type: "canon-implicit-contradiction",
          canonRefs: ["canon_rule_magic_memory"],
          severity: "major",
          confidence: 0.95,
          minStrictness: "gentle",
          quote: repro,
        });
      } else {
        assert.deepEqual(findings, [], `${repro.slice(0, 30)}: ${agentId} stays silent`);
      }
    }
  }

  // The locked rule makes the repro gentle-eligible.
  const gentle = await runTool("canon-lore", demoStore, "demo", OWNER_REPRO, "gentle");
  const gentleFindings = (gentle.findings ?? []) as Finding[];
  assert.equal(gentleFindings.length, 1, "the locked-rule repro surfaces at gentle");
  assert.equal(surfacesAt(gentleFindings[0] as Finding, "gentle"), true, "the finding passes the gentle gate");
});

// ---------------------------------------------------------------------------
// ac-1, ac-7 — the ch5 proof-implicit seed: layout, catch table, gentle matrix
// ---------------------------------------------------------------------------

test("test-authoring: the ch5 seed table is caught with file-anchored offsets and gentle-eligible locked rows (ac-1, ac-7)", async () => {
  assert.ok(projectIds.includes("proof-implicit"), "the loader emits the proof-implicit project");
  assert.deepEqual(skipped, [], "no fixture is skipped or malformed");
  const snapshot = await proofStore.read("proof-implicit");
  const magicRule = snapshot.entries.find((e) => e.id === "canon_rule_magic_memory");
  assert.ok(magicRule?.locked && magicRule.kind === "rule", "the ch5 flagship entry is a confirmed locked rule");
  const settings = await proofStore.settings("proof-implicit");
  assert.equal(settings.agents.find((s) => s.agentId === "canon-lore")?.strictness, "standard");
  assert.equal(settings.agents.find((s) => s.agentId === "canon-lore")?.enabled, true);

  // Layout: the owner's repro is the FIRST paragraph; every paragraph is a
  // single sentence whose offsets slice the real file.
  assert.equal(CH5.paragraphs.length, 16, "ch5 has exactly the 16 documented paragraphs");
  assert.equal(CH5.paragraphs[0]?.text, OWNER_REPRO, "the owner's repro is the first paragraph");
  for (const paragraph of CH5.paragraphs) {
    assert.equal(CH5.content.slice(paragraph.startOffset, paragraph.endOffset), paragraph.text, "offsets slice the real file");
    assert.ok(!/[.!?]/.test(paragraph.text.slice(0, -1)), "paragraph is a single sentence");
  }

  interface Seed {
    id: string;
    row: Row;
    sentence: string;
    gentle: boolean;
  }
  const CATCHES: Seed[] = [
    { id: "IC1", row: { agent: "canon-lore", type: "canon-implicit-contradiction", canonRefs: ["canon_rule_magic_memory"], severity: "major", confidence: 0.95, minStrictness: "gentle" }, sentence: OWNER_REPRO, gentle: true },
    { id: "IC2", row: { agent: "canon-lore", type: "canon-implicit-contradiction", canonRefs: ["canon_rule_magic_memory"], severity: "major", confidence: 0.95, minStrictness: "gentle" }, sentence: "She wove the warding circle at dusk and kept every memory she had.", gentle: true },
    { id: "IC3", row: { agent: "canon-lore", type: "canon-implicit-contradiction", canonRefs: ["canon_rule_magic_memory"], severity: "major", confidence: 0.95, minStrictness: "gentle" }, sentence: "Daven invoked the old rite and recalled every detail of the working.", gentle: true },
    { id: "IC4", row: { agent: "canon-lore", type: "canon-implicit-contradiction", canonRefs: ["canon_rule_magic_memory"], severity: "major", confidence: 0.95, minStrictness: "gentle" }, sentence: "The hedge-witch channelled the storm's power and nothing was lost of her own mind.", gentle: true },
    { id: "G1", row: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_blackout"], severity: "minor", confidence: 0.8, minStrictness: "standard" }, sentence: "The capital blazed with light during the blackout.", gentle: false },
    { id: "G2", row: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_north_wolves"], severity: "minor", confidence: 0.8, minStrictness: "standard" }, sentence: "The north wolves did not hunt in packs that spring.", gentle: false },
    { id: "G3", row: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_bridge_watch"], severity: "minor", confidence: 0.8, minStrictness: "standard" }, sentence: "The bridge watch changed at 15 past each hour.", gentle: false },
  ];

  for (const seed of CATCHES) {
    const paragraph = paragraphOf(CH5, seed.sentence);
    const result = await runAnalyzeTool(AGENT_BY_ID.get("canon-lore") as (typeof CONTINUITY_AGENTS)[number], proofStore, {
      projectId: "proof-implicit",
      chunk: { text: paragraph.text, file: CH5_LABEL, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset },
    });
    assert.equal(result.invoked, true, `${seed.id}: agent invoked through the tool path`);
    assert.equal(result.strictness, "standard", `${seed.id}: project strictness applies`);
    const findings = (result.findings ?? []) as Finding[];
    assert.equal(findings.length, 1, `${seed.id}: exactly one finding, got ${JSON.stringify(findings.map((f) => f.type))}`);
    const finding = findings[0] as Finding;
    assertRow(seed.id, finding, { ...seed.row, quote: seed.sentence });
    assert.equal(finding.location.file, CH5_LABEL, `${seed.id}: anchored to ch5`);
    assert.equal(
      CH5.content.slice(finding.location.startOffset, finding.location.endOffset),
      seed.sentence,
      `${seed.id}: offsets slice exactly from the ch5 file`,
    );
    // Gentle matrix: locked implicit rows reach gentle; minor explicit rows do not.
    const atGentle = await runAnalyzeTool(AGENT_BY_ID.get("canon-lore") as (typeof CONTINUITY_AGENTS)[number], proofStore, {
      projectId: "proof-implicit",
      chunk: { text: paragraph.text, file: CH5_LABEL, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset },
      strictness: "gentle",
    });
    assert.equal(((atGentle.findings ?? []) as Finding[]).length, seed.gentle ? 1 : 0, `${seed.id}: gentle matrix`);
  }
});

// ---------------------------------------------------------------------------
// ac-2 — finding type and the severity/confidence/minStrictness pattern
// ---------------------------------------------------------------------------

test("test-authoring: canon-implicit-contradiction follows the locked/unlocked severity pattern and the schema carries the agent (ac-2)", async () => {
  const lockedRule = entry("canon_rule_magic_memory", MAGIC_RULE_TEXT, { kind: "rule", tags: ["magic", "cost"], locked: true });

  const locked = await canonDirect(OWNER_REPRO, [lockedRule]);
  assert.equal(locked.length, 1, "locked rule: exactly one finding");
  assertRow("locked", locked[0] as Finding, {
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRefs: ["canon_rule_magic_memory"],
    severity: "major",
    confidence: 0.95,
    minStrictness: "gentle",
  });
  assert.equal(surfacesAt(locked[0] as Finding, "gentle"), true, "locked: gentle-eligible");
  assert.equal(surfacesAt(locked[0] as Finding, "standard"), true, "locked: surfaces at standard");
  assert.notEqual((locked[0] as Finding).type, "canon-contradiction", "the implicit shape is its own type");
  assert.match((locked[0] as Finding).message, /keeping everything/, "the message names the full-retention shape");

  const unlocked = await canonDirect(OWNER_REPRO, [entry("canon_rule_magic_memory", MAGIC_RULE_TEXT, { kind: "rule", tags: ["magic", "cost"] })]);
  assert.equal(unlocked.length, 1, "unlocked rule: exactly one finding");
  assertRow("unlocked", unlocked[0] as Finding, {
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRefs: ["canon_rule_magic_memory"],
    severity: "minor",
    confidence: 0.8,
    minStrictness: "standard",
  });
  assert.equal(surfacesAt(unlocked[0] as Finding, "gentle"), false, "unlocked: below the gentle floor");
  assert.equal(surfacesAt(unlocked[0] as Finding, "standard"), true, "unlocked: surfaces at standard");

  // The finding schema still carries the emitting agent and category.
  const schema = JSON.parse(
    readFileSync(path.join(REPO_ROOT, "schemas", "finding.schema.json"), "utf8"),
  ) as { properties: { agent: { enum: string[] }; category: { enum: string[] } } };
  assert.ok(schema.properties.agent.enum.includes("canon-lore"), "schema agent enum carries canon-lore");
  assert.ok(schema.properties.category.enum.includes("canon"), "schema category enum carries canon");
});

// ---------------------------------------------------------------------------
// ac-3 — eligibility gates, one-sentence scope, explicit precedence
// ---------------------------------------------------------------------------

test("test-authoring: the implicit shape is eligibility-gated within one sentence and explicit shapes keep precedence (ac-3)", async () => {
  const lockedRule = entry("canon_rule_magic_memory", MAGIC_RULE_TEXT, { kind: "rule", tags: ["magic", "cost"], locked: true });

  // Clean passages: casting alone, remembering alone, paying the cost,
  // remembering a non-magic object — silent for every continuity agent at
  // every level through the real tool path (the ch5 seeds).
  const CLEAN = [
    "Mira cast a ward over the harbor map before dawn.",
    "She remembered every detail of the tide tables.",
    "She paid a memory for the small ward, as the rule demands.",
    "She remembered every detail of the spell book.",
  ];
  for (const sentence of CLEAN) {
    const paragraph = paragraphOf(CH5, sentence);
    for (const agentId of AGENT_BY_ID.keys()) {
      for (const level of ["gentle", "standard", "strict"] as const) {
        const result = await runAnalyzeTool(AGENT_BY_ID.get(agentId) as (typeof CONTINUITY_AGENTS)[number], proofStore, {
          projectId: "proof-implicit",
          chunk: { text: paragraph.text, file: CH5_LABEL, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset },
          strictness: level,
        });
        assert.deepEqual(
          result.findings ?? [],
          [],
          `clean passage must stay silent for ${agentId} at ${level}: '${sentence}'`,
        );
      }
    }
  }

  // Synthetic gates — each breaks exactly one eligibility requirement, and the
  // shape stays silent at all three levels.
  const GATED: [string, string, CanonEntry[]][] = [
    ["casting and retention split across two sentences", "Mira cast a powerful spell at dusk. She remembered every detail of it afterward.", [lockedRule]],
    ["rule text states no cost cue", "She cast the ward at the full moon and remembered every detail of it afterward.", [entry("canon_rule_wards", "Every ward must be redrawn at each full moon.", { kind: "rule", tags: ["ward"] })]],
    ["no domain link between the casting and the rule", "Daven invoked the old rite and recalled every detail of the working.", [entry("canon_rule_gate_toll", "Every gate passage costs one silver coin.", { kind: "rule", tags: ["gate"] })]],
    ["entry is fact-kind, not rule-kind", OWNER_REPRO, [entry("canon_fact_magic", MAGIC_RULE_TEXT, { kind: "fact", tags: ["magic", "cost"] })]],
    ["entry is only proposed, not confirmed", OWNER_REPRO, [entry("canon_rule_magic_memory", MAGIC_RULE_TEXT, { kind: "rule", tags: ["magic", "cost"], status: "proposed" })]],
  ];
  for (const [why, text, entries] of GATED) {
    for (const level of ["gentle", "standard", "strict"] as const) {
      assert.deepEqual(await canonDirect(text, entries, level), [], `${why} must stay silent at ${level}`);
    }
  }

  // Explicit precedence: the ch4 E1 sentence is an explicit negation of the
  // same rule — exactly one canon-contradiction, no implicit double fire.
  const e1 = paragraphOf(CH4, "Mira cast the warding spell without giving up a single memory.");
  const result = await runTool("canon-lore", proofStore, "proof", e1.text, undefined, {
    file: CH4_LABEL,
    startOffset: e1.startOffset,
    endOffset: e1.endOffset,
  });
  const findings = (result.findings ?? []) as Finding[];
  assert.equal(findings.length, 1, "E1: exactly one finding");
  assert.equal(findings[0]?.type, "canon-contradiction", "E1: the explicit shape wins");
  assert.ok(!findings.some((f) => f.type === "canon-implicit-contradiction"), "E1: no implicit double fire");
  // Same precedence on the synthetic direct path.
  const direct = await canonDirect("Mira cast the warding spell without giving up a single memory.", [lockedRule]);
  assert.equal(direct.length, 1, "precedence: exactly one finding");
  assert.equal(direct[0]?.type, "canon-contradiction", "precedence: explicit shape wins");
});

// ---------------------------------------------------------------------------
// ac-4 — the four false-positive guards, both sides; owner FP classes silent
// ---------------------------------------------------------------------------

test("test-authoring: all four false-positive guards hold on both sides and the owner FP classes stay silent (ac-4)", async () => {
  // Guard matrix through the real tool path against the proof-implicit canon.
  const GUARDS: { id: string; sentence: string; expect: "silent" | Row }[] = [
    {
      id: "antonym/suppressed",
      sentence: "Light burned in every window that night.",
      expect: "silent",
    },
    {
      id: "antonym/firing",
      sentence: "The capital blazed with light during the blackout.",
      expect: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_blackout"], severity: "minor", confidence: 0.8, minStrictness: "standard" },
    },
    {
      id: "negation/suppressed",
      sentence: "The north wolves did not come down from the hills that spring.",
      expect: "silent",
    },
    {
      id: "negation/firing",
      sentence: "The north wolves did not hunt in packs that spring.",
      expect: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_north_wolves"], severity: "minor", confidence: 0.8, minStrictness: "standard" },
    },
    {
      id: "numeric/suppressed",
      sentence: "She waited 1 hour on the bridge.",
      expect: "silent",
    },
    {
      id: "numeric/firing",
      sentence: "The bridge watch changed at 15 past each hour.",
      expect: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_bridge_watch"], severity: "minor", confidence: 0.8, minStrictness: "standard" },
    },
    {
      id: "verbatim/suppressed",
      sentence: "The gate was not merely symbolic: the Weeping Gate is the only gate in the city's north wall, and it is sealed since the siege.",
      expect: "silent",
    },
    {
      id: "verbatim/firing",
      sentence: "The Weeping Gate is not the only gate in the city wall.",
      expect: { agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_weeping_gate"], severity: "minor", confidence: 0.8, minStrictness: "standard" },
    },
  ];
  for (const guard of GUARDS) {
    for (const level of ["gentle", "standard", "strict"] as const) {
      const result = await runTool("canon-lore", proofStore, "proof-implicit", guard.sentence, level);
      const findings = (result.findings ?? []) as Finding[];
      if (guard.expect === "silent") {
        assert.deepEqual(findings, [], `${guard.id}: silent at ${level}`);
      } else if (level === "standard" || level === "strict") {
        assert.equal(findings.length, 1, `${guard.id}: exactly one finding at ${level}`);
        assertRow(guard.id, findings[0] as Finding, { ...guard.expect, quote: guard.sentence });
      } else {
        assert.deepEqual(findings, [], `${guard.id}: minor finding stays below the gentle floor`);
      }
    }
  }

  // The four owner false-positive classes plus the confirmed-setting
  // co-mention seed are silent for every continuity agent at every level.
  const OWNER_FP = [
    "Light burned in every window that night.",
    "She waited 1 hour on the bridge.",
    "The north wolves did not come down from the hills that spring.",
    "The gate was not merely symbolic: the Weeping Gate is the only gate in the city's north wall, and it is sealed since the siege.",
    "They climbed past the dark stair to the lamp room, where a window threw light on the water.",
  ];
  for (const sentence of OWNER_FP) {
    const paragraph = paragraphOf(CH5, sentence);
    for (const agentId of AGENT_BY_ID.keys()) {
      for (const level of ["gentle", "standard", "strict"] as const) {
        const result = await runAnalyzeTool(AGENT_BY_ID.get(agentId) as (typeof CONTINUITY_AGENTS)[number], proofStore, {
          projectId: "proof-implicit",
          chunk: { text: paragraph.text, file: CH5_LABEL, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset },
          strictness: level,
        });
        assert.deepEqual(result.findings ?? [], [], `owner FP class must stay silent for ${agentId} at ${level}: '${sentence.slice(0, 40)}'`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// ac-5 — the three pinned matcher cautions
// ---------------------------------------------------------------------------

test("test-authoring: the three pinned matcher cautions are fixed (ac-5)", async () => {
  // Caution 1 — cueBetween considers every occurrence: a comparative cue
  // outside the mention window does not mask a second occurrence inside it.
  const CORONATION = event("ev_coronation", "The coronation of the queen.", 0);
  const ENVOY = event("ev_envoy", "The envoy departs for the coast.", 1);
  const inWindow = await timelineDirect(
    "Before the frost the envoy departed for the coast, well before the coronation of the queen.",
    [CORONATION, ENVOY],
  );
  assert.equal(inWindow.length, 1, "the in-window cue occurrence asserts the reversed sequence");
  assert.equal(inWindow[0]?.type, "timeline-contradiction", "cueBetween: sequence contradiction");
  assert.deepEqual([...inWindow[0]!.canonRefs].sort(), ["ev_coronation", "ev_envoy"], "cueBetween: both events referenced");
  const outsideWindow = await timelineDirect(
    "Long before the war and long before the siege even, the envoy departed for the coast, and the coronation of the queen followed.",
    [CORONATION, ENVOY],
  );
  assert.deepEqual(outsideWindow, [], "cueBetween: cues outside the mention window assert nothing");

  // Caution 2 — ambiguity is mention-window gated: a hedge between the two
  // event mentions fires; a hedge trailing both mentions is silent; a
  // comparative between the mentions wins over a hedge.
  const SIEGE = event("ev_siege", "The siege that sealed the Weeping Gate.", 0);
  const SURVEY = event("ev_survey", "The survey of the north wall began at the Weeping Gate.", 1);
  const hedged = await timelineDirect(
    "The survey of the north wall happened sometime near the siege that sealed the Weeping Gate.",
    [SIEGE, SURVEY],
  );
  assert.equal(hedged.length, 1, "a hedge between the two event mentions fires");
  assert.equal(hedged[0]?.type, "unclear-time-jump", "ambiguity: unclear-time-jump");
  assert.deepEqual([...hedged[0]!.canonRefs].sort(), ["ev_siege", "ev_survey"], "ambiguity: both events referenced");
  const trailing = await timelineDirect(
    "The survey of the north wall outlasted the siege that sealed the Weeping Gate, or so the surveyors wrote.",
    [SIEGE, SURVEY],
  );
  assert.deepEqual(trailing, [], "a hedge trailing both mentions stays silent");
  const comparativeWins = await timelineDirect(
    "The survey of the north wall started sometime after the siege that sealed the Weeping Gate.",
    [SIEGE, SURVEY],
  );
  assert.deepEqual(comparativeWins, [], "a comparative cue between the mentions wins and the hedge stays silent");

  // Caution 3 — location drift derives object identity from the entry text
  // and carries its own drift reason (the antonym-shaped hack is gone).
  const driftEntries = [
    entry("canon_sextant", "The bronze sextant rests on the cartographer's bench in the map room.", { tags: ["instrument"] }),
    entry("canon_lantern", "The signal lantern hangs in the lighthouse.", { tags: ["lantern"] }),
  ];
  const drift = await canonDirect(
    "Daven moved the sextant to the lighthouse during the storm.",
    driftEntries,
    "strict",
    DRIFT_SETTINGS,
  );
  assert.equal(drift.length, 1, "drift: exactly one finding");
  assertRow("drift", drift[0] as Finding, {
    agent: "canon-lore",
    type: "canon-location-drift",
    canonRefs: ["canon_sextant"],
    severity: "info",
    confidence: 0.55,
    minStrictness: "strict",
  });
  assert.match((drift[0] as Finding).message, /sextant/, "the drift message names the object from the entry text");
  assert.match((drift[0] as Finding).message, /relocates it toward 'lighthouse'/, "the drift message names the destination");
  assert.ok(!/says the opposite of canon/.test((drift[0] as Finding).message), "no antonym-shaped message leaks through");
  assert.equal(surfacesAt(drift[0] as Finding, "strict"), true, "drift surfaces at strict");
  assert.equal(surfacesAt(drift[0] as Finding, "standard"), false, "drift is strict-only");
  assert.deepEqual(
    await canonDirect("Daven moved the sextant to the lighthouse during the storm.", driftEntries, "standard", DRIFT_SETTINGS),
    [],
    "drift stays silent at standard even with the option enabled",
  );
  // tags[0] remains the fallback when the subject words are empty.
  const fallbackEntries = [
    entry("canon_spyglass", "It is kept in the satchel.", { tags: ["spyglass"] }),
    entry("canon_chart", "The harbor chart lies on the office desk.", { tags: ["chart"] }),
  ];
  const fallback = await canonDirect("Daven moved the spyglass to the office during the storm.", fallbackEntries, "strict", DRIFT_SETTINGS);
  assert.equal(fallback.length, 1, "fallback: exactly one finding");
  assert.match((fallback[0] as Finding).message, /spyglass/, "the fallback label names the object");
});

// ---------------------------------------------------------------------------
// ac-6 — increment-1 ch4 outcomes stay byte-stable
// ---------------------------------------------------------------------------

test("test-authoring: increment-1 ch4 outcomes stay byte-stable (ac-6)", async () => {
  // Byte-pin: ch4 keeps its 18 documented paragraphs and every finding quote
  // slices exactly from the file.
  assert.equal(CH4.paragraphs.length, 18, "ch4 keeps its documented paragraph count");

  interface ERow {
    id: string;
    agent: string;
    type: string;
    canonRefs: string[];
    sentence: string;
    severity: string;
    confidence: number;
    minStrictness: string;
  }
  const E_ROWS: ERow[] = [
    { id: "E1", agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_rule_magic_memory"], sentence: "Mira cast the warding spell without giving up a single memory.", severity: "major", confidence: 0.95, minStrictness: "gentle" },
    { id: "E2", agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_weeping_gate"], sentence: "Daven pushed the Weeping Gate open and slipped through into the darkness beyond.", severity: "minor", confidence: 0.8, minStrictness: "standard" },
    { id: "E3", agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_fact_karth_ferry"], sentence: "The ferry crossing took 15 minutes that morning.", severity: "minor", confidence: 0.8, minStrictness: "standard" },
    { id: "E4", agent: "character-consistency", type: "trait-contradiction", canonRefs: ["char_daven"], sentence: "Daven was careful with the instruments, tightening each screw twice.", severity: "minor", confidence: 0.75, minStrictness: "standard" },
    { id: "E5", agent: "character-consistency", type: "injury-contradiction", canonRefs: ["char_daven"], sentence: "Daven flexed his wrist, fully healed after a week of rest.", severity: "minor", confidence: 0.8, minStrictness: "standard" },
    { id: "E6", agent: "character-consistency", type: "ability-contradiction", canonRefs: ["char_mira"], sentence: "Mira admitted she had never surveyed a wall this old.", severity: "minor", confidence: 0.8, minStrictness: "standard" },
    { id: "E7", agent: "character-consistency", type: "knowledge-violation", canonRefs: ["char_daven", "ev_siege"], sentence: "Daven knew about the siege before Calla ever spoke of it.", severity: "minor", confidence: 0.72, minStrictness: "standard" },
    { id: "E8", agent: "timeline", type: "timeline-contradiction", canonRefs: ["ev_harbor_lanterns", "ev_wall_survey"], sentence: "The harbor lanterns were sketched before the survey of the north wall began, Mira swore to Calla.", severity: "minor", confidence: 0.8, minStrictness: "standard" },
    { id: "E9", agent: "timeline", type: "timeline-contradiction", canonRefs: ["ev_siege", "ev_wall_survey"], sentence: "Mira swore her survey of the north wall began before the siege, a claim Calla loved to correct.", severity: "major", confidence: 0.95, minStrictness: "gentle" },
    { id: "E10", agent: "timeline", type: "unclear-time-jump", canonRefs: ["ev_harbor_lanterns", "ev_wall_survey"], sentence: "Mira meant to sketch the harbor lanterns sometime around her survey of the north wall.", severity: "minor", confidence: 0.7, minStrictness: "standard" },
  ];

  for (const row of E_ROWS) {
    const paragraph = paragraphOf(CH4, row.sentence);
    const result = await runTool(row.agent, proofStore, "proof", paragraph.text, undefined, {
      file: CH4_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    });
    assert.equal(result.invoked, true, `${row.id}: agent invoked`);
    assert.equal(result.strictness, "standard", `${row.id}: standard strictness applies`);
    const findings = (result.findings ?? []) as Finding[];
    assert.equal(findings.length, 1, `${row.id}: exactly one finding, got ${JSON.stringify(findings.map((f) => f.type))}`);
    const finding = findings[0] as Finding;
    assertRow(row.id, finding, { ...row, quote: row.sentence });
    assert.equal(finding.location.file, CH4_LABEL, `${row.id}: anchored to ch4`);
    assert.equal(
      CH4.content.slice(finding.location.startOffset, finding.location.endOffset),
      row.sentence,
      `${row.id}: offsets slice exactly from the ch4 file`,
    );
  }

  // Gentle matrix: across all seeds and all agents, exactly the two
  // writer-locked rows (E1, E9) surface.
  const gentleSurfaced: { seed: string; agent: string; type: string }[] = [];
  for (const row of E_ROWS) {
    const paragraph = paragraphOf(CH4, row.sentence);
    for (const agentId of AGENT_BY_ID.keys()) {
      const result = await runAnalyzeTool(AGENT_BY_ID.get(agentId) as (typeof CONTINUITY_AGENTS)[number], proofStore, {
        projectId: "proof",
        chunk: { text: paragraph.text, file: CH4_LABEL, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset },
        strictness: "gentle",
      });
      for (const finding of (result.findings ?? []) as Finding[]) {
        assert.equal(surfacesAt(finding, "gentle"), true, `${row.id}: surfaced finding passes the gentle gate`);
        gentleSurfaced.push({ seed: row.id, agent: finding.agent, type: finding.type });
      }
    }
  }
  assert.deepEqual(
    gentleSurfaced.map((s) => `${s.seed}/${s.agent}/${s.type}`),
    ["E1/canon-lore/canon-contradiction", "E9/timeline/timeline-contradiction"],
    "at gentle, exactly the locked seeds E1 and E9 surface",
  );

  // S1/S2: the strict-only drifts fire only at strict and stay silent below.
  const STRICT_ROWS: ERow[] = [
    { id: "S1", agent: "canon-lore", type: "canon-location-drift", canonRefs: ["canon_fact_astrolabe"], sentence: "Daven moved the astrolabe to the lighthouse during the storm.", severity: "info", confidence: 0.55, minStrictness: "strict" },
    { id: "S2", agent: "character-consistency", type: "relationship-drift", canonRefs: ["char_bren", "char_oskar"], sentence: "Bren and Oskar are rivals now, each claiming the same stretch of the river.", severity: "info", confidence: 0.55, minStrictness: "strict" },
  ];
  for (const row of STRICT_ROWS) {
    const paragraph = paragraphOf(CH4, row.sentence);
    const atStrict = await runTool(row.agent, proofStore, "proof-strict", paragraph.text, "strict", {
      file: CH4_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    });
    const findings = (atStrict.findings ?? []) as Finding[];
    const target = findings.find((f) => f.type === row.type);
    assert.ok(target, `${row.id}: expected ${row.type} at strict`);
    if (target) {
      assertRow(row.id, target, { ...row, quote: row.sentence });
      assert.equal(surfacesAt(target, "strict"), true, `${row.id}: surfaces at strict`);
      assert.equal(surfacesAt(target, "standard"), false, `${row.id}: silent at standard by declaration`);
    }
    const atStandard = await runTool(row.agent, proofStore, "proof-strict", paragraph.text, "standard", {
      file: CH4_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    });
    assert.deepEqual((atStandard.findings ?? []) as Finding[], [], `${row.id}: nothing surfaces at standard`);
  }
});

// ---------------------------------------------------------------------------
// ac-7 (determinism) and ac-8 — README parity
// ---------------------------------------------------------------------------

test("test-authoring: the acceptance surface is deterministic across two passes (ac-7)", async () => {
  const table = async (): Promise<unknown[]> => {
    const rows: unknown[] = [];
    for (const paragraph of CH5.paragraphs) {
      for (const agentId of AGENT_BY_ID.keys()) {
        for (const level of ["gentle", "standard", "strict"] as const) {
          const result = await runAnalyzeTool(AGENT_BY_ID.get(agentId) as (typeof CONTINUITY_AGENTS)[number], proofStore, {
            projectId: "proof-implicit",
            chunk: { text: paragraph.text, file: CH5_LABEL, startOffset: paragraph.startOffset, endOffset: paragraph.endOffset },
            strictness: level,
          });
          rows.push(((result.findings ?? []) as Finding[]).map((f) => ({
            agent: f.agent,
            type: f.type,
            severity: f.severity,
            confidence: f.confidence,
            minStrictness: f.minStrictness,
            canonRefs: [...f.canonRefs].sort(),
            quote: f.quote,
          })));
        }
      }
    }
    return rows;
  };
  const first = await table();
  assert.ok(first.some((row) => (row as unknown[]).length > 0), "the sweep produced findings to compare");
  assert.deepEqual(await table(), first, "two identical ch5 passes yield identical finding tables");
});

test("test-authoring: README parity — the implicit shape is documented and every try-this row is machine-proven (ac-8)", async () => {
  const README = readFileSync(path.join(REPO_ROOT, "packages", "mcp-server", "README.md"), "utf8");

  function section(markdown: string, headingPrefix: string): string {
    const start = markdown.indexOf(headingPrefix);
    assert.notEqual(start, -1, `README section not found: "${headingPrefix}"`);
    const next = markdown.indexOf("\n## ", start + headingPrefix.length);
    return next === -1 ? markdown.slice(start) : markdown.slice(start, next);
  }

  const catchesSection = section(README, "## What the engine catches today");
  const tryThisSection = section(README, "## Try these");
  const limitsSection = section(README, "## What the engine does NOT catch today");

  // The implicit shape moved from known-limit to documented catch.
  assert.ok(
    catchesSection.includes("Implicit full-retention contradiction"),
    "'What the engine catches today' documents the implicit full-retention shape",
  );
  assert.ok(
    catchesSection.includes("remembered every detail") || catchesSection.includes("canon_rule_magic_memory"),
    "the catches section carries the shape's concrete example",
  );
  assert.ok(
    tryThisSection.includes(README_REPRO),
    "the repro is offered as a catchable try-this sample",
  );
  assert.ok(
    !limitsSection.includes(README_REPRO),
    "the known-limits section no longer quotes the repro as uncaught",
  );
  assert.ok(
    !/\*\*not\*\* flagged/.test(limitsSection),
    "the known-limits section no longer claims the implicit shape is unflagged",
  );
  assert.ok(
    /implicit/i.test(limitsSection),
    "the known-limits section stays honest about implied contradictions beyond the cue tables",
  );

  // Every try-this row (five sentences, the implicit row among them) is
  // machine-proven through the real tool path: the named agent returns
  // exactly the documented finding and every other agent stays silent.
  const rows = tryThisSection.split("\n").filter((line) => line.startsWith("|") && line.includes("→"));
  assert.equal(rows.length, 5, "the try-this table demonstrates five samples");
  const implicitRow = rows.find((line) => line.includes("canon-implicit-contradiction"));
  assert.ok(implicitRow, "one try-this row demonstrates the implicit shape");
  for (const line of rows) {
    const spans = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    assert.ok(spans.length >= 4, `try-this row must quote sentence, agent, type and ref: ${line}`);
    const [sentence, agent, type, ref] = spans as [string, string, string, string];
    const results = await runAllAgents(demoStore, "demo", sentence);
    for (const [agentId, result] of results) {
      assert.equal(result.invoked, true, `${sentence.slice(0, 40)}: ${agentId} invoked`);
      const findings = (result.findings ?? []) as Finding[];
      if (agentId === agent) {
        assert.equal(findings.length, 1, `${sentence.slice(0, 40)}: ${agentId} returns exactly one finding`);
        assert.equal(findings[0]?.type, type, `${sentence.slice(0, 40)}: finding type matches the README`);
        assert.ok(findings[0]?.canonRefs.includes(ref), `${sentence.slice(0, 40)}: canonRefs include ${ref}`);
        assert.equal(findings[0]?.quote, sentence, `${sentence.slice(0, 40)}: finding quotes the sample`);
        assert.deepEqual(validateFinding(findings[0] as Finding), [], `${sentence.slice(0, 40)}: finding schema-valid`);
      } else {
        assert.deepEqual(findings, [], `${sentence.slice(0, 40)}: ${agentId} stays silent`);
      }
    }
  }
});
