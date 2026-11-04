import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { CanonStore, Finding, ProjectSettings } from "@lorewardens/core";
import { ALL_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool } from "@lorewardens/mcp-server";
import { defaultFixturesDir, loadFixtures } from "@lorewardens/mcp-server";
import { createRegistryFromAllAgents, runBridgeAnalyze, type BridgeAnalyzeResponse } from "../src/analyze.js";
import { createBridgeServer, type BridgeServerOptions } from "../src/server.js";
import { loadOrCreateToken } from "../src/token.js";
import type { IncomingHttpHeaders } from "node:http";

const E1_SENTENCE = "Mira cast the warding spell without giving up a single memory.";
const PROOF_FIXTURES_DIR = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));

interface HttpResponse {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
  json: () => unknown;
}

function request(
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
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers, json: () => JSON.parse(body) });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

const TOKEN = "bridge-test-token-0123456789abcdef";
const AUTH = { authorization: `Bearer ${TOKEN}` };

async function listen(
  options: Partial<BridgeServerOptions> & { registry?: ReturnType<typeof createRegistryFromAllAgents>; store: CanonStore },
): Promise<{ server: Server; port: number }> {
  const server = createBridgeServer({ token: TOKEN, ...options } as BridgeServerOptions);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, port: address.port };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// makeFinding assigns a fresh id and createdAt on every engine run; parity is
// defined on the deterministic content fields, exactly like the proof suite's
// deterministic projections.
function stableFindings(findings: Finding[]): Record<string, unknown>[] {
  return jsonRoundTrip(findings).map((f) => {
    const { id: _id, createdAt: _createdAt, ...rest } = f;
    return rest;
  });
}

test("GET /health requires the token and reports the roster size without hard-coding it", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  try {
    const none = await request(port, "/health");
    assert.equal(none.status, 401, "no token -> 401");
    const wrong = await request(port, "/health", { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401, "mismatched token -> 401");
    const good = await request(port, "/health", { headers: AUTH });
    assert.equal(good.status, 200);
    const payload = good.json() as { ok: boolean; agents: number };
    assert.equal(payload.ok, true);
    assert.equal(payload.agents, ALL_AGENTS.length);
  } finally {
    await close(server);
  }
});

test("loopback Host and chrome-extension Origin guards reject everything else (403)", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const extensionId = "abcdefghijklmnopabcdefghijklmnop";
  const { server, port } = await listen({
    store,
    registry: createRegistryFromAllAgents(),
    allowedExtensionId: extensionId,
  });
  try {
    for (const host of ["evil.example", "127.0.0.1.evil.com", "localhost.evil.example:8765", "192.168.1.5:8765"]) {
      const res = await request(port, "/health", { headers: { ...AUTH, host } });
      assert.equal(res.status, 403, `non-loopback Host '${host}' -> 403`);
    }
    const portOnly = await request(port, "/health", { headers: { ...AUTH, host: "127.0.0.1:1" } });
    assert.equal(portOnly.status, 200, "loopback Host with a port is accepted");

    const noOrigin = await request(port, "/health", { headers: AUTH });
    assert.equal(noOrigin.status, 200, "non-browser client without Origin passes the Origin guard (token still required)");

    const webOrigin = await request(port, "/health", { headers: { ...AUTH, origin: "https://evil.example" } });
    assert.equal(webOrigin.status, 403, "non-extension Origin -> 403");
    const wrongId = await request(port, "/health", {
      headers: { ...AUTH, origin: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz" },
    });
    assert.equal(wrongId.status, 403, "non-allowlisted extension id -> 403");
    const rightId = await request(port, "/health", {
      headers: { ...AUTH, origin: `chrome-extension://${extensionId}` },
    });
    assert.equal(rightId.status, 200, "allowlisted extension id accepted");
  } finally {
    await close(server);
  }
});

