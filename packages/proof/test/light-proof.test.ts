import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Finding, Strictness } from "@lorewardens/core";
import { selectRelevantContext } from "@lorewardens/core";
import {
  ALL_AGENTS,
  CONTINUITY_AGENTS,
  LANGUAGE_AGENTS,
  NARRATIVE_AGENTS,
  OPTIONAL_AGENTS,
} from "@lorewardens/agents";
import { runAnalyzeTool, type AnalyzeToolResult } from "@lorewardens/mcp-server/dist/src/tools.js";
import { FixtureCanonStore, loadFixtures, type FixtureBundle } from "@lorewardens/mcp-server/dist/src/store.js";
import { validateFinding } from "@lorewardens/mcp-server/dist/src/validate.js";
import { defaultFixturesDir } from "../src/index.js";

const fixturesDir = defaultFixturesDir();
const { store, projectIds, skipped } = loadFixtures(fixturesDir);

const MANUSCRIPT_RELATIVE_PATH = "manuscript/ch-light.md";
const MANUSCRIPT_FILE_LABEL = MANUSCRIPT_RELATIVE_PATH;
const PROJECT = "proof-light";

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

// One row per seeded scenario in ch-light.md. `prefix` is the stable
// exact-text prefix that maps the scenario to its paragraph; canonRef is the
// canon id the target finding must reference (empty canonRefs stay empty).
// Strict-only rows are silent at standard and added at strict. The gentle
// rows are the declared gentle-effective pins: the stereotype note (0.9/
// gentle) and the locked-motif escalation (0.95/gentle).
const SEED_SCENARIOS: SeededScenario[] = [
  { id: "SVT1", agent: "show-vs-tell", type: "craft-emotion-label", severity: "info", prefix: "She felt terrified as the door swung open" },
  { id: "SVT2", agent: "show-vs-tell", type: "craft-exposition-block", severity: "info", prefix: "The harbor town had always been a place of waiting", strictOnly: true },
  { id: "SVT3", agent: "show-vs-tell", type: "craft-filter-phrase", severity: "info", prefix: "She saw that the gate had been left open", strictOnly: true },
  { id: "SR1", agent: "sensitivity-representation", type: "sensitivity-stereotype-phrase", severity: "minor", prefix: "He had learned not to trust the newcomers" },
  { id: "SR2", agent: "sensitivity-representation", type: "sensitivity-broad-brush", severity: "info", prefix: "All the outsiders had gathered by the seawall" },
  { id: "TM1", agent: "theme-motif", type: "motif-conflict", canonRef: "canon_motif_lighthouse", severity: "minor", prefix: "The lighthouse never burned while the ships sheltered" },
  { id: "TM2", agent: "theme-motif", type: "motif-conflict", canonRef: "canon_motif_storm", severity: "major", prefix: "The storm never passed before the festival" },
  { id: "TM3", agent: "theme-motif", type: "motif-recurrence", canonRef: "canon_motif_lighthouse", severity: "info", prefix: "The keeper climbed to the lighthouse before dawn", strictOnly: true },
];

// Gentle rows: the stereotype note (0.9/gentle) and the locked-motif
// escalation (0.95/gentle). Everything else stays below the gentle floor.
const GENTLE_IDS = new Set(["SR1", "TM2"]);

const CLEAN_PREFIXES = [
  '"They are all the same," the harbor master said', // dialogue-carried phrasing
  "All the villagers came up the old path", // canon-overlapping group term (fictional-culture guard)
  "For as long as anyone could remember, the families had mended nets", // sub-threshold run
  "The bell rang twice.", // short chunk
  "The lighthouse keeper trimmed the wick at noon.", // recurrence sub-threshold
];

