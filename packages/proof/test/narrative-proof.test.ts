import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Finding, Strictness } from "@lorewardens/core";
import { ALL_AGENTS, CONTINUITY_AGENTS, LANGUAGE_AGENTS, NARRATIVE_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "@lorewardens/mcp-server/dist/src/tools.js";
import { loadFixtures } from "@lorewardens/mcp-server/dist/src/store.js";
import { validateFinding } from "@lorewardens/mcp-server/dist/src/validate.js";
import { defaultFixturesDir } from "../src/index.js";

const fixturesDir = defaultFixturesDir();
const { store, projectIds, skipped } = loadFixtures(fixturesDir);

const MANUSCRIPT_RELATIVE_PATH = "manuscript/ch-narrative.md";
const MANUSCRIPT_FILE_LABEL = MANUSCRIPT_RELATIVE_PATH;
const PROJECT = "proof-narrative";

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

interface SeededScenario {
  id: string;
  agent: string;
  type: string;
  canonRef?: string;
  severity: "info" | "minor" | "major";
  prefix: string;
  strictOnly?: boolean;
}

// One row per seeded scenario in ch-narrative.md. `prefix` is the stable
// exact-text prefix that maps the scenario to its paragraph; canonRef is the
// canon id the target finding must reference (empty canonRefs stay empty).
// Strict-only rows are silent at standard and added at strict.
const SEED_SCENARIOS: SeededScenario[] = [
  { id: "PT1", agent: "plot-thread", type: "plot-promise-conflict", canonRef: "canon_promise_blade", severity: "minor", prefix: "Osric told the council he would never guard" },
  { id: "PT2", agent: "plot-thread", type: "plot-promise-conflict", canonRef: "canon_promise_oath", severity: "major", prefix: "Gwyn did not protect the heir" },
  { id: "PT3", agent: "plot-thread", type: "plot-promise-planted", severity: "info", prefix: "She promised the ferryman", strictOnly: true },
  { id: "PT4", agent: "plot-thread", type: "plot-open-question", severity: "info", prefix: "No one knew why the beacon", strictOnly: true },
  { id: "PA1", agent: "pacing-tension", type: "pacing-static-stretch", severity: "info", prefix: "The road climbed away from the river", strictOnly: true },
  { id: "PA2", agent: "pacing-tension", type: "pacing-rushed-passage", severity: "info", prefix: "Boots on gravel", strictOnly: true },
  { id: "PA3", agent: "pacing-tension", type: "tension-abrupt-shift", severity: "info", prefix: "The gate slammed", strictOnly: true },
  { id: "POV1", agent: "pov-consistency", type: "pov-head-hop", canonRef: "canon_rule_pov_maren", severity: "minor", prefix: "Maren stood at the window" },
  { id: "POV2", agent: "pov-consistency", type: "pov-head-hop", canonRef: "char_osric", severity: "minor", prefix: "Gwyn remembered the night" },
  { id: "POV3", agent: "pov-consistency", type: "pov-distance-shift", severity: "minor", prefix: "I climbed the north stair" },
];

// The one locked escalation in the fixture: PT2 contradicts the writer's
// locked oath, so it is the only seed that reaches gentle.
const GENTLE_IDS = new Set(["PT2"]);

const CLEAN_PREFIXES = [
  "Maren fed the horses while Osric strained",
  "The ferry carries three riders, as the old law",
  "Osric asked the ferryman about the winter fares",
  "Suddenly the horn blew from the gate tower",
  "The bell rang. Doors opened.",
];

type Level = Exclude<Strictness, "off">;

async function analyze(agentId: string, projectId: string, paragraph: Paragraph, strictness?: Level): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  return (await runAnalyzeTool(agent, store, {
    projectId,
    chunk: {
      text: paragraph.text,
      file: MANUSCRIPT_FILE_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    },
    ...(strictness ? { strictness } : {}),
  })) as AnalyzeToolResult;
}

test("the proof fixture directory seeds the narrative project without skips", () => {
  assert.deepEqual(projectIds, ["proof", "proof-language", "proof-narrative", "proof-strict"]);
  assert.deepEqual(skipped, []);
});

test("modular enablement: continuity and language rosters are off for proof-narrative, the narrative roster on", async () => {
  const settings = await store.settings(PROJECT);
  for (const agent of [...CONTINUITY_AGENTS, ...LANGUAGE_AGENTS]) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, false, `${agent.id} is disabled for proof-narrative`);
  }
  for (const agent of NARRATIVE_AGENTS) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, true, `${agent.id} is enabled for proof-narrative`);
    assert.equal(agentSettings.strictness, "standard");
  }
});