test("analyze parity: bridge response equals the MCP tool path agent-for-agent on the seeded corpus", async () => {
  const { store } = loadFixtures(PROOF_FIXTURES_DIR);
  const registry = createRegistryFromAllAgents();
  const { server, port } = await listen({ store, registry });
  try {
    const inputs = [
      { projectId: "proof", text: E1_SENTENCE },
      { projectId: "proof", text: E1_SENTENCE, strictness: "gentle" as const },
      { projectId: "proof", text: "The ferry crossing took 15 minutes that morning." },
      {
        projectId: "proof",
        text: "Daven and Calla walked the north wall to the Weeping Gate and found it sealed, just as the city records promised.",
      },
    ];
    for (const input of inputs) {
      const res = await request(port, "/analyze", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      assert.equal(res.status, 200, `analyze succeeded for ${input.projectId}`);
      const bridgeResponse = res.json() as BridgeAnalyzeResponse;

      const directFindings: Finding[] = [];
      const directInvoked: string[] = [];
      const directSkipped: { agent: string; reason: string }[] = [];
      for (const descriptor of registry.list()) {
        const agent = registry.get(descriptor.id);
        assert.ok(agent, "registry resolves every listed descriptor");
        const result = await runAnalyzeTool(agent!, store, {
          projectId: input.projectId,
          chunk: {
            text: input.text,
            file: "document",
            startOffset: 0,
            endOffset: input.text.length,
          },
          ...(input.strictness ? { strictness: input.strictness } : {}),
        });
        if (result.invoked) {
          directInvoked.push(agent!.id);
          directFindings.push(...((result.findings ?? []) as Finding[]));
        } else {
          directSkipped.push({ agent: agent!.id, reason: result.reason ?? "" });
        }
      }

      assert.deepEqual(
        stableFindings(bridgeResponse.findings),
        stableFindings(directFindings),
        `findings identical to the MCP path for ${input.projectId} (${input.strictness ?? "project default"})`,
      );
      assert.deepEqual(bridgeResponse.invokedAgents, directInvoked, "invoked roster identical");
      assert.deepEqual(bridgeResponse.skipped, directSkipped, "skipped roster and reasons identical");

      const proofDisabled = bridgeResponse.skipped.filter((s) =>
        ["grammar-mechanics", "vocabulary-repetition", "style-voice", "character-voice", "period-dialect"].includes(
          s.agent,
        ),
      );
      if (input.projectId === "proof") {
        assert.equal(proofDisabled.length, 5, "proof project settings disable the five language agents");
        for (const skipped of proofDisabled) {
          assert.match(skipped.reason, /disabled/, "disabled agents carry the exact MCP-path reason");
        }
      }
    }

    const withFindings = await request(port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({ projectId: "proof", text: E1_SENTENCE }),
    });
    const payload = withFindings.json() as BridgeAnalyzeResponse;
    assert.ok(payload.findings.length > 0, "the seeded sentence produces findings through the bridge");
  } finally {
    await close(server);
  }

  const demo = loadFixtures(defaultFixturesDir());
  const demoListen = await listen({ store: demo.store, registry });
  try {
    const res = await request(demoListen.port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "demo",
        text: "Mira sketched the Weeping Gate while Daven dropped the measuring line again.",
      }),
    });
    assert.equal(res.status, 200, "analyze succeeded for the demo fixture project");
    const bridgeResponse = res.json() as BridgeAnalyzeResponse;
    const directFindings: Finding[] = [];
    const directInvoked: string[] = [];
    const directSkipped: { agent: string; reason: string }[] = [];
    for (const descriptor of registry.list()) {
      const agent = registry.get(descriptor.id)!;
      const result = await runAnalyzeTool(agent, demo.store, {
        projectId: "demo",
        chunk: {
          text: "Mira sketched the Weeping Gate while Daven dropped the measuring line again.",
          file: "document",
          startOffset: 0,
          endOffset: "Mira sketched the Weeping Gate while Daven dropped the measuring line again.".length,
        },
      });
      if (result.invoked) {
        directInvoked.push(agent.id);
        directFindings.push(...((result.findings ?? []) as Finding[]));
      } else {
        directSkipped.push({ agent: agent.id, reason: result.reason ?? "" });
      }
    }
    assert.deepEqual(stableFindings(bridgeResponse.findings), stableFindings(directFindings), "demo findings parity");
    assert.deepEqual(bridgeResponse.invokedAgents, directInvoked, "demo invoked parity");
    assert.deepEqual(bridgeResponse.skipped, directSkipped, "demo skipped parity");
  } finally {
    await close(demoListen.server);
  }
});

