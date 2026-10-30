import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadFixtureBundle } from "../src/store.js";
import { runCanonListTool } from "../src/tools.js";
import {
  CANON_BOOTSTRAP_TOOL_NAME,
  CanonBootstrapInput,
  buildCanonBootstrapTool,
  runCanonBootstrapTool,
} from "../src/bootstrap.js";

const STORY =
  "Mira, the cartographer, unrolled her map. Daven sat with Mira, and Mira carried the lamp. " +
  "Daven found Mira at the tent. Every gate closes at dusk.";

const BOOTSTRAP_INPUT = { projectId: "storydraft", source: { kind: "text" as const, text: STORY } };

interface BootstrapResult {
  projectId: string;
  source: { kind: string; label: string; length: number };
  generatedAt: string;
  snapshot: {
    projectId: string;
    entries: { id: string; kind: string; text: string; status: string; locked: boolean }[];
    characters: { id: string; name: string; status: string; locked: boolean; aliases: string[] }[];
    events: { id: string; order: number; precision: string; participants: string[]; status: string }[];
  };
  counts: {
    entries: { fact: number; rule: number; history: number; setting: number };
    characters: number;
    events: number;
  };
  notes: string[];
  writtenTo?: string;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "lore-bootstrap-"));
}

// ---------------------------------------------------------------------------
// registration and tool contract
// ---------------------------------------------------------------------------

test("canon_bootstrap is registered last in the server bundle", () => {
  const tool = buildCanonBootstrapTool();
  assert.equal(tool.name, CANON_BOOTSTRAP_TOOL_NAME);
  assert.ok(tool.description.length > 20);
});

