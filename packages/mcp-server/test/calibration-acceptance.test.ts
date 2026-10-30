// Independent acceptance suite for build-standing-agent-calibration-corpus.
//
// Covers the five accepted criteria (ac-1..ac-5) of the standing calibration
// corpus: the corpus structure in packages/proof/calibration/, the triage
// workflow documented in docs/calibration.md, the six seeded classes, the
// mechanical landing gate (corpus runner inside root `npm test`), and the
// growth/offline/repo-owned properties.
//
// This suite is written against the spec's acceptance criteria, not against
// the builder's runner: it re-derives the whole contract from the corpus
// files on disk and drives the REAL MCP tool path (runAnalyzeTool) exactly
// like the existing suites (established deep-import pattern, no mocks,
// offline). It does not import the builder's runner and changes no product
// code.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CanonSnapshot, Finding, ProjectSettings, Strictness } from "@lorewardens/core";
import { ALL_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { FixtureCanonStore } from "../src/store.js";
import { validateFinding } from "../src/validate.js";

// ---------------------------------------------------------------------------
// Paths. This file compiles to dist/test/, so the repo root is four levels up.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const CALIBRATION_DIR = join(REPO_ROOT, "packages", "proof", "calibration");
const STORIES_DIR = join(CALIBRATION_DIR, "stories");
const TRIAGE_DIR = join(CALIBRATION_DIR, "triage");
const CALIBRATION_DOC = join(REPO_ROOT, "docs", "calibration.md");
const CALIBRATION_README = join(CALIBRATION_DIR, "README.md");
const RUNNER_TEST = join(REPO_ROOT, "packages", "proof", "test", "calibration-corpus.test.ts");
const ROOT_PACKAGE_JSON = join(REPO_ROOT, "package.json");
const PROOF_PACKAGE_JSON = join(REPO_ROOT, "packages", "proof", "package.json");

function requireFile(path: string, what: string): string {
  assert.ok(existsSync(path), `${what} must exist at ${path}`);
  return readFileSync(path, "utf8");
}

// ---------------------------------------------------------------------------
// Manifest / triage shapes (the regression contract from the spec).
// ---------------------------------------------------------------------------

interface ExpectRow {
  agent: string;
  category: string;
  type: string;
  severity: string;
  confidence: number;
  minStrictness: Strictness;
  canonRefs: string[];
  message: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  suggestion: string | null;
}

interface Seed {
  id: string;
  class: string;
  kind: "catch" | "fp-guard" | "miss";
  paragraph: number;
  agent?: string;
  note?: string;
  expect?: ExpectRow | null;
}

interface Manifest {
  projectId: string;
  story: string;
  seeds: Seed[];
  cleanPassages: number[];
}

interface TriageItem {
  ref: string;
  verdict: string;
  note: string;
  action?: string;
}

interface TriageRecord {
  storyId: string;
  triagedAt: string;
  triagedBy: string;
  disclosure: { content: string; offline: string };
  items: TriageItem[];
}

interface Paragraph {
  text: string;
  startOffset: number;
  endOffset: number;
}

interface Story {
  id: string;
  canon: CanonSnapshot;
  settings: ProjectSettings;
  manifest: Manifest;
  triage: TriageRecord;
  content: string;
  paragraphs: Paragraph[];
  store: FixtureCanonStore;
  enabledAgentIds: string[];
  fileLabel: string;
}

// Identical paragraph convention to the existing proof suites and to
// docs/calibration.md: paragraphs are the non-empty blocks of story.md split
// on blank lines; numbers are 1-based; offsets are real file-relative spans.
function splitParagraphs(content: string): Paragraph[] {
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
  return paragraphs;
}

function readJson<T>(path: string): T {
  return JSON.parse(requireFile(path, "JSON file")) as T;
}

const STORY_IDS = readdirSync(STORIES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const AGENT_BY_ID = new Map<string, (typeof ALL_AGENTS)[number]>(ALL_AGENTS.map((a) => [a.id, a]));

type Level = Exclude<Strictness, "off">;
const LEVELS: Level[] = ["gentle", "standard", "strict"];

function loadStory(id: string): Story {
  const storyDir = join(STORIES_DIR, id);
  const canon = readJson<CanonSnapshot>(join(storyDir, "canon.json"));
  const settings = readJson<ProjectSettings>(join(storyDir, "settings.json"));
  const manifest = readJson<Manifest>(join(storyDir, "manifest.json"));
  const triage = readJson<TriageRecord>(join(TRIAGE_DIR, `${id}.triage.json`));
  const content = requireFile(join(storyDir, "story.md"), `story text for ${id}`);
  const enabledAgentIds = settings.agents.filter((a) => a.enabled).map((a) => a.agentId);
  return {
    id,
    canon,
    settings,
    manifest,
    triage,
    content,
    paragraphs: splitParagraphs(content),
    store: new FixtureCanonStore([{ snapshot: canon, settings }]),
    enabledAgentIds,
    fileLabel: `calibration/stories/${id}/story.md`,
  };
}

const STORIES: Story[] = STORY_IDS.map(loadStory);

function paragraphOf(story: Story, seed: Seed): Paragraph {
  assert.ok(
    Number.isInteger(seed.paragraph) && seed.paragraph >= 1 && seed.paragraph <= story.paragraphs.length,
    `${story.id}/${seed.id}: paragraph ${seed.paragraph} resolves inside story.md (${story.paragraphs.length} paragraphs)`,
  );
  return story.paragraphs[seed.paragraph - 1];
}

async function analyze(story: Story, agentId: string, paragraph: Paragraph, strictness: Level): Promise<AnalyzeToolResult> {
  const agent = AGENT_BY_ID.get(agentId);
  if (!agent) throw new Error(`unknown agent '${agentId}'`);
  return (await runAnalyzeTool(agent, story.store, {
    projectId: story.id,
    chunk: {
      text: paragraph.text,
      file: story.fileLabel,
      startOffset: paragraph.startOffset,
      endOffset: paragraph.endOffset,
    },
    strictness,
  })) as AnalyzeToolResult;
}

function findingsOf(result: AnalyzeToolResult): Finding[] {
  return (result.findings ?? []) as Finding[];
}

// ---------------------------------------------------------------------------
// ac-1 — corpus structure: repo-owned purpose-built stories, each paired
// with canon/settings fixtures and a manifest of seeded issues (catch /
// fp-guard / miss kinds, clean passages).
// ---------------------------------------------------------------------------

test("calibration acceptance (ac-1): the corpus holds three or more stories, each a four-file fixtures+manifest pair", () => {
  assert.ok(STORIES.length >= 3, `the corpus seeds at least three stories, found ${STORIES.length}`);
  // The calibration subtree is exactly README + stories + triage (additive
  // growth adds story directories, never new top-level kinds).
  assert.deepEqual(
    readdirSync(CALIBRATION_DIR).sort(),
    ["README.md", "stories", "triage"],
    "the calibration subtree holds exactly README.md, stories/ and triage/",
  );
  assert.deepEqual(
    readdirSync(TRIAGE_DIR).sort(),
    STORY_IDS.map((id) => `${id}.triage.json`),
    "the triage directory holds exactly one record per story",
  );

  for (const story of STORIES) {
    const storyDir = join(STORIES_DIR, story.id);
    assert.deepEqual(
      readdirSync(storyDir).sort(),
      ["canon.json", "manifest.json", "settings.json", "story.md"],
      `${story.id}: a story directory holds exactly story.md, canon.json, settings.json and manifest.json`,
    );
    assert.ok(
      story.id.startsWith("cal-") && story.id === story.id.toLowerCase(),
      `${story.id}: story ids are kebab-case and namespaced cal-`,
    );
    assert.equal(story.canon.projectId, story.id, `${story.id}: canon projectId matches the story directory`);
    assert.equal(story.settings.projectId, story.id, `${story.id}: settings projectId matches the story directory`);
    assert.equal(story.manifest.projectId, story.id, `${story.id}: manifest projectId matches the story directory`);
    assert.equal(story.manifest.story, "story.md", `${story.id}: manifest points at story.md`);
    assert.ok(story.manifest.seeds.length > 0, `${story.id}: the manifest seeds at least one issue`);
    assert.ok(story.manifest.cleanPassages.length > 0, `${story.id}: the manifest pins clean passages`);
    assert.ok(story.paragraphs.length >= 6, `${story.id}: a corpus story has at least six paragraphs`);
  }
});

test("calibration acceptance (ac-1): manifests are well-formed regression contracts (seed kinds, expect rows, clean passages)", () => {
  for (const story of STORIES) {
    assert.deepEqual(
      new Set(story.manifest.seeds.map((s) => s.id)).size,
      story.manifest.seeds.length,
      `${story.id}: seed ids are unique`,
    );
    for (const seed of story.manifest.seeds) {
      assert.ok(seed.id.length > 0, `${story.id}: every seed has an id`);
      assert.ok(typeof seed.class === "string" && seed.class.length > 0, `${story.id}/${seed.id}: every seed names its class`);
      assert.ok(
        ["catch", "fp-guard", "miss"].includes(seed.kind),
        `${story.id}/${seed.id}: kind is one of catch / fp-guard / miss, got '${seed.kind}'`,
      );
      if (seed.kind === "catch") {
        const expect = seed.expect;
        assert.ok(expect, `${story.id}/${seed.id}: a catch seed pins a full expect row`);
        assert.ok(expect && expect.agent.length > 0, `${story.id}/${seed.id}: expect row pins the agent`);
        assert.ok(expect && expect.type.length > 0, `${story.id}/${seed.id}: expect row pins the finding type`);
        assert.ok(expect && expect.quote.length > 0, `${story.id}/${seed.id}: expect row pins the quote`);
        assert.ok(expect && Number.isInteger(expect.startOffset) && Number.isInteger(expect.endOffset) && expect.endOffset > expect.startOffset, `${story.id}/${seed.id}: expect row pins a real span`);
        assert.ok(expect && Array.isArray(expect.canonRefs), `${story.id}/${seed.id}: expect row pins canonRefs`);
        assert.ok(expect && typeof expect.confidence === "number", `${story.id}/${seed.id}: expect row pins confidence`);
        assert.ok(expect && typeof expect.suggestion === "string" || expect && expect.suggestion === null, `${story.id}/${seed.id}: expect row pins suggestion`);
      } else {
        assert.ok(seed.note && seed.note.length > 0, `${story.id}/${seed.id}: ${seed.kind} seeds carry a note`);
        assert.equal(seed.expect ?? null, null, `${story.id}/${seed.id}: ${seed.kind} seeds pin no expect row`);
      }
    }
    // The enabled agents must be real agents from the registry, so the
    // contract can only ever be exercised through the real tool path.
    assert.ok(story.enabledAgentIds.length > 0, `${story.id}: at least one agent is enabled`);
    for (const agentId of story.enabledAgentIds) {
      assert.ok(AGENT_BY_ID.has(agentId), `${story.id}: enabled agent '${agentId}' exists in the agent registry`);
    }
  }
});

test("calibration acceptance (ac-1/ac-5): every paragraph resolves to exactly one seed or clean passage and catch quotes slice the story text", () => {
  for (const story of STORIES) {
    // Structural integrity: fail loudly on drift before any engine assertion.
    const coverage = [
      ...story.manifest.seeds.map((s) => s.paragraph),
      ...story.manifest.cleanPassages,
    ].sort((a, b) => a - b);
    assert.deepEqual(
      coverage,
      Array.from({ length: story.paragraphs.length }, (_, i) => i + 1),
      `${story.id}: every paragraph is exactly one seed or cleanPassages entry`,
    );
    for (const seed of story.manifest.seeds) {
      paragraphOf(story, seed);
      if (seed.kind === "catch" && seed.expect) {
        assert.equal(
          story.content.slice(seed.expect.startOffset, seed.expect.endOffset),
          seed.expect.quote,
          `${story.id}/${seed.id}: expect offsets slice exactly the pinned quote from story.md`,
        );
        assert.ok(
          paragraphOf(story, seed).text.includes(seed.expect.quote),
          `${story.id}/${seed.id}: the pinned quote is an excerpt of the seeded paragraph`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// ac-3 — at least three seed stories covering the known FP classes
// (token collisions, negation-on-shared-keywords, verbatim-agreement, POV
// thought-tags) and miss classes (implicit contradictions, name variants).
// ---------------------------------------------------------------------------

test("calibration acceptance (ac-3): the manifests cover all six known FP and miss classes with the right kinds", () => {
  const byClass = new Map<string, { kind: string; type: string | null; story: string }[]>();
  for (const story of STORIES) {
    for (const seed of story.manifest.seeds) {
      const rows = byClass.get(seed.class) ?? [];
      rows.push({ kind: seed.kind, type: seed.expect?.type ?? null, story: story.id });
      byClass.set(seed.class, rows);
    }
  }

  // The four known FP classes must be seeded as fp-guards: passages that
  // look like a known FP class and must stay silent.
  const fpClasses = ["token-collision", "negation-on-shared-keywords", "verbatim-agreement", "pov-thought-tags"];
  for (const fpClass of fpClasses) {
    const rows = byClass.get(fpClass);
    assert.ok(rows && rows.length > 0, `the corpus seeds the FP class '${fpClass}'`);
    for (const row of rows ?? []) {
      assert.equal(row.kind, "fp-guard", `the '${fpClass}' seed in ${row.story} is an fp-guard`);
      assert.equal(row.type, null, `the '${fpClass}' seed in ${row.story} pins no finding`);
    }
  }

  // The two known miss classes must be seeded as catches pinning the real
  // finding type (the implicit shape and the name-variant flagger are on the
  // base; a genuine gap would be seeded as kind miss instead).
  const implicitRows = byClass.get("implicit-contradiction");
  assert.ok(implicitRows && implicitRows.length > 0, "the corpus seeds the implicit-contradiction class");
  for (const row of implicitRows ?? []) {
    assert.equal(row.kind, "catch", `the implicit-contradiction seed in ${row.story} is a catch`);
    assert.equal(row.type, "canon-implicit-contradiction", `the implicit-contradiction seed in ${row.story} pins type canon-implicit-contradiction`);
  }
  const nameVariantRows = byClass.get("name-variant");
  assert.ok(nameVariantRows && nameVariantRows.length > 0, "the corpus seeds the name-variant class");
  for (const row of nameVariantRows ?? []) {
    assert.equal(row.kind, "catch", `the name-variant seed in ${row.story} is a catch`);
    assert.equal(row.type, "name-variant-drift", `the name-variant seed in ${row.story} pins type name-variant-drift`);
  }
});

// ---------------------------------------------------------------------------
// ac-2 — the triage workflow exists and is documented: run -> triage record
// format -> conversion rules, with the landing-gate rule stated.
// ---------------------------------------------------------------------------

test("calibration acceptance (ac-2): docs/calibration.md documents the triage workflow end to end (run, record format, conversion rules, landing gate, growth)", () => {
  const doc = requireFile(CALIBRATION_DOC, "docs/calibration.md");

  // RUN
  assert.match(doc, /npm test -w @lorewardens\/proof -t calibration/, "the doc documents the corpus run command");
  assert.match(doc, /root npm test/, "the doc documents the root npm test path");

  // TRIAGE: the record format (path, fields, verdict vocabulary).
  assert.match(doc, /calibration\/triage\/<story-id>\.triage\.json/, "the doc documents the triage record location");
  assert.match(doc, /"storyId":\s*"cal-<name>"/, "the doc documents the triage storyId field");
  assert.match(doc, /"triagedAt"/, "the doc documents the triagedAt field");
  assert.match(doc, /"triagedBy"/, "the doc documents the triagedBy field");
  assert.match(doc, /"verdict":\s*"tp\|fp\|missed"/, "the doc documents the tp|fp|missed verdict vocabulary");

  // CONVERT: the three conversion rules, which are the whole point.
  assert.match(doc, /confirmed FALSE POSITIVE → file\/extend an `fp-guard` seed/, "FP converts to an fp-guard seed pinning the lookalike passage");
  assert.match(doc, /lands in the SAME change/, "the matcher/cue-table/guard fix lands in the same change as the guard pin");
  assert.match(doc, /confirmed MISSED → add a `catch` seed/, "a miss converts to a catch seed");
  assert.match(doc, /until the engine\s+change that learns it lands with the corpus green in the same change/, "a converted miss stays a known gap until the engine change lands with the corpus green");
  assert.match(doc, /confirmed TRUE POSITIVE → extend the `catch` expect row/, "a true positive extends the catch expect row");
  assert.match(doc, /never silently becomes a `catch`/, "a miss never silently becomes a catch");
  assert.match(doc, /regression-proof moment/, "the manifest edit is the regression-proof moment");

  // GATE: the landing-gate rule, stated.
  assert.match(doc, /Every matcher\/cue-table\/guard change MUST run the full corpus before landing/, "the landing-gate rule is stated");
  assert.match(doc, /\(extends\s+the existing proof gate\)/, "the gate rule names the extended proof gate verbatim");

  // GROWTH: additive by design.
  assert.match(doc, /never edited except by the conversion rules/, "existing corpus files are never edited except by the conversion rules");
  assert.match(doc, /never a silent test loosening/, "a flip is never a silent test loosening");
  assert.match(doc, /never renamed once a story exists/, "story ids are never renamed");
  assert.match(doc, /`cal-`-namespaced projectId/, "story projectIds are namespaced cal-");
});

// ---------------------------------------------------------------------------
// ac-4 — every matcher change is validated against the full corpus before
// landing, enforced mechanically: the corpus runner is part of root npm test.
// ---------------------------------------------------------------------------

test("calibration acceptance (ac-4): the corpus runner is wired into root npm test as the mechanical landing gate", () => {
  const rootManifest = JSON.parse(requireFile(ROOT_PACKAGE_JSON, "root package.json")) as { scripts: Record<string, string> };
  assert.match(
    rootManifest.scripts.test,
    /npm run test -w @lorewardens\/proof/,
    "root npm test runs the proof workspace, which owns the corpus runner",
  );
  assert.match(
    rootManifest.scripts.test,
    /npm run build &&/,
    "root npm test builds first, so the runner always executes against built sources",
  );

  const proofManifest = JSON.parse(requireFile(PROOF_PACKAGE_JSON, "proof package.json")) as { scripts: Record<string, string> };
  assert.equal(
    proofManifest.scripts.test,
    "node --test dist/test/*.test.js",
    "the proof test script runs every compiled test file, including the corpus runner",
  );

  const runner = requireFile(RUNNER_TEST, "the calibration corpus runner");
  assert.match(runner, /calibration/, "the runner targets the calibration corpus");
  assert.match(runner, /readdirSync\(.+\)\s*\.sort\(\)/, "the runner walks the stories sorted, so growth is order-stable");
  assert.match(runner, /structural integrity/, "the runner asserts structural integrity");
  assert.match(runner, /byte-identical/, "the runner asserts whole-corpus determinism");
  assert.match(runner, /known[- ]misses table/i, "the runner reports the known-misses table, so a flip is visible in CI");

  // The gate is stated in the doc next to the wiring (cross-checked here so
  // ac-4 stands on both halves).
  const doc = requireFile(CALIBRATION_DOC, "docs/calibration.md");
  assert.match(doc, /runner lives in root `npm test`/, "the doc states that the runner lives in root npm test");
});

// ---------------------------------------------------------------------------
// Behavioral verification through the REAL tool path. The builder's runner
// does this too; this suite re-derives it independently from the manifests
// on disk. no mocks, no shortcuts.
// ---------------------------------------------------------------------------

test("calibration acceptance (ac-3): catch seeds surface their exact pinned findings through the real analyze tool path at standard", async () => {
  const catchCount = STORIES.reduce((n, s) => n + s.manifest.seeds.filter((seed) => seed.kind === "catch").length, 0);
  assert.ok(catchCount >= 4, `the corpus seeds at least four catch rows, found ${catchCount}`);

  for (const story of STORIES) {
    for (const seed of story.manifest.seeds.filter((s) => s.kind === "catch")) {
      const expect = seed.expect;
      if (!expect) throw new Error(`${story.id}/${seed.id}: catch seed without expect row`);
      const paragraph = paragraphOf(story, seed);
      for (const agentId of story.enabledAgentIds) {
        const result = await analyze(story, agentId, paragraph, "standard");
        assert.equal(result.invoked, true, `${story.id}/${seed.id}: ${agentId} is invoked`);
        const findings = findingsOf(result);
        if (agentId !== expect.agent) {
          assert.deepEqual(
            findings,
            [],
            `${story.id}/${seed.id}: ${agentId} stays silent on the ${expect.agent} catch paragraph`,
          );
          continue;
        }
        assert.equal(findings.length, 1, `${story.id}/${seed.id}: exactly one finding, got ${JSON.stringify(findings.map((f) => f.type))}`);
        const finding = findings[0];
        assert.equal(finding.agent, expect.agent, `${story.id}/${seed.id}: agent`);
        assert.equal(finding.category, expect.category, `${story.id}/${seed.id}: category`);
        assert.equal(finding.type, expect.type, `${story.id}/${seed.id}: type`);
        assert.equal(finding.severity, expect.severity, `${story.id}/${seed.id}: severity`);
        assert.equal(finding.confidence, expect.confidence, `${story.id}/${seed.id}: confidence`);
        assert.equal(finding.minStrictness, expect.minStrictness, `${story.id}/${seed.id}: minStrictness`);
        assert.deepEqual([...finding.canonRefs].sort(), [...expect.canonRefs].sort(), `${story.id}/${seed.id}: canonRefs`);
        assert.equal(finding.message, expect.message, `${story.id}/${seed.id}: message`);
        assert.equal(finding.quote, expect.quote, `${story.id}/${seed.id}: quote`);
        assert.equal(finding.location.file, story.fileLabel, `${story.id}/${seed.id}: file`);
        assert.equal(finding.location.startOffset, expect.startOffset, `${story.id}/${seed.id}: startOffset`);
        assert.equal(finding.location.endOffset, expect.endOffset, `${story.id}/${seed.id}: endOffset`);
        assert.equal(finding.suggestion, expect.suggestion, `${story.id}/${seed.id}: suggestion`);
        assert.ok(paragraph.text.includes(finding.quote), `${story.id}/${seed.id}: quote is an excerpt of the seeded paragraph`);
        assert.deepEqual(validateFinding(finding), [], `${story.id}/${seed.id}: finding schema-valid`);
      }
    }
  }
});

test("calibration acceptance (ac-3): fp-guard seeds, miss seeds and clean passages stay silent for every enabled agent at every strictness level", async () => {
  for (const story of STORIES) {
    const silentParagraphs: { label: string; paragraph: Paragraph }[] = [];
    for (const seed of story.manifest.seeds.filter((s) => s.kind === "fp-guard" || s.kind === "miss")) {
      silentParagraphs.push({ label: `${seed.kind} ${seed.id} (${seed.class})`, paragraph: paragraphOf(story, seed) });
    }
    for (const number of story.manifest.cleanPassages) {
      silentParagraphs.push({ label: `clean p${number}`, paragraph: story.paragraphs[number - 1] });
    }
    assert.ok(silentParagraphs.length > 0, `${story.id}: the story pins silence expectations`);

    for (const { label, paragraph } of silentParagraphs) {
      for (const agentId of story.enabledAgentIds) {
        for (const level of LEVELS) {
          const result = await analyze(story, agentId, paragraph, level);
          assert.equal(result.invoked, true, `${story.id} ${label}: ${agentId} invoked at ${level}`);
          assert.deepEqual(
            findingsOf(result),
            [],
            `${story.id} ${label} must stay silent for ${agentId} at ${level}`,
          );
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// ac-5 — whole-corpus determinism: two full passes, byte-identical tables.
// ---------------------------------------------------------------------------

function stableRow(finding: Finding): unknown {
  return {
    agent: finding.agent,
    category: finding.category,
    type: finding.type,
    severity: finding.severity,
    confidence: finding.confidence,
    minStrictness: finding.minStrictness,
    canonRefs: [...finding.canonRefs].sort(),
    message: finding.message,
    quote: finding.quote,
    location: {
      file: finding.location.file,
      startOffset: finding.location.startOffset,
      endOffset: finding.location.endOffset,
    },
    suggestion: finding.suggestion,
  };
}

async function corpusTable(): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const story of STORIES) {
    for (let i = 0; i < story.paragraphs.length; i++) {
      for (const agentId of story.enabledAgentIds) {
        for (const level of LEVELS) {
          const result = await analyze(story, agentId, story.paragraphs[i], level);
          rows.push({
            storyId: story.id,
            paragraph: i + 1,
            agentId,
            level,
            invoked: result.invoked,
            findings: findingsOf(result).map(stableRow),
          });
        }
      }
    }
  }
  return rows;
}

test("calibration acceptance (ac-5): two full corpus passes produce byte-identical finding tables", async () => {
  const first = await corpusTable();
  assert.ok(first.length > 0, "the corpus produced rows to compare");
  assert.ok(
    (first as { findings: unknown[] }[]).some((r) => r.findings.length > 0),
    "the corpus table includes real findings to compare",
  );
  const second = await corpusTable();
  assert.equal(JSON.stringify(second), JSON.stringify(first), "whole-corpus finding tables are byte-identical");
  assert.deepEqual(second, first, "whole-corpus finding tables are identical across passes");
});

// ---------------------------------------------------------------------------
// ac-5 — growth is additive; the corpus is offline and repo-owned by
// construction.
// ---------------------------------------------------------------------------

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

test("calibration acceptance (ac-5): the corpus is additive, offline and repo-owned by construction", () => {
  // The runner is story-agnostic: it contains no hardcoded story id, so
  // adding a story never requires editing the runner (additive by design).
  const runner = requireFile(RUNNER_TEST, "the calibration corpus runner");
  for (const story of STORIES) {
    assert.ok(!runner.includes(story.id), `the runner must not hardcode the story id '${story.id}' (growth is data-only)`);
  }
  assert.match(runner, /length >= 3/, "the runner keeps asserting a growing corpus");

  // The corpus README documents how to add a story.
  const readme = requireFile(CALIBRATION_README, "the calibration README");
  assert.match(readme, /Adding a story = adding one directory plus its triage record/, "the README documents additive growth");

  // Fully offline: the runner's imports are node builtins on the established
  // allowlist plus workspace packages only, and its source holds no network
  // or nondeterminism constructs.
  const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  const specifiers = [...runner.matchAll(importPattern)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, "the runner's imports are scannable");
  const ALLOWED_NODE_BUILTINS = new Set(["node:assert", "node:test", "node:fs", "node:url"]);
  for (const specifier of specifiers) {
    if (specifier.startsWith("node:")) {
      assert.ok(
        ALLOWED_NODE_BUILTINS.has(specifier.split("/")[0]),
        `the corpus runner imports '${specifier}', which is outside the offline allowlist`,
      );
    } else {
      assert.ok(
        specifier.startsWith("@lorewardens/"),
        `the corpus runner imports '${specifier}', which is not a workspace package`,
      );
    }
  }
  const offlinePatterns: [string, RegExp][] = [
    ["fetch call", /(?:^|[^\w.$])fetch\s*\(/],
    ["http(s) client", /https?\.(?:request|get)\s*\(/],
    ["XMLHttpRequest", /XMLHttpRequest/],
    ["WebSocket", /WebSocket/],
    ["undici", /undici/],
    ["axios", /axios/],
    ["http module", /node:http/],
    ["https module", /node:https/],
    ["net module", /node:net/],
    ["dns module", /node:dns/],
    ["tls module", /node:tls/],
    ["dgram module", /node:dgram/],
    ["child process", /child_process/],
    ["Math.random", /Math\.random\s*\(/],
    ["Date.now", /Date\.now\s*\(/],
    ["new Date", /new\s+Date\s*\(/],
  ];
  for (const [name, pattern] of offlinePatterns) {
    assert.ok(!pattern.test(runner), `the corpus runner must not contain ${name} (fully offline, deterministic)`);
  }

  // The corpus carries data only — no code can hide in the story tree.
  for (const file of walkFiles(CALIBRATION_DIR)) {
    assert.ok(
      file.endsWith(".md") || file.endsWith(".json"),
      `${file}: the corpus carries only markdown and JSON data (offline by construction)`,
    );
  }

  // Repo-owned content only: every triage record discloses original
  // repo-owned authorship and offline provenance.
  for (const story of STORIES) {
    assert.match(
      story.triage.disclosure.content,
      /original repo-owned content/i,
      `${story.id}: the triage record discloses original repo-owned content`,
    );
    assert.match(
      story.triage.disclosure.content,
      /no text, character, place or event is taken from Wolves of the Revolution/i,
      `${story.id}: the triage record discloses no owner-manuscript content`,
    );
    assert.match(story.triage.disclosure.offline, /offline/i, `${story.id}: the triage record discloses offline authoring`);
  }

  // And the story text itself carries none of the owner manuscript's proper
  // nouns (the disclosure sentences may name the rule; the fiction may not).
  const OWNER_MANUSCRIPT_TERMS = ["Wolves of the Revolution", "Bael", "Malakar", "Hazeldown", "Hazledown"];
  for (const story of STORIES) {
    for (const term of OWNER_MANUSCRIPT_TERMS) {
      assert.ok(
        !story.content.includes(term),
        `${story.id}/story.md must not contain the owner-manuscript term '${term}' (repo-owned content only)`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// ac-2/ac-5 — triage records exist per story in the documented format, with
// valid verdicts referencing real seeds.
// ---------------------------------------------------------------------------

test("calibration acceptance (ac-2/ac-5): every story has a triage record in the documented format with valid verdicts", () => {
  for (const story of STORIES) {
    assert.equal(story.triage.storyId, story.id, `${story.id}: triage storyId matches the story`);
    assert.ok(story.triage.triagedAt.length > 0 && !Number.isNaN(Date.parse(story.triage.triagedAt)), `${story.id}: triagedAt is an ISO timestamp`);
    assert.ok(story.triage.triagedBy.length > 0, `${story.id}: triagedBy is recorded`);
    assert.ok(Array.isArray(story.triage.items) && story.triage.items.length > 0, `${story.id}: the triage record holds items`);
    const seedIds = new Set(story.manifest.seeds.map((s) => s.id));
    for (const item of story.triage.items) {
      assert.ok(seedIds.has(item.ref), `${story.id}: triage item '${item.ref}' references a real seed`);
      assert.ok(
        ["tp", "fp", "missed"].includes(item.verdict),
        `${story.id}: triage item '${item.ref}' has a tp|fp|missed verdict, got '${item.verdict}'`,
      );
      assert.ok(item.note.length > 0, `${story.id}: triage item '${item.ref}' carries a note`);
      if (item.action !== undefined) {
        assert.ok(typeof item.action === "string" && item.action.length > 0, `${story.id}: triage item '${item.ref}' carries an action`);
      }
    }
  }
});
