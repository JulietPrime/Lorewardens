import assert from "node:assert/strict";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { CanonStore } from "@lorewardens/core";
import { defaultFixturesDir, loadFixtures } from "@lorewardens/mcp-server";
import { createRegistryFromAllAgents } from "../src/analyze.js";
import { createBridgeServer, type BridgeServerOptions } from "../src/server.js";

// Independent acceptance suite for the bridge CORS preflight fix
// (task fix-bridge-cors-preflight-for-extension).
//
// The owner's live failure: fetch() from the Docs extension to the loopback
// bridge with an Authorization header triggers a browser preflight (an
// OPTIONS request that carries no Authorization header by spec); the bridge
// reached the token check and answered with a bare 401, so Chrome reported
// "Response to preflight request doesn't pass access control check: No
// Access-Control-Allow-Origin header". CORS is browser-enforced only, so this
// suite asserts the wire contract a real browser holds the bridge to:
//
//   ac-1  preflight handshake: OPTIONS from an allowed chrome-extension://
//         origin -> 204 + Access-Control-Allow-Origin (exact echo) +
//         Access-Control-Allow-Headers (Authorization, Content-Type) +
//         Access-Control-Allow-Methods (GET, POST); no Authorization header
//         required; answered for any path;
//   ac-2  real responses to allowed-origin requests carry the same ACAO on
//         success and on 400/401/404/405;
//   ac-3  disallowed origins get 403 with NO Access-Control-Allow-Origin
//         (allowlist rules unchanged); no-Origin (non-browser) requests get
//         no CORS headers at all.

const TOKEN = "cors-acceptance-token-0123456789abcdef";
const AUTH = { authorization: `Bearer ${TOKEN}` };

// The exact origin from the owner's live failure report.
const OWNER_ORIGIN = "chrome-extension://mmmbfenncncclcoajepmfdfpfkdjnogj";
const ALLOWED_ID = "abcdefghijklmnopabcdefghijklmnop";
const ALLOWED_ORIGIN = `chrome-extension://${ALLOWED_ID}`;
const WRONG_EXTENSION_ORIGIN = "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
const WEB_ORIGIN = "https://phishing.example";

