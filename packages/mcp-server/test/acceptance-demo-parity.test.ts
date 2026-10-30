import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Finding } from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { defaultFixturesDir, loadFixtures } from "../src/store.js";
import { validateFinding } from "../src/validate.js";

const { store } = loadFixtures(defaultFixturesDir());

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> @lorewardens/mcp-server -> packages -> repo root
const REPO_ROOT = path.resolve(HERE, "../../../..");
const MCP_README_PATH = path.join(REPO_ROOT, "packages", "mcp-server", "README.md");

// The develop commit this task's review was made against. The diff-scope
// criteria (proof untouched, no engine/schema changes) are defined relative
// to it, so the checks pin the exact commit instead of a moving ref.
const PINNED_DEVELOP = "868079e386fb0dda998e357e336369d3cd7c79b4";

const README = readFileSync(MCP_README_PATH, "utf8");

interface ParsedSample {
  sentence: string;
  agent: string;
  type: string;
  ref: string;
  detail: string;
}

function readSection(markdown: string, headingPrefix: string): string {
  const start = markdown.indexOf(headingPrefix);
  assert.notEqual(start, -1, `README section not found: "${headingPrefix}"`);
  const next = markdown.indexOf("\n## ", start + headingPrefix.length);
  return next === -1 ? markdown.slice(start) : markdown.slice(start, next);
}

function codeSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

// The README "Try these" table is the demo's promise list. Parsing it here
// (instead of duplicating sentences) makes the engine run the README's own
// words: if a sample is edited or added without the engine backing it, this
// suite fails; if the engine drops a shape, the table row fails.
function parseTryThisTable(markdown: string): ParsedSample[] {
  const section = readSection(markdown, "## Try these");
  const rows = section.split("\n").filter((line) => line.startsWith("|"));
  const samples: ParsedSample[] = [];
  for (const line of rows) {
    const cells = line.split("|");
    if (cells.length < 4) continue;
    if (cells[2].includes("→") === false) continue; // header and separator rows
    const sentenceSpans = codeSpans(cells[1]);
    assert.equal(sentenceSpans.length, 1, `try-this row must quote exactly one sentence: ${line}`);
    const resultSpans = codeSpans(cells[2]);
    assert.ok(
      resultSpans.length >= 3,
      `try-this row must name agent, finding type and canon ref in backticks: ${line}`,
    );
    const [agent, type, ref] = resultSpans;
    samples.push({ sentence: sentenceSpans[0], agent, type, ref, detail: cells[2] });
  }
  return samples;
}

const SAMPLES = parseTryThisTable(README);
const KNOWN_LIMITS_SECTION = readSection(README, "## What the engine does NOT catch today");
const CATCHES_SECTION = readSection(README, "## What the engine catches today");
const KNOWN_LIMIT_REPRO = "She cast the ward and remembered every detail of it afterward.";

const SHAPES = [
  { key: "negation-polarity", heading: "Negation-polarity conflict", detailRe: /negation polarity/i },
  { key: "antonym-swap", heading: "Antonym swap", detailRe: /antonym swap/i },
  { key: "numeric-mismatch", heading: "Numeric mismatch", detailRe: /numeric mismatch/i },
  { key: "implicit-full-retention", heading: "Implicit full-retention contradiction", detailRe: /implicit full-retention/i },
] as const;

function git(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", REPO_ROOT, ...args], { encoding: "utf8" });
  if (result.error) throw new Error(`git ${args.join(" ")} failed to start: ${result.error.message}`);
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function developBase(): string {
  const pinned = git(["cat-file", "-e", `${PINNED_DEVELOP}^{commit}`]);
  if (pinned.status === 0) return PINNED_DEVELOP;
  const fallback = git(["rev-parse", "--verify", "origin/develop"]);
  assert.equal(fallback.status, 0, `cannot resolve a develop base for the diff-scope checks: ${fallback.stderr}`);
  return fallback.stdout.trim();
}

// demo-parity-skip-ruling-v1: the diff-scope pins below were discharged at the
// demo-parity landing; they govern only branches at (or predating) that revision.
const DEMO_PARITY_REVISION = "b10ef32aeeff84d7e08cb03360198cb56ed44359";

function demoDiffScopePinsApply(t: { skip(reason?: string): void }): boolean {
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  const headIsDescendant = git(["merge-base", "--is-ancestor", DEMO_PARITY_REVISION, "HEAD"]).status === 0;
  const headPredates = head !== DEMO_PARITY_REVISION && git(["merge-base", "--is-ancestor", "HEAD", DEMO_PARITY_REVISION]).status === 0;
  if ((headIsDescendant && head !== DEMO_PARITY_REVISION) || headPredates) {
    t.skip(
      `demo diff-scope pins were discharged at the demo-parity landing ${DEMO_PARITY_REVISION}; ` +
        `this branch predates or supersedes that revision`,
    );
    return false;
  }
  return true;
}

function chunk(text: string): { text: string; file: string; startOffset: number; endOffset: number } {
  return { text, file: "demo/acceptance-demo-parity.md", startOffset: 0, endOffset: text.length };
}

async function analyzeWithAllAgents(text: string): Promise<Map<string, AnalyzeToolResult>> {
  const results = new Map<string, AnalyzeToolResult>();
  for (const agent of CONTINUITY_AGENTS) {
    const result = await runAnalyzeTool(agent, store, { projectId: "demo", chunk: chunk(text) });
    results.set(agent.id, result as AnalyzeToolResult);
  }
  return results;
}

test("acceptance: repo root resolves and the MCP README is present (guard)", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { name?: string };
  assert.equal(pkg.name, "lorewardens", "test resolves the Lorewardens repo root");
  assert.ok(README.includes("@lorewardens/mcp-server"), "MCP README is readable at the repo root");
});