test("spanStart shifts finding offsets document-absolute with no client arithmetic", async () => {
  const { store } = loadFixtures(PROOF_FIXTURES_DIR);
  const registry = createRegistryFromAllAgents();
  const { server, port } = await listen({ store, registry });
  try {
    async function analyzeAt(spanStart: number, title: string): Promise<Finding[]> {
      const res = await request(port, "/analyze", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "proof", text: E1_SENTENCE, spanStart, title }),
      });
      assert.equal(res.status, 200);
      return (res.json() as BridgeAnalyzeResponse).findings;
    }
    const base = await analyzeAt(0, "My Novel - Chapter One");
    assert.ok(base.length > 0, "baseline findings exist");
    const shifted = await analyzeAt(500, "My Novel - Chapter One");
    assert.ok(shifted.length === base.length, "same findings at shifted span");
    for (const original of base) {
      const moved = shifted.find((f) => f.agent === original.agent && f.type === original.type);
      assert.ok(moved, `finding ${original.agent}/${original.type} present at shifted span`);
      assert.equal(moved!.location.startOffset, original.location.startOffset + 500);
      assert.equal(moved!.location.endOffset, original.location.endOffset + 500);
      assert.equal(moved!.quote, original.quote);
      assert.equal(moved!.location.file, "My Novel - Chapter One");
      assert.ok(moved!.location.startOffset >= 500, "offsets are document-absolute");
    }
  } finally {
    await close(server);
  }
});

test("GET /settings/:projectId passes the resolved project settings straight through", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  try {
    const res = await request(port, "/settings/demo", { headers: AUTH });
    assert.equal(res.status, 200);
    const expected = jsonRoundTrip(await store.settings("demo"));
    assert.deepEqual(res.json() as ProjectSettings, expected, "settings passthrough is byte-equal");
    const unknown = await request(port, "/settings/nope", { headers: AUTH });
    assert.equal(unknown.status, 404);
  } finally {
    await close(server);
  }
});

test("malformed and misrouted requests get the documented status codes", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  const post = (body: string) =>
    request(port, "/analyze", { method: "POST", headers: { ...AUTH, "content-type": "application/json" }, body });
  try {
    assert.equal((await post("{not json")).status, 400, "invalid JSON -> 400");
    assert.equal((await post(JSON.stringify({ projectId: "demo", text: "" }))).status, 400, "empty text -> 400");
    assert.equal((await post(JSON.stringify({ projectId: "demo", text: "hi", spanStart: -1 }))).status, 400, "negative spanStart -> 400");
    assert.equal((await post(JSON.stringify({ projectId: "demo", text: "hi", strictness: "extreme" }))).status, 400, "bad strictness -> 400");
    assert.equal((await post(JSON.stringify({ projectId: "demo", text: "hi", evil: true }))).status, 400, "unknown field -> 400");
    assert.equal(
      (await post(JSON.stringify({ projectId: "nope", text: "hi" }))).status,
      404,
      "unknown project -> 404",
    );
    assert.equal((await request(port, "/analyze", { headers: AUTH })).status, 405, "GET /analyze -> 405");
    assert.equal(
      (await request(port, "/health", { method: "POST", headers: AUTH, body: "{}" })).status,
      405,
      "POST /health -> 405",
    );
    assert.equal((await request(port, "/nope", { headers: AUTH })).status, 404, "unknown path -> 404");
  } finally {
    await close(server);
  }
});

