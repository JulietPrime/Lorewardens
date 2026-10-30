import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Mirror of the proof package's offline scan (ac-7 in
// packages/proof/test/acceptance-seeded-errors.test.ts). The task spec offers
// two paths: extend that scan, or add this mirror. The proof scan pins exact
// per-file labels and a shared node-builtin allowlist; adding bridge files
// there would require loosening that allowlist (node:http is legitimate
// loopback server usage here, forbidden for the proof package), which would
// weaken the existing proof pin. So the spec's mirror path is taken; the
// proof test file is left untouched.
//
// Scope: shipped code (src/*.ts). Test files are excluded because they quote
// the patterns as data, mirroring the mcp-server nonetwork test precedent.

const SRC_DIR = new URL("../../src/", import.meta.url);
const PKG_ROOT = new URL("../../", import.meta.url);

// node:http is loopback listen-only usage; every other network-capable
// builtin stays banned.
const ALLOWED_NODE_BUILTINS = new Set(["node:crypto", "node:fs", "node:http", "node:path", "node:url"]);
const ALLOWED_PACKAGES = new Set(["@lorewardens/agents", "@lorewardens/core", "@lorewardens/mcp-server"]);

const importPattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

const networkPatterns: [string, RegExp][] = [
  ["fetch call", /(?:^|[^\w.$])fetch\s*\(/],
  ["http(s).request call", /https?\.(?:request|get)\s*\(/],
  ["legacy XHR", /(?:XML)HttpRequest/],
  ["raw socket client", /(?:Web)Socket/],
  ["promise-based http client", /(?:und)ici/],
  ["promise-based http client", /(?:ax)ios/],
  ["https module", /node:https/],
  ["net module", /node:net\b/],
  ["dns module", /node:dns\b/],
  ["tls module", /node:tls\b/],
  ["dgram module", /node:dgram\b/],
  ["child process", /node:child_process/],
];

const nondeterminismPatterns: [string, RegExp][] = [
  ["Math.random", /Math\.(?:random)\s*\(/],
  ["Date.now", /Date\.(?:now)\s*\(/],
  ["new Date", /new\s+(?:Date)\s*\(/],
];

interface ScannedFile {
  label: string;
  text: string;
}

function scanSources(): ScannedFile[] {
  return readdirSync(fileURLToPath(SRC_DIR))
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .map((file) => ({
      label: `src/${file}`,
      text: readFileSync(fileURLToPath(new URL(file, SRC_DIR)), "utf8"),
    }));
}

test("offline scan covers the whole bridge package (mirror of the proof ac-7 scan)", () => {
  const scanned = scanSources();
  const labels = scanned.map((s) => s.label);
  assert.deepEqual(
    labels,
    ["src/analyze.ts", "src/index.ts", "src/server.ts", "src/start.ts", "src/token.ts"],
    "the offline scan covers every bridge source file",
  );

  for (const { label, text } of scanned) {
    const specifiers = [...text.matchAll(importPattern)].map((m) => m[1]);
    assert.ok(specifiers.length > 0, `${label}: imports are scannable`);
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) {
        const builtin = specifier.split("/")[0];
        assert.ok(
          ALLOWED_NODE_BUILTINS.has(builtin),
          `${label}: node builtin '${specifier}' is not on the bridge offline allowlist`,
        );
      } else if (!specifier.startsWith(".")) {
        assert.ok(
          ALLOWED_PACKAGES.has(specifier),
          `${label}: import '${specifier}' is not a workspace package (zero new dependencies)`,
        );
      }
    }
    assert.ok(!/\brequire\s*\(/.test(text), `${label}: no CommonJS require`);
    for (const [name, pattern] of [...networkPatterns, ...nondeterminismPatterns]) {
      assert.ok(!pattern.test(text), `${label}: must not contain ${name}`);
    }
  }
});

test("the bridge only listens: loopback bind and no outbound client usage anywhere in src", () => {
  const scanned = scanSources();
  const combined = scanned.map((s) => s.text).join("\n");
  assert.match(combined, /createServer\s*\(/, "http usage is server creation");
  assert.match(combined, /["']127\.0\.0\.1["']/, "the bind address is the loopback literal");
  assert.doesNotMatch(combined, /\.connect\s*\(/, "no client-style connect calls");
  assert.doesNotMatch(combined, /listen\s*\(\s*\d+\s*,\s*(?!"127\.0\.0\.1")/, "listen calls pin the loopback host");
});

test("bridge dependencies are exactly the three workspace packages plus the toolchain", () => {
  const manifest = JSON.parse(readFileSync(new URL("package.json", PKG_ROOT), "utf8")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.deepEqual(
    Object.keys(manifest.dependencies).sort(),
    ["@lorewardens/agents", "@lorewardens/core", "@lorewardens/mcp-server"],
    "bridge runtime dependencies are exactly the three workspace packages",
  );
  assert.deepEqual(
    Object.keys(manifest.devDependencies).sort(),
    ["@types/node", "typescript"],
    "bridge dev dependencies are exactly the toolchain",
  );
});