interface Probe {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

function probe(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Probe> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers ?? {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

async function listen(
  options: Partial<BridgeServerOptions> & { store: CanonStore },
): Promise<{ server: Server; port: number }> {
  const server = createBridgeServer({
    token: TOKEN,
    registry: createRegistryFromAllAgents(),
    ...options,
  } as BridgeServerOptions);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, port };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// The preflights a Chrome extension actually sends: GET /health only needs
// Authorization granted; POST /analyze needs Authorization + Content-Type.
function preflightFor(origin: string, method: "GET" | "POST", requestHeaders: string): Record<string, string> {
  return {
    origin,
    "access-control-request-method": method,
    "access-control-request-headers": requestHeaders,
  };
}

function assertPreflightHandshake(res: Probe, origin: string, context: string): void {
  assert.equal(res.status, 204, `${context}: preflight answered 204`);
  assert.equal(res.body, "", `${context}: preflight body is empty`);
  assert.equal(
    res.headers["access-control-allow-origin"],
    origin,
    `${context}: Access-Control-Allow-Origin echoes the exact origin (never a wildcard)`,
  );
  const allowHeaders = String(res.headers["access-control-allow-headers"] ?? "").toLowerCase();
  assert.ok(allowHeaders.includes("authorization"), `${context}: Allow-Headers grants authorization`);
  assert.ok(allowHeaders.includes("content-type"), `${context}: Allow-Headers grants content-type`);
  const allowMethods = String(res.headers["access-control-allow-methods"] ?? "").toUpperCase();
  assert.ok(allowMethods.includes("GET"), `${context}: Allow-Methods grants GET`);
  assert.ok(allowMethods.includes("POST"), `${context}: Allow-Methods grants POST`);
  assert.equal(res.headers["access-control-max-age"], undefined, `${context}: no Access-Control-Max-Age`);
  assert.equal(
    res.headers["access-control-allow-credentials"],
    undefined,
    `${context}: no Access-Control-Allow-Credentials (fetch runs in the default credentials mode)`,
  );
}

function assertNoCorsHeaders(res: Probe, context: string): void {
  assert.equal(res.headers["access-control-allow-origin"], undefined, `${context}: no Access-Control-Allow-Origin`);
  assert.equal(res.headers["access-control-allow-headers"], undefined, `${context}: no Access-Control-Allow-Headers`);
  assert.equal(res.headers["access-control-allow-methods"], undefined, `${context}: no Access-Control-Allow-Methods`);
}

function fixtureStore(): CanonStore {
  return loadFixtures(defaultFixturesDir()).store;
}

test("ac-1: the preflight handshake is answered 204 with the allow headers and no Authorization header", async () => {
  const { server, port } = await listen({ store: fixtureStore() });
  try {
    // The exact shape that failed in the owner's live test: preflight for
    // GET /health, which requests only the authorization header.
    const health = await probe(port, "/health", {
      method: "OPTIONS",
      headers: preflightFor(OWNER_ORIGIN, "GET", "authorization"),
    });
    assertPreflightHandshake(health, OWNER_ORIGIN, "GET /health preflight from the owner's extension origin");

    // POST /analyze preflight requests authorization + content-type.
    const analyze = await probe(port, "/analyze", {
      method: "OPTIONS",
      headers: preflightFor(OWNER_ORIGIN, "POST", "authorization, content-type"),
    });
    assertPreflightHandshake(analyze, OWNER_ORIGIN, "POST /analyze preflight from the owner's extension origin");

    // The extension also reads settings through the bridge.
    const settings = await probe(port, "/settings/demo", {
      method: "OPTIONS",
      headers: preflightFor(OWNER_ORIGIN, "GET", "authorization"),
    });
    assertPreflightHandshake(settings, OWNER_ORIGIN, "GET /settings preflight from the owner's extension origin");

    // Browsers preflight per-URL before the route matters, so the handshake
    // is answered for any path.
    const unknown = await probe(port, "/nope", {
      method: "OPTIONS",
      headers: preflightFor(OWNER_ORIGIN, "GET", "authorization"),
    });
    assertPreflightHandshake(unknown, OWNER_ORIGIN, "preflight on an unknown path");
  } finally {
    await close(server);
  }
});

test("ac-1: with allowedExtensionId set, only the allowlisted extension id gets the preflight handshake", async () => {
  const { server, port } = await listen({ store: fixtureStore(), allowedExtensionId: ALLOWED_ID });
  try {
    const allowed = await probe(port, "/health", {
      method: "OPTIONS",
      headers: preflightFor(ALLOWED_ORIGIN, "GET", "authorization"),
    });
    assertPreflightHandshake(allowed, ALLOWED_ORIGIN, "allowlisted extension id preflight");

    const wrongId = await probe(port, "/health", {
      method: "OPTIONS",
      headers: preflightFor(WRONG_EXTENSION_ORIGIN, "GET", "authorization"),
    });
    assert.equal(wrongId.status, 403, "preflight from a non-allowlisted extension id -> 403");
    assertNoCorsHeaders(wrongId, "non-allowlisted extension id preflight");

    const web = await probe(port, "/health", {
      method: "OPTIONS",
      headers: preflightFor(WEB_ORIGIN, "GET", "authorization"),
    });
    assert.equal(web.status, 403, "preflight from a non-extension origin -> 403");
    assertNoCorsHeaders(web, "non-extension origin preflight");
  } finally {
    await close(server);
  }
});

test("ac-2: real responses to an allowed origin carry the same ACAO on 200, 400, 401, 404 and 405", async () => {
  const { server, port } = await listen({ store: fixtureStore() });
  try {
    const health = await probe(port, "/health", { headers: { ...AUTH, origin: OWNER_ORIGIN } });
    assert.equal(health.status, 200);
    assert.equal(health.headers["access-control-allow-origin"], OWNER_ORIGIN, "200 /health carries the exact ACAO");

    const settings = await probe(port, "/settings/demo", { headers: { ...AUTH, origin: OWNER_ORIGIN } });
    assert.equal(settings.status, 200);
    assert.equal(settings.headers["access-control-allow-origin"], OWNER_ORIGIN, "200 /settings carries the exact ACAO");

    const analyze = await probe(port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json", origin: OWNER_ORIGIN },
      body: JSON.stringify({ projectId: "demo", text: "Mira cast the warding spell without giving up a single memory." }),
    });
    assert.equal(analyze.status, 200);
    assert.equal(analyze.headers["access-control-allow-origin"], OWNER_ORIGIN, "200 /analyze carries the exact ACAO");

    const wrongToken = await probe(port, "/health", {
      headers: { authorization: "Bearer nope", origin: OWNER_ORIGIN },
    });
    assert.equal(wrongToken.status, 401);
    assert.equal(
      wrongToken.headers["access-control-allow-origin"],
      OWNER_ORIGIN,
      "401 carries ACAO so the browser can read the error body",
    );

    const missingToken = await probe(port, "/health", { headers: { origin: OWNER_ORIGIN } });
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.headers["access-control-allow-origin"], OWNER_ORIGIN, "401 without a token still carries ACAO");

    const methodMismatch = await probe(port, "/analyze", { headers: { ...AUTH, origin: OWNER_ORIGIN } });
    assert.equal(methodMismatch.status, 405, "GET /analyze -> 405");
    assert.equal(methodMismatch.headers["access-control-allow-origin"], OWNER_ORIGIN, "405 carries ACAO");

    const unknownRoute = await probe(port, "/nope", { headers: { ...AUTH, origin: OWNER_ORIGIN } });
    assert.equal(unknownRoute.status, 404, "unknown path -> 404");
    assert.equal(unknownRoute.headers["access-control-allow-origin"], OWNER_ORIGIN, "404 carries ACAO");

    const badJson = await probe(port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json", origin: OWNER_ORIGIN },
      body: "{not json",
    });
    assert.equal(badJson.status, 400, "malformed JSON -> 400");
    assert.equal(badJson.headers["access-control-allow-origin"], OWNER_ORIGIN, "400 carries ACAO");

    const unknownProject = await probe(port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json", origin: OWNER_ORIGIN },
      body: JSON.stringify({ projectId: "nope", text: "hi" }),
    });
    assert.equal(unknownProject.status, 404, "unknown project -> 404");
    assert.equal(unknownProject.headers["access-control-allow-origin"], OWNER_ORIGIN, "unknown-project 404 carries ACAO");
  } finally {
    await close(server);
  }
});

