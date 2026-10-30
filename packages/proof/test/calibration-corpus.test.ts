// Calibration corpus runner — the standing, growing regression library.
//
// Walks packages/proof/calibration/stories/* (sorted), drives the REAL MCP
// tool path (runAnalyzeTool) per paragraph exactly like the existing proof
// suites, and enforces each story's manifest: catch rows must surface their
// exact pinned finding, fp-guard passages must stay silent at every
// strictness level, miss seeds (known engine gaps) must still be silent and
// stay visible in CI output by seed id, and clean passages must stay silent
// at gentle, standard and strict. The whole corpus runs twice and the two
// finding tables must be byte-identical.
//
// This runner is part of root `npm test`, which is what mechanically
// enforces the landing gate: every matcher/cue-table/guard change is
// validated against the full corpus before landing (extends the existing
// proof gate). See docs/calibration.md for the triage workflow.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CanonSnapshot, Finding, ProjectSettings, Strictness } from "@lorewardens/core";
import { ALL_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "@lorewardens/mcp-server/dist/src/tools.js";
import { FixtureCanonStore } from "@lorewardens/mcp-server/dist/src/store.js";
import { validateFinding } from "@lorewardens/mcp-server/dist/src/validate.js";

// ---------------------------------------------------------------------------
// Manifest / triage shapes (the regression contract). Structural drift fails
// loudly in the integrity test below.
// ---------------------------------------------------------------------------

interface ExpectRow {
  agent: string;
  category: string;
  type: string;
  severity: string;
  confidence: number;
  minStrictness: string;
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
  action: string;
}

interface TriageFile {
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

interface StoryCorpus {
  id: string;
  canon: CanonSnapshot;
  settings: ProjectSettings;
  manifest: Manifest;
  triage: TriageFile;
  content: string;
  paragraphs: Paragraph[];
  store: FixtureCanonStore;
  enabledAgentIds: string[];
  fileLabel: string;
}

// ---------------------------------------------------------------------------
// Corpus loading. The test compiles to dist/test/, so the calibration subtree
// lives two levels up. Stories are walked in sorted order — deterministic.
// ---------------------------------------------------------------------------

const CALIBRATION_DIR = new URL("../../calibration/", import.meta.url);
const STORIES_DIR = new URL("stories/", CALIBRATION_DIR);
const TRIAGE_DIR = new URL("triage/", CALIBRATION_DIR);

const STORY_IDS = readdirSync(fileURLToPath(STORIES_DIR)).sort();

const AGENT_BY_ID = new Map<string, (typeof ALL_AGENTS)[number]>(ALL_AGENTS.map((a) => [a.id, a]));

type Level = Exclude<Strictness, "off">;
const LEVELS: Level[] = ["gentle", "standard", "strict"];

// Identical paragraph splitting to the existing proof suites: blank-line
// separated, trimmed, real file-relative offsets.
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

function readJson(url: URL): unknown {
  return JSON.parse(readFileSync(url, "utf8"));
}

function loadStory(id: string): StoryCorpus {
  const storyDir = new URL(`${id}/`, STORIES_DIR);
  const canon = readJson(new URL("canon.json", storyDir)) as CanonSnapshot;
  const settings = readJson(new URL("settings.json", storyDir)) as ProjectSettings;
  const manifest = readJson(new URL("manifest.json", storyDir)) as Manifest;
  const triage = readJson(new URL(`${id}.triage.json`, TRIAGE_DIR)) as TriageFile;
  const content = readFileSync(new URL("story.md", storyDir), "utf8");
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

const STORY_CORPUSES: StoryCorpus[] = STORY_IDS.map(loadStory);

function paragraphOf(story: StoryCorpus, seed: Seed): Paragraph {
  assert.ok(
    seed.paragraph >= 1 && seed.paragraph <= story.paragraphs.length,
    `${story.id}/${seed.id}: paragraph ${seed.paragraph} resolves inside story.md (${story.paragraphs.length} paragraphs)`,
  );
  return story.paragraphs[seed.paragraph - 1];
}

async function analyze(story: StoryCorpus, agentId: string, paragraph: Paragraph, strictness?: Level): Promise<AnalyzeToolResult> {
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
    ...(strictness ? { strictness } : {}),
  })) as AnalyzeToolResult;
}

