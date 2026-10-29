import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  AGENT_CONTRACT_RULES,
  InMemoryCanonStore,
  STRICTNESS_CONFIDENCE_FLOOR,
  STRICTNESS_ORDER,
  atLeastStrictness,
  filterFindings,
  makeFinding,
  selectRelevantContext,
  surfacesAt,
} from "../src/index.js";
import type {
  CanonEntry,
  CanonException,
  CanonProposal,
  CanonSnapshot,
  Character,
  DismissedFinding,
  FindingDraft,
  ProjectSettings,
  TimelineEvent,
} from "../src/index.js";

const TS = "2026-01-01T00:00:00Z";

function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      const name = JSON.parse(fs.readFileSync(pkg, "utf8")).name;
      if (name === "lorewardens") return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("repo root (package.json name=lorewardens) not found");
}

function readRepo(rel: string): string {
  return fs.readFileSync(path.join(repoRoot(), rel), "utf8");
}

function canonEntry(overrides: Partial<CanonEntry> = {}): CanonEntry {
  return {
    id: "canon_x",
    projectId: "proj_accept",
    kind: "fact",
    text: "The river Vessa runs east.",
    tags: ["river"],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: "char_mira",
    projectId: "proj_accept",
    name: "Mira",
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
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function timelineEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "ev_1",
    projectId: "proj_accept",
    description: "",
    order: 1,
    precision: "day",
    participants: ["char_mira"],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CanonSnapshot> = {}): CanonSnapshot {
  return {
    projectId: "proj_accept",
    entries: [],
    characters: [],
    events: [],
    ...overrides,
  };
}

function findingDraft(overrides: Partial<FindingDraft> = {}): FindingDraft {
  return {
    agent: "canon-lore",
    category: "canon",
    type: "canon-contradiction",
    severity: "major",
    confidence: 0.95,
    minStrictness: "standard",
    message: "Contradicts confirmed canon.",
    quote: "the river ran west",
    location: { file: "ch1.md", startOffset: 10, endOffset: 30 },
    canonRefs: ["canon_x"],
    suggestion: null,
    ...overrides,
  };
}

function emptySettings(projectId = "proj_accept"): ProjectSettings {
  return { projectId, agents: [], exceptions: [], dismissed: [] };
}

function exception(overrides: Partial<CanonException> = {}): CanonException {
  return {
    id: "exc_1",
    projectId: "proj_accept",
    scope: "rule",
    ref: "canon-contradiction",
    reason: "writer marked this intentional",
    createdAt: TS,
    ...overrides,
  };
}

function dismissal(overrides: Partial<DismissedFinding> = {}): DismissedFinding {
  return {
    findingId: "fnd_1",
    projectId: "proj_accept",
    dismissedAt: TS,
    ...overrides,
  };
}

type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  enum?: unknown[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
};

function validateAgainstSchema(value: unknown, schema: JsonSchema, at = "$"): string[] {
  const errors: string[] = [];
  if (schema.type !== undefined) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = expected.some((t) => {
      if (value === null) return t === "null";
      if (t === "integer") return typeof value === "number" && Number.isInteger(value);
      if (t === "array") return Array.isArray(value);
      if (t === "object") return typeof value === "object" && !Array.isArray(value);
      return typeof value === t;
    });
    if (!ok) {
      errors.push(`${at}: expected type ${expected.join("|")}, got ${JSON.stringify(value)}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} not in enum [${schema.enum.join(", ")}]`);
  }
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${at}: ${JSON.stringify(value)} fails pattern ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: ${value} below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: ${value} above maximum ${schema.maximum}`);
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((v, i) => errors.push(...validateAgainstSchema(v, schema.items!, `${at}[${i}]`)));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) errors.push(`${at}: missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) errors.push(...validateAgainstSchema(obj[key], sub, `${at}.${key}`));
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties ?? {}));
      for (const key of Object.keys(obj)) {
        if (!known.has(key)) errors.push(`${at}: additional property "${key}" not allowed`);
      }
    }
  }
  return errors;
}