test("the bridge binds to 127.0.0.1 only", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  try {
    const address = server.address() as AddressInfo;
    assert.equal(address.address, "127.0.0.1");
    assert.ok(port > 0, "ephemeral loopback port assigned");
  } finally {
    await close(server);
  }
});

test("runBridgeAnalyze matches runAnalyzeTool directly in-process (handler-level parity)", async () => {
  const { store } = loadFixtures(PROOF_FIXTURES_DIR);
  const registry = createRegistryFromAllAgents();
  const response = await runBridgeAnalyze(registry, store, { projectId: "proof", text: E1_SENTENCE });
  assert.ok(response.findings.length > 0);
  assert.ok(response.invokedAgents.includes("canon-lore"));
  const direct = await runAnalyzeTool(registry.get("canon-lore")!, store, {
    projectId: "proof",
    chunk: { text: E1_SENTENCE, file: "document", startOffset: 0, endOffset: E1_SENTENCE.length },
  });
  const bridgeCanonLore = response.findings.filter((f) => f.agent === "canon-lore");
  assert.deepEqual(stableFindings(bridgeCanonLore), stableFindings((direct.findings ?? []) as Finding[]));
});

test("bridge token persists to one file and is reused on restart", () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-bridge-token-"));
  try {
    const tokenFile = join(tmp, ".lorewardens-bridge.token");
    const first = loadOrCreateToken(tokenFile);
    assert.equal(first.created, true, "first start creates the token");
    assert.match(first.token, /^[0-9a-f]{64}$/, "token is 64 hex chars");
    const written = readFileSync(tokenFile, "utf8").trim();
    assert.equal(written, first.token, "token persisted");
    const second = loadOrCreateToken(tokenFile);
    assert.equal(second.created, false, "second start reuses the token");
    assert.equal(second.token, first.token);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("the bridge token file is gitignored at the repo root", () => {
  const gitignore = readFileSync(fileURLToPath(new URL("../../../../.gitignore", import.meta.url)), "utf8");
  assert.match(gitignore, /^\.lorewardens-bridge\.token$/m, ".lorewardens-bridge.token is gitignored");
});

function writeMinimalFixture(dir: string, projectId: string, overrides: unknown[]): CanonStore {
  writeFileSync(join(dir, `${projectId}.canon.json`), JSON.stringify({ projectId, entries: [], characters: [], events: [] }));
  writeFileSync(join(dir, `${projectId}.settings.json`), JSON.stringify({ projectId, agents: overrides, exceptions: [], dismissed: [] }));
  return loadFixtures(dir).store;
}

test("disabled and off agents come back as skipped with the MCP-path reasons", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "lore-bridge-settings-"));
  try {
    const store = writeMinimalFixture(tmp, "bridge-off", [
      { agentId: "timeline", enabled: false, strictness: "standard" },
      { agentId: "canon-lore", enabled: true, strictness: "off" },
    ]);
    const registry = createRegistryFromAllAgents();
    const { server, port } = await listen({ store, registry });
    try {
      const res = await request(port, "/analyze", {
        method: "POST",
        headers: { ...AUTH, "content-type": "application/json" },
        body: JSON.stringify({ projectId: "bridge-off", text: "Some ordinary prose for the agents." }),
      });
      assert.equal(res.status, 200);
      const payload = res.json() as BridgeAnalyzeResponse;
      const timeline = payload.skipped.find((s) => s.agent === "timeline");
      assert.ok(timeline, "disabled timeline is skipped");
      assert.match(timeline!.reason, /disabled/);
      const canonLore = payload.skipped.find((s) => s.agent === "canon-lore");
      assert.ok(canonLore, "strictness-off canon-lore is skipped");
      assert.match(canonLore!.reason, /off/);
      assert.ok(!payload.invokedAgents.includes("timeline"));
      assert.ok(!payload.invokedAgents.includes("canon-lore"));
    } finally {
      await close(server);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- CORS for the Docs browser extension ---
//
// A browser preflight is OPTIONS with an Origin and no Authorization header by
// spec, so it must be answered before the token check; and every response to
// an allowed-origin request — success or error — must carry
// Access-Control-Allow-Origin so the browser can read real bodies.

const CORS_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const WRONG_EXTENSION_ORIGIN = "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
const WEB_ORIGIN = "https://evil.example";

function preflightHeaders(origin: string): Record<string, string> {
  return {
    origin,
    "access-control-request-method": "GET",
    "access-control-request-headers": "authorization, content-type",
  };
}

test("t1: CORS preflight from an allowed extension origin gets a 204 handshake with no token", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  try {
    const res = await request(port, "/health", { method: "OPTIONS", headers: preflightHeaders(CORS_ORIGIN) });
    assert.equal(res.status, 204, "preflight answered 204 without an Authorization header");
    assert.equal(res.headers["access-control-allow-origin"], CORS_ORIGIN, "ACAO echoes the exact origin");
    const allowHeaders = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase();
    assert.ok(allowHeaders.includes("authorization"), "Allow-Headers contains authorization");
    assert.ok(allowHeaders.includes("content-type"), "Allow-Headers contains content-type");
    const allowMethods = String(res.headers["access-control-allow-methods"] ?? "").toUpperCase();
    assert.ok(allowMethods.includes("GET"), "Allow-Methods contains GET");
    assert.ok(allowMethods.includes("POST"), "Allow-Methods contains POST");
    assert.equal(res.body, "", "preflight body is empty");
    assert.equal(res.headers["access-control-max-age"], undefined, "no Max-Age (default fetch semantics)");
    assert.equal(res.headers["access-control-allow-credentials"], undefined, "no Allow-Credentials (default credentials mode)");

    const otherPath = await request(port, "/nope", { method: "OPTIONS", headers: preflightHeaders(CORS_ORIGIN) });
    assert.equal(otherPath.status, 204, "preflight is answered for any path (browsers preflight per-URL)");
    assert.equal(otherPath.headers["access-control-allow-origin"], CORS_ORIGIN);
  } finally {
    await close(server);
  }
});

test("t2: preflight respects the allowedExtensionId allowlist (204 for the allowed id, bare 403 otherwise)", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const allowedId = "abcdefghijklmnopabcdefghijklmnop";
  const { server, port } = await listen({
    store,
    registry: createRegistryFromAllAgents(),
    allowedExtensionId: allowedId,
  });
  try {
    const allowed = await request(port, "/health", {
      method: "OPTIONS",
      headers: preflightHeaders(`chrome-extension://${allowedId}`),
    });
    assert.equal(allowed.status, 204, "preflight from the allowlisted extension id -> 204");
    assert.equal(allowed.headers["access-control-allow-origin"], `chrome-extension://${allowedId}`, "ACAO echoes the allowed origin");

    const wrongId = await request(port, "/health", { method: "OPTIONS", headers: preflightHeaders(WRONG_EXTENSION_ORIGIN) });
    assert.equal(wrongId.status, 403, "preflight from a non-allowlisted extension id -> 403");
    assert.equal(wrongId.headers["access-control-allow-origin"], undefined, "rejected preflight carries NO Access-Control-Allow-Origin");

    const webOrigin = await request(port, "/health", { method: "OPTIONS", headers: preflightHeaders(WEB_ORIGIN) });
    assert.equal(webOrigin.status, 403, "preflight from a non-extension origin -> 403");
    assert.equal(webOrigin.headers["access-control-allow-origin"], undefined, "rejected preflight carries NO Access-Control-Allow-Origin");
  } finally {
    await close(server);
  }
});

test("t3: responses to allowed-origin requests carry ACAO on success and on error statuses", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  try {
    const health = await request(port, "/health", { headers: { ...AUTH, origin: CORS_ORIGIN } });
    assert.equal(health.status, 200);
    assert.equal(health.headers["access-control-allow-origin"], CORS_ORIGIN, "200 /health carries ACAO");

    const analyze = await request(port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json", origin: CORS_ORIGIN },
      body: JSON.stringify({ projectId: "demo", text: E1_SENTENCE }),
    });
    assert.equal(analyze.status, 200);
    assert.equal(analyze.headers["access-control-allow-origin"], CORS_ORIGIN, "200 /analyze carries ACAO");

    const wrongToken = await request(port, "/health", { headers: { authorization: "Bearer nope", origin: CORS_ORIGIN } });
    assert.equal(wrongToken.status, 401, "wrong token -> 401");
    assert.equal(wrongToken.headers["access-control-allow-origin"], CORS_ORIGIN, "401 still carries ACAO so the browser can read the error body");

    const noToken = await request(port, "/health", { headers: { origin: CORS_ORIGIN } });
    assert.equal(noToken.status, 401, "missing token -> 401");
    assert.equal(noToken.headers["access-control-allow-origin"], CORS_ORIGIN, "401 without a token still carries ACAO");

    const methodMismatch = await request(port, "/analyze", { headers: { ...AUTH, origin: CORS_ORIGIN } });
    assert.equal(methodMismatch.status, 405, "GET /analyze -> 405");
    assert.equal(methodMismatch.headers["access-control-allow-origin"], CORS_ORIGIN, "405 carries ACAO");

    const unknownRoute = await request(port, "/nope", { headers: { ...AUTH, origin: CORS_ORIGIN } });
    assert.equal(unknownRoute.status, 404, "unknown path -> 404");
    assert.equal(unknownRoute.headers["access-control-allow-origin"], CORS_ORIGIN, "404 carries ACAO");
  } finally {
    await close(server);
  }
});