function findingsOf(result: AnalyzeToolResult): Finding[] {
  return (result.findings ?? []) as Finding[];
}

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
  };
}

function knownMissesTable(): { storyId: string; seedId: string; class: string; paragraph: number }[] {
  return STORY_CORPUSES.flatMap((story) =>
    story.manifest.seeds
      .filter((seed) => seed.kind === "miss")
      .map((seed) => ({ storyId: story.id, seedId: seed.id, class: seed.class, paragraph: seed.paragraph })),
  );
}

// ---------------------------------------------------------------------------
// Structural integrity — fail loudly on drift before any engine assertion.
// ---------------------------------------------------------------------------

test("calibration corpus: structural integrity (files, projectIds, paragraph coverage, triage)", () => {
  assert.ok(STORY_CORPUSES.length >= 3, "the corpus seeds at least three stories");
  for (const story of STORY_CORPUSES) {
    const storyDir = new URL(`${story.id}/`, STORIES_DIR);
    assert.deepEqual(
      readdirSync(fileURLToPath(storyDir)).sort(),
      ["canon.json", "manifest.json", "settings.json", "story.md"],
      `${story.id}: a story directory holds exactly the four corpus files`,
    );
    assert.equal(story.canon.projectId, story.id, `${story.id}: canon projectId matches the directory`);
    assert.equal(story.settings.projectId, story.id, `${story.id}: settings projectId matches the directory`);
    assert.equal(story.manifest.projectId, story.id, `${story.id}: manifest projectId matches canon`);
    assert.equal(story.manifest.story, "story.md", `${story.id}: manifest points at story.md`);
    assert.ok(story.paragraphs.length >= 6, `${story.id}: a corpus story has at least six paragraphs`);

    // Every paragraph maps to exactly one seed or cleanPassages entry, and
    // every seed paragraph reference resolves inside story.md.
    const seedParagraphs = story.manifest.seeds.map((s) => s.paragraph);
    const coverage = [...seedParagraphs, ...story.manifest.cleanPassages].sort((a, b) => a - b);
    assert.deepEqual(
      coverage,
      Array.from({ length: story.paragraphs.length }, (_, i) => i + 1),
      `${story.id}: every paragraph is exactly one seed or cleanPassages entry`,
    );
    assert.deepEqual(
      new Set(story.manifest.seeds.map((s) => s.id)).size,
      story.manifest.seeds.length,
      `${story.id}: seed ids are unique`,
    );
    for (const seed of story.manifest.seeds) {
      paragraphOf(story, seed);
      if (seed.kind === "catch") {
        assert.ok(seed.expect, `${story.id}/${seed.id}: a catch seed pins a full expect row`);
        assert.ok(seed.expect!.agent && seed.expect!.type && seed.expect!.quote, `${story.id}/${seed.id}: expect row has agent, type and quote`);
        assert.ok(seed.expect!.endOffset > seed.expect!.startOffset, `${story.id}/${seed.id}: expect row has a real span`);
        assert.equal(
          story.content.slice(seed.expect!.startOffset, seed.expect!.endOffset),
          seed.expect!.quote,
          `${story.id}/${seed.id}: expect offsets slice exactly the pinned quote from story.md`,
        );
      } else {
        assert.ok(seed.note && seed.note.length > 0, `${story.id}/${seed.id}: ${seed.kind} seeds carry a note`);
        assert.equal(seed.expect ?? null, null, `${story.id}/${seed.id}: ${seed.kind} seeds pin no expect row`);
      }
    }

    // Triage record: present, matching, disclosed as original repo-owned
    // content, and referencing only real seeds.
    assert.equal(story.triage.storyId, story.id, `${story.id}: triage storyId matches`);
    assert.ok(story.triage.disclosure?.content.length > 0, `${story.id}: triage discloses content provenance`);
    assert.match(story.triage.disclosure.content, /original repo-owned content/i, `${story.id}: disclosure states original repo-owned content`);
    assert.match(story.triage.disclosure.offline, /offline/i, `${story.id}: disclosure states offline authoring`);
    const seedIds = new Set(story.manifest.seeds.map((s) => s.id));
    for (const item of story.triage.items) {
      assert.ok(seedIds.has(item.ref), `${story.id}: triage item '${item.ref}' references a real seed`);
      assert.ok(["tp", "fp", "missed"].includes(item.verdict), `${story.id}: triage item '${item.ref}' has a valid verdict`);
    }
  }

  // Triage directory: exactly one triage file per story, nothing else.
  assert.deepEqual(
    readdirSync(fileURLToPath(TRIAGE_DIR)).sort(),
    STORY_IDS.map((id) => `${id}.triage.json`),
    "the triage directory holds exactly one record per story",
  );
});