test("ac-1: architecture doc component map covers every component with a status", () => {
  const arch = readRepo("docs/architecture.md");
  const mapStart = arch.indexOf("## Component map");
  const mapEnd = arch.indexOf("## Flow");
  assert.ok(mapStart >= 0 && mapEnd > mapStart, "component map section missing");
  const map = arch.slice(mapStart, mapEnd);

  const dataRows = map
    .split("\n")
    .filter((l) => l.trim().startsWith("|"))
    .slice(2);
  assert.ok(dataRows.length >= 4, `expected several component rows, got ${dataRows.length}`);
  for (const row of dataRows) {
    const cells = row.split("|").slice(1, -1).map((c) => c.trim().replaceAll("`", ""));
    assert.ok(cells.length >= 3, `component row lacks component/package/status cells: ${row}`);
    assert.ok(
      /^(current|planned|potential)\b/.test(cells[2]),
      `component "${cells[0]}" has no known status: "${cells[2]}"`,
    );
  }

  for (const pkg of ["packages/core", "packages/agents", "packages/mcp-server", "packages/proof"]) {
    assert.ok(map.includes(pkg), `component map does not describe ${pkg}`);
  }
  assert.ok(
    arch.includes("schemas/finding.schema.json"),
    "architecture doc does not reference the findings schema",
  );
  for (const doc of [
    "docs/architecture.md",
    "docs/living-canon-data-model.md",
    "docs/findings-schema.md",
    "docs/agent-contract.md",
    "schemas/finding.schema.json",
  ]) {
    assert.ok(fs.existsSync(path.join(repoRoot(), doc)), `documented artifact missing: ${doc}`);
  }

  const componentsPath = path.join(repoRoot(), ".project/architecture/components.json");
  const components = JSON.parse(fs.readFileSync(componentsPath, "utf8")).components;
  assert.ok(Array.isArray(components) && components.length >= 4, "component registry too small");
  for (const component of components) {
    assert.ok(component.id && component.name, `component missing identity: ${JSON.stringify(component)}`);
    assert.ok(
      ["current", "planned", "potential"].includes(component.status),
      `component ${component.id} has unknown status ${component.status}`,
    );
  }
});

test("ac-1: repo scaffold wires the four workspace packages in dependency order", () => {
  const root = repoRoot();
  const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(rootPkg.workspaces, ["packages/*"]);
  assert.ok(typeof rootPkg.scripts.build === "string", "root build script missing");
  assert.ok(rootPkg.scripts.test.includes("npm run build"), "root test must build first (ac-6)");
  assert.ok(rootPkg.scripts.test.includes("@lorewardens/core"), "root test must run core tests");
  assert.ok(rootPkg.scripts.test.includes("@lorewardens/agents"), "root test must run agents tests");

  const dirs = fs.readdirSync(path.join(root, "packages")).sort();
  assert.deepEqual(dirs, ["agents", "core", "mcp-server", "proof"]);

  const deps = (dir: string): string[] =>
    Object.keys(JSON.parse(fs.readFileSync(path.join(root, "packages", dir, "package.json"), "utf8")).dependencies ?? {})
      .filter((d) => d.startsWith("@lorewardens/"))
      .sort();

  assert.deepEqual(deps("core"), [], "core must not depend on sibling packages");
  assert.deepEqual(deps("agents"), ["@lorewardens/core"]);
  assert.deepEqual(deps("mcp-server"), ["@lorewardens/agents", "@lorewardens/core"]);
  assert.deepEqual(deps("proof"), [
    "@lorewardens/agents",
    "@lorewardens/core",
    "@lorewardens/mcp-server",
  ]);

  for (const dir of dirs) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"));
    assert.ok(pkg.name.startsWith("@lorewardens/"), `${dir} package name not scoped`);
    assert.equal(pkg.type, "module", `${dir} must be ESM`);
    assert.ok(typeof pkg.scripts.build === "string", `${dir} has no build script`);
  }
});

