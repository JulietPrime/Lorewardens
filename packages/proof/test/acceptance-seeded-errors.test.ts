import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Category, ContinuityAgentId, Finding, Severity, Strictness } from "@lorewardens/core";
import { surfacesAt } from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "@lorewardens/mcp-server/dist/src/tools.js";
import { loadFixtures } from "@lorewardens/mcp-server/dist/src/store.js";
import { validateFinding } from "@lorewardens/mcp-server/dist/src/validate.js";
import {
  defaultFixturesDir,
  loadManuscript,
  MANUSCRIPT_FILE_LABEL,
  type ManuscriptParagraph,
} from "../src/index.js";

const fixturesDir = defaultFixturesDir();
const { store, projectIds, skipped } = loadFixtures(fixturesDir);
const { content, paragraphs } = loadManuscript(fixturesDir);

const AGENT_BY_ID = new Map<string, (typeof CONTINUITY_AGENTS)[number]>(
  CONTINUITY_AGENTS.map((a) => [a.id, a]),
);
const AGENT_IDS = [...AGENT_BY_ID.keys()] as ContinuityAgentId[];
type Level = Exclude<Strictness, "off">;

interface SeedRow {
  id: string;
  category: Category;
  agent: ContinuityAgentId;
  type: string;
  canonRefs: string[];
  sentence: string;
  severity: Severity;
  confidence: number;
  minStrictness: "gentle" | "standard" | "strict";
  caughtAt: "standard" | "strict";
}

// Independent truth table for the seeded chapter, derived from the accepted
// specification: one row per seeded scenario, pinned down to the exact
// sentence, the complete canonRefs list, severity, confidence and the
// strictness level at which the finding declares itself.
const SEEDS: SeedRow[] = [
  {
    id: "E1", category: "canon", agent: "canon-lore", type: "canon-contradiction",
    canonRefs: ["canon_rule_magic_memory"],
    sentence: "Mira cast the warding spell without giving up a single memory.",
    severity: "major", confidence: 0.95, minStrictness: "gentle", caughtAt: "standard",
  },
  {
    id: "E2", category: "canon", agent: "canon-lore", type: "canon-contradiction",
    canonRefs: ["canon_fact_weeping_gate"],
    sentence: "Daven pushed the Weeping Gate open and slipped through into the darkness beyond.",
    severity: "minor", confidence: 0.8, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E3", category: "canon", agent: "canon-lore", type: "canon-contradiction",
    canonRefs: ["canon_fact_karth_ferry"],
    sentence: "The ferry crossing took 15 minutes that morning.",
    severity: "minor", confidence: 0.8, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E4", category: "character", agent: "character-consistency", type: "trait-contradiction",
    canonRefs: ["char_daven"],
    sentence: "Daven was careful with the instruments, tightening each screw twice.",
    severity: "minor", confidence: 0.75, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E5", category: "character", agent: "character-consistency", type: "injury-contradiction",
    canonRefs: ["char_daven"],
    sentence: "Daven flexed his wrist, fully healed after a week of rest.",
    severity: "minor", confidence: 0.8, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E6", category: "character", agent: "character-consistency", type: "ability-contradiction",
    canonRefs: ["char_mira"],
    sentence: "Mira admitted she had never surveyed a wall this old.",
    severity: "minor", confidence: 0.8, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E7", category: "character", agent: "character-consistency", type: "knowledge-violation",
    canonRefs: ["char_daven", "ev_siege"],
    sentence: "Daven knew about the siege before Calla ever spoke of it.",
    severity: "minor", confidence: 0.72, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E8", category: "timeline", agent: "timeline", type: "timeline-contradiction",
    canonRefs: ["ev_harbor_lanterns", "ev_wall_survey"],
    sentence: "The harbor lanterns were sketched before the survey of the north wall began, Mira swore to Calla.",
    severity: "minor", confidence: 0.8, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "E9", category: "timeline", agent: "timeline", type: "timeline-contradiction",
    canonRefs: ["ev_siege", "ev_wall_survey"],
    sentence: "Mira swore her survey of the north wall began before the siege, a claim Calla loved to correct.",
    severity: "major", confidence: 0.95, minStrictness: "gentle", caughtAt: "standard",
  },
  {
    id: "E10", category: "timeline", agent: "timeline", type: "unclear-time-jump",
    canonRefs: ["ev_harbor_lanterns", "ev_wall_survey"],
    sentence: "Mira meant to sketch the harbor lanterns sometime around her survey of the north wall.",
    severity: "minor", confidence: 0.7, minStrictness: "standard", caughtAt: "standard",
  },
  {
    id: "S1", category: "canon", agent: "canon-lore", type: "canon-location-drift",
    canonRefs: ["canon_fact_astrolabe"],
    sentence: "Daven moved the astrolabe to the lighthouse during the storm.",
    severity: "info", confidence: 0.55, minStrictness: "strict", caughtAt: "strict",
  },
  {
    id: "S2", category: "character", agent: "character-consistency", type: "relationship-drift",
    canonRefs: ["char_bren", "char_oskar"],
    sentence: "Bren and Oskar are rivals now, each claiming the same stretch of the river.",
    severity: "info", confidence: 0.55, minStrictness: "strict", caughtAt: "strict",
  },
];

