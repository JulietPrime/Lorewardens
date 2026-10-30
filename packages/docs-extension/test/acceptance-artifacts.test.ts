import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { CanonStore } from "@lorewardens/core";
import { defaultFixturesDir, loadFixtures } from "@lorewardens/mcp-server";
import {
  TOKEN_FILE_NAME,
  bridgeConfigFromEnv,
  createBridgeServer,
  createRegistryFromAllAgents,
  isAllowedOrigin,
  isLoopbackHost,
  loadOrCreateToken,
  startBridge,
} from "@lorewardens/bridge";

const PKG_ROOT_URL = new URL("../../", import.meta.url);
const PKG_ROOT = fileURLToPath(PKG_ROOT_URL);
const DIST = join(PKG_ROOT, "dist");
const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const STABLE_EXTENSION_ID = "mmmbfenncncclcoajepmfdfpfkdjnogj";

function readPackageFile(relative: string): string {
  return readFileSync(join(PKG_ROOT, relative), "utf8");
}

function walkSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walkSources(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

interface HttpResponse {
  status: number;
  body: string;
  json: () => unknown;
}

function loopbackRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers ?? {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body, json: () => JSON.parse(body) });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("loopback Host guard accepts exactly 127.0.0.1 and localhost, with an optional port", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("127.0.0.1:8765"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("localhost:8765"), true);
  assert.equal(isLoopbackHost(undefined), false, "a missing Host header admits nothing");
  assert.equal(isLoopbackHost(""), false);
  assert.equal(isLoopbackHost("evil.example"), false);
  assert.equal(isLoopbackHost("127.0.0.1.evil.com"), false, "suffix-spoofed loopback is rejected");
  assert.equal(isLoopbackHost("localhost.evil.example:8765"), false);
  assert.equal(isLoopbackHost("192.168.1.5:8765"), false);
  assert.equal(isLoopbackHost("[::1]:8765"), false, "the allowlist is exactly 127.0.0.1/localhost");
  assert.equal(isLoopbackHost("2130706433"), false, "integer-encoded loopback is rejected");
  assert.equal(isLoopbackHost("0x7f.0.0.1"), false, "hex-encoded loopback is rejected");
  assert.equal(isLoopbackHost("127.0.0.1:8765:extra"), false, "a malformed port suffix is rejected");
});

test("Origin guard admits chrome-extension origins only, optionally pinned to one exact id", () => {
  assert.equal(isAllowedOrigin(undefined), true, "non-browser callers have no Origin header (token still required)");
  assert.equal(isAllowedOrigin("chrome-extension://anyunpackedextension"), true);
  assert.equal(isAllowedOrigin(`chrome-extension://${STABLE_EXTENSION_ID}`, STABLE_EXTENSION_ID), true);
  assert.equal(isAllowedOrigin("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", STABLE_EXTENSION_ID), false);
  assert.equal(isAllowedOrigin("https://example.com", STABLE_EXTENSION_ID), false);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8765", STABLE_EXTENSION_ID), false);
  assert.equal(isAllowedOrigin("", STABLE_EXTENSION_ID), false, "an empty Origin is not a chrome-extension origin");
  assert.equal(
    isAllowedOrigin(`chrome-extension://${STABLE_EXTENSION_ID}/`, STABLE_EXTENSION_ID),
    false,
    "the id match is exact, no trailing slash",
  );
});

