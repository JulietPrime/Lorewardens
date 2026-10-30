// Chapter 5 proof — the implicit full-retention contradiction shape and the
// false-positive guards, proven through the real MCP tool path
// (runAnalyzeTool) against the dedicated proof-implicit fixture project.
//
// Layout contract: the owner's repro is the FIRST paragraph; the four owner
// false-positive classes and the clean cast-only / remember-only / paid-cost /
// spellbook passages must stay silent for every continuity agent; the guard
// firing-sides prove each guard is not over-broad. Two identical passes must
// produce identical tables.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Finding, Strictness } from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "@lorewardens/mcp-server/dist/src/tools.js";
import { loadFixtures } from "@lorewardens/mcp-server/dist/src/store.js";
import { validateFinding } from "@lorewardens/mcp-server/dist/src/validate.js";
import { defaultFixturesDir, type ManuscriptParagraph } from "../src/index.js";

const fixturesDir = defaultFixturesDir();
const CH5_LABEL = "manuscript/ch5-implicit.md";
const { store, projectIds, skipped } = loadFixtures(fixturesDir);

const { content, paragraphs } = (() => {
  const path = `${fixturesDir.replace(/\/$/, "")}/${CH5_LABEL}`;
  const file = readFileSync(path, "utf8");
  const loaded: ManuscriptParagraph[] = [];
  let cursor = 0;
  for (const raw of file.split("\n\n")) {
    const text = raw.trim();
    if (text.length > 0) {
      const startOffset = cursor + (raw.length - raw.trimStart().length);
      loaded.push({ text, startOffset, endOffset: startOffset + text.length });
    }
    cursor += raw.length + 2;
  }
  return { content: file, paragraphs: loaded };
})();

const AGENT_BY_ID = new Map<string, (typeof CONTINUITY_AGENTS)[number]>(CONTINUITY_AGENTS.map((a) => [a.id, a]));
type Level = Exclude<Strictness, "off">;

interface CatchSeed {
  id: string;
  agent: string;
  type: string;
  canonRef: string;
  severity: "major" | "minor";
  confidence: number;
  minStrictness: "gentle" | "standard";
  sentence: string;
}

// The owner's repro comes FIRST, then the further implicit catches (different
// cue-table entries), then the false-positive-guard firing sides.
const CATCHES: CatchSeed[] = [
  {
    id: "IC1",
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRef: "canon_rule_magic_memory",
    severity: "major",
    confidence: 0.95,
    minStrictness: "gentle",
    sentence: "Mira cast a powerful spell and remembered every detail of it afterward.",
  },
  {
    id: "IC2",
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRef: "canon_rule_magic_memory",
    severity: "major",
    confidence: 0.95,
    minStrictness: "gentle",
    sentence: "She wove the warding circle at dusk and kept every memory she had.",
  },
  {
    id: "IC3",
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRef: "canon_rule_magic_memory",
    severity: "major",
    confidence: 0.95,
    minStrictness: "gentle",
    sentence: "Daven invoked the old rite and recalled every detail of the working.",
  },
  {
    id: "IC4",
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRef: "canon_rule_magic_memory",
    severity: "major",
    confidence: 0.95,
    minStrictness: "gentle",
    sentence: "The hedge-witch channelled the storm's power and nothing was lost of her own mind.",
  },
  {
    id: "G1",
    agent: "canon-lore",
    type: "canon-contradiction",
    canonRef: "canon_fact_blackout",
    severity: "minor",
    confidence: 0.8,
    minStrictness: "standard",
    sentence: "The capital blazed with light during the blackout.",
  },
  {
    id: "G2",
    agent: "canon-lore",
    type: "canon-contradiction",
    canonRef: "canon_fact_north_wolves",
    severity: "minor",
    confidence: 0.8,
    minStrictness: "standard",
    sentence: "The north wolves did not hunt in packs that spring.",
  },
  {
    id: "G3",
    agent: "canon-lore",
    type: "canon-contradiction",
    canonRef: "canon_fact_bridge_watch",
    severity: "minor",
    confidence: 0.8,
    minStrictness: "standard",
    sentence: "The bridge watch changed at 15 past each hour.",
  },
];