test("ac-2: canon store applies only writer-confirmed proposals for every subject kind", async () => {
  const store = new InMemoryCanonStore();

  const empty = await store.read("proj_accept");
  assert.deepEqual(empty, { projectId: "proj_accept", entries: [], characters: [], events: [] });

  const proposals: CanonProposal[] = [
    {
      id: "prp_1",
      projectId: "proj_accept",
      proposedBy: "canon-lore",
      subjectKind: "canon-entry",
      action: "add",
      payload: canonEntry({ id: "canon_1" }),
      reason: "writer confirmed in review",
      createdAt: TS,
    },
    {
      id: "prp_2",
      projectId: "proj_accept",
      proposedBy: "character-consistency",
      subjectKind: "character",
      action: "add",
      payload: character({ id: "char_1" }),
      reason: "writer confirmed in review",
      createdAt: TS,
    },
    {
      id: "prp_3",
      projectId: "proj_accept",
      proposedBy: "timeline",
      subjectKind: "timeline-event",
      action: "add",
      payload: timelineEvent({ id: "ev_1" }),
      reason: "writer confirmed in review",
      createdAt: TS,
    },
  ];
  for (const proposal of proposals) await store.applyConfirmed(proposal);

  const afterAdd = await store.read("proj_accept");
  assert.deepEqual(afterAdd.entries.map((e) => e.id), ["canon_1"]);
  assert.deepEqual(afterAdd.characters.map((c) => c.id), ["char_1"]);
  assert.deepEqual(afterAdd.events.map((e) => e.id), ["ev_1"]);

  await store.applyConfirmed({
    id: "prp_4",
    projectId: "proj_accept",
    proposedBy: "writer",
    subjectKind: "canon-entry",
    action: "update",
    payload: canonEntry({ id: "canon_1", text: "The river Vessa runs west." }),
    reason: "writer corrected the fact",
    createdAt: TS,
  });
  const afterUpdate = await store.read("proj_accept");
  assert.equal(afterUpdate.entries[0].text, "The river Vessa runs west.");

  await store.applyConfirmed({
    id: "prp_5",
    projectId: "proj_accept",
    proposedBy: "writer",
    subjectKind: "canon-entry",
    action: "retire",
    payload: canonEntry({ id: "canon_1" }),
    reason: "writer retired the fact",
    createdAt: TS,
  });
  const afterRetire = await store.read("proj_accept");
  assert.equal(afterRetire.entries[0].status, "retired");
});

test("ac-2: canon entities carry writer locks and the store keeps them", async () => {
  const store = new InMemoryCanonStore();
  await store.applyConfirmed({
    id: "prp_lock",
    projectId: "proj_accept",
    proposedBy: "writer",
    subjectKind: "canon-entry",
    action: "add",
    payload: canonEntry({
      id: "canon_locked",
      kind: "rule",
      text: "Magic costs the caster a memory.",
      locked: true,
      lockReason: "core premise, not negotiable",
    }),
    reason: "writer locked this rule",
    createdAt: TS,
  });
  const readBack = await store.read("proj_accept");
  assert.equal(readBack.entries[0].locked, true);
  assert.equal(readBack.entries[0].lockReason, "core premise, not negotiable");

  assert.ok(
    AGENT_CONTRACT_RULES.some((rule) => /locked canon is inviolable/i.test(rule) && /major/i.test(rule)),
    "contract must state locked canon contradictions are major+",
  );
  assert.ok(
    AGENT_CONTRACT_RULES.some((rule) => /read-only/i.test(rule)),
    "contract must state agents never mutate canon",
  );
});

test("ac-2: writer memory — exceptions and dismissals persist in project settings", async () => {
  const store = new InMemoryCanonStore();
  await store.addException(
    exception({ id: "exc_rule", scope: "rule", ref: "unclear-time-jump" }),
  );
  await store.addException(
    exception({ id: "exc_passage", scope: "passage", ref: "ch3.md" }),
  );
  await store.dismissFinding(dismissal({ findingId: "fnd_abc" }));

  const settings = await store.settings("proj_accept");
  assert.deepEqual(
    settings.exceptions.map((e) => e.id),
    ["exc_rule", "exc_passage"],
  );
  assert.deepEqual(
    settings.dismissed.map((d) => d.findingId),
    ["fnd_abc"],
  );

  const untouched = await store.settings("other_project");
  assert.deepEqual(untouched, { projectId: "other_project", agents: [], exceptions: [], dismissed: [] });
});

test("ac-2: findings pipeline honors dismissals and all three exception scopes", () => {
  const findingA = makeFinding(findingDraft({ type: "canon-contradiction", location: { file: "ch1.md", startOffset: 0, endOffset: 5 } }));
  const findingB = makeFinding(findingDraft({ type: "unclear-time-jump", location: { file: "ch3.md", startOffset: 50, endOffset: 80 } }));
  const findingC = makeFinding(findingDraft({ type: "trait-contradiction", location: { file: "ch4.md", startOffset: 0, endOffset: 9 } }));
  const settings: ProjectSettings = {
    ...emptySettings(),
    exceptions: [
      exception({ id: "exc_f", scope: "finding", ref: findingA.id }),
      exception({ id: "exc_p", scope: "passage", ref: "ch3.md" }),
      exception({ id: "exc_r", scope: "rule", ref: "trait-contradiction" }),
    ],
    dismissed: [dismissal({ findingId: findingC.id })],
  };

  const survivors = filterFindings([findingA, findingB, findingC], {
    strictness: "strict",
    settings,
  });
  assert.deepEqual(survivors, [], "every finding matched an exception or dismissal");

  const kept = filterFindings(
    [makeFinding(findingDraft({ type: "knowledge-violation", location: { file: "ch9.md", startOffset: 0, endOffset: 4 } }))],
    { strictness: "strict", settings },
  );
  assert.equal(kept.length, 1, "unrelated findings must survive writer memory");
});