const E_SEEDS = SEEDS.filter((s) => s.id.startsWith("E"));
const STRICT_ONLY = SEEDS.filter((s) => s.id.startsWith("S"));

// Clean intentional passages: they touch the same canon objects as the seeds
// (gate, survey, wrist, abilities, ferry, ledger, magic rule) in
// canon-consistent ways, so silence proves discrimination, not blindness.
const CLEAN_SENTENCES = [
  "Daven and Calla walked the north wall to the Weeping Gate and found it sealed, just as the city records promised.",
  "Mira resumed her survey of the north wall at first light, measuring every stone twice.",
  "Daven guarded his sprained wrist as he coiled the measuring line.",
  "Mira drew the wall's measurements onto her map with a steady hand.",
  "The harbor master's ledger stayed in the lighthouse where it had always rested.",
  "Mira paid a memory for the small ward she cast over her maps.",
];

// The documented chapter layout: seeds and clean passages interleaved.
const DOCUMENTED_ORDER: string[] = [
  "E1", "clean", "E2", "clean", "E3", "clean", "E4", "clean", "E5", "clean", "E6", "clean",
  "E7", "E8", "E9", "E10", "S1", "S2",
];

function sentenceFor(slot: string): string {
  const seed = SEEDS.find((s) => s.id === slot);
  if (!seed) throw new Error(`unknown scenario slot '${slot}'`);
  return seed.sentence;
}

function paragraphOf(sentence: string): ManuscriptParagraph {
  const matches = paragraphs.filter((p) => p.text === sentence);
  assert.equal(
    matches.length,
    1,
    `scenario sentence must match exactly one paragraph: '${sentence}'`,
  );
  return matches[0];
}

function orderedSentences(): string[] {
  const clean = [...CLEAN_SENTENCES];
  let cleanIndex = 0;
  return DOCUMENTED_ORDER.map((slot) => {
    if (slot === "clean") {
      const sentence = clean[cleanIndex++];
      if (sentence === undefined) throw new Error("more clean slots than clean sentences");
      return sentence;
    }
    return sentenceFor(slot);
  });
}

async function analyze(
  agentId: ContinuityAgentId,
  projectId: string,
  paragraph: ManuscriptParagraph,
  strictness?: Level,
): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  return await runAnalyzeTool(agent, store, {
    projectId,
    chunk: {
      text: paragraph.text,
      file: MANUSCRIPT_FILE_LABEL,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    },
    ...(strictness ? { strictness } : {}),
  });
}

