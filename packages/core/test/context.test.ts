import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRelevantContext } from "../src/context.js";
import type { CanonEntry, CanonSnapshot, Character, TimelineEvent } from "../src/types.js";

function character(id: string, name: string, aliases: string[] = []): Character {
  return {
    id,
    projectId: "p1",
    name,
    aliases,
    summary: "",
    traits: [],
    abilities: [],
    injuries: [],
    goals: [],
    relationships: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function event(id: string, participants: string[], status: "confirmed" | "proposed"): TimelineEvent {
  return {
    id,
    projectId: "p1",
    description: "",
    order: 1,
    precision: "day",
    participants,
    status,
    locked: false,
    sources: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const snapshot: CanonSnapshot = {
  projectId: "p1",
  entries: [
    {
      id: "canon_rule",
      projectId: "p1",
      kind: "rule",
      text: "Magic costs the caster a memory",
      tags: ["magic"],
      status: "confirmed",
      locked: true,
      sources: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "canon_irrelevant",
      projectId: "p1",
      kind: "fact",
      text: "The southern harbor closes each winter",
      tags: ["harbor"],
      status: "confirmed",
      locked: false,
      sources: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "canon_unconfirmed",
      projectId: "p1",
      kind: "fact",
      text: "Draft fact still awaiting confirmation",
      tags: ["magic"],
      status: "proposed",
      locked: false,
      sources: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  characters: [
    character("char_mira", "Mira", ["the cartographer"]),
    character("char_other", "Daven"),
  ],
  events: [event("ev_1", ["char_mira"], "confirmed"), event("ev_2", ["char_other"], "proposed")],
};

test("context selection returns only confirmed, relevant items", () => {
  const ctx = selectRelevantContext("Mira drew the map while the magic hummed.", snapshot);
  assert.deepEqual(
    ctx.characters.map((c) => c.id),
    ["char_mira"],
  );
  assert.deepEqual(
    ctx.entries.map((e) => e.id),
    ["canon_rule"],
  );
  assert.deepEqual(
    ctx.events.map((e) => e.id),
    ["ev_1"],
  );
});

test("alias mentions select the character", () => {
  const ctx = selectRelevantContext("The cartographer said nothing.", snapshot);
  assert.deepEqual(
    ctx.characters.map((c) => c.id),
    ["char_mira"],
  );
});

test("unmentioned non-rule canon stays out of context; world rules always stay in", () => {
  const ctx = selectRelevantContext("Mira walked on.", snapshot);
  assert.deepEqual(
    ctx.entries.map((e) => e.id),
    ["canon_rule"],
  );
  assert.equal(ctx.characters.length, 1);
});

// ---------------------------------------------------------------------------
// Variant-tolerant selection and place-name evidence (additive cases)
// ---------------------------------------------------------------------------

function settingEntry(id: string, text: string, status: "confirmed" | "proposed" | "retired"): CanonEntry {
  return {
    id,
    projectId: "p1",
    kind: "setting",
    text,
    tags: [],
    status,
    locked: false,
    sources: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const variantSnapshot: CanonSnapshot = {
  projectId: "p1",
  entries: [],
  characters: [character("char_haze", "Hazledown"), character("char_bram", "Daven", ["Bramwell"])],
  events: [],
};

test("a chunk containing only a variant spelling still pulls the character into context", () => {
  const ctx = selectRelevantContext("Hazeldown watched the road.", variantSnapshot);
  assert.deepEqual(
    ctx.characters.map((c) => c.id),
    ["char_haze"],
  );
});

test("a variant of an alias pulls the character into context", () => {
  const ctx = selectRelevantContext("Bramwel stood at the gate.", variantSnapshot);
  assert.deepEqual(
    ctx.characters.map((c) => c.id),
    ["char_bram"],
  );
});

test("a variant-only chunk yields no place evidence without setting entries", () => {
  const ctx = selectRelevantContext("Hazeldown watched the road.", variantSnapshot);
  assert.deepEqual(ctx.placeNames ?? [], []);
});

test("placeNames come from confirmed setting entries in first-occurrence order", () => {
  const snap: CanonSnapshot = {
    projectId: "p1",
    entries: [
      settingEntry("canon_set_a", "Embervale sits beyond the Ashford river.", "confirmed"),
      settingEntry("canon_set_b", "Draftmere remains unmapped.", "proposed"),
      settingEntry("canon_set_c", "Oldmere sank below the waves.", "retired"),
      settingEntry("canon_set_d", "The Embervale market burns.", "confirmed"),
    ],
    characters: [],
    events: [],
  };
  const ctx = selectRelevantContext("A stray dog barked.", snap);
  assert.deepEqual(ctx.placeNames, ["Embervale", "Ashford"]);
});

test("placeNames keep the first capitalized occurrence's casing", () => {
  const snap: CanonSnapshot = {
    projectId: "p1",
    entries: [settingEntry("canon_set_e", "the embervale is quiet, but Embervale endures.", "confirmed")],
    characters: [],
    events: [],
  };
  const ctx = selectRelevantContext("A stray dog barked.", snap);
  assert.deepEqual(ctx.placeNames, ["Embervale"]);
});
