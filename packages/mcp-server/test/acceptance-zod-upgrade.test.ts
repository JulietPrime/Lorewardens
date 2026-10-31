import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ZodError } from "zod";
import { DEFAULT_GENERATED_AT } from "@lorewardens/core";
import { CanonBootstrapInput, runCanonBootstrapTool } from "../src/bootstrap.js";
import { AnalyzeToolInput, CanonListInput } from "../src/tools.js";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const MIN_ZOD = "4.6.7";

function atLeast(version: string, minimum: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(/[.-]/)
      .slice(0, 3)
      .map((part) => Number(part));
  const got = parse(version);
  const want = parse(minimum);
  for (let i = 0; i < 3; i++) {
    if ((got[i] ?? 0) !== (want[i] ?? 0)) return (got[i] ?? 0) > (want[i] ?? 0);
  }
  return true;
}

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runNpm(args: string[], timeoutMs = 120000): SpawnSyncReturns<string> {
  const run = spawnSync(npmBin(), args, { cwd: REPO_ROOT, encoding: "utf8", timeout: timeoutMs });
  if (run.error) throw new Error(`failed to spawn npm ${args.join(" ")}: ${run.error.message}`);
  return run as unknown as SpawnSyncReturns<string>;
}

function collectSourceFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full, ext));
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}

test("acceptance: mcp-server declares zod ^4.6.7 and the lockfile resolves a single zod >= 4.6.7 (ac-1)", () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    dependencies: Record<string, string>;
  };
  assert.equal(pkg.dependencies.zod, "^4.6.7");
  const lock = JSON.parse(readFileSync(join(REPO_ROOT, "package-lock.json"), "utf8")) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };
  assert.equal(lock.packages["packages/mcp-server"].dependencies?.zod, "^4.6.7");
  const zodEntries = Object.entries(lock.packages).filter(([key]) => /(^|\/)zod$/.test(key));
  assert.equal(
    zodEntries.length,
    1,
    `expected exactly one zod entry in the lockfile, saw: ${zodEntries.map(([key]) => key).join(", ")}`,
  );
  const version = zodEntries[0][1].version ?? "";
  assert.ok(atLeast(version, MIN_ZOD), `lockfile zod ${version} is below ${MIN_ZOD}`);
});

test("acceptance: npm ls zod shows exactly one zod instance in the tree, version >= 4.6.7 (ac-2)", () => {
  const run = runNpm(["ls", "zod", "--json"]);
  assert.equal(run.status, 0, `npm ls zod exited ${run.status}: ${run.stderr}`);
  const tree = JSON.parse(run.stdout) as {
    dependencies?: Record<
      string,
      { version?: string; resolved?: string; deduped?: boolean; dependencies?: unknown }
    >;
  };
  const found: { version?: string; resolved?: string; deduped?: boolean }[] = [];
  (function walk(node: { dependencies?: Record<string, never> }): void {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (name === "zod") {
        found.push(child as unknown as { version?: string; resolved?: string; deduped?: boolean });
      }
      walk(child as unknown as { dependencies?: Record<string, never> });
    }
  })(tree as unknown as { dependencies?: Record<string, never> });
  assert.ok(found.length > 0, "npm ls zod found no zod instance in the tree");
  for (const node of found) {
    assert.ok(
      atLeast(node.version ?? "", MIN_ZOD),
      `zod instance at version ${node.version} is below ${MIN_ZOD}`,
    );
  }
  const versions = new Set(found.map((node) => node.version));
  assert.equal(
    versions.size,
    1,
    `expected a single zod version in the tree, saw: ${[...versions].join(", ")}`,
  );
  const physical = found.filter((node) => !node.deduped && node.resolved);
  assert.equal(
    physical.length,
    1,
    `expected exactly one physical zod instance (deduped everywhere else), saw ${physical.length}`,
  );
});

test("acceptance: npm audit reports zero vulnerabilities (ac-3)", () => {
  const run = runNpm(["audit", "--json"]);
  assert.equal(run.status, 0, `npm audit exited ${run.status}: ${run.stderr}`);
  const report = JSON.parse(run.stdout) as { metadata?: { vulnerabilities?: { total?: number } } };
  assert.equal(
    report.metadata?.vulnerabilities?.total,
    0,
    `audit found vulnerabilities: ${JSON.stringify(report.metadata?.vulnerabilities)}`,
  );
});