test("modular disable: the three narrative agents are disabled in the three existing proof projects", async () => {
  for (const projectId of ["proof", "proof-language", "proof-strict"]) {
    const settings = await store.settings(projectId);
    for (const agent of NARRATIVE_AGENTS) {
      const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
      assert.ok(agentSettings, `${projectId}: ${agent.id} has an explicit settings entry`);
      assert.equal(agentSettings.enabled, false, `${projectId}: ${agent.id} is disabled`);
      const result = await analyze(agent.id, projectId, paragraphFor(CLEAN_PREFIXES[0]));
      assert.equal(result.invoked, false, `${projectId}: ${agent.id} is not invoked`);
      assert.deepEqual(result.findings, [], `${projectId}: ${agent.id} returns zero findings`);
      assert.match(result.reason ?? "", /disabled/, `${projectId}: ${agent.id} reports the disablement`);
    }
  }
});

test("catch table: every seeded scenario produces exactly its finding at standard (strict-only notes stay silent)", async () => {
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    for (const agent of NARRATIVE_AGENTS) {
      const result = await analyze(agent.id, PROJECT, paragraph);
      assert.equal(result.invoked, true, `${seed.id}: ${agent.id} invoked`);
      const findings = (result.findings ?? []) as Finding[];
      if (agent.id !== seed.agent) {
        assert.deepEqual(findings, [], `${seed.id}: ${agent.id} stays silent`);
        continue;
      }
      if (seed.strictOnly) {
        assert.deepEqual(findings, [], `${seed.id}: strict-only note stays below the standard floor`);
        continue;
      }
      assert.equal(findings.length, 1, `${seed.id}: exactly one finding`);
      const finding = findings[0];
      assert.equal(finding.agent, seed.agent, `${seed.id}: agent`);
      assert.equal(finding.type, seed.type, `${seed.id}: type`);
      assert.equal(finding.severity, seed.severity, `${seed.id}: severity`);
      assert.equal(finding.category, "narrative", `${seed.id}: category`);
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

test("gentle matrix: only the locked-promise escalation reaches gentle", async () => {
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    const result = await analyze(seed.agent, PROJECT, paragraph, "gentle");
    const findings = (result.findings ?? []) as Finding[];
    if (GENTLE_IDS.has(seed.id)) {
      assert.equal(findings.length, 1, `${seed.id} is gentle-eligible (locked promise, 0.95/gentle)`);
      assert.equal(findings[0].type, seed.type);
      assert.equal(findings[0].severity, "major");
    } else {
      assert.deepEqual(findings, [], `${seed.id} must not surface at gentle`);
    }
  }
});

test("strict adds the strict-only notes on top of the standard catch table", async () => {
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    for (const agent of NARRATIVE_AGENTS) {
      const standard = ((await analyze(agent.id, PROJECT, paragraph)).findings ?? []) as Finding[];
      const strict = ((await analyze(agent.id, PROJECT, paragraph, "strict")).findings ?? []) as Finding[];
      if (agent.id !== seed.agent) {
        assert.deepEqual(standard, [], `${seed.id}: ${agent.id} silent at standard`);
        assert.deepEqual(strict, [], `${seed.id}: ${agent.id} silent at strict`);
        continue;
      }
      if (seed.strictOnly) {
        assert.deepEqual(standard, [], `${seed.id} is absent at standard`);
        assert.equal(strict.length, 1, `${seed.id} is added at strict`);
        assert.equal(strict[0].type, seed.type, `${seed.id}: correct type at strict`);
      } else {
        assert.equal(standard.length, 1, `${seed.id} present at standard`);
        assert.equal(strict.length, 1, `${seed.id} still present at strict`);
        assert.equal(strict[0].type, seed.type, `${seed.id}: same finding type at strict`);
      }
    }
  }
});

test("clean paragraphs stay silent for all three narrative agents at every level", async () => {
  for (const prefix of CLEAN_PREFIXES) {
    const paragraph = paragraphFor(prefix);
    for (const level of ["gentle", "standard", "strict"] as const) {
      for (const agent of NARRATIVE_AGENTS) {
        const result = await analyze(agent.id, PROJECT, paragraph, level);
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

test("narrative findings are deterministic across repeated passes (ids and timestamps may vary)", async () => {
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
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    const first = stable(await analyze(seed.agent, PROJECT, paragraph));
    const second = stable(await analyze(seed.agent, PROJECT, paragraph));
    assert.deepEqual(second, first, `${seed.id}: identical across passes`);
  }
});
