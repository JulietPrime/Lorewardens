import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_DESCRIPTORS, STUB_AGENTS } from "../src/index.js";
import type { AnalyzeInput } from "@lorewardens/core";

test("the three continuity agents are described", () => {
  assert.deepEqual(
    AGENT_DESCRIPTORS.map((d) => d.id),
    ["canon-lore", "character-consistency", "timeline"],
  );
  for (const d of AGENT_DESCRIPTORS) {
    assert.equal(d.family, "continuity");
    assert.equal(d.defaultStrictness, "standard");
    assert.ok(d.description.length > 0);
  }
});

test("stub agents return zero findings (replaced by implement-three-continuity-agents)", async () => {
  const input: AnalyzeInput = {
    projectId: "p1",
    chunk: {
      text: "Mira drew the map.",
      span: { file: "ch1.md", startOffset: 0, endOffset: 18 },
    },
    context: { entries: [], characters: [], events: [] },
    strictness: "standard",
    settings: { projectId: "p1", agents: [], exceptions: [], dismissed: [] },
  };
  for (const agent of STUB_AGENTS) {
    assert.deepEqual(await agent.analyze(input), []);
  }
});
