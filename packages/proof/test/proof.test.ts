import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding, Strictness } from "@lorewardens/core";
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

const AGENT_BY_ID = new Map<string, (typeof CONTINUITY_AGENTS)[number]>(CONTINUITY_AGENTS.map((a) => [a.id, a]));
const AGENT_IDS = [...AGENT_BY_ID.keys()];
type Level = Exclude<Strictness, "off">;

interface SeededError {
  id: string;
  agent: string;
  type: string;
  canonRef: string;
  prefix: string;
}

// One row per seeded error in the manuscript. `prefix` is the stable
// exact-text prefix that maps the scenario to its paragraph; `canonRef` is
// the canon id the target finding must reference.
const SEED_ERRORS: SeededError[] = [
  { id: "E1", agent: "canon-lore", type: "canon-contradiction", canonRef: "canon_rule_magic_memory", prefix: "Mira cast the warding spell" },
  { id: "E2", agent: "canon-lore", type: "canon-contradiction", canonRef: "canon_fact_weeping_gate", prefix: "Daven pushed the Weeping Gate open" },
  { id: "E3", agent: "canon-lore", type: "canon-contradiction", canonRef: "canon_fact_karth_ferry", prefix: "The ferry crossing took 15 minutes" },
  { id: "E4", agent: "character-consistency", type: "trait-contradiction", canonRef: "char_daven", prefix: "Daven was careful with the instruments" },
  { id: "E5", agent: "character-consistency", type: "injury-contradiction", canonRef: "char_daven", prefix: "Daven flexed his wrist" },
  { id: "E6", agent: "character-consistency", type: "ability-contradiction", canonRef: "char_mira", prefix: "Mira admitted she had never surveyed" },
  { id: "E7", agent: "character-consistency", type: "knowledge-violation", canonRef: "char_daven", prefix: "Daven knew about the siege" },
  { id: "E8", agent: "timeline", type: "timeline-contradiction", canonRef: "ev_wall_survey", prefix: "The harbor lanterns were sketched" },
  { id: "E9", agent: "timeline", type: "timeline-contradiction", canonRef: "ev_siege", prefix: "Mira swore her survey" },
  { id: "E10", agent: "timeline", type: "unclear-time-jump", canonRef: "ev_wall_survey", prefix: "Mira meant to sketch the harbor lanterns" },
];

// Strict-optional checks: proven at strict (proof-strict project, options on)
// and proven silent at standard even in that project.
const STRICT_ONLY: SeededError[] = [
  { id: "S1", agent: "canon-lore", type: "canon-location-drift", canonRef: "canon_fact_astrolabe", prefix: "Daven moved the astrolabe" },
  { id: "S2", agent: "character-consistency", type: "relationship-drift", canonRef: "char_bren", prefix: "Bren and Oskar are rivals now" },
];

const CLEAN_PREFIXES = [
  "Daven and Calla walked the north wall",
  "Mira resumed her survey",
  "Daven guarded his sprained wrist",
  "Mira drew the wall's measurements",
  "The harbor master's ledger stayed",
  "Mira paid a memory",
];

function paragraphFor(prefix: string): ManuscriptParagraph {
  const matches = paragraphs.filter((p) => p.text.startsWith(prefix));
  assert.equal(matches.length, 1, `scenario prefix must match exactly one paragraph: '${prefix}'`);
  return matches[0];
}

