import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Finding, Strictness } from "@lorewardens/core";
import { ALL_AGENTS, CONTINUITY_AGENTS, LANGUAGE_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "@lorewardens/mcp-server/dist/src/tools.js";
import { loadFixtures } from "@lorewardens/mcp-server/dist/src/store.js";
import { validateFinding } from "@lorewardens/mcp-server/dist/src/validate.js";
import { defaultFixturesDir } from "../src/index.js";

const fixturesDir = defaultFixturesDir();
const { store, projectIds, skipped } = loadFixtures(fixturesDir);

const MANUSCRIPT_RELATIVE_PATH = "manuscript/ch-language.md";
const MANUSCRIPT_FILE_LABEL = MANUSCRIPT_RELATIVE_PATH;
const PROJECT = "proof-language";

interface Paragraph {
  text: string;
  startOffset: number;
  endOffset: number;
}

const content = readFileSync(`${fixturesDir.replace(/\/$/, "")}/${MANUSCRIPT_RELATIVE_PATH}`, "utf8");
const paragraphs: Paragraph[] = [];
{
  let cursor = 0;
  for (const raw of content.split("\n\n")) {
    const text = raw.trim();
    if (text.length > 0) {
      const startOffset = cursor + (raw.length - raw.trimStart().length);
      paragraphs.push({ text, startOffset, endOffset: startOffset + text.length });
    }
    cursor += raw.length + 2;
  }
}

function paragraphFor(prefix: string): Paragraph {
  const matches = paragraphs.filter((p) => p.text.startsWith(prefix));
  assert.equal(matches.length, 1, `scenario prefix must match exactly one paragraph: '${prefix}'`);
  return matches[0];
}

const AGENT_BY_ID = new Map<string, (typeof ALL_AGENTS)[number]>(ALL_AGENTS.map((a) => [a.id, a]));

interface SeededError {
  id: string;
  agent: string;
  type: string;
  canonRef?: string;
  severity: "info" | "minor";
  prefix: string;
}

// One row per seeded scenario in ch-language.md. `prefix` is the stable
// exact-text prefix that maps the scenario to its paragraph; canonRef is the
// canon id the target finding must reference (empty canonRefs stay empty).
const SEED_ERRORS: SeededError[] = [
  { id: "G1", agent: "grammar-mechanics", type: "grammar-mechanical-error", severity: "minor", prefix: "The herald read the the proclamation" },
  { id: "G2", agent: "grammar-mechanics", type: "grammar-mechanical-error", severity: "minor", prefix: "She counted the coins" },
  { id: "G3", agent: "grammar-mechanics", type: "grammar-unbalanced-quotes", severity: "minor", prefix: '"Room\'s warm," the innkeeper' },
  { id: "V1", agent: "vocabulary-repetition", type: "vocabulary-overuse", severity: "info", prefix: "The old lantern by the docks" },
  { id: "V2", agent: "vocabulary-repetition", type: "vocabulary-echo", severity: "info", prefix: "He whispered the name again" },
  { id: "S1", agent: "style-voice", type: "style-rhythm-shift", severity: "info", prefix: "The bell rang. Servants scattered." },
  { id: "S2", agent: "style-voice", type: "style-formality-shift", severity: "info", prefix: "The council convened at dawn." },
  { id: "CV1", agent: "character-voice", type: "voice-drift", canonRef: "char_elinor", severity: "minor", prefix: "Elinor smoothed the map" },
  { id: "CV2", agent: "character-voice", type: "voice-drift", canonRef: "char_tam", severity: "minor", prefix: "Tam crossed his arms" },
  { id: "P1", agent: "period-dialect", type: "period-anachronism", canonRef: "canon_rule_period_voice", severity: "minor", prefix: "The watchman spoke into his telephone" },
  { id: "P2", agent: "period-dialect", type: "period-register-mismatch", canonRef: "canon_rule_period_voice", severity: "info", prefix: "You gonna tell me the ferry" },
];

// The strict-only notes: absent at standard, added at strict.
const STRICT_ONLY_IDS = new Set(["V2", "S1"]);

const CLEAN_PREFIXES = [
  "Elinor and Tam walked the wall road",
  "Marda had warned them about the ford",
  "Wenna said she'd mind the stall",
  "The seneschal read the tolls",
];

type Level = Exclude<Strictness, "off">;

async function analyze(agentId: string, paragraph: Paragraph, strictness?: Level): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  return (await runAnalyzeTool(agent, store, {
    projectId: PROJECT,
    chunk: {
      text: paragraph.text,
      file: MANUSCRIPT_FILE_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    },
    ...(strictness ? { strictness } : {}),
  })) as AnalyzeToolResult;
}

test("the proof fixture directory seeds all four projects without skips", () => {
  assert.deepEqual(projectIds, ["proof", "proof-language", "proof-narrative", "proof-strict"]);
  assert.deepEqual(skipped, []);
});