// The existing proof projects and the manuscripts their canon describes.
const EXISTING_PROJECTS: { projectId: string; manuscript: string }[] = [
  { projectId: "proof", manuscript: "manuscript/ch4.md" },
  { projectId: "proof-language", manuscript: "manuscript/ch-language.md" },
  { projectId: "proof-narrative", manuscript: "manuscript/ch-narrative.md" },
  { projectId: "proof-strict", manuscript: "manuscript/ch4.md" },
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

function findingsOf(result: AnalyzeToolResult): Finding[] {
  return (result.findings ?? []) as Finding[];
}

test("the proof fixture directory seeds all five projects without skips", () => {
  // Standing ruling v2 (additive): proof-implicit joins in the loader's
  // emission order (see proof.test.ts).
  assert.deepEqual(projectIds, ["proof", "proof-implicit", "proof-language", "proof-light", "proof-narrative", "proof-strict"]);
  assert.deepEqual(skipped, []);
});

test("modular enablement: proof-light enables exactly the trio at standard, every other roster off", async () => {
  const settings = await store.settings(PROJECT);
  for (const agent of [...CONTINUITY_AGENTS, ...LANGUAGE_AGENTS, ...NARRATIVE_AGENTS]) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, false, `${agent.id} is disabled for proof-light`);
  }
  for (const agent of OPTIONAL_AGENTS) {
    const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
    assert.ok(agentSettings, `${agent.id} has an explicit settings entry`);
    assert.equal(agentSettings.enabled, true, `${agent.id} is enabled for proof-light`);
    assert.equal(agentSettings.strictness, "standard");
  }
});

test("modular disable: the trio is disabled in the four existing proof projects and never invoked", async () => {
  const probe = paragraphFor(CLEAN_PREFIXES[3]);
  for (const projectId of ["proof", "proof-language", "proof-narrative", "proof-strict"]) {
    const settings = await store.settings(projectId);
    for (const agent of OPTIONAL_AGENTS) {
      const agentSettings = settings.agents.find((s) => s.agentId === agent.id);
      assert.ok(agentSettings, `${projectId}: ${agent.id} resolved without a fixture entry`);
      assert.equal(agentSettings.enabled, false, `${projectId}: ${agent.id} is disabled by the default-off merge`);
      const result = await analyze(agent.id, projectId, probe);
      assert.equal(result.invoked, false, `${projectId}: ${agent.id} is not invoked`);
      assert.deepEqual(result.findings, [], `${projectId}: ${agent.id} returns zero findings`);
      assert.match(result.reason ?? "", /disabled/, `${projectId}: ${agent.id} reports the disablement`);
    }
  }
});