async function analyze(
  agentId: string,
  projectId: string,
  paragraph: ManuscriptParagraph,
  strictness?: Level,
): Promise<AnalyzeToolResult> {
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

interface PassEntry {
  projectId: string;
  strictness: Level;
  paragraph: ManuscriptParagraph;
  result: AnalyzeToolResult;
}

/** Runs all three agents over every paragraph of the chapter at the given levels. */
async function fullPass(projectId: string, levels: Level[]): Promise<PassEntry[]> {
  const entries: PassEntry[] = [];
  for (const paragraph of paragraphs) {
    for (const agentId of AGENT_IDS) {
      for (const strictness of levels) {
        entries.push({
          projectId,
          strictness,
          paragraph,
          result: await analyze(agentId, projectId, paragraph, strictness),
        });
      }
    }
  }
  return entries;
}

function findingsOf(entries: PassEntry[]): { entry: PassEntry; finding: Finding }[] {
  const out: { entry: PassEntry; finding: Finding }[] = [];
  for (const entry of entries) {
    for (const finding of (entry.result.findings ?? []) as Finding[]) {
      out.push({ entry, finding });
    }
  }
  return out;
}

test("proof fixtures seed the two increment-1 projects plus proof-language", () => {
  assert.deepEqual(projectIds, ["proof", "proof-language", "proof-strict"]);
  assert.deepEqual(skipped, [], "no fixture is skipped or malformed");
});

test("project settings implement the strictness matrix: standard/options-off vs strict/options-on", async () => {
  const proof = await store.settings("proof");
  const strictProject = await store.settings("proof-strict");
  for (const agentId of AGENT_IDS) {
    const standard = proof.agents.find((s) => s.agentId === agentId);
    const strict = strictProject.agents.find((s) => s.agentId === agentId);
    assert.ok(standard && strict, `${agentId} configured in both projects`);
    assert.equal(standard.enabled, true);
    assert.equal(standard.strictness, "standard");
    assert.equal(strict.enabled, true);
    assert.equal(strict.strictness, "strict");
  }
  assert.equal(proof.agents.find((s) => s.agentId === "canon-lore")?.options?.objectLocationChecks, false);
  assert.equal(strictProject.agents.find((s) => s.agentId === "canon-lore")?.options?.objectLocationChecks, true);
  assert.equal(proof.agents.find((s) => s.agentId === "character-consistency")?.options?.relationshipState, false);
  assert.equal(strictProject.agents.find((s) => s.agentId === "character-consistency")?.options?.relationshipState, true);
});

test("proof-strict seeds the same canon content under its own projectId, with the siege locked", async () => {
  const proof = await store.read("proof");
  const strict = await store.read("proof-strict");
  const strip = (value: unknown): unknown => JSON.parse(JSON.stringify(value).replaceAll("proof-strict", "proof"));
  assert.deepEqual(strip(strict), strip(proof), "same canon content, own projectId");
  assert.equal(strict.projectId, "proof-strict");
  assert.equal(strict.events.find((e) => e.id === "ev_siege")?.locked, true, "the proof copy locks the siege event");
  assert.ok(strict.events.find((e) => e.id === "ev_siege")?.lockReason);
});

test("the manuscript maps every paragraph to exactly one scenario", () => {
  const seeded = [...SEED_ERRORS, ...STRICT_ONLY].map((s) => paragraphFor(s.prefix));
  const clean = CLEAN_PREFIXES.map((p) => paragraphFor(p));
  const texts = new Set([...seeded, ...clean].map((p) => p.text));
  assert.equal(texts.size, seeded.length + clean.length, "scenario prefixes resolve to distinct paragraphs");
  assert.equal(seeded.length + clean.length, paragraphs.length, "every paragraph belongs to a scenario");
  for (const paragraph of paragraphs) {
    assert.equal(
      content.slice(paragraph.startOffset, paragraph.endOffset),
      paragraph.text,
      "paragraph offsets slice the real file",
    );
  }
});

test("catch table at standard: every seeded error is caught by its target agent through the tool path", async () => {
  for (const seed of SEED_ERRORS) {
    const paragraph = paragraphFor(seed.prefix);
    const result = await analyze(seed.agent, "proof", paragraph);
    assert.equal(result.invoked, true, `${seed.id}: agent invoked`);
    assert.equal(result.strictness, "standard", `${seed.id}: project strictness applied`);
    const findings = (result.findings ?? []) as Finding[];
    const target = findings.find((f) => f.type === seed.type && f.canonRefs.includes(seed.canonRef));
    assert.ok(
      target,
      `${seed.id}: expected ${seed.type} referencing ${seed.canonRef}, got ${JSON.stringify(
        findings.map((f) => ({ agent: f.agent, type: f.type, canonRefs: f.canonRefs })),
      )}`,
    );
    if (target) {
      assert.equal(
        content.slice(target.location.startOffset, target.location.endOffset),
        target.quote,
        `${seed.id}: finding offsets slice the real manuscript`,
      );
    }
  }
});

test("strict-only checks (S1/S2) fire at strict and stay silent at standard even in the strict project", async () => {
  for (const seed of STRICT_ONLY) {
    const paragraph = paragraphFor(seed.prefix);
    const strictResult = await analyze(seed.agent, "proof-strict", paragraph);
    assert.equal(strictResult.invoked, true, `${seed.id}: agent invoked`);
    assert.equal(strictResult.strictness, "strict");
    const findings = (strictResult.findings ?? []) as Finding[];
    assert.ok(
      findings.some((f) => f.type === seed.type && f.canonRefs.includes(seed.canonRef)),
      `${seed.id}: expected ${seed.type} referencing ${seed.canonRef} at strict, got ${JSON.stringify(
        findings.map((f) => ({ agent: f.agent, type: f.type, canonRefs: f.canonRefs })),
      )}`,
    );
  }
  const s1 = await analyze("canon-lore", "proof-strict", paragraphFor("Daven moved the astrolabe"), "standard");
  assert.deepEqual(s1.findings ?? [], [], "S1 does not surface below strict");
  const s2 = await analyze("character-consistency", "proof-strict", paragraphFor("Bren and Oskar are rivals now"), "standard");
  assert.deepEqual(s2.findings ?? [], [], "S2 does not surface below strict");
});

test("strictness matrix at gentle: exactly the locked-severity seeds (E1, E9) surface", async () => {
  const surfaced: { seedId: string; finding: Finding }[] = [];
  for (const seed of [...SEED_ERRORS, ...STRICT_ONLY]) {
    const paragraph = paragraphFor(seed.prefix);
    for (const agentId of AGENT_IDS) {
      const result = await analyze(agentId, "proof", paragraph, "gentle");
      assert.equal(result.invoked, true, `${seed.id}/${agentId} invoked at gentle`);
      for (const finding of (result.findings ?? []) as Finding[]) {
        surfaced.push({ seedId: seed.id, finding });
      }
    }
  }
  assert.deepEqual(
    surfaced.map((s) => ({ seedId: s.seedId, agent: s.finding.agent, type: s.finding.type, canonRefs: [...s.finding.canonRefs].sort() })),
    [
      { seedId: "E1", agent: "canon-lore", type: "canon-contradiction", canonRefs: ["canon_rule_magic_memory"] },
      { seedId: "E9", agent: "timeline", type: "timeline-contradiction", canonRefs: ["ev_siege", "ev_wall_survey"] },
    ],
    "only the writer-locked seeds surface at gentle; nothing else from the seeded paragraphs",
  );
});

test("silence on clean passages at gentle, standard and strict (strict project with options enabled)", async () => {
  for (const prefix of CLEAN_PREFIXES) {
    const paragraph = paragraphFor(prefix);
    for (const agentId of AGENT_IDS) {
      for (const level of ["gentle", "standard"] as const) {
        const result = await analyze(agentId, "proof", paragraph, level);
        assert.deepEqual(
          result.findings ?? [],
          [],
          `clean passage '${prefix}' must stay silent for ${agentId} at ${level}`,
        );
      }
      const strictResult = await analyze(agentId, "proof-strict", paragraph, "strict");
      assert.deepEqual(
        strictResult.findings ?? [],
        [],
        `clean passage '${prefix}' must stay silent for ${agentId} at strict (strict project)`,
      );
    }
  }
});

test("every finding on the tool path is schema-valid and its offsets slice the real manuscript", async () => {
  const entries = [
    ...(await fullPass("proof", ["gentle", "standard"])),
    ...(await fullPass("proof-strict", ["gentle", "standard", "strict"])),
  ];
  const pairs = findingsOf(entries);
  assert.ok(pairs.length > 0, "the full pass produced findings to validate");
  for (const { entry, finding } of pairs) {
    assert.deepEqual(validateFinding(finding), [], "finding matches schemas/finding.schema.json");
    assert.equal(entry.result.invoked, true);
    assert.equal(finding.location.file, MANUSCRIPT_FILE_LABEL);
    assert.ok(
      finding.location.startOffset >= entry.paragraph.startOffset &&
        finding.location.endOffset <= entry.paragraph.endOffset,
      "finding offsets stay inside their chunk",
    );
    assert.equal(
      content.slice(finding.location.startOffset, finding.location.endOffset),
      finding.quote,
      "finding quote slices exactly from the manuscript file",
    );
  }
});

test("determinism: two identical passes yield identical finding tables (ids and timestamps may vary)", async () => {
  const table = (entries: PassEntry[]) =>
    findingsOf(entries).map(({ entry, finding }) => ({
      projectId: entry.projectId,
      level: entry.strictness,
      chunk: entry.paragraph.startOffset,
      agent: finding.agent,
      type: finding.type,
      severity: finding.severity,
      confidence: finding.confidence,
      minStrictness: finding.minStrictness,
      canonRefs: [...finding.canonRefs].sort(),
      location: {
        file: finding.location.file,
        startOffset: finding.location.startOffset,
        endOffset: finding.location.endOffset,
      },
      quote: finding.quote,
    }));

  const first = table([
    ...(await fullPass("proof", ["gentle", "standard"])),
    ...(await fullPass("proof-strict", ["gentle", "standard", "strict"])),
  ]);
  const second = table([
    ...(await fullPass("proof", ["gentle", "standard"])),
    ...(await fullPass("proof-strict", ["gentle", "standard", "strict"])),
  ]);
  assert.ok(first.length > 0);
  assert.deepEqual(second, first, "finding tables are identical across runs");
});