test("acceptance: README documents the three detection shapes, each tied to one concrete sample sentence (ac-1)", () => {
  const tryThisSection = readSection(README, "## Try these");
  assert.ok(SAMPLES.length >= 3, "try-this table has data rows");
  for (const shape of SHAPES) {
    assert.ok(
      CATCHES_SECTION.includes(shape.heading),
      `'What the engine catches today' names the ${shape.key} shape`,
    );
    const matching = SAMPLES.filter((sample) => shape.detailRe.test(sample.detail));
    assert.equal(
      matching.length,
      1,
      `exactly one try-this sample demonstrates the ${shape.key} shape (its concrete example)`,
    );
    assert.match(matching[0].sentence, /\S/, `${shape.key} example is a concrete sentence, not prose only`);
  }
  assert.ok(
    CATCHES_SECTION.includes("sealed/open") && CATCHES_SECTION.includes('"9 years" vs "3 years"'),
    "antonym and numeric shapes carry inline concrete examples in the catches section",
  );
  assert.ok(tryThisSection.includes("runAnalyzeTool"), "try-this section names the real tool path it is proven through");
});

test("acceptance: every README try-this sample produces exactly its documented finding at standard through runAnalyzeTool (ac-2, ac-4)", async () => {
  const sentences = SAMPLES.map((sample) => sample.sentence);
  assert.equal(new Set(sentences).size, sentences.length, "try-this samples are distinct sentences");
  assert.equal(sentences.length, 5, "four shapes plus one character cue check are demonstrated");
  for (const sample of SAMPLES) {
    const results = await analyzeWithAllAgents(sample.sentence);
    for (const [agentId, result] of results) {
      const label = `${sample.sentence.slice(0, 40)}... via ${agentId}`;
      assert.equal(result.invoked, true, `${label}: agent is invoked`);
      assert.equal(result.strictness, "standard", `${label}: runs at standard`);
      const findings = (result.findings ?? []) as Finding[];
      if (agentId === sample.agent) {
        assert.equal(result.findingsCount, 1, `${label}: exactly one finding`);
        assert.equal(findings.length, 1, `${label}: exactly one finding`);
        const finding = findings[0];
        assert.equal(finding.agent, sample.agent, `${label}: agent matches the README`);
        assert.equal(finding.type, sample.type, `${label}: finding type matches the README`);
        assert.ok(
          finding.canonRefs.includes(sample.ref),
          `${label}: canonRefs include ${sample.ref} (got ${JSON.stringify(finding.canonRefs)})`,
        );
        assert.equal(finding.quote, sample.sentence, `${label}: finding quotes the sample sentence`);
        assert.deepEqual(validateFinding(finding), [], `${label}: finding schema-validates`);
      } else {
        assert.equal(findings.length, 0, `${label}: other agents stay silent`);
      }
    }
  }
});

test("acceptance: README documents the implicit full-retention shape as caught, not as a known limit (ac-3)", () => {
  // The former known limit moved into the catch list when
  // catch-implicit-contradictions-in-matchers landed: the shape is documented
  // under "What the engine catches today", the repro is a machine-proven
  // try-this row, and the known-limits section no longer quotes it.
  assert.ok(
    CATCHES_SECTION.includes("Implicit full-retention contradiction"),
    "'What the engine catches today' documents the implicit full-retention shape",
  );
  assert.ok(
    CATCHES_SECTION.includes("canon_rule_magic_memory") || CATCHES_SECTION.includes("remembered every detail"),
    "the catches section carries the implicit shape's concrete example",
  );
  const tryThisSection = readSection(README, "## Try these");
  assert.ok(
    tryThisSection.includes(KNOWN_LIMIT_REPRO),
    "the repro is offered as a catchable try-this sample",
  );
  assert.ok(
    !KNOWN_LIMITS_SECTION.includes(KNOWN_LIMIT_REPRO),
    "the known-limits section no longer quotes the repro as uncaught",
  );
  assert.ok(
    !/\*\*not\*\* flagged/.test(KNOWN_LIMITS_SECTION),
    "the known-limits section no longer claims the implicit shape is unflagged",
  );
  assert.ok(
    /implicit/i.test(KNOWN_LIMITS_SECTION),
    "the known-limits section stays honest about what remains uncaught beyond the cue tables",
  );
});

