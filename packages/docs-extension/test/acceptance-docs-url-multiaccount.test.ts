import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { documentIdFromUrl } from "../src/lib/docs-url.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const DEVELOP_BASE = "5739b14dce0a97c1279b8041591b26a2634cf22c";
const REVIEWED_REVISION = "019453afcda682470c65c13851752dc54dd05bc4";
const ACCEPTANCE_FILE = "packages/docs-extension/test/acceptance-docs-url-multiaccount.test.ts";

type Row = {
  name: string;
  url: string | undefined;
  expected: string | null;
  changedFromLegacy: boolean;
};

const ROWS: Row[] = [
  {
    name: "single-account Docs URL",
    url: "https://docs.google.com/document/d/abc123/edit",
    expected: "abc123",
    changedFromLegacy: false,
  },
  {
    name: "fragment after the id",
    url: "https://docs.google.com/document/d/abc123/edit#heading=h.x",
    expected: "abc123",
    changedFromLegacy: false,
  },
  {
    name: "multi-account /u/1/",
    url: "https://docs.google.com/document/u/1/d/abc123/edit",
    expected: "abc123",
    changedFromLegacy: true,
  },
  {
    name: "multi-account /u/2/ full id charset",
    url: "https://docs.google.com/document/u/2/d/docXYZ_9-/edit",
    expected: "docXYZ_9-",
    changedFromLegacy: true,
  },
  {
    name: "multi-account /u/0/",
    url: "https://docs.google.com/document/u/0/d/abc123/edit",
    expected: "abc123",
    changedFromLegacy: true,
  },
  {
    name: "slides negative",
    url: "https://docs.google.com/presentation/d/xyz123/edit",
    expected: null,
    changedFromLegacy: false,
  },
  {
    name: "sheets negative",
    url: "https://docs.google.com/spreadsheets/d/xyz123/edit",
    expected: null,
    changedFromLegacy: false,
  },
  {
    name: "drive negative",
    url: "https://drive.google.com/file/d/xyz123/view",
    expected: null,
    changedFromLegacy: false,
  },
  {
    name: "plain https negative",
    url: "https://example.com/some/page",
    expected: null,
    changedFromLegacy: false,
  },
  {
    name: "non-digit u segment negative",
    url: "https://docs.google.com/document/u/abc/d/abc123/edit",
    expected: null,
    changedFromLegacy: false,
  },
  {
    name: "empty id negative",
    url: "https://docs.google.com/document/d/",
    expected: null,
    changedFromLegacy: false,
  },
  {
    name: "undefined url",
    url: undefined,
    expected: null,
    changedFromLegacy: false,
  },
];

const MULTI_ACCOUNT_SAME_ID: [multi: string, single: string][] = [
  ["https://docs.google.com/document/u/1/d/abc123/edit", "https://docs.google.com/document/d/abc123/edit"],
  ["https://docs.google.com/document/u/0/d/abc123/edit", "https://docs.google.com/document/d/abc123/edit"],
  ["https://docs.google.com/document/u/2/d/docXYZ_9-/edit", "https://docs.google.com/document/d/docXYZ_9-/edit"],
  ["https://docs.google.com/document/u/12/d/Ab-9_/edit", "https://docs.google.com/document/d/Ab-9_/edit"],
  ["https://docs.google.com/document/u/999/d/longId_42-/edit?usp=sharing", "https://docs.google.com/document/d/longId_42-/edit?usp=sharing"],
];

const LEGACY_PRESERVED_EXTRAS: [url: string, id: string | null][] = [
  ["https://example.com/document/d/abc123", "abc123"],
  ["https://docs.google.com/presentation/u/1/d/xyz123/edit", null],
  ["https://docs.google.com/document/du/1/d/abc123/edit", null],
];

function legacyDocumentIdFromUrl(url: string | undefined): string | null {
  if (url === undefined) return null;
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match === null ? null : (match[1] as string);
}