test("catch table: every seeded scenario produces exactly its finding at standard (strict-only notes stay silent)", async () => {
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    for (const agent of OPTIONAL_AGENTS) {
      const result = await analyze(agent.id, PROJECT, paragraph);
      assert.equal(result.invoked, true, `${seed.id}: ${agent.id} invoked`);
      const findings = findingsOf(result);
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
      assert.equal(finding.category, "optional", `${seed.id}: category`);
      assert.equal(finding.suggestion, null, `${seed.id}: light findings carry no suggestion`);
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

test("gentle matrix: only the stereotype note and the locked-motif escalation reach gentle", async () => {
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    const result = await analyze(seed.agent, PROJECT, paragraph, "gentle");
    const findings = findingsOf(result);
    if (GENTLE_IDS.has(seed.id)) {
      assert.equal(findings.length, 1, `${seed.id} is gentle-eligible as pinned`);
      assert.equal(findings[0].type, seed.type);
    } else {
      assert.deepEqual(findings, [], `${seed.id} must not surface at gentle`);
    }
  }
  const locked = findingsOf(await analyze("theme-motif", PROJECT, paragraphFor("The storm never passed before the festival"), "gentle"));
  assert.equal(locked[0].severity, "major", "the locked motif escalates to major at gentle");
});

test("strict adds the strict-only notes on top of the standard catch table", async () => {
  for (const seed of SEED_SCENARIOS) {
    const paragraph = paragraphFor(seed.prefix);
    for (const agent of OPTIONAL_AGENTS) {
      const standard = findingsOf(await analyze(agent.id, PROJECT, paragraph));
      const strict = findingsOf(await analyze(agent.id, PROJECT, paragraph, "strict"));
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

test("clean paragraphs stay silent for all three optional agents at every level", async () => {
  for (const prefix of CLEAN_PREFIXES) {
    const paragraph = paragraphFor(prefix);
    for (const level of ["gentle", "standard", "strict"] as const) {
      for (const agent of OPTIONAL_AGENTS) {
        const result = await analyze(agent.id, PROJECT, paragraph, level);
        assert.deepEqual(
          findingsOf(result),
          [],
          `clean paragraph '${prefix}' must be silent for ${agent.id} at ${level}`,
        );
      }
    }
  }
});

test("modular enable/disable both directions: disabling a light agent silences it; re-enabling restores it", async () => {
  // Each agent probes on a paragraph that seeds one of its own findings.
  const PROBE_PREFIX: Record<string, string> = {
    "show-vs-tell": "She felt terrified as the door swung open",
    "sensitivity-representation": "He had learned not to trust the newcomers",
    "theme-motif": "The lighthouse never burned while the ships sheltered",
  };
  for (const agent of OPTIONAL_AGENTS) {
    const probe = paragraphFor(PROBE_PREFIX[agent.id]);
    const bundle = JSON.parse(readFileSync(`${fixturesDir.replace(/\/$/, "")}/proof-light.settings.json`, "utf8")) as FixtureBundle["settings"];
    const row = bundle.agents.find((a) => a.agentId === agent.id);
    assert.ok(row, `${agent.id} has a fixture settings row`);
    row.enabled = false;
    const disabledStore = new FixtureCanonStore([
      { snapshot: await store.read(PROJECT), settings: bundle },
    ]);
    const disabled = (await runAnalyzeTool(agent, disabledStore, {
      projectId: PROJECT,
      chunk: { text: probe.text, file: MANUSCRIPT_FILE_LABEL, startOffset: probe.startOffset, endOffset: probe.endOffset },
    })) as AnalyzeToolResult;
    assert.equal(disabled.invoked, false, `${agent.id}: disabled in settings means not invoked`);
    assert.deepEqual(disabled.findings, [], `${agent.id}: zero findings while disabled`);
    assert.match(disabled.reason ?? "", /disabled/);
    const reEnabled = await analyze(agent.id, PROJECT, probe);
    assert.equal(reEnabled.invoked, true, `${agent.id}: re-enabled through the shipped settings`);
    assert.ok(findingsOf(reEnabled).length > 0, `${agent.id}: findings return when re-enabled`);
  }
});

test("the trio contributes zero findings to every existing proof project at every strictness level", async () => {
  for (const { projectId, manuscript } of EXISTING_PROJECTS) {
    const snapshot = await store.read(projectId);
    const fileContent = readFileSync(`${fixturesDir.replace(/\/$/, "")}/${manuscript}`, "utf8");
    let cursor = 0;
    for (const raw of fileContent.split("\n\n")) {
      const text = raw.trim();
      if (text.length === 0) {
        cursor += raw.length + 2;
        continue;
      }
      const startOffset = cursor + (raw.length - raw.trimStart().length);
      const chunkData = {
        text,
        span: { file: manuscript, startOffset, endOffset: startOffset + text.length },
      };
      const context = selectRelevantContext(text, snapshot);
      for (const level of ["gentle", "standard", "strict"] as const) {
        for (const agent of OPTIONAL_AGENTS) {
          const findings = await agent.analyze({
            projectId,
            chunk: chunkData,
            context,
            strictness: level,
            settings: await store.settings(projectId),
          });
          assert.deepEqual(
            findings,
            [],
            `${projectId}/${manuscript}: ${agent.id} must find nothing at ${level}`,
          );
        }
      }
      cursor += raw.length + 2;
    }
  }
});

test("light findings are deterministic across repeated passes (ids and timestamps may vary)", async () => {
  const stable = (result: AnalyzeToolResult) =>
    findingsOf(result).map((finding) => ({
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