test("t4: real requests from disallowed origins get 403 with the ACAO header absent", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const allowedId = "abcdefghijklmnopabcdefghijklmnop";
  const { server, port } = await listen({
    store,
    registry: createRegistryFromAllAgents(),
    allowedExtensionId: allowedId,
  });
  try {
    const webOrigin = await request(port, "/health", { headers: { ...AUTH, origin: WEB_ORIGIN } });
    assert.equal(webOrigin.status, 403, "non-extension Origin -> 403");
    assert.equal(webOrigin.headers["access-control-allow-origin"], undefined, "Access-Control-Allow-Origin header is absent, not merely non-echoing");

    const wrongId = await request(port, "/health", { headers: { ...AUTH, origin: WRONG_EXTENSION_ORIGIN } });
    assert.equal(wrongId.status, 403, "non-allowlisted extension id -> 403");
    assert.equal(wrongId.headers["access-control-allow-origin"], undefined, "Access-Control-Allow-Origin header is absent for the wrong extension id");
  } finally {
    await close(server);
  }
});

test("t5: OPTIONS without Origin still falls through to the token check; no-Origin requests get no CORS headers", async () => {
  const { store } = loadFixtures(defaultFixturesDir());
  const { server, port } = await listen({ store, registry: createRegistryFromAllAgents() });
  try {
    const bareOptions = await request(port, "/health", { method: "OPTIONS" });
    assert.equal(bareOptions.status, 401, "OPTIONS without Origin is not answered by the preflight branch (token check reached)");
    assert.equal(bareOptions.headers["access-control-allow-origin"], undefined, "no CORS headers on the fall-through 401");

    const noOrigin = await request(port, "/health", { headers: AUTH });
    assert.equal(noOrigin.status, 200, "non-browser client without Origin still passes with a valid token");
    assert.equal(noOrigin.headers["access-control-allow-origin"], undefined, "no-Origin request gets no CORS headers at all");
  } finally {
    await close(server);
  }
});