// The four owner false-positive classes plus the clean passages: silence for
// every continuity agent at every level.
const SILENCES: { id: string; class: string; sentence: string }[] = [
  { id: "FP1", class: "token collision (light in every window)", sentence: "Light burned in every window that night." },
  { id: "FP2", class: "stray numeral (1 vs canon 30)", sentence: "She waited 1 hour on the bridge." },
  { id: "FP3", class: "negation on shared keywords (wolves)", sentence: "The north wolves did not come down from the hills that spring." },
  { id: "FP4", class: "verbatim canon agreement", sentence: "The gate was not merely symbolic: the Weeping Gate is the only gate in the city's north wall, and it is sealed since the siege." },
  { id: "FP5", class: "confirmed-setting co-mention", sentence: "They climbed past the dark stair to the lamp room, where a window threw light on the water." },
  { id: "C1", class: "clean: casting alone", sentence: "Mira cast a ward over the harbor map before dawn." },
  { id: "C2", class: "clean: remembering alone", sentence: "She remembered every detail of the tide tables." },
  { id: "C3", class: "clean: paying the cost", sentence: "She paid a memory for the small ward, as the rule demands." },
  { id: "C4", class: "clean: spell-book mention", sentence: "She remembered every detail of the spell book." },
];

function paragraphOf(sentence: string): ManuscriptParagraph {
  const matches = paragraphs.filter((p) => p.text === sentence);
  assert.equal(matches.length, 1, `scenario sentence must match exactly one paragraph: '${sentence}'`);
  return matches[0];
}

async function analyze(agentId: string, paragraph: ManuscriptParagraph, strictness?: Level): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  return (await runAnalyzeTool(agent, store, {
    projectId: "proof-implicit",
    chunk: {
      text: paragraph.text,
      file: CH5_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    },
    ...(strictness ? { strictness } : {}),
  })) as AnalyzeToolResult;
}

test("proof-implicit fixtures seed the dedicated project alongside the increment-1 projects", async () => {
  assert.ok(projectIds.includes("proof-implicit"), "the loader emits the new fixture project");
  assert.deepEqual(skipped, [], "no fixture is skipped or malformed");
  assert.equal(projectIds[projectIds.length - 1], "proof-strict", "the loader's emission order keeps the existing tail");
  const snapshot = await store.read("proof-implicit");
  const magicRule = snapshot.entries.find((e) => e.id === "canon_rule_magic_memory");
  assert.ok(magicRule?.locked, "the implicit repro contradicts the locked memory rule");
  assert.equal(magicRule?.kind, "rule", "the flagship entry is rule-kind");
  const settings = await store.settings("proof-implicit");
  assert.equal(settings.agents.find((s) => s.agentId === "canon-lore")?.strictness, "standard");
  assert.equal(settings.agents.find((s) => s.agentId === "canon-lore")?.enabled, true);
});

test("ch5 maps every paragraph to exactly one scenario and starts with the owner's repro", () => {
  const texts = paragraphs.map((p) => p.text);
  assert.equal(texts.length, CATCHES.length + SILENCES.length, "every paragraph belongs to a scenario");
  assert.match(
    texts[0],
    /^Mira cast a powerful spell and remembered every detail of it afterward\.$/,
    "the owner's repro is the first paragraph",
  );
  for (const seed of [...CATCHES, ...SILENCES]) paragraphOf(seed.sentence);
  for (const paragraph of paragraphs) {
    assert.equal(content.slice(paragraph.startOffset, paragraph.endOffset), paragraph.text, "offsets slice the real file");
    assert.match(paragraph.text, /^[A-Z]/, "paragraph starts like prose");
    assert.ok(paragraph.text.endsWith("."), "paragraph ends with a period");
    assert.ok(!/[.!?]/.test(paragraph.text.slice(0, -1)), "paragraph is a single sentence");
  }
});