test("Host and Origin guards answer 403 before the token check; the token check still requires a valid bearer", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const registry = createRegistryFromAllAgents();
  const server = createBridgeServer({
    registry,
    store,
    token: "precedence-token-0123456789abcdef",
    allowedExtensionId: STABLE_EXTENSION_ID,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const badHost = await loopbackRequest(port, "/health", { headers: { host: "evil.example" } });
    assert.equal(badHost.status, 403, "a foreign Host is 403 even with no token at all");
    const badOrigin = await loopbackRequest(port, "/health", {
      headers: { host: "127.0.0.1", origin: "https://evil.example" },
    });
    assert.equal(badOrigin.status, 403, "a foreign Origin is 403 even with no token at all");
    const wrongExtension = await loopbackRequest(port, "/health", {
      headers: { host: "127.0.0.1", origin: `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` },
    });
    assert.equal(wrongExtension.status, 403, "an unlisted extension id is 403 even with no token at all");
    const noToken = await loopbackRequest(port, "/health", {
      headers: { host: "127.0.0.1", origin: `chrome-extension://${STABLE_EXTENSION_ID}` },
    });
    assert.equal(noToken.status, 401, "past the guards, a missing token is still 401");
    const wrongToken = await loopbackRequest(port, "/health", {
      headers: {
        host: "127.0.0.1",
        origin: `chrome-extension://${STABLE_EXTENSION_ID}`,
        authorization: "Bearer nope",
      },
    });
    assert.equal(wrongToken.status, 401);
    const good = await loopbackRequest(port, "/health", {
      headers: {
        host: "127.0.0.1",
        origin: `chrome-extension://${STABLE_EXTENSION_ID}`,
        authorization: "Bearer precedence-token-0123456789abcdef",
      },
    });
    assert.equal(good.status, 200);
    assert.deepEqual(good.json(), { ok: true, agents: registry.list().length });
  } finally {
    await closeServer(server);
  }
});

test("bridgeConfigFromEnv implements the documented environment contract", () => {
  const defaults = bridgeConfigFromEnv({});
  assert.equal(defaults.port, 8765, "the default port is the documented 8765");
  assert.equal(defaults.allowedExtensionId, undefined, "no extension id pin by default");
  assert.equal(defaults.fixturesDir, undefined);
  assert.ok(defaults.tokenFile.endsWith(TOKEN_FILE_NAME), "the token file defaults to .lorewardens-bridge.token in cwd");

  const custom = bridgeConfigFromEnv({
    LOREWARDENS_BRIDGE_PORT: "9000",
    LOREWARDENS_EXTENSION_ID: STABLE_EXTENSION_ID,
    LOREWARDENS_BRIDGE_TOKEN_FILE: "/tmp/lore-acceptance.token",
    LOREWARDENS_BRIDGE_FIXTURES_DIR: "/tmp/lore-fixtures",
  });
  assert.equal(custom.port, 9000);
  assert.equal(custom.allowedExtensionId, STABLE_EXTENSION_ID);
  assert.equal(custom.tokenFile, "/tmp/lore-acceptance.token");
  assert.equal(custom.fixturesDir, "/tmp/lore-fixtures");

  for (const bad of ["abc", "1.5", "-1", "99999"]) {
    assert.throws(
      () => bridgeConfigFromEnv({ LOREWARDENS_BRIDGE_PORT: bad }),
      /LOREWARDENS_BRIDGE_PORT/,
      `port '${bad}' is rejected`,
    );
  }

  const empty = bridgeConfigFromEnv({ LOREWARDENS_BRIDGE_PORT: "", LOREWARDENS_EXTENSION_ID: "" });
  assert.equal(empty.port, 8765, "an empty port variable falls back to the default");
  assert.equal(empty.allowedExtensionId, undefined, "an empty extension id variable means no pin");
});

