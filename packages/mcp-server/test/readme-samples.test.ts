import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { defaultFixturesDir, loadFixtures } from "../src/store.js";
import { validateFinding } from "../src/validate.js";

const { store } = loadFixtures(defaultFixturesDir());

interface Sample {
  id: string;
  text: string;
  agent: string;
  type: string;
  canonRef: string;
}

// One row per "try this" sentence in packages/mcp-server/README.md. The
// sentences are duplicated verbatim on purpose: this test fails when the
// README promises something the engine does not actually catch, and the
// README fails CI-side review when a sample disappears from here.
const README_SAMPLES: Sample[] = [
  {
    id: "antonym-swap",
    text: "Mira pushed through the Weeping Gate on the city wall, and found it standing open.",
    agent: "canon-lore",
    type: "canon-contradiction",
    canonRef: "canon_fact_weeping_gate",
  },
  {
    id: "negation-polarity",
    text: "The Weeping Gate is not the only gate in the city wall.",
    agent: "canon-lore",
    type: "canon-contradiction",
    canonRef: "canon_fact_weeping_gate",
  },
  {
    id: "numeric-mismatch",
    text: "Daven swore the siege of the city lasted only 3 years.",
    agent: "canon-lore",
    type: "canon-contradiction",
    canonRef: "canon_fact_siege_years",
  },
  {
    id: "implicit-full-retention",
    text: "She cast the ward and remembered every detail of it afterward.",
    agent: "canon-lore",
    type: "canon-implicit-contradiction",
    canonRef: "canon_rule_magic_memory",
  },
  {
    id: "character-recovery-cue",
    text: "Daven flexed his sprained wrist, which had healed nicely since the fall.",
    agent: "character-consistency",
    type: "injury-contradiction",
    canonRef: "char_daven",
  },
];

// The former known-limit repro from the README: remembering every detail
// after a spell contradicts the locked memory-cost rule without an explicit
// negation, antonym or numeral. Since catch-implicit-contradictions-in-matchers
// landed, the engine flags it as a canon-implicit-contradiction; this test
// and the README known-limits section moved together with the engine.
const KNOWN_LIMIT_REPRO = "She cast the ward and remembered every detail of it afterward.";

function sampleChunk(text: string): { text: string; file: string; startOffset: number; endOffset: number } {
  return { text, file: "demo/readme-samples.md", startOffset: 0, endOffset: text.length };
}

async function analyzeWithAllAgents(text: string): Promise<Map<string, AnalyzeToolResult>> {
  const results = new Map<string, AnalyzeToolResult>();
  for (const agent of CONTINUITY_AGENTS) {
    const result = await runAnalyzeTool(agent, store, { projectId: "demo", chunk: sampleChunk(text) });
    results.set(agent.id, result as AnalyzeToolResult);
  }
  return results;
}

test("every README 'try this' sample produces exactly its documented finding at standard", async () => {
  for (const sample of README_SAMPLES) {
    const results = await analyzeWithAllAgents(sample.text);
    for (const [agentId, result] of results) {
      assert.equal(result.invoked, true, `${sample.id}: ${agentId} invoked`);
      assert.equal(result.strictness, "standard", `${sample.id}: ${agentId} runs at the project default`);
      const findings = (result.findings ?? []) as Finding[];
      if (agentId === sample.agent) {
        assert.equal(findings.length, 1, `${sample.id}: ${agentId} returns exactly one finding`);
        const finding = findings[0];
        assert.equal(finding.agent, sample.agent, `${sample.id}: agent matches the README`);
        assert.equal(finding.type, sample.type, `${sample.id}: finding type matches the README`);
        assert.ok(
          finding.canonRefs.includes(sample.canonRef),
          `${sample.id}: canonRefs include ${sample.canonRef}`,
        );
        assert.equal(finding.quote, sample.text, `${sample.id}: finding quotes the sample sentence`);
        assert.deepEqual(validateFinding(finding), [], `${sample.id}: finding schema-valid`);
      } else {
        assert.deepEqual(findings, [], `${sample.id}: ${agentId} stays silent`);
      }
    }
  }
});

test("README sample findings are deterministic across repeated runs (ids and timestamps may vary)", async () => {
  const stable = (results: Map<string, AnalyzeToolResult>) =>
    [...results.entries()].map(([agentId, result]) => ({
      agentId,
      findings: ((result.findings ?? []) as Finding[]).map((finding) => ({
        agent: finding.agent,
        type: finding.type,
        severity: finding.severity,
        confidence: finding.confidence,
        minStrictness: finding.minStrictness,
        canonRefs: [...finding.canonRefs].sort(),
        quote: finding.quote,
        location: { file: finding.location.file, startOffset: finding.location.startOffset },
      })),
    }));
  for (const sample of README_SAMPLES) {
    const first = stable(await analyzeWithAllAgents(sample.text));
    const second = stable(await analyzeWithAllAgents(sample.text));
    assert.deepEqual(second, first, `${sample.id}: findings are identical across runs`);
  }
});

test("the former known-limit repro is now caught as an implicit contradiction", async () => {
  const results = await analyzeWithAllAgents(KNOWN_LIMIT_REPRO);
  for (const [agentId, result] of results) {
    if (agentId === "canon-lore") {
      const findings = (result.findings ?? []) as Finding[];
      assert.equal(findings.length, 1, "canon-lore flags the implicit full-retention contradiction");
      assert.equal(findings[0].type, "canon-implicit-contradiction");
      assert.equal(findings[0].severity, "major", "the memory rule is writer-locked");
      assert.equal(findings[0].confidence, 0.95);
      assert.equal(findings[0].minStrictness, "gentle");
      assert.deepEqual(findings[0].canonRefs, ["canon_rule_magic_memory"]);
      assert.deepEqual(validateFinding(findings[0]), [], "finding schema-valid");
    } else {
      assert.deepEqual(result.findings, [], `${agentId} stays silent on the repro`);
    }
  }
});
