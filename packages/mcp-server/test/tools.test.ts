import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRegistry, makeFinding, type CanonStore, type CanonSnapshot } from "@lorewardens/core";
import { CONTINUITY_AGENTS } from "@lorewardens/agents";
import { buildTools, runAnalyzeTool, type AnalyzeToolResult } from "../src/tools.js";
import { defaultFixturesDir, loadFixtures } from "../src/store.js";

const fixturesDir = defaultFixturesDir();

function seededStore(): { store: CanonStore; projectIds: string[] } {
  const { store, projectIds } = loadFixtures(fixturesDir);
  return { store, projectIds };
}

const CHUNK = {
  text: "Mira sketched the Weeping Gate while Daven dropped the measuring line again.",
  file: "demo/ch1.md",
  startOffset: 0,
  endOffset: 76,
};

test("one tool per registered agent plus read-only canon_list", () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const tools = buildTools(registry, store);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["analyze_canon_lore", "analyze_character_consistency", "analyze_timeline", "canon_list"],
  );
  for (const tool of tools) {
    assert.ok(tool.description.length > 20, `${tool.name} has a description`);
  }
});

test("analyze at standard invokes the stub agent and returns validated empty findings with a minimal context", async () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const agent = registry.get("canon-lore")!;
  const result = (await runAnalyzeTool(agent, store, {
    projectId: "demo",
    chunk: CHUNK,
  })) as AnalyzeToolResult;

  assert.equal(result.invoked, true);
  assert.equal(result.strictness, "standard", "falls back to the project/descriptor default");
  assert.deepEqual(result.findings, [], "stub agents return zero findings — valid per the contract");
  assert.equal(result.findingsCount, 0);
  assert.deepEqual(result.contextSummary, {
    entries: 1,
    characters: 2,
    events: 1,
  }, "context is minimal: the locked world rule, the two mentioned characters, the participant event");
});

test("explicit strictness on the call overrides project defaults", async () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const agent = registry.get("timeline")!;
  const result = (await runAnalyzeTool(agent, store, {
    projectId: "demo",
    chunk: CHUNK,
    strictness: "strict",
  })) as AnalyzeToolResult;
  assert.equal(result.strictness, "strict");
  assert.equal(result.invoked, true);
});

test("strictness off never invokes the agent and returns a reason", async () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const agent = registry.get("character-consistency")!;
  const result = (await runAnalyzeTool(agent, store, {
    projectId: "demo",
    chunk: CHUNK,
    strictness: "off",
  })) as AnalyzeToolResult;
  assert.equal(result.invoked, false);
  assert.deepEqual(result.findings, []);
  assert.match(result.reason ?? "", /off/i);
});

test("a disabled agent in project settings is not invoked", async () => {
  const tmpStore = disabledTimelineStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const agent = registry.get("timeline")!;
  const result = (await runAnalyzeTool(agent, tmpStore, {
    projectId: "demo",
    chunk: CHUNK,
  })) as AnalyzeToolResult;
  assert.equal(result.invoked, false);
  assert.match(result.reason ?? "", /disabled/);
  assert.deepEqual(result.findings, []);
});

test("canon_list returns the seeded confirmed snapshot with status counts", async () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const tools = buildTools(registry, store);
  const canonList = tools.find((t) => t.name === "canon_list")!;
  const result = (await canonList.handler({ projectId: "demo" })) as {
    projectId: string;
    snapshot: CanonSnapshot;
    counts: { entries: Record<string, number> };
  };
  assert.equal(result.projectId, "demo");
  assert.ok(result.snapshot.entries.length >= 3);
  assert.ok(result.snapshot.characters.length >= 2);
  assert.equal(result.counts.entries.confirmed, 2);
  assert.equal(result.counts.entries.proposed, 1);
});

test("handlers reject invalid input with a useful message", async () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const tools = buildTools(registry, store);
  const analyze = tools.find((t) => t.name === "analyze_canon_lore")!;
  await assert.rejects(() => analyze.handler({ projectId: "demo", chunk: { text: "" } }), /chunk/);
  const canonList = tools.find((t) => t.name === "canon_list")!;
  await assert.rejects(() => canonList.handler({}), /projectId/);
});

test("the runtime re-gates findings: below-floor and dismissed findings never reach the caller", async () => {
  const { store } = seededStore();
  const registry = createRegistry(CONTINUITY_AGENTS);
  const agent = registry.get("canon-lore")!;
  const whisperer = {
    ...agent,
    async analyze() {
      return [
        makeFinding({
          agent: "canon-lore",
          category: "canon",
          type: "canon-contradiction",
          severity: "major",
          confidence: 0.95,
          minStrictness: "standard",
          message: "The river ran east, but canon says west.",
          quote: "the river ran east",
          location: { file: "demo/ch1.md", startOffset: 0, endOffset: 18 },
          canonRefs: ["canon_fact_weeping_gate"],
          suggestion: null,
        }),
        makeFinding({
          agent: "canon-lore",
          category: "canon",
          type: "speculative-note",
          severity: "info",
          confidence: 0.5,
          minStrictness: "strict",
          message: "Possibly a timeline wobble.",
          quote: "",
          location: { file: "demo/ch1.md", startOffset: 0, endOffset: 1 },
          canonRefs: [],
          suggestion: null,
        }),
      ];
    },
  };
  const result = (await runAnalyzeTool(whisperer, store, {
    projectId: "demo",
    chunk: CHUNK,
    strictness: "standard",
  })) as AnalyzeToolResult;
  assert.equal(result.invoked, true);
  assert.equal(result.findingsCount, 1, "speculative note (minStrictness strict) is gated off at standard");
  assert.equal((result.findings as { type: string }[])[0].type, "canon-contradiction");
});

function disabledTimelineStore(): CanonStore {
  const tmp = mkdtempSync(join(tmpdir(), "lore-disabled-"));
  try {
    writeFileSync(
      join(tmp, "demo.canon.json"),
      JSON.stringify({ projectId: "demo", entries: [], characters: [], events: [] }),
    );
    writeFileSync(
      join(tmp, "demo.settings.json"),
      JSON.stringify({
        projectId: "demo",
        agents: [{ agentId: "timeline", enabled: false, strictness: "standard" }],
      }),
    );
    const { store } = loadFixtures(tmp);
    return store;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