test("ac-2: living-canon docs cover confirmation, locks, and exceptions", () => {
  const doc = readRepo("docs/living-canon-data-model.md").toLowerCase();
  for (const phrase of [
    "canonproposal",
    "applyconfirmed",
    "locked",
    "lockreason",
    "exception",
    "dismiss",
    "proposed",
    "confirmed",
    "retired",
  ]) {
    assert.ok(doc.includes(phrase), `living-canon doc does not mention "${phrase}"`);
  }
});

test("ac-3: finding schema requires type, location, severity, explanation, and a nullable suggestion", () => {
  const schema: JsonSchema & { "$schema"?: string } = JSON.parse(
    readRepo("schemas/finding.schema.json"),
  );
  assert.ok(String(schema["$schema"]).includes("2020-12"), "schema must be draft 2020-12");

  for (const field of ["type", "location", "severity", "message", "suggestion", "id", "canonRefs"]) {
    assert.ok(schema.required?.includes(field), `schema required set lacks "${field}"`);
  }
  assert.ok(
    schema.properties?.location?.required?.includes("startOffset") &&
      schema.properties.location.required.includes("endOffset") &&
      schema.properties.location.required.includes("file"),
    "location must carry file + offsets",
  );
  assert.deepEqual(
    schema.properties?.suggestion?.type,
    ["string", "null"],
    "suggestion must be optional/advisory (string or null), never auto-applied",
  );
  assert.deepEqual(
    (schema.properties?.severity as JsonSchema | undefined)?.enum,
    ["info", "minor", "major", "critical"],
  );
});

test("ac-3: makeFinding output validates against the JSON Schema and matches the TS type shape", () => {
  const schema: JsonSchema = JSON.parse(readRepo("schemas/finding.schema.json"));
  const finding = makeFinding(findingDraft());

  assert.deepEqual(
    validateAgainstSchema(finding, schema),
    [],
    "a canonical finding must validate against the JSON Schema",
  );

  assert.deepEqual(
    Object.keys(finding).sort(),
    Object.keys(schema.properties ?? {}).sort(),
    "TS Finding shape and JSON Schema properties disagree",
  );

  const withSuggestion = makeFinding(findingDraft({ suggestion: "Consider: the river runs east." }));
  assert.deepEqual(validateAgainstSchema(withSuggestion, schema), []);
});

test("ac-3: schema rejects malformed findings", () => {
  const schema: JsonSchema = JSON.parse(readRepo("schemas/finding.schema.json"));

  const badSeverity = makeFinding(findingDraft({ severity: "blocker" as never }));
  assert.ok(
    validateAgainstSchema(badSeverity, schema).some((e) => e.includes("severity") && e.includes("enum")),
    "unknown severity must be rejected",
  );

  const missingOffsets = makeFinding(findingDraft());
  delete (missingOffsets.location as { startOffset?: number }).startOffset;
  assert.ok(
    validateAgainstSchema(missingOffsets, schema).some((e) => e.includes("startOffset")),
    "location without startOffset must be rejected",
  );

  const extraField = { ...makeFinding(findingDraft()), autoFix: "replace the sentence" };
  assert.ok(
    validateAgainstSchema(extraField, schema).some((e) => e.includes("autoFix")),
    "findings must not carry edit instructions (non-destructive)",
  );

  const badConfidence = makeFinding(findingDraft({ confidence: 1.5 }));
  assert.ok(
    validateAgainstSchema(badConfidence, schema).some((e) => e.includes("maximum")),
    "confidence must stay within 0..1",
  );

  const badId = makeFinding(findingDraft());
  badId.id = "not-a-finding-id";
  assert.ok(
    validateAgainstSchema(badId, schema).some((e) => e.includes("pattern") && e.includes("id")),
    "finding ids must follow the fnd_ pattern",
  );
});