test("ac-3: disallowed origins get bare 403s on real requests and preflights; allowlist rules unchanged", async () => {
  const { server, port } = await listen({ store: fixtureStore(), allowedExtensionId: ALLOWED_ID });
  try {
    const webHealth = await probe(port, "/health", { headers: { ...AUTH, origin: WEB_ORIGIN } });
    assert.equal(webHealth.status, 403, "non-extension Origin -> 403");
    assertNoCorsHeaders(webHealth, "non-extension Origin health request");

    const wrongIdHealth = await probe(port, "/health", { headers: { ...AUTH, origin: WRONG_EXTENSION_ORIGIN } });
    assert.equal(wrongIdHealth.status, 403, "non-allowlisted extension id -> 403");
    assertNoCorsHeaders(wrongIdHealth, "non-allowlisted extension id health request");

    const webAnalyze = await probe(port, "/analyze", {
      method: "POST",
      headers: { ...AUTH, "content-type": "application/json", origin: WEB_ORIGIN },
      body: JSON.stringify({ projectId: "demo", text: "hi" }),
    });
    assert.equal(webAnalyze.status, 403, "a disallowed origin is rejected before route handling");
    assertNoCorsHeaders(webAnalyze, "non-extension Origin analyze request");

    const allowed = await probe(port, "/health", { headers: { ...AUTH, origin: ALLOWED_ORIGIN } });
    assert.equal(allowed.status, 200, "the allowlisted extension id still passes");
    assert.equal(allowed.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
  } finally {
    await close(server);
  }
});

test("ac-3: no-Origin (non-browser) requests carry no CORS headers at all", async () => {
  const { server, port } = await listen({ store: fixtureStore() });
  try {
    const health = await probe(port, "/health", { headers: AUTH });
    assert.equal(health.status, 200, "a non-browser client with a valid token still passes");
    assertNoCorsHeaders(health, "no-Origin /health");

    const tokenlessOptions = await probe(port, "/health", { method: "OPTIONS" });
    assert.equal(tokenlessOptions.status, 401, "OPTIONS without Origin is not treated as a preflight (token check reached)");
    assertNoCorsHeaders(tokenlessOptions, "no-Origin tokenless OPTIONS");

    const authenticatedOptions = await probe(port, "/health", { method: "OPTIONS", headers: AUTH });
    assert.equal(
      authenticatedOptions.status,
      405,
      "an authenticated no-Origin OPTIONS is a misrouted request (405), not a handshake",
    );
    assertNoCorsHeaders(authenticatedOptions, "no-Origin authenticated OPTIONS");
  } finally {
    await close(server);
  }
});