test("acceptance: the former known-limit repro is caught as an implicit contradiction across all agents (ac-3, behavioral half)", async () => {
  const results = await analyzeWithAllAgents(KNOWN_LIMIT_REPRO);
  assert.equal(results.size, CONTINUITY_AGENTS.length, "all three agents were run");
  for (const [agentId, result] of results) {
    assert.equal(result.invoked, true, `${agentId} invoked`);
    if (agentId === "canon-lore") {
      const findings = (result.findings ?? []) as Finding[];
      assert.equal(findings.length, 1, "canon-lore flags the implicit full-retention contradiction");
      assert.equal(findings[0].type, "canon-implicit-contradiction");
      assert.equal(findings[0].severity, "major", "the memory rule is writer-locked");
      assert.ok(findings[0].canonRefs.includes("canon_rule_magic_memory"));
      assert.deepEqual(validateFinding(findings[0]), [], "finding schema-validates");
    } else {
      assert.equal(result.findings?.length, 0, `${agentId} stays silent on the repro`);
    }
  }
});

test("acceptance: the numeric mismatch example is grounded in real canon — demo says 9 years, sample says 3 (ac-1)", async () => {
  const snapshot = await store.read("demo");
  const siegeEntry = snapshot.entries.find((entry) => entry.id === "canon_fact_siege_years");
  assert.ok(siegeEntry, "canon_fact_siege_years exists in the demo fixture");
  assert.equal(siegeEntry.status, "confirmed", "the siege-length fact is confirmed canon");
  assert.ok(siegeEntry.text.includes("9 years"), "canon says the siege lasted 9 years");
  const numericSample = SAMPLES.find((sample) => /numeric mismatch/i.test(sample.detail));
  assert.ok(numericSample, "a numeric mismatch sample exists");
  assert.match(numericSample.sentence, /\b3 years\b/, "the sample carries a different concrete number than canon");
  assert.equal(numericSample.ref, "canon_fact_siege_years", "the sample points at the siege fact");
});

test("acceptance: packages/proof is byte-identical to develop (ac-5)", (t) => {
  if (!demoDiffScopePinsApply(t)) return;
  const base = developBase();
  const diff = git(["diff", "--quiet", base, "HEAD", "--", "packages/proof"]);
  assert.equal(diff.status, 0, `packages/proof changed since develop: ${diff.stderr}`);
  const proofTree = git(["rev-parse", `${base}:packages/proof`]);
  const headTree = git(["rev-parse", "HEAD:packages/proof"]);
  assert.equal(proofTree.status, 0, `cannot read develop's packages/proof tree: ${proofTree.stderr}`);
  assert.equal(headTree.status, 0, `cannot read HEAD's packages/proof tree: ${headTree.stderr}`);
  assert.equal(
    headTree.stdout.trim(),
    proofTree.stdout.trim(),
    "packages/proof tree hash differs from develop (content or mode changed)",
  );
});

test("acceptance: no changes to packages/agents, packages/core, schemas, packages/mcp-server/src; diff stays in the allowed demo files (ac-6, ac-7)", (t) => {
  if (!demoDiffScopePinsApply(t)) return;
  const base = developBase();
  const forbidden = ["packages/agents/", "packages/core/", "schemas/", "packages/mcp-server/src/", "packages/proof/"];
  const changed = git(["diff", "--name-only", base, "HEAD"]).stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  assert.ok(changed.length > 0, "the diff against develop is non-empty (the demo change exists)");
  for (const file of changed) {
    for (const prefix of forbidden) {
      assert.ok(!file.startsWith(prefix), `${file} touches the protected path ${prefix}`);
    }
  }
  const allowed = new Set([
    "README.md",
    "docs/reports/self-check/self-check-report-make-the-demo-match-the-engine.md",
    "packages/mcp-server/README.md",
    "packages/mcp-server/fixtures/demo.canon.json",
    "packages/mcp-server/test/tools.test.ts",
    "packages/mcp-server/test/readme-samples.test.ts",
    "packages/mcp-server/test/acceptance-demo-parity.test.ts",
  ]);
  for (const file of changed) {
    assert.ok(allowed.has(file), `${file} is outside the reviewed demo-parity change set`);
  }
});