test("catch table at standard: implicit catches and guard firing-sides produce their exact finding", async () => {
  for (const seed of CATCHES) {
    const paragraph = paragraphOf(seed.sentence);
    const result = await analyze(seed.agent, paragraph);
    assert.equal(result.invoked, true, `${seed.id}: agent invoked`);
    assert.equal(result.strictness, "standard", `${seed.id}: project strictness applied`);
    const findings = (result.findings ?? []) as Finding[];
    assert.equal(findings.length, 1, `${seed.id}: exactly one finding, got ${JSON.stringify(findings.map((f) => f.type))}`);
    const finding = findings[0];
    assert.equal(finding.agent, seed.agent, `${seed.id}: agent matches`);
    assert.equal(finding.type, seed.type, `${seed.id}: type matches`);
    assert.deepEqual([...finding.canonRefs].sort(), [seed.canonRef], `${seed.id}: canonRefs match`);
    assert.equal(finding.severity, seed.severity, `${seed.id}: severity matches`);
    assert.equal(finding.confidence, seed.confidence, `${seed.id}: confidence matches`);
    assert.equal(finding.minStrictness, seed.minStrictness, `${seed.id}: minStrictness matches`);
    assert.equal(finding.quote, seed.sentence, `${seed.id}: quote is the seeded sentence`);
    assert.equal(finding.location.file, CH5_LABEL, `${seed.id}: anchored to ch5`);
    assert.equal(
      content.slice(finding.location.startOffset, finding.location.endOffset),
      finding.quote,
      `${seed.id}: offsets slice exactly from the ch5 file`,
    );
    assert.deepEqual(validateFinding(finding), [], `${seed.id}: finding schema-valid`);
  }
});

test("the locked-rule implicit catches surface at gentle as well (gentle-eligible)", async () => {
  for (const seed of CATCHES.filter((s) => s.type === "canon-implicit-contradiction")) {
    const result = await analyze(seed.agent, paragraphOf(seed.sentence), "gentle");
    const findings = (result.findings ?? []) as Finding[];
    assert.equal(findings.length, 1, `${seed.id}: the locked implicit contradiction reaches gentle`);
    assert.equal(findings[0].type, seed.type);
  }
  for (const seed of CATCHES.filter((s) => s.type !== "canon-implicit-contradiction")) {
    const result = await analyze(seed.agent, paragraphOf(seed.sentence), "gentle");
    assert.deepEqual(result.findings ?? [], [], `${seed.id}: minor guard-side findings stay below the gentle floor`);
  }
});

test("owner false-positive classes and clean passages stay silent for every agent at every level", async () => {
  for (const seed of SILENCES) {
    const paragraph = paragraphOf(seed.sentence);
    for (const agentId of AGENT_BY_ID.keys()) {
      for (const level of ["gentle", "standard", "strict"] as const) {
        const result = await analyze(agentId, paragraph, level);
        assert.deepEqual(
          result.findings ?? [],
          [],
          `${seed.id} (${seed.class}) must stay silent for ${agentId} at ${level}`,
        );
      }
    }
  }
});

test("determinism: two identical ch5 passes yield identical finding tables", async () => {
  const table = async () => {
    const rows: unknown[] = [];
    for (const seed of [...CATCHES, ...SILENCES]) {
      const paragraph = paragraphOf(seed.sentence);
      for (const agentId of AGENT_BY_ID.keys()) {
        for (const level of ["gentle", "standard", "strict"] as const) {
          const result = await analyze(agentId, paragraph, level);
          rows.push({
            seed: seed.id,
            agentId,
            level,
            invoked: result.invoked,
            findings: ((result.findings ?? []) as Finding[]).map((f) => ({
              type: f.type,
              severity: f.severity,
              confidence: f.confidence,
              minStrictness: f.minStrictness,
              canonRefs: [...f.canonRefs].sort(),
              location: { startOffset: f.location.startOffset, endOffset: f.location.endOffset },
              quote: f.quote,
            })),
          });
        }
      }
    }
    return rows;
  };
  const first = await table();
  const second = await table();
  assert.ok(first.length > 0);
  assert.deepEqual(second, first, "finding tables are identical across runs");
});