/** Asserts a finding matches its spec row exactly and anchors to the real file. */
function assertFindingRow(seed: SeedRow, finding: Finding, paragraph: ManuscriptParagraph): void {
  assert.deepEqual(validateFinding(finding), [], `${seed.id}: finding matches schemas/finding.schema.json`);
  assert.equal(finding.agent, seed.agent, `${seed.id}: reported by the expected agent`);
  assert.equal(finding.category, seed.category, `${seed.id}: expected category`);
  assert.equal(finding.type, seed.type, `${seed.id}: expected finding type`);
  assert.deepEqual(
    [...finding.canonRefs].sort(),
    seed.canonRefs,
    `${seed.id}: canonRefs match the spec row exactly`,
  );
  assert.equal(finding.severity, seed.severity, `${seed.id}: expected severity`);
  assert.equal(finding.confidence, seed.confidence, `${seed.id}: expected confidence`);
  assert.equal(finding.minStrictness, seed.minStrictness, `${seed.id}: expected minStrictness`);
  assert.equal(finding.quote, seed.sentence, `${seed.id}: quote is the seeded sentence`);
  assert.equal(finding.location.file, MANUSCRIPT_FILE_LABEL, `${seed.id}: finding anchored to the manuscript`);
  assert.ok(
    finding.location.startOffset >= paragraph.startOffset &&
      finding.location.endOffset <= paragraph.endOffset,
    `${seed.id}: finding offsets stay inside their chunk`,
  );
  assert.equal(
    content.slice(finding.location.startOffset, finding.location.endOffset),
    finding.quote,
    `${seed.id}: finding offsets slice exactly from the manuscript file`,
  );
}