function git(args: string[]): SpawnSyncReturns<string> {
  const run = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", timeout: 60000 });
  if (run.error) throw new Error(`failed to spawn git ${args.join(" ")}: ${run.error.message}`);
  assert.equal(
    run.status,
    0,
    `git ${args.join(" ")} exited ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
  );
  return run;
}

function gitChangedFiles(range: [string, string], filter?: string, pathspec?: string): string[] {
  const args = ["diff", "--name-only", range[0], range[1]];
  if (filter) args.push(`--diff-filter=${filter}`);
  if (pathspec) args.push("--", pathspec);
  return git(args).stdout.split("\n").filter(Boolean);
}

function gitDiffText(pathspec: string, range: [string, string]): string {
  return git(["diff", "--no-color", range[0], range[1], "--", pathspec]).stdout;
}

function diffAddedLines(diffText: string): string[] {
  return diffText
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function diffRemovedLines(diffText: string): string[] {
  return diffText
    .split("\n")
    .filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line.slice(1));
}

test("acceptance: multi-account /document/u/<digits>/d/<id> resolves the same id as the single-account form (ac-1)", () => {
  assert.ok(MULTI_ACCOUNT_SAME_ID.length >= 3, "multi-account parity cases are present");
  for (const [multi, single] of MULTI_ACCOUNT_SAME_ID) {
    assert.equal(
      documentIdFromUrl(multi),
      documentIdFromUrl(single),
      `multi-account form ${multi} must resolve to the same id as the single-account form ${single}`,
    );
  }
});

test("acceptance: existing resolutions are preserved exactly against the legacy matcher (ac-2)", () => {
  assert.equal(ROWS.length, 12, "the pin table has exactly 12 rows");
  for (const row of ROWS) {
    assert.equal(
      documentIdFromUrl(row.url),
      row.expected,
      `row '${row.name}' must resolve to ${row.expected === null ? "null" : row.expected}`,
    );
    const before = legacyDocumentIdFromUrl(row.url);
    const after = documentIdFromUrl(row.url);
    if (row.changedFromLegacy) {
      assert.equal(before, null, `row '${row.name}' was unmatched before the fix`);
      assert.notEqual(after, null, `row '${row.name}' is the intended new resolution`);
    } else {
      assert.equal(after, before, `row '${row.name}' must resolve exactly as before the fix`);
    }
  }
  const changed = ROWS.filter((row) => row.changedFromLegacy);
  assert.equal(
    changed.length,
    3,
    "only the three multi-account rows change behavior; everything else is byte-identical to the legacy matcher",
  );
  for (const [url, id] of LEGACY_PRESERVED_EXTRAS) {
    assert.equal(
      documentIdFromUrl(url),
      id,
      `extra preservation pin ${url} must resolve to ${id === null ? "null" : id} exactly as before`,
    );
    assert.equal(documentIdFromUrl(url), legacyDocumentIdFromUrl(url), `extra pin ${url} matches the legacy matcher`);
  }
});

test("acceptance: the new docs-url.test.ts covers every row of the 12-row pin table (ac-3)", () => {
  const builderTestPath = join(PACKAGE_ROOT, "test", "docs-url.test.ts");
  const content = readFileSync(builderTestPath, "utf8");
  const rowTests = content.match(/test\("documentIdFromUrl/g) ?? [];
  assert.equal(
    rowTests.length,
    12,
    `docs-url.test.ts must pin exactly 12 documentIdFromUrl rows, found ${rowTests.length}`,
  );
  for (const row of ROWS) {
    if (row.url === undefined) {
      assert.match(content, /test\("documentIdFromUrl: undefined yields null"/, `row '${row.name}' must be pinned`);
    } else {
      assert.ok(
        content.includes(row.url),
        `row '${row.name}' (${row.url}) must appear verbatim in docs-url.test.ts`,
      );
    }
  }
  assert.ok(
    content.includes("https://docs.google.com/*"),
    "the manifest-grant acceptance row must be present in docs-url.test.ts",
  );
});

test("acceptance: no existing test file was modified by the fix (ac-3)", () => {
  const modifiedTestFiles = gitChangedFiles([DEVELOP_BASE, REVIEWED_REVISION], "M", "packages").filter((file) =>
    file.includes("/test/"),
  );
  assert.deepEqual(
    modifiedTestFiles,
    [],
    `no existing test file may be modified between base and the reviewed revision, saw: ${modifiedTestFiles.join(", ")}`,
  );
  const addedTestFiles = gitChangedFiles([DEVELOP_BASE, REVIEWED_REVISION], "A", "packages").filter((file) =>
    file.includes("/test/"),
  );
  assert.deepEqual(
    addedTestFiles,
    ["packages/docs-extension/test/docs-url.test.ts"],
    "the only test-side addition is the new docs-url.test.ts",
  );
});

test("acceptance: service-worker.ts diff is exactly the import swap plus local-function removal (ac-4)", () => {
  const swDiff = gitDiffText("packages/docs-extension/src/background/service-worker.ts", [DEVELOP_BASE, REVIEWED_REVISION]);
  const added = diffAddedLines(swDiff);
  const removed = diffRemovedLines(swDiff).map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(
    added,
    ['import { documentIdFromUrl } from "../lib/docs-url.js";'],
    "the only added line in service-worker.ts is the docs-url import",
  );
  assert.deepEqual(
    removed,
    [
      "function documentIdFromUrl(url: string | undefined): string | null {",
      "if (url === undefined) return null;",
      "const match = url.match(/\\/document\\/d\\/([a-zA-Z0-9_-]+)/);",
      "return match === null ? null : (match[1] as string);",
      "}",
    ],
    "the only removed lines are the module-private local documentIdFromUrl function",
  );
  const current = readFileSync(join(PACKAGE_ROOT, "src", "background", "service-worker.ts"), "utf8");
  assert.ok(
    current.includes('import { documentIdFromUrl } from "../lib/docs-url.js";'),
    "service-worker.ts imports documentIdFromUrl from the new lib module",
  );
  assert.ok(!current.includes("function documentIdFromUrl"), "the local definition is gone from service-worker.ts");
  assert.match(current, /documentIdFromUrl\(/, "the grab-active-doc call site still resolves the document id");
});

test("acceptance: docs-url.ts is a pure lib with the spec regex (ac-4)", () => {
  const lib = readFileSync(join(PACKAGE_ROOT, "src", "lib", "docs-url.ts"), "utf8");
  assert.match(
    lib,
    /export function documentIdFromUrl\(url: string \| undefined\): string \| null \{/,
    "documentIdFromUrl is exported from the pure lib module",
  );
  assert.ok(
    lib.includes('const match = url.match(/\\/document\\/(?:u\\/\\d+\\/)?d\\/([a-zA-Z0-9_-]+)/);'),
    "the regex keeps the id charset and adds only the optional non-capturing /u/<digits>/ segment",
  );
  assert.match(lib, /if \(url === undefined\) return null;/, "undefined handling is preserved");
});

test("acceptance: the manifest grants persistent docs.google.com tab visibility (amended scope)", () => {
  const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "manifest.json"), "utf8")) as {
    host_permissions?: string[];
  };
  assert.ok(
    manifest.host_permissions?.includes("https://docs.google.com/*"),
    "host permission 'https://docs.google.com/*' must be granted so tab.url stays visible for Docs tabs",
  );
});

test("acceptance: diff vs base shows exactly the amended contract files and nothing else (ac-6)", () => {
  const builderFiles = gitChangedFiles([DEVELOP_BASE, REVIEWED_REVISION]).sort();
  assert.deepEqual(
    builderFiles,
    [
      "packages/docs-extension/manifest.json",
      "packages/docs-extension/src/background/service-worker.ts",
      "packages/docs-extension/src/lib/docs-url.ts",
      "packages/docs-extension/test/docs-url.test.ts",
    ],
    "the reviewed revision touches exactly the amended region contract",
  );
  const manifestDiff = gitDiffText("packages/docs-extension/manifest.json", [DEVELOP_BASE, REVIEWED_REVISION]);
  assert.deepEqual(
    diffAddedLines(manifestDiff).map((line) => line.trim()),
    ['"https://docs.google.com/*",'],
    "the manifest diff is exactly the one host-permission line",
  );
  const authoredDelta = gitChangedFiles([REVIEWED_REVISION, "HEAD"]).sort();
  assert.deepEqual(
    authoredDelta,
    [ACCEPTANCE_FILE],
    "the authored acceptance suite is the only change on top of the reviewed revision",
  );
});

test("acceptance: root npm test chains build plus all six workspace suites in one command (ac-5)", () => {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const script = root.scripts.test ?? "";
  assert.ok(script.startsWith("npm run build &&"), "root npm test builds before testing");
  let cursor = -1;
  for (const workspace of ["core", "agents", "mcp-server", "bridge", "proof", "docs-extension"]) {
    const at = script.indexOf(`-w @lorewardens/${workspace}`);
    assert.ok(at > cursor, `root npm test does not chain the ${workspace} suite`);
    cursor = at;
  }
});

test("acceptance: a sibling workspace leg runs green from inside the suite (bridge canary, ac-5)", () => {
  const run = spawnSync("npm", ["run", "test", "-w", "@lorewardens/bridge"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 180000,
  });
  if (run.error) throw run.error;
  assert.equal(
    run.status,
    0,
    `bridge leg exited ${run.status}\nstdout: ${run.stdout?.slice(-2000)}\nstderr: ${run.stderr?.slice(-2000)}`,
  );
});

test("acceptance: the url-resolution surface is deterministic across passes (ac-5)", () => {
  const surface = (): (string | null)[] => [
    ...ROWS.map((row) => documentIdFromUrl(row.url)),
    ...MULTI_ACCOUNT_SAME_ID.map(([multi]) => documentIdFromUrl(multi)),
    ...LEGACY_PRESERVED_EXTRAS.map(([url]) => documentIdFromUrl(url)),
  ];
  const first = surface();
  const second = surface();
  assert.deepEqual(second, first);
});