test("acceptance: generatedAt validation is unchanged under zod 4 (ac-4)", () => {
  const base = {
    projectId: "zod-acceptance",
    source: { kind: "text" as const, text: "Mira unrolled her map." },
  };
  const utc = CanonBootstrapInput.parse({ ...base, generatedAt: "2026-01-01T00:00:00Z" });
  assert.equal(utc.generatedAt, "2026-01-01T00:00:00Z");
  const fractional = CanonBootstrapInput.parse({ ...base, generatedAt: DEFAULT_GENERATED_AT });
  assert.equal(fractional.generatedAt, DEFAULT_GENERATED_AT);
  const omitted = CanonBootstrapInput.parse({ ...base });
  assert.equal(omitted.generatedAt, undefined);
  assert.throws(
    () => CanonBootstrapInput.parse({ ...base, generatedAt: "2026-01-01T00:00:00+05:00" }),
    ZodError,
  );
  assert.throws(
    () => CanonBootstrapInput.parse({ ...base, generatedAt: "2026-01-01T00:00:00" }),
    ZodError,
  );
  assert.throws(() => CanonBootstrapInput.parse({ ...base, generatedAt: 42 }), ZodError);
  assert.throws(() => CanonBootstrapInput.parse({ source: base.source }), ZodError);
});

test("acceptance: the bootstrap draft tool behaves identically under zod 4 (ac-4)", async () => {
  const result = await runCanonBootstrapTool({
    projectId: "zod-upgrade-acceptance",
    source: { kind: "text", text: "Mira unrolled her map at dawn. Daven found the lamp near the tent." },
    generatedAt: "2026-01-01T00:00:00Z",
  });
  assert.equal(result.generatedAt, "2026-01-01T00:00:00Z");
  assert.equal(result.snapshot.projectId, "zod-upgrade-acceptance");
  assert.ok(Array.isArray(result.notes));
  await assert.rejects(
    runCanonBootstrapTool({
      projectId: "zod-upgrade-acceptance",
      source: { kind: "text", text: "Mira unrolled her map at dawn." },
      generatedAt: "2026-01-01T00:00:00+05:00",
    }),
    ZodError,
  );
});

test("acceptance: analyze and canon_list input schemas parse identically under zod 4 (ac-4)", () => {
  const analyze = AnalyzeToolInput.parse({
    projectId: "demo-project",
    chunk: { text: "Mira unrolled her map.", file: "demo/ch1.md", startOffset: 0, endOffset: 22 },
  });
  assert.equal(analyze.projectId, "demo-project");
  assert.equal(analyze.chunk.file, "demo/ch1.md");
  assert.equal(analyze.strictness, undefined);
  assert.throws(
    () =>
      AnalyzeToolInput.parse({
        projectId: "demo-project",
        chunk: { text: "", file: "demo/ch1.md", startOffset: 0, endOffset: 1 },
      }),
    ZodError,
  );
  assert.throws(
    () =>
      AnalyzeToolInput.parse({
        projectId: "demo-project",
        chunk: { text: "t", file: "demo/ch1.md", startOffset: -1, endOffset: 1 },
      }),
    ZodError,
  );
  assert.throws(
    () =>
      AnalyzeToolInput.parse({
        projectId: "demo-project",
        chunk: { text: "t", file: "demo/ch1.md", startOffset: 0, endOffset: 1 },
        strictness: "bogus",
      }),
    ZodError,
  );
  assert.throws(() => AnalyzeToolInput.parse({ projectId: "demo-project" }), ZodError);
  const list = CanonListInput.parse({ projectId: "demo-project" });
  assert.equal(list.projectId, "demo-project");
  assert.throws(() => CanonListInput.parse({}), ZodError);
  assert.throws(() => CanonListInput.parse({ projectId: "" }), ZodError);
});