test("acceptance: the manuscript is exactly the documented seeded-error chapter (ac-1)", async () => {
  // Standing ruling v2 (additive): the deepEqual stays exact; the new
  // proof-implicit project from catch-implicit-contradictions-in-matchers is
  // appended in the loader's actual emission order (proof-implicit sorts
  // between "proof" and "proof-language").
  assert.deepEqual(projectIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"], "fixtures seed the two increment-1 projects plus the language, narrative and optional proof projects");
  assert.deepEqual(skipped, [], "no fixture is skipped or malformed");

  // Byte-exact layout: every documented slot resolves to its exact sentence,
  // in order, and covers every paragraph of the chapter.
  const documented = orderedSentences();
  assert.equal(paragraphs.length, DOCUMENTED_ORDER.length, "chapter has exactly the documented paragraphs");
  assert.deepEqual(
    paragraphs.map((p) => p.text),
    documented,
    "chapter paragraphs match the documented scenario sentences, in order",
  );

  // Natural writing: every paragraph is a single declarative sentence.
  for (const paragraph of paragraphs) {
    assert.match(paragraph.text, /^[A-Z]/, `paragraph starts like prose: '${paragraph.text}'`);
    assert.ok(paragraph.text.endsWith("."), `paragraph ends with a period: '${paragraph.text}'`);
    assert.ok(
      !/[.!?]/.test(paragraph.text.slice(0, -1)),
      `paragraph is a single sentence: '${paragraph.text}'`,
    );
  }

  // Category coverage: canon, character and timeline errors are all seeded;
  // the language/prose categories stay empty in this increment-1 suite, and
  // the narrative category stays empty too — the increment-1 suite must
  // assert it seeds NO narrative errors.
  const counts: Record<Category, number> = { canon: 0, character: 0, timeline: 0, language: 0, prose: 0, narrative: 0, optional: 0 };
  for (const seed of E_SEEDS) counts[seed.category] += 1;
  assert.deepEqual(counts, { canon: 3, character: 4, timeline: 3, language: 0, prose: 0, narrative: 0, optional: 0 });

  // The two locked seeds contradict canon the writer has actually locked.
  const snapshot = await store.read("proof");
  const magicRule = snapshot.entries.find((e) => e.id === "canon_rule_magic_memory");
  assert.ok(magicRule?.locked, "E1 contradicts locked canon (the magic-memory rule)");
  assert.ok(magicRule?.lockReason, "the locked rule carries the writer's lock reason");
  const siege = snapshot.events.find((e) => e.id === "ev_siege");
  assert.ok(siege?.locked, "E9 contradicts a locked timeline event (the siege)");
  assert.ok(siege?.lockReason, "the locked event carries the writer's lock reason");
});

test("acceptance: standard strictness catches every seeded error E1-E10 with its full spec row (ac-2)", async () => {
  for (const seed of E_SEEDS) {
    const paragraph = paragraphOf(seed.sentence);
    const result = await analyze(seed.agent, "proof", paragraph);
    assert.equal(result.invoked, true, `${seed.id}: agent invoked through the tool path`);
    assert.equal(result.agent, seed.agent, `${seed.id}: tool ran the expected agent`);
    assert.equal(result.strictness, "standard", `${seed.id}: project strictness (standard) applies`);
    const findings = (result.findings ?? []) as Finding[];
    assert.equal(result.findingsCount, findings.length, `${seed.id}: findingsCount agrees with findings`);
    const targets = findings.filter((f) => f.type === seed.type);
    assert.equal(
      targets.length,
      1,
      `${seed.id}: target agent reports exactly one ${seed.type}, got ${JSON.stringify(
        findings.map((f) => ({ type: f.type, canonRefs: f.canonRefs })),
      )}`,
    );
    assertFindingRow(seed, targets[0] as Finding, paragraph);
  }
});

test("acceptance: gentle surfaces exactly the two locked seeds across all agents (ac-5)", async () => {
  const surfaced: { seedId: string; finding: Finding }[] = [];
  for (const seed of SEEDS) {
    const paragraph = paragraphOf(seed.sentence);
    for (const agentId of AGENT_IDS) {
      const result = await analyze(agentId, "proof", paragraph, "gentle");
      assert.equal(result.invoked, true, `${seed.id}/${agentId}: agent invoked at gentle`);
      for (const finding of (result.findings ?? []) as Finding[]) {
        assert.equal(
          surfacesAt(finding, "gentle"),
          true,
          `${seed.id}: surfaced finding genuinely passes the gentle gate`,
        );
        surfaced.push({ seedId: seed.id, finding });
      }
    }
  }
  assert.deepEqual(
    surfaced.map((s) => ({
      seedId: s.seedId,
      agent: s.finding.agent,
      type: s.finding.type,
      severity: s.finding.severity,
      confidence: s.finding.confidence,
      canonRefs: [...s.finding.canonRefs].sort(),
      quote: s.finding.quote,
    })),
    [
      {
        seedId: "E1",
        agent: "canon-lore",
        type: "canon-contradiction",
        severity: "major",
        confidence: 0.95,
        canonRefs: ["canon_rule_magic_memory"],
        quote: "Mira cast the warding spell without giving up a single memory.",
      },
      {
        seedId: "E9",
        agent: "timeline",
        type: "timeline-contradiction",
        severity: "major",
        confidence: 0.95,
        canonRefs: ["ev_siege", "ev_wall_survey"],
        quote: "Mira swore her survey of the north wall began before the siege, a claim Calla loved to correct.",
      },
    ],
    "at gentle, exactly the writer-locked seeds (E1, E9) surface and nothing else",
  );
});

test("acceptance: strict-only S1/S2 fire only at strict and stay silent below it (ac-6)", async () => {
  for (const seed of STRICT_ONLY) {
    const paragraph = paragraphOf(seed.sentence);

    // Proven at strict: the target surfaces with strict-only metadata.
    const strictResult = await analyze(seed.agent, "proof-strict", paragraph, "strict");
    assert.equal(strictResult.invoked, true, `${seed.id}: agent invoked at strict`);
    assert.equal(strictResult.strictness, "strict", `${seed.id}: strictness echoed`);
    const findings = (strictResult.findings ?? []) as Finding[];
    const target = findings.find((f) => f.type === seed.type);
    assert.ok(
      target,
      `${seed.id}: expected ${seed.type} at strict, got ${JSON.stringify(
        findings.map((f) => ({ type: f.type, canonRefs: f.canonRefs })),
      )}`,
    );
    if (target) {
      assertFindingRow(seed, target, paragraph);
      // The finding itself declares strictness "strict"; the core gate keeps it
      // at strict and refuses it everywhere below.
      assert.equal(surfacesAt(target, "strict"), true, `${seed.id}: surfaces at strict`);
      assert.equal(surfacesAt(target, "standard"), false, `${seed.id}: silent at standard by declaration`);
      assert.equal(surfacesAt(target, "gentle"), false, `${seed.id}: silent at gentle by declaration`);
    }

    // Proven silent at standard, even in the strict project with options on.
    const standardResult = await analyze(seed.agent, "proof-strict", paragraph, "standard");
    assert.equal(standardResult.invoked, true, `${seed.id}: agent still runs at standard`);
    assert.deepEqual(
      standardResult.findings ?? [],
      [],
      `${seed.id}: nothing surfaces at standard in the strict project`,
    );
  }
});

test("acceptance: clean intentional passages stay silent at gentle, standard and strict (ac-3)", async () => {
  for (const sentence of CLEAN_SENTENCES) {
    const paragraph = paragraphOf(sentence);
    for (const agentId of AGENT_IDS) {
      const calls: [string, Level][] = [
        ["proof", "gentle"],
        ["proof", "standard"],
        ["proof-strict", "strict"],
      ];
      for (const [projectId, level] of calls) {
        const result = await analyze(agentId, projectId, paragraph, level);
        assert.equal(
          result.invoked,
          true,
          `clean passage '${sentence}' must actually be analyzed by ${agentId} at ${level}`,
        );
        assert.deepEqual(
          result.findings ?? [],
          [],
          `clean passage '${sentence}' must stay silent for ${agentId} at ${level}`,
        );
        assert.equal(result.findingsCount, 0, `clean passage '${sentence}': zero findings for ${agentId} at ${level}`);
      }
    }
  }
});

test("acceptance: the acceptance surface is deterministic across passes (ac-4)", async () => {
  interface SweepFinding {
    agent: string;
    type: string;
    severity: string;
    confidence: number;
    minStrictness: string;
    canonRefs: string[];
    location: { file: string; startOffset: number; endOffset: number };
    quote: string;
  }
  interface SweepRow {
    seedId: string;
    projectId: string;
    level: Level;
    agentCalled: string;
    chunkStart: number;
    invoked: boolean;
    findings: SweepFinding[];
  }

  async function sweep(): Promise<SweepRow[]> {
    const rows: SweepRow[] = [];
    for (const seed of SEEDS) {
      const paragraph = paragraphOf(seed.sentence);
      const projectId = seed.caughtAt === "strict" ? "proof-strict" : "proof";
      const levels: Level[] = seed.caughtAt === "strict" ? ["strict", "standard"] : ["standard", "gentle"];
      for (const level of levels) {
        const result = await analyze(seed.agent, projectId, paragraph, level);
        rows.push({
          seedId: seed.id,
          projectId,
          level,
          agentCalled: seed.agent,
          chunkStart: paragraph.startOffset,
          invoked: result.invoked,
          findings: ((result.findings ?? []) as Finding[])
            .map((f) => ({
              agent: f.agent,
              type: f.type,
              severity: f.severity,
              confidence: f.confidence,
              minStrictness: f.minStrictness,
              canonRefs: [...f.canonRefs].sort(),
              location: {
                file: f.location.file,
                startOffset: f.location.startOffset,
                endOffset: f.location.endOffset,
              },
              quote: f.quote,
            }))
            .sort((a, b) => a.type.localeCompare(b.type) || a.quote.localeCompare(b.quote)),
        });
      }
    }
    return rows;
  }

  const first = await sweep();
  const second = await sweep();
  assert.ok(first.length > 0, "the acceptance sweep ran");
  assert.ok(
    first.some((r) => r.findings.length > 0),
    "the acceptance sweep produced findings to compare",
  );
  assert.deepEqual(second, first, "two identical passes yield identical acceptance tables");
});

test("acceptance: proof sources are offline, dependency-clean and deterministic by construction (ac-7)", () => {
  // This file compiles to dist/test/, so the package sources live two levels up.
  const sourceRoot = new URL("../../", import.meta.url);

  // Scan every proof-package source file (src + test, including this suite).
  const scanned: { label: string; text: string }[] = [];
  for (const dir of ["src", "test"]) {
    const dirPath = new URL(`../../${dir}/`, import.meta.url);
    for (const file of readdirSync(fileURLToPath(dirPath))) {
      if (!file.endsWith(".ts")) continue;
      scanned.push({ label: `${dir}/${file}`, text: readFileSync(fileURLToPath(new URL(file, dirPath)), "utf8") });
    }
  }
  const labels = scanned.map((s) => s.label).sort();
  // Additive (standing ruling v2): the scan covers the whole proof package
  // including the ch5 implicit-contradiction suite and the calibration
  // corpus runner.
  assert.deepEqual(
    labels,
    ["src/index.ts", "test/acceptance-seeded-errors.test.ts", "test/calibration-corpus.test.ts", "test/implicit-proof.test.ts", "test/language-proof.test.ts", "test/light-proof.test.ts", "test/narrative-proof.test.ts", "test/proof.test.ts"],
    "the offline scan covers the whole proof package",
  );

  // Node builtin imports stay on the offline allowlist (fs/url read fixtures;
  // assert/test run the checks). No http, net, tls, dgram, dns, child_process.
  const ALLOWED_NODE_BUILTINS = new Set(["node:assert", "node:test", "node:fs", "node:url"]);
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](node:[\w/.-]+)["']/g;
  for (const { label, text } of scanned) {
    const builtins = [...text.matchAll(importPattern)].map((m) => m[1]);
    assert.ok(builtins.length > 0, `${label}: imports are scannable`);
    for (const specifier of builtins) {
      // Subpaths (node:assert/strict) count as their builtin family.
      const builtin = specifier.split("/")[0];
      assert.ok(
        ALLOWED_NODE_BUILTINS.has(builtin),
        `${label}: node builtin '${specifier}' is not on the offline allowlist`,
      );
    }
    assert.ok(!/\brequire\s*\(/.test(text), `${label}: no CommonJS require`);
  }

  // No outbound-call constructs anywhere in the proof sources. Patterns and
  // labels are word-split so this guard cannot match its own source text.
  const networkPatterns: [string, RegExp][] = [
    ["fetch call", /(?:^|[^\w.$])fetch\s*\(/],
    ["http(s).request call", /https?\.request\s*\(/],
    ["legacy XHR", /(?:XML)HttpRequest/],
    ["raw socket client", /(?:Web)Socket/],
    ["promise-based http client", /(?:und)ici/],
    ["promise-based http client", /(?:ax)ios/],
  ];
  const nondeterminismPatterns: [string, RegExp][] = [
    ["Math.random", /Math\.(?:random)\s*\(/],
    ["Date.now", /Date\.(?:now)\s*\(/],
    ["new Date", /new\s+(?:Date)\s*\(/],
  ];
  for (const { label, text } of scanned) {
    for (const [name, pattern] of [...networkPatterns, ...nondeterminismPatterns]) {
      assert.ok(!pattern.test(text), `${label}: must not contain ${name}`);
    }
  }

  // The proof package depends only on the workspace packages it proves; no
  // external runtime dependency can smuggle in network or nondeterminism.
  const manifest = JSON.parse(readFileSync(new URL("package.json", sourceRoot), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(
    Object.keys(manifest.dependencies).sort(),
    ["@lorewardens/agents", "@lorewardens/core", "@lorewardens/mcp-server"],
    "proof runtime dependencies are exactly the three workspace packages",
  );
  assert.deepEqual(
    Object.keys(manifest.devDependencies).sort(),
    ["@types/node", "typescript"],
    "proof dev dependencies are exactly the toolchain",
  );
});
