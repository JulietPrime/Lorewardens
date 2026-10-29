import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The Lorewardens MCP server must run entirely on the writer's machine:
// stdio only, zero outbound network calls anywhere in the package source.
const NETWORK_PATTERNS: [string, RegExp][] = [
  ["fetch(", /\bfetch\s*\(/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["WebSocket", /\bWebSocket\b/],
  ["axios", /\baxios\b/],
  ["node:http", /node:http/],
  ["node:https", /node:https/],
  ["node:net", /node:net\b/],
  ["node:dns", /node:dns\b/],
  ["node:tls", /node:tls\b/],
  ["http.request", /https?\.(get|request)\s*\(/],
  ["undici", /\bundici\b/],
];

function collectFiles(dir: string, ext: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, ext));
    else if (ext.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

// Test files (including this one) quote the patterns as data, so test
// directories are excluded from the scan: only shipped code is checked.
function isTestFile(path: string): boolean {
  return /[\\/]test[\\/]/.test(path);
}

const pkgRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceFiles = [
  ...collectFiles(join(pkgRoot, "src"), [".ts"]),
  ...collectFiles(join(pkgRoot, "dist"), [".js", ".mjs", ".cjs"]),
].filter((f) => !isTestFile(f));

test("package source and build output contain no network entry points", () => {
  assert.ok(sourceFiles.length > 0, "found source files to scan");
  const offenders: string[] = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    for (const [label, pattern] of NETWORK_PATTERNS) {
      if (pattern.test(content)) offenders.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("every store write path rejects, so no tool can mutate canon or settings", async () => {
  const { loadFixtures } = await import("../src/store.js");
  const { store } = loadFixtures();
  const writes = [
    () =>
      store.applyConfirmed({
        id: "p",
        projectId: "demo",
        proposedBy: "writer",
        subjectKind: "canon-entry",
        action: "add",
        payload: {} as never,
        reason: "",
        createdAt: new Date().toISOString(),
      }),
    () =>
      store.addException({
        id: "e",
        projectId: "demo",
        scope: "rule",
        ref: "r",
        reason: "",
        createdAt: new Date().toISOString(),
      }),
    () => store.dismissFinding({ findingId: "f", projectId: "demo", dismissedAt: new Date().toISOString() }),
  ];
  for (const write of writes) {
    await assert.rejects(write, /read-only/i);
  }
});