test("modular enablement: the continuity roster is off for proof-language, the language roster on", async () => {
  const settings = await store.settings(PROJECT);
  for (const agent of CONTINUITY_AGENTS) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, false, `${agent.id} is disabled for proof-language`);
  }
  for (const agent of LANGUAGE_AGENTS) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, true, `${agent.id} is enabled for proof-language`);
    assert.equal(agentSettings.strictness, "standard");
  }
});

test("catch table: every seeded scenario produces exactly its finding at standard (strict-only notes stay silent)", async () => {
  for (const seed of SEED_ERRORS) {
    const paragraph = paragraphFor(seed.prefix);
    for (const agent of LANGUAGE_AGENTS) {
      const result = await analyze(agent.id, paragraph);
      assert.equal(result.invoked, true, `${seed.id}: ${agent.id} invoked`);
      const findings = (result.findings ?? []) as Finding[];
      if (agent.id !== seed.agent) {
        assert.deepEqual(findings, [], `${seed.id}: ${agent.id} stays silent`);
        continue;
      }
      if (STRICT_ONLY_IDS.has(seed.id)) {
        assert.deepEqual(findings, [], `${seed.id}: strict-only note stays below the standard floor`);
        continue;
      }
      assert.equal(findings.length, 1, `${seed.id}: exactly one finding`);
      const finding = findings[0];
      assert.equal(finding.agent, seed.agent, `${seed.id}: agent`);
      assert.equal(finding.type, seed.type, `${seed.id}: type`);
      assert.equal(finding.severity, seed.severity, `${seed.id}: severity`);
      if (seed.canonRef) {
        assert.ok(finding.canonRefs.includes(seed.canonRef), `${seed.id}: canonRefs include ${seed.canonRef}`);
      } else {
        assert.deepEqual(finding.canonRefs, [], `${seed.id}: canonRefs stay empty`);
      }
      assert.ok(paragraph.text.includes(finding.quote), `${seed.id}: quote is an excerpt of the paragraph`);
      assert.deepEqual(validateFinding(finding), [], `${seed.id}: finding schema-valid`);
      const sliced = content.slice(finding.location.startOffset, finding.location.endOffset);
      assert.equal(sliced, finding.quote, `${seed.id}: offsets slice exactly from the manuscript file`);
    }
  }
});

test("gentle matrix: only the gentle-pinned mechanical-error seeds reach gentle", async () => {
  for (const seed of SEED_ERRORS) {
    const paragraph = paragraphFor(seed.prefix);
    const result = await analyze(seed.agent, paragraph, "gentle");
    const findings = (result.findings ?? []) as Finding[];
    if (seed.id === "G1" || seed.id === "G2") {
      assert.equal(findings.length, 1, `${seed.id} is gentle-eligible (grammar-mechanical-error, 0.9/gentle)`);
      assert.equal(findings[0].type, "grammar-mechanical-error");
    } else {
      assert.deepEqual(findings, [], `${seed.id} must not surface at gentle`);
    }
  }
});

test("strict adds the strict-only notes on top of the standard catch table", async () => {
  for (const seed of SEED_ERRORS) {
    const paragraph = paragraphFor(seed.prefix);
    const standard = ((await analyze(seed.agent, paragraph)).findings ?? []) as Finding[];
    const strict = ((await analyze(seed.agent, paragraph, "strict")).findings ?? []) as Finding[];
    if (STRICT_ONLY_IDS.has(seed.id)) {
      assert.deepEqual(standard, [], `${seed.id} is absent at standard`);
      assert.equal(strict.length, 1, `${seed.id} is added at strict`);
    } else {
      assert.equal(standard.length, 1, `${seed.id} present at standard`);
      assert.equal(strict.length, 1, `${seed.id} still present at strict`);
      assert.equal(strict[0].type, seed.type, `${seed.id}: same finding type at strict`);
    }
  }
});

test("clean paragraphs stay silent for all five language agents at every level", async () => {
  for (const prefix of CLEAN_PREFIXES) {
    const paragraph = paragraphFor(prefix);
    for (const level of ["gentle", "standard", "strict"] as const) {
      for (const agent of LANGUAGE_AGENTS) {
        const result = await analyze(agent.id, paragraph, level);
        const findings = (result.findings ?? []) as Finding[];
        assert.deepEqual(
          findings,
          [],
          `clean paragraph '${prefix}' must be silent for ${agent.id} at ${level}`,
        );
      }
    }
  }
});

test("language findings are deterministic across repeated passes (ids and timestamps may vary)", async () => {
  const stable = (result: AnalyzeToolResult) =>
    ((result.findings ?? []) as Finding[]).map((finding) => ({
      agent: finding.agent,
      type: finding.type,
      severity: finding.severity,
      confidence: finding.confidence,
      minStrictness: finding.minStrictness,
      canonRefs: [...finding.canonRefs].sort(),
      quote: finding.quote,
      location: { file: finding.location.file, startOffset: finding.location.startOffset },
    }));
  for (const seed of SEED_ERRORS) {
    const paragraph = paragraphFor(seed.prefix);
    const first = stable(await analyze(seed.agent, paragraph));
    const second = stable(await analyze(seed.agent, paragraph));
    assert.deepEqual(second, first, `${seed.id}: identical across passes`);
  }
});
