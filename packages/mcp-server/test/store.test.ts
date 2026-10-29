import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AGENT_DESCRIPTORS } from "@lorewardens/agents";
import type { CanonSnapshot, Character, TimelineEvent, CanonEntry } from "@lorewardens/core";
import { defaultSettings, loadFixtureBundle, loadFixtures, ReadOnlyStoreError, defaultFixturesDir } from "../src/store.js";

const fixturesDir = defaultFixturesDir();

function entry(id: string, overrides: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id,
    projectId: "t1",
    kind: "fact",
    text: `Fact ${id}`,
    tags: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: "2026-10-29T09:00:00.000Z",
    updatedAt: "2026-10-29T09:00:00.000Z",
    ...overrides,
  };
}

function character(id: string, name: string): Character {
  return {
    id,
    projectId: "t1",
    name,
    aliases: [],
    summary: "",
    traits: [],
    abilities: [],
    injuries: [],
    goals: [],
    relationships: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: "2026-10-29T09:00:00.000Z",
    updatedAt: "2026-10-29T09:00:00.000Z",
  };
}

function event(id: string, participants: string[]): TimelineEvent {
  return {
    id,
    projectId: "t1",
    description: id,
    order: 1,
    precision: "day",
    participants,
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: "2026-10-29T09:00:00.000Z",
    updatedAt: "2026-10-29T09:00:00.000Z",
  };
}

test("loadFixtures seeds the demo project from disk with its settings", () => {
  const { store, projectIds, skipped } = loadFixtures(fixturesDir);
  assert.deepEqual(projectIds, ["demo"]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(store.listProjectIds(), ["demo"]);
});

test("canon snapshot round-trips and read() returns a defensive copy", async () => {
  const { store } = loadFixtures(fixturesDir);
  const snapshot = await store.read("demo");
  assert.equal(snapshot.projectId, "demo");
  assert.ok(snapshot.entries.length >= 1);
  assert.ok(snapshot.characters.length >= 1);
  assert.ok(snapshot.events.length >= 1);
  const lockedRule = snapshot.entries.find((e) => e.kind === "rule" && e.locked);
  assert.ok(lockedRule, "demo fixture seeds a locked world rule");

  snapshot.entries.pop();
  const again = await store.read("demo");
  assert.equal(again.entries.length, snapshot.entries.length + 1, "mutation of a read does not corrupt the store");
});

test("projects without a settings file default to all agents enabled at descriptor defaults", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-fixtures-"));
  try {
    const snapshot: CanonSnapshot = {
      projectId: "bare",
      entries: [entry("e1", { projectId: "bare" })],
      characters: [],
      events: [],
    };
    writeFileSync(join(tmp, "bare.canon.json"), JSON.stringify(snapshot));
    const bundle = loadFixtureBundle(tmp, "bare");
    assert.deepEqual(bundle.settings.agents, defaultSettings("bare").agents);
    assert.deepEqual(
      bundle.settings.agents.map((a) => [a.enabled, a.strictness]),
      AGENT_DESCRIPTORS.map((d) => [true, d.defaultStrictness]),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("a settings fixture overrides enablement and strictness", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-fixtures-"));
  try {
    const snapshot: CanonSnapshot = {
      projectId: "partial",
      entries: [],
      characters: [],
      events: [],
    };
    writeFileSync(join(tmp, "partial.canon.json"), JSON.stringify(snapshot));
    writeFileSync(
      join(tmp, "partial.settings.json"),
      JSON.stringify({
        projectId: "partial",
        agents: [
          { agentId: "canon-lore", enabled: true, strictness: "strict" },
          { agentId: "timeline", enabled: false, strictness: "off" },
        ],
      }),
    );
    const bundle = loadFixtureBundle(tmp, "partial");
    const timeline = bundle.settings.agents.find((a) => a.agentId === "timeline");
    const canon = bundle.settings.agents.find((a) => a.agentId === "canon-lore");
    const missing = bundle.settings.agents.find((a) => a.agentId === "character-consistency");
    assert.equal(timeline?.enabled, false);
    assert.equal(canon?.strictness, "strict");
    assert.equal(missing?.enabled, true, "unlisted agents fall back to descriptor defaults");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("fixtures with a mismatched projectId are skipped with a warning, not loaded", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-fixtures-"));
  try {
    writeFileSync(join(tmp, "wrong.canon.json"), JSON.stringify({ projectId: "other", entries: [], characters: [], events: [] }));
    const { store, projectIds, skipped } = loadFixtures(tmp);
    assert.deepEqual(projectIds, []);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0], /wrong\.canon\.json/);
    await assert.rejects(() => store.read("wrong"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the fixture store is read-only: every write path rejects", async () => {
  const { store } = loadFixtures(fixturesDir);
  await assert.rejects(
    () =>
      store.applyConfirmed({
        id: "prop_1",
        projectId: "demo",
        proposedBy: "writer",
        subjectKind: "canon-entry",
        action: "add",
        payload: entry("canon_new"),
        reason: "test",
        createdAt: new Date().toISOString(),
      }),
    ReadOnlyStoreError,
  );
  await assert.rejects(
    () =>
      store.addException({
        id: "exc_1",
        projectId: "demo",
        scope: "rule",
        ref: "canon-contradiction",
        reason: "intentional",
        createdAt: new Date().toISOString(),
      }),
    ReadOnlyStoreError,
  );
  await assert.rejects(
    () => store.dismissFinding({ findingId: "fnd_x", projectId: "demo", dismissedAt: new Date().toISOString() }),
    ReadOnlyStoreError,
  );
});

test("reading an unknown project explains what is seeded", async () => {
  const { store } = loadFixtures(fixturesDir);
  await assert.rejects(() => store.read("nope"), /Unknown project 'nope'.*demo/);
});