test("ac-3: findings doc field table agrees with schema properties", () => {
  const schema: JsonSchema = JSON.parse(readRepo("schemas/finding.schema.json"));
  const doc = readRepo("docs/findings-schema.md");
  const table = doc.slice(doc.indexOf("## Fields"), doc.indexOf("## Pipeline semantics"));
  const docFields = new Set<string>();
  for (const line of table.split("\n")) {
    const cell = line.split("|")[1];
    const match = cell?.trim().match(/^`([a-zA-Z][a-zA-Z-]*)`$/);
    if (match) docFields.add(match[1]);
  }
  assert.deepEqual(
    [...docFields].sort(),
    Object.keys(schema.properties ?? {}).sort(),
    "docs/findings-schema.md field table and schemas/finding.schema.json disagree",
  );
});

test("ac-4: strictness levels are exactly off/gentle/standard/strict", () => {
  assert.deepEqual(
    Object.keys(STRICTNESS_ORDER).sort(),
    ["gentle", "off", "standard", "strict"],
    "strictness must be fixed to off/gentle/standard/strict",
  );
  assert.ok(STRICTNESS_ORDER.off < STRICTNESS_ORDER.gentle);
  assert.ok(STRICTNESS_ORDER.gentle < STRICTNESS_ORDER.standard);
  assert.ok(STRICTNESS_ORDER.standard < STRICTNESS_ORDER.strict);
  assert.ok(atLeastStrictness("strict", "gentle"));
  assert.ok(!atLeastStrictness("gentle", "strict"));
});

test("ac-4: confidence floors match the contract (0.9 / 0.7 / 0.4)", () => {
  assert.deepEqual(STRICTNESS_CONFIDENCE_FLOOR, { gentle: 0.9, standard: 0.7, strict: 0.4 });
  assert.ok(!("off" in STRICTNESS_CONFIDENCE_FLOOR), "off has no confidence floor — it never runs");
});

test("ac-4: surfacesAt gates by level and confidence; off never surfaces", () => {
  const boundary = (minStrictness: FindingDraft["minStrictness"], confidence: number) =>
    surfacesAt(makeFinding(findingDraft({ minStrictness, confidence })), "standard");

  assert.equal(boundary("gentle", 0.95), true, "clear gentle contradiction surfaces at standard");
  assert.equal(boundary("standard", 0.7), true, "confidence exactly at the floor surfaces");
  assert.equal(boundary("standard", 0.69), false, "confidence below the floor is held back");
  assert.equal(boundary("strict", 1), false, "strict-only notes do not surface at standard");
  assert.equal(
    surfacesAt(makeFinding(findingDraft()), "off"),
    false,
    "off never surfaces findings",
  );
  assert.equal(surfacesAt(makeFinding(findingDraft({ minStrictness: "strict", confidence: 0.4 })), "strict"), true);
  assert.equal(surfacesAt(makeFinding(findingDraft({ minStrictness: "strict", confidence: 0.39 })), "strict"), false);
});

test("ac-4: strictness off yields zero findings through the pipeline (agent not invoked)", () => {
  const loud = [
    makeFinding(findingDraft({ severity: "critical", confidence: 1, minStrictness: "gentle" })),
    makeFinding(findingDraft({ severity: "major", confidence: 0.99, minStrictness: "standard" })),
  ];
  assert.deepEqual(
    filterFindings(loud, { strictness: "off", settings: emptySettings() }),
    [],
    "off must produce zero findings at zero cost",
  );
});

test("ac-4: agent contract doc fixes the four levels and floors", () => {
  const doc = readRepo("docs/agent-contract.md");
  const section = doc.slice(doc.indexOf("## Strictness levels"), doc.indexOf("## Modular enable/disable"));
  for (const level of ["off", "gentle", "standard", "strict"]) {
    assert.ok(section.includes(level), `strictness table lacks level "${level}"`);
  }
  for (const floor of ["0.9", "0.7", "0.4"]) {
    assert.ok(section.includes(floor), `strictness table lacks confidence floor ${floor}`);
  }
  assert.ok(
    /off.*not invoke|runtime does not invoke/i.test(section),
    "off must mean the agent is never invoked",
  );
});