test("acceptance: z.string().datetime() is fully migrated to z.iso.datetime() in mcp-server src (ac-4)", () => {
  const srcDir = join(PACKAGE_ROOT, "src");
  const files = collectSourceFiles(srcDir, ".ts");
  assert.ok(files.length > 0, "found mcp-server source files to scan");
  const legacy = files.filter((file) =>
    /z\s*\.\s*string\s*\(\s*\)\s*\.\s*datetime\s*\(/.test(readFileSync(file, "utf8")),
  );
  assert.deepEqual(legacy, [], `legacy z.string().datetime() remains in: ${legacy.join(", ")}`);
  const bootstrap = readFileSync(join(srcDir, "bootstrap.ts"), "utf8");
  assert.match(bootstrap, /z\s*\.\s*iso\s*\.\s*datetime\s*\(/);
});

test("acceptance: the smoke script drives the real MCP stdio server under zod 4 (ac-6)", () => {
  const serverJs = join(PACKAGE_ROOT, "dist", "src", "index.js");
  assert.ok(
    existsSync(serverJs),
    "dist/src/index.js is missing - run `npm run build` first (root `npm test` builds automatically)",
  );
  const smokePath = join(PACKAGE_ROOT, "scripts", "smoke.mjs");
  const run = spawnSync(process.execPath, [smokePath], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  if (run.error) throw run.error;
  assert.equal(
    run.status,
    0,
    `smoke exited ${run.status}\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
  );
  assert.match(`${run.stdout}\n${run.stderr}`, /SMOKE OK/);
});

test("acceptance: root npm test runs build plus all six workspace suites in one command (ac-5)", () => {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  const script = root.scripts.test ?? "";
  assert.match(script, /npm run build/);
  for (const workspace of ["core", "agents", "mcp-server", "bridge", "proof", "docs-extension"]) {
    assert.ok(
      script.includes(`npm run test -w @lorewardens/${workspace}`),
      `root npm test does not chain the ${workspace} suite`,
    );
  }
});

test("acceptance: a sibling workspace leg runs green from inside the suite (bridge canary, ac-5)", () => {
  const run = runNpm(["run", "test", "-w", "@lorewardens/bridge"], 180000);
  assert.equal(
    run.status,
    0,
    `bridge leg exited ${run.status}\nstdout: ${run.stdout?.slice(-2000)}\nstderr: ${run.stderr?.slice(-2000)}`,
  );
});

type ProbeOutcome = { name: string; observed: string };

function probe(name: string, attempt: () => unknown): ProbeOutcome {
  try {
    attempt();
    return { name, observed: "accepted" };
  } catch (err) {
    return { name, observed: err instanceof ZodError ? "rejected" : `rejected:other:${String(err)}` };
  }
}

test("acceptance: the acceptance surface is deterministic across passes (ac-5)", () => {
  const base = {
    projectId: "zod-acceptance",
    source: { kind: "text" as const, text: "Mira unrolled her map." },
  };
  const surface = (): ProbeOutcome[] => [
    probe("generatedAt UTC accepted", () =>
      CanonBootstrapInput.parse({ ...base, generatedAt: "2026-01-01T00:00:00Z" }),
    ),
    probe("generatedAt fractional UTC accepted", () =>
      CanonBootstrapInput.parse({ ...base, generatedAt: DEFAULT_GENERATED_AT }),
    ),
    probe("generatedAt omitted accepted", () => CanonBootstrapInput.parse({ ...base })),
    probe("generatedAt offset rejected", () =>
      CanonBootstrapInput.parse({ ...base, generatedAt: "2026-01-01T00:00:00+05:00" }),
    ),
    probe("generatedAt bare-local rejected", () =>
      CanonBootstrapInput.parse({ ...base, generatedAt: "2026-01-01T00:00:00" }),
    ),
    probe("generatedAt non-string rejected", () =>
      CanonBootstrapInput.parse({ ...base, generatedAt: 42 }),
    ),
    probe("analyze input accepted", () =>
      AnalyzeToolInput.parse({
        projectId: "p",
        chunk: { text: "t", file: "f", startOffset: 0, endOffset: 1 },
      }),
    ),
    probe("analyze bad strictness rejected", () =>
      AnalyzeToolInput.parse({
        projectId: "p",
        chunk: { text: "t", file: "f", startOffset: 0, endOffset: 1 },
        strictness: "bogus",
      }),
    ),
    probe("canon_list input accepted", () => CanonListInput.parse({ projectId: "p" })),
    probe("canon_list empty rejected", () => CanonListInput.parse({})),
  ];
  const first = surface();
  const second = surface();
  assert.deepEqual(second, first);
});