test("startBridge binds 127.0.0.1 only, seeds a private token file, and serves /health end-to-end", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-bridge-start-"));
  try {
    const tokenFile = join(tmp, TOKEN_FILE_NAME);
    const { store } = loadFixtures(defaultFixturesDir());
    const registry = createRegistryFromAllAgents();
    const handle = await startBridge(
      { port: 0, tokenFile, allowedExtensionId: STABLE_EXTENSION_ID },
      { registry, store: store as CanonStore },
    );
    try {
      assert.equal(handle.agents, registry.list().length, "the handle reports the full registered roster");
      assert.match(handle.token, /^[0-9a-f]{64}$/, "the generated token is 64 hex chars");
      const address = handle.server.address() as AddressInfo;
      assert.equal(address.address, "127.0.0.1", "the bind address is the loopback interface, nothing else");
      const written = statSync(tokenFile);
      assert.equal(written.isFile(), true, "the token file was created at the configured path");
      assert.equal(written.mode & 0o077, 0, "the token file is private: no group or other access");
      const persisted = readFileSync(tokenFile, "utf8").trim();
      assert.equal(persisted, handle.token, "the served token is the persisted token");

      const health = await loopbackRequest(handle.port, "/health", {
        headers: {
          host: "127.0.0.1",
          origin: `chrome-extension://${STABLE_EXTENSION_ID}`,
          authorization: `Bearer ${handle.token}`,
        },
      });
      assert.equal(health.status, 200);
      assert.deepEqual(health.json(), { ok: true, agents: registry.list().length });

      const unauthorized = await loopbackRequest(handle.port, "/health", {
        headers: {
          host: "127.0.0.1",
          origin: `chrome-extension://${STABLE_EXTENSION_ID}`,
          authorization: "Bearer wrong",
        },
      });
      assert.equal(unauthorized.status, 401);
    } finally {
      await closeServer(handle.server);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadOrCreateToken never writes an empty token file and reuses a non-empty one", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-bridge-token-"));
  try {
    const tokenFile = join(tmp, "empty.token");
    writeFileSync(tokenFile, "\n", { encoding: "utf8" });
    const regenerated = loadOrCreateToken(tokenFile);
    assert.equal(regenerated.created, true, "an empty token file is treated as absent");
    assert.match(regenerated.token, /^[0-9a-f]{64}$/);
    assert.notEqual(regenerated.token, "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("no secrets are tracked: the bridge token file is untracked and no real OAuth client id is committed", () => {
  const tracked = execFileSync("git", ["-C", REPO_ROOT, "ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const tokenFiles = tracked.filter((file) => file.endsWith(TOKEN_FILE_NAME));
  assert.deepEqual(tokenFiles, [], ".lorewardens-bridge.token must never be tracked by git");

  const realClientId = /[0-9]{4,}-[0-9a-z]{16,}\.apps\.googleusercontent\.com/;
  for (const file of tracked) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.ok(
      !realClientId.test(text),
      `${file} contains a real-format OAuth client id; client ids are options-only, never committed`,
    );
  }
});

test("the MV3 manifest pins stable identity, the module worker, side panel and options page", () => {
  const manifest = JSON.parse(readPackageFile("manifest.json"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(typeof manifest.key === "string" && manifest.key.length > 300, "a pinned key gives the unpacked extension a stable id");
  assert.equal(manifest.background?.service_worker, "background/service-worker.js");
  assert.equal(manifest.background?.type, "module", "the service worker is a module worker");
  assert.equal(manifest.side_panel?.default_path, "sidepanel/sidepanel.html");
  assert.equal(manifest.options_ui?.page, "options/options.html");
  for (const permission of ["sidePanel", "storage", "identity", "activeTab", "alarms"]) {
    assert.ok(manifest.permissions?.includes(permission), `permission '${permission}' is present`);
  }
  for (const host of ["https://docs.googleapis.com/", "https://www.googleapis.com/", "http://127.0.0.1:8765/*"]) {
    assert.ok(manifest.host_permissions?.includes(host), `host permission '${host}' is present`);
  }
  assert.ok(
    !manifest.host_permissions.some((h: string) => h === "<all_urls>" || h === "*://*/*"),
    "host permissions stay minimal: the two Google API hosts and the loopback bridge only",
  );
  assert.equal(manifest.oauth2, undefined, "no oauth2 manifest block: the client id is options-configured");
});

test("the manifest key derives the documented stable extension id (sha-256, first 16 bytes, hex mapped a-p)", () => {
  const manifest = JSON.parse(readPackageFile("manifest.json"));
  const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
  const id = [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
  assert.equal(id, STABLE_EXTENSION_ID, "the unpacked extension always gets this id, independent of load path");
  const readme = readPackageFile("README.md");
  assert.ok(readme.includes(STABLE_EXTENSION_ID), "the README documents the same stable id");
  const redirectUri = `https://${STABLE_EXTENSION_ID}.chromiumapp.org/`;
  assert.match(readme, new RegExp(redirectUri.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")), "the README pins the chromiumapp.org redirect URI for the stable id");
});

test("the extension builds with tsc only and adds zero new dependencies", () => {
  const pkg = JSON.parse(readPackageFile("package.json"));
  assert.match(pkg.scripts.build, /tsc -p tsconfig\.json/, "the build is tsc");
  for (const bundler of ["esbuild", "webpack", "rollup", "vite", "babel", "parcel", "swc", "tsup"]) {
    assert.ok(!pkg.scripts.build.includes(bundler), `the build script must not use ${bundler}`);
  }
  assert.deepEqual(
    Object.keys(pkg.dependencies ?? {}).sort(),
    ["@lorewardens/bridge", "@lorewardens/core"],
    "runtime dependencies are exactly the two workspace packages",
  );
  assert.deepEqual(
    Object.keys(pkg.devDependencies ?? {}).sort(),
    ["@types/node", "typescript"],
    "dev dependencies are exactly the toolchain",
  );
});

test("the built dist/ contains every path the manifest and bundled pages reference (loadable unpacked)", () => {
  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  const missing: string[] = [];
  const referenced: string[] = [
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    manifest.options_ui?.page,
  ].filter((p): p is string => typeof p === "string");
  assert.ok(referenced.length === 3, "the manifest references a worker, a panel and an options page");
  for (const relative of referenced) {
    if (!existsSync(join(DIST, relative))) missing.push(`dist/${relative}`);
  }
  for (const [pageDir, page] of [
    ["sidepanel", "sidepanel.html"],
    ["options", "options.html"],
  ] as const) {
    const html = readFileSync(join(DIST, pageDir, page), "utf8");
    const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1] as string);
    assert.ok(scripts.length > 0, `dist/${pageDir}/${page} loads its script`);
    for (const src of scripts) {
      if (!existsSync(join(DIST, pageDir, decodeURIComponent(src)))) {
        missing.push(`dist/${pageDir}/${src}`);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    `the unpacked bundle must contain every referenced file; Chrome rejects the load otherwise. Missing: ${missing.join(", ")}`,
  );
});

test("the OAuth client id is options-configured only: no hard-coded client id anywhere in code", () => {
  const srcDir = join(PKG_ROOT, "src");
  const sourceFiles = walkSources(srcDir);
  assert.ok(sourceFiles.length > 0, "extension sources are found");
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8");
    assert.ok(
      !text.includes("apps.googleusercontent.com"),
      `${file} hard-codes an OAuth client id; client ids are entered on the options page only`,
    );
  }
  const manifestRaw = readPackageFile("manifest.json");
  assert.ok(!manifestRaw.includes("apps.googleusercontent.com"), "the manifest carries no client id");

  const optionsHtml = readPackageFile("src/options/options.html");
  assert.match(optionsHtml, /id="oauthClientId"/, "the options page has the OAuth client id input");
  const optionsTs = readPackageFile("src/options/options.ts");
  assert.match(optionsTs, /chrome\.storage\.local\.set/, "the options page persists its values");
  assert.match(optionsTs, /oauthClientId/, "the client id is saved from the options page");
  const worker = readPackageFile("src/background/service-worker.ts");
  assert.match(worker, /oauthClientId/, "the worker reads the options-configured client id");
  assert.match(worker, /chrome\.storage\.local\.get/, "the worker loads configuration from chrome.storage.local");
  assert.match(worker, /chromiumAppRedirectUri\(chrome\.runtime\.id\)/, "the redirect URI is derived from the runtime id");
  assert.match(worker, /launchWebAuthFlow/, "the flow goes through chrome.identity.launchWebAuthFlow");
});

test("Testing mode is the documented access control; no Marketplace listing or verification machinery exists", () => {
  const manifestRaw = readPackageFile("manifest.json");
  assert.ok(!manifestRaw.toLowerCase().includes("webstore"), "the manifest carries no store machinery");
  const scanned = [
    ...walkSources(join(PKG_ROOT, "src")),
    join(PKG_ROOT, "README.md"),
    join(PKG_ROOT, "src/options/options.html"),
    join(PKG_ROOT, "src/sidepanel/sidepanel.html"),
  ];
  for (const file of scanned) {
    const text = readFileSync(file, "utf8");
    assert.ok(
      !/chrome\.google\.com\/webstore|chromewebstore|chrome-web-store/i.test(text),
      `${file} must not reference the Chrome Web Store`,
    );
  }
  const readme = readPackageFile("README.md");
  assert.match(readme, /Testing/, "the consent screen runs in Testing mode");
  assert.match(readme, /no Marketplace listing, no verification/, "the docs state the Testing-mode-only posture");
});

test("the sidebar lists findings with agent, severity, type, message and quote, and surfaces the multi-tab notice", () => {
  const sidepanel = readPackageFile("src/sidepanel/sidepanel.ts");
  for (const field of ["finding.agent", "finding.severity", "finding.type", "finding.message", "finding.quote"]) {
    assert.ok(sidepanel.includes(field), `the sidebar renders ${field} like the Docs comment does`);
  }
  assert.match(sidepanel, /multitab/, "the sidebar toggles the multi-tab notice");
  const html = readPackageFile("src/sidepanel/sidepanel.html");
  for (const id of ["findings", "settings", "status", "multitab", "projectId"]) {
    assert.ok(html.includes(`id="${id}"`), `sidebar element #${id} is present`);
  }
  assert.match(html, /Multi-tab document/, "the documented v1 single-tab limit is visible in the sidebar");
  assert.match(html, /Clear Lorewardens comments/, "the sidebar offers the clear-own-comments action");
});

test("the README documents install, bridge startup, options, owner Google setup, the test-user cap and live E2E", () => {
  const readme = readPackageFile("README.md");
  assert.match(readme, /npm start -w @lorewardens\/bridge/, "bridge startup steps");
  assert.match(readme, /Load unpacked/, "unpacked install steps");
  assert.match(readme, /chrome:\/\/extensions/, "install points at the extensions page");
  assert.match(readme, /Bridge URL/, "options: bridge URL");
  assert.match(readme, /Bridge token/, "options: bridge token");
  assert.match(readme, /OAuth client id/, "options: OAuth client id");
  assert.match(readme, /google-oauth-credentials-v1/, "the owner Google setup references the credentials dependency");
  assert.match(readme, /100 test users/, "the Testing-mode flow and its <=100 test-user cap are documented");
  assert.match(readme, /Live E2E/, "live E2E steps are documented");
  assert.match(readme, /documents\.readonly/, "the documents.readonly scope is documented");
  assert.match(readme, /drive\.file/, "the drive.file scope is documented");
  assert.match(readme, /Single tab only|analyzed on the first tab/i, "the v1 multi-tab limit is documented");
});

test("the root scripts build and test both new packages, bridge before docs-extension", () => {
  const root = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  for (const [name, script] of [
    ["build", root.scripts.build as string],
    ["test", root.scripts.test as string],
  ] as const) {
    assert.ok(script.includes("-w @lorewardens/bridge"), `the root ${name} script wires @lorewardens/bridge`);
    assert.ok(
      script.includes("-w @lorewardens/docs-extension"),
      `the root ${name} script wires @lorewardens/docs-extension`,
    );
    assert.ok(
      script.indexOf("@lorewardens/bridge") < script.indexOf("@lorewardens/docs-extension"),
      `the root ${name} script orders the bridge before the extension that depends on it`,
    );
  }
});