test("ac-5: context selector returns only confirmed items relevant to the changed chunk", () => {
  const snap = snapshot({
    entries: [
      canonEntry({ id: "canon_rule_magic", kind: "rule", text: "Magic costs a memory.", tags: ["magic"], locked: true }),
      canonEntry({ id: "canon_fact_river", text: "The river Vessa runs east.", tags: ["river"] }),
      canonEntry({ id: "canon_fact_harbor", text: "The harbor closes each winter.", tags: ["harbor"] }),
      canonEntry({ id: "canon_fact_proposed", text: "Draft fact awaiting confirmation.", tags: ["magic"], status: "proposed" }),
    ],
    characters: [
      character({ id: "char_mira", name: "Mira", aliases: ["the cartographer"] }),
      character({ id: "char_retired", name: "Old Ro", status: "retired" }),
    ],
    events: [
      timelineEvent({ id: "ev_mira", participants: ["char_mira"] }),
      timelineEvent({ id: "ev_proposed", participants: ["char_mira"], status: "proposed" }),
    ],
  });

  const ctx = selectRelevantContext("Mira bargained with the river spirit while the magic hummed.", snap);
  assert.deepEqual(ctx.entries.map((e) => e.id), ["canon_rule_magic", "canon_fact_river"]);
  assert.deepEqual(ctx.characters.map((c) => c.id), ["char_mira"]);
  assert.deepEqual(ctx.events.map((e) => e.id), ["ev_mira"]);

  const byAlias = selectRelevantContext("The cartographer packed her ink.", snap);
  assert.deepEqual(byAlias.characters.map((c) => c.id), ["char_mira"]);
  assert.deepEqual(byAlias.entries.map((e) => e.id), ["canon_rule_magic"]);
  assert.deepEqual(byAlias.events.map((e) => e.id), ["ev_mira"]);

  const retired = selectRelevantContext("Old Ro whispered.", snap);
  assert.deepEqual(retired.characters, [], "retired characters never feed context");
  assert.deepEqual(retired.events, [], "events only enter via confirmed participants");

  const minimal = selectRelevantContext("A stray dog barked.", snap);
  assert.deepEqual(
    minimal.entries.map((e) => e.id),
    ["canon_rule_magic"],
    "only world rules stay in context; unrelated confirmed facts do not",
  );
  assert.deepEqual(minimal.characters, []);
});

test("ac-5: incremental input rule is written into the contract and the docs", () => {
  assert.ok(
    AGENT_CONTRACT_RULES.some((rule) => /changed chunk/i.test(rule) && /minimal canon context/i.test(rule)),
    "contract rules must include the incremental input rule",
  );

  const contract = readRepo("docs/agent-contract.md");
  assert.ok(/incremental input/i.test(contract), "agent contract must document incremental input");
  assert.ok(
    /must not require/i.test(contract) && /full manuscript/i.test(contract),
    "contract must forbid requiring the full manuscript",
  );

  const canonDoc = readRepo("docs/living-canon-data-model.md");
  assert.ok(
    /incremental analysis contract/i.test(canonDoc),
    "canon doc must carry the incremental analysis section",
  );
  assert.ok(
    /never see the whole manuscript/i.test(canonDoc),
    "canon doc must state agents never see the whole manuscript",
  );

  const agentSrc = readRepo("packages/core/src/agent.ts");
  const start = agentSrc.indexOf("interface AnalyzeInput");
  const end = agentSrc.indexOf("}", start);
  assert.ok(start >= 0 && end > start, "AnalyzeInput interface missing");
  const block = agentSrc.slice(start, end);
  assert.ok(/\bchunk\b/.test(block) && /\bcontext\b/.test(block), "input must be chunk + context");
  assert.doesNotMatch(block, /manuscript/i, "AnalyzeInput must not carry the full manuscript");
});

test("ac-6: npm run build succeeds from the repo root and test scripts target every testable workspace", () => {
  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot(),
    encoding: "utf8",
    timeout: 180_000,
  });
  assert.equal(
    result.status,
    0,
    `npm run build failed on the repo tree:\n${result.stdout}\n${result.stderr}`,
  );

  const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "package.json"), "utf8"));
  for (const dir of ["core", "agents"]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "packages", dir, "package.json"), "utf8"));
    assert.ok(/node --test/.test(pkg.scripts.test), `packages/${dir} must run its suite with node --test`);
  }
  assert.ok(rootPkg.engines && /20/.test(String(rootPkg.engines.node)), "engines must pin Node >= 20");
});