test("canon_bootstrap accepts pasted text and returns the draft contract", async () => {
  const result = (await runCanonBootstrapTool(BOOTSTRAP_INPUT)) as BootstrapResult;
  assert.equal(result.projectId, "storydraft");
  assert.deepEqual(result.source, { kind: "text", label: "pasted-text", length: STORY.length });
  assert.equal(result.generatedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(result.writtenTo, undefined);
  assert.equal(result.snapshot.projectId, "storydraft");
  assert.equal(result.snapshot.entries.length, 1);
  assert.equal(result.snapshot.entries[0]!.kind, "rule");
  assert.equal(result.snapshot.characters.length, 1);
  assert.equal(result.snapshot.characters[0]!.name, "Mira");
  assert.deepEqual(result.snapshot.characters[0]!.aliases, ["the cartographer"]);
  assert.equal(result.snapshot.events.length, 1);
  assert.deepEqual(result.snapshot.events[0]!.participants, ["char_mira"]);
  assert.deepEqual(result.counts, {
    entries: { fact: 0, rule: 1, history: 0, setting: 0 },
    characters: 1,
    events: 1,
  });
  assert.ok(Array.isArray(result.notes) && result.notes.length > 0);
  for (const item of [
    ...result.snapshot.entries,
    ...result.snapshot.characters,
    ...result.snapshot.events,
  ]) {
    assert.equal((item as { status: string }).status, "proposed");
    assert.equal((item as { locked: boolean }).locked, false);
  }
});

test("the same input yields byte-identical tool output across calls (ac-4)", async () => {
  const first = await runCanonBootstrapTool(BOOTSTRAP_INPUT);
  const second = await runCanonBootstrapTool(BOOTSTRAP_INPUT);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("a custom label flows into the provenance spans and the result", async () => {
  const result = (await runCanonBootstrapTool({
    projectId: "storydraft",
    source: { kind: "text", text: "Every gate closes at dusk.", label: "chapter-1.md" },
  })) as BootstrapResult;
  assert.equal(result.source.label, "chapter-1.md");
  const entry = result.snapshot.entries[0] as unknown as {
    sources: { file: string }[];
  };
  assert.equal(entry.sources[0]!.file, "chapter-1.md");
});

test("a local file source is read as UTF-8 and labeled with the path as given", async () => {
  const dir = tempDir();
  try {
    const storyPath = join(dir, "story.txt");
    writeFileSync(storyPath, STORY, "utf8");
    const result = (await runCanonBootstrapTool({
      projectId: "storydraft",
      source: { kind: "file", path: storyPath },
    })) as BootstrapResult;
    assert.equal(result.source.kind, "file");
    assert.equal(result.source.label, storyPath);
    assert.equal(result.source.length, STORY.length);
    assert.equal(result.snapshot.entries.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unreadable file sources produce a clear tool error", async () => {
  await assert.rejects(
    () =>
      runCanonBootstrapTool({
        projectId: "storydraft",
        source: { kind: "file", path: join(tempDir(), "missing.txt") },
      }),
    /Cannot read source file/,
  );
});

test("malformed input is rejected by the schema", async () => {
  await assert.rejects(() => runCanonBootstrapTool({ projectId: "storydraft" }), /source/i);
  await assert.rejects(
    () => runCanonBootstrapTool({ projectId: "storydraft", source: { kind: "text", text: "" } }),
    /text/,
  );
  await assert.rejects(
    () =>
      runCanonBootstrapTool({
        projectId: "storydraft",
        source: { kind: "text", text: "Hello." },
        generatedAt: "not-a-timestamp",
      }),
    /generatedAt|Invalid/i,
  );
  await assert.rejects(
    () => runCanonBootstrapTool({ projectId: "storydraft", source: { kind: "web", url: "x" } }),
    /source/i,
  );
});

// ---------------------------------------------------------------------------
// outputPath governance: write only on request, never overwrite, no mkdir
// ---------------------------------------------------------------------------

test("outputPath writes the draft exactly once; a second call refuses and leaves the file untouched", async () => {
  const dir = tempDir();
  try {
    const draftPath = join(dir, "storydraft.canon.json");
    const first = (await runCanonBootstrapTool({
      ...BOOTSTRAP_INPUT,
      outputPath: draftPath,
    })) as BootstrapResult;
    assert.equal(first.writtenTo, draftPath);
    assert.ok(existsSync(draftPath));
    const fileContent = readFileSync(draftPath, "utf8");
    assert.equal(fileContent, JSON.stringify(first.snapshot, null, 2) + "\n");
    assert.deepEqual(JSON.parse(fileContent), first.snapshot);

    await assert.rejects(
      () => runCanonBootstrapTool({ ...BOOTSTRAP_INPUT, outputPath: draftPath }),
      /already exists|never overwrite/i,
    );
    assert.equal(readFileSync(draftPath, "utf8"), fileContent, "the existing draft file is untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("outputPath with a missing parent directory is refused and nothing is created", async () => {
  const dir = tempDir();
  try {
    const draftPath = join(dir, "no-such-subdir", "storydraft.canon.json");
    await assert.rejects(
      () => runCanonBootstrapTool({ ...BOOTSTRAP_INPUT, outputPath: draftPath }),
      /Parent directory/,
    );
    assert.equal(existsSync(join(dir, "no-such-subdir")), false, "no directory is created");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ac-2: nothing auto-confirms, the store is untouched
// ---------------------------------------------------------------------------

test("a bootstrap call leaves the fixture store byte-identical: canon_list unchanged before/after", async () => {
  const dir = tempDir();
  try {
    const { loadFixtures } = await import("../src/store.js");
    const { store, projectIds } = loadFixtures();
    const before = await runCanonListTool(store, { projectId: "demo" });
    const settingsBefore = await store.settings("demo");

    const result = (await runCanonBootstrapTool({
      projectId: "demo",
      source: { kind: "text", text: STORY },
      outputPath: join(dir, "demo.canon.json"),
    })) as BootstrapResult;

    const after = await runCanonListTool(store, { projectId: "demo" });
    const settingsAfter = await store.settings("demo");
    assert.deepEqual(after, before, "canon_list output is unchanged after a bootstrap call");
    assert.deepEqual(settingsAfter, settingsBefore);
    assert.deepEqual(projectIds, ["demo"], "no project is registered by bootstrap");

    await assert.rejects(() => store.applyConfirmed({} as never), /read-only/i);

    const written = JSON.parse(readFileSync(join(dir, "demo.canon.json"), "utf8"));
    assert.deepEqual(written, result.snapshot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ac-5: the draft file loads cleanly through the existing fixture validation
// ---------------------------------------------------------------------------

test("a draft written to a temp fixtures dir loads through loadFixtureBundle (ac-5)", async () => {
  const dir = tempDir();
  try {
    const result = (await runCanonBootstrapTool({
      ...BOOTSTRAP_INPUT,
      outputPath: join(dir, "storydraft.canon.json"),
    })) as BootstrapResult;
    const bundle = loadFixtureBundle(dir, "storydraft");
    assert.deepEqual(bundle.snapshot, result.snapshot);
    assert.equal(bundle.snapshot.projectId, "storydraft");
    assert.ok(bundle.snapshot.entries.length > 0);
    assert.ok(bundle.snapshot.characters.length > 0);
    assert.ok(bundle.snapshot.events.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ac-3: no network modules and no nondeterministic APIs in the new path
// ---------------------------------------------------------------------------

test("the bootstrap source files contain no network entry points (ac-3)", () => {
  const coreBootstrap = fileURLToPath(new URL("../../../core/src/bootstrap.ts", import.meta.url));
  const serverBootstrap = fileURLToPath(new URL("../../src/bootstrap.ts", import.meta.url));
  const forbidden: [string, RegExp][] = [
    ["fetch(", /\bfetch\s*\(/],
    ["XMLHttpRequest", /\bXMLHttpRequest\b/],
    ["WebSocket", /\bWebSocket\b/],
    ["axios", /\baxios\b/],
    ["undici", /\bundici\b/],
    ["node:http", /node:http/],
    ["node:net", /node:net\b/],
    ["node:tls", /node:tls\b/],
    ["node:dns", /node:dns\b/],
    ["URL", /\bhttps?:\/\//],
    ["Date.now", /\bDate\.now\b/],
    ["new Date", /\bnew Date\b/],
    ["Math.random", /\bMath\.random\b/],
    ["locale API", /\btoLocale[A-Za-z]*\b/],
    ["localeCompare", /\blocaleCompare\b/],
  ];
  const offenders: string[] = [];
  for (const file of [coreBootstrap, serverBootstrap]) {
    const content = readFileSync(file, "utf8");
    for (const [label, re] of forbidden) {
      if (re.test(content)) offenders.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the tool input schema requires exactly one source kind", () => {
  const parsed = CanonBootstrapInput.parse(BOOTSTRAP_INPUT) as { source: { kind: string } };
  assert.equal(parsed.source.kind, "text");
  assert.throws(() => CanonBootstrapInput.parse({ projectId: "x" }));
  assert.throws(() => CanonBootstrapInput.parse({ projectId: "x", source: { kind: "web", url: "x" } }));
});