// ---------------------------------------------------------------------------
// Catch rows: the engine MUST surface the seeded issue, exactly as pinned.
// ---------------------------------------------------------------------------

for (const story of STORY_CORPUSES) {
  for (const seed of story.manifest.seeds.filter((s) => s.kind === "catch")) {
    test(`calibration ${story.id} catch ${seed.id} (${seed.class}): exact pinned finding row at standard`, async () => {
      const paragraph = paragraphOf(story, seed);
      for (const agentId of story.enabledAgentIds) {
        const result = await analyze(story, agentId, paragraph, "standard");
        assert.equal(result.invoked, true, `${seed.id}: ${agentId} invoked`);
        const findings = findingsOf(result);
        if (agentId !== seed.expect!.agent) {
          assert.deepEqual(findings, [], `${seed.id}: ${agentId} stays silent on the catch paragraph`);
          continue;
        }
        assert.equal(findings.length, 1, `${seed.id}: exactly one finding, got ${JSON.stringify(findings.map((f) => f.type))}`);
        const finding = findings[0];
        const expect = seed.expect!;
        assert.equal(finding.agent, expect.agent, `${seed.id}: agent`);
        assert.equal(finding.category, expect.category, `${seed.id}: category`);
        assert.equal(finding.type, expect.type, `${seed.id}: type`);
        assert.equal(finding.severity, expect.severity, `${seed.id}: severity`);
        assert.equal(finding.confidence, expect.confidence, `${seed.id}: confidence`);
        assert.equal(finding.minStrictness, expect.minStrictness, `${seed.id}: minStrictness`);
        assert.deepEqual([...finding.canonRefs].sort(), [...expect.canonRefs].sort(), `${seed.id}: canonRefs`);
        assert.equal(finding.message, expect.message, `${seed.id}: message`);
        assert.equal(finding.quote, expect.quote, `${seed.id}: quote`);
        assert.equal(finding.location.file, story.fileLabel, `${seed.id}: file`);
        assert.equal(finding.location.startOffset, expect.startOffset, `${seed.id}: startOffset`);
        assert.equal(finding.location.endOffset, expect.endOffset, `${seed.id}: endOffset`);
        assert.equal(finding.suggestion, expect.suggestion, `${seed.id}: suggestion`);
        assert.ok(paragraph.text.includes(finding.quote), `${seed.id}: quote is an excerpt of the seeded paragraph`);
        assert.deepEqual(validateFinding(finding), [], `${seed.id}: finding schema-valid`);
      }
    });
  }

  // fp-guard seeds: passages seeded to look like a known FP class must stay
  // silent for every enabled agent at every strictness level.
  for (const seed of story.manifest.seeds.filter((s) => s.kind === "fp-guard")) {
    test(`calibration ${story.id} fp-guard ${seed.id} (${seed.class}): silent at every level`, async () => {
      const paragraph = paragraphOf(story, seed);
      for (const agentId of story.enabledAgentIds) {
        for (const level of LEVELS) {
          const result = await analyze(story, agentId, paragraph, level);
          assert.equal(result.invoked, true, `${seed.id}: ${agentId} invoked at ${level}`);
          assert.deepEqual(
            findingsOf(result),
            [],
            `${seed.id} (${seed.class}) must stay silent for ${agentId} at ${level}`,
          );
        }
      }
    });
  }

  // Known misses: a recorded engine gap must still be silent TODAY. The seed
  // id is in the test name so the flip to `catch` is visible in CI output.
  for (const seed of story.manifest.seeds.filter((s) => s.kind === "miss")) {
    test(`calibration ${story.id} known miss ${seed.id} (${seed.class}): still silent — ${seed.note ?? "engine gap"}`, async () => {
      const paragraph = paragraphOf(story, seed);
      for (const agentId of story.enabledAgentIds) {
        for (const level of LEVELS) {
          const result = await analyze(story, agentId, paragraph, level);
          assert.equal(result.invoked, true, `${seed.id}: ${agentId} invoked at ${level}`);
          assert.deepEqual(
            findingsOf(result),
            [],
            `${seed.id} (${seed.class}) is a known miss and must stay silent for ${agentId} at ${level} until the engine learns it`,
          );
        }
      }
    });
  }

  test(`calibration ${story.id}: clean passages stay silent for every enabled agent at every level`, async () => {
    assert.ok(story.manifest.cleanPassages.length > 0, `${story.id}: the story pins clean passages`);
    for (const number of story.manifest.cleanPassages) {
      const paragraph = story.paragraphs[number - 1];
      for (const agentId of story.enabledAgentIds) {
        for (const level of LEVELS) {
          const result = await analyze(story, agentId, paragraph, level);
          assert.equal(result.invoked, true, `${story.id} p${number}: ${agentId} invoked at ${level}`);
          assert.deepEqual(
            findingsOf(result),
            [],
            `${story.id} clean passage p${number} must be silent for ${agentId} at ${level}`,
          );
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The known-misses table: stable, derived only from the manifests, and equal
// when re-read from disk so the flip of a miss to catch is always a visible
// manifest edit.
// ---------------------------------------------------------------------------

test("calibration corpus: the known-misses table is stable and manifest-derived", () => {
  const table = knownMissesTable();
  const reread = STORY_IDS.map(loadStory).flatMap((story) =>
    story.manifest.seeds
      .filter((seed) => seed.kind === "miss")
      .map((seed) => ({ storyId: story.id, seedId: seed.id, class: seed.class, paragraph: seed.paragraph })),
  );
  assert.deepEqual(reread, table, "the known-misses table matches the manifests on disk, in sorted story order");
});

// ---------------------------------------------------------------------------
// Determinism: the whole corpus executes twice and the finding tables must be
// byte-identical (ids and timestamps excluded — they are non-deterministic by
// design and pinned nowhere).
// ---------------------------------------------------------------------------

async function corpusTable(): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (const story of STORY_CORPUSES) {
    for (let i = 0; i < story.paragraphs.length; i++) {
      const paragraph = story.paragraphs[i];
      for (const agentId of story.enabledAgentIds) {
        for (const level of LEVELS) {
          const result = await analyze(story, agentId, paragraph, level);
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

test("calibration corpus: two full passes yield byte-identical finding tables", async () => {
  const first = await corpusTable();
  assert.ok(first.length > 0, "the corpus produced rows to compare");
  const second = await corpusTable();
  assert.equal(JSON.stringify(second), JSON.stringify(first), "whole-corpus finding tables are byte-identical");
  assert.deepEqual(second, first, "whole-corpus finding tables are identical across runs");
});
