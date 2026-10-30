import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { CanonStore, ProjectSettings } from "@lorewardens/core";
import type { AgentRegistry } from "@lorewardens/core";
import { BridgeRequestError, parseAnalyzeRequest, runBridgeAnalyze } from "./analyze.js";

export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface BridgeServerOptions {
  registry: AgentRegistry;
  store: CanonStore;
  token: string;
  allowedExtensionId?: string;
  maxBodyBytes?: number;
}

export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === "") return false;
  let hostname = host;
  const colon = host.lastIndexOf(":");
  if (colon > -1 && !host.includes("]")) {
    const port = host.slice(colon + 1);
    if (!/^\d*$/.test(port)) return false;
    hostname = host.slice(0, colon);
  }
  return hostname === "127.0.0.1" || hostname === "localhost";
}

export function isAllowedOrigin(origin: string | undefined, allowedExtensionId?: string): boolean {
  if (origin === undefined) return true;
  const prefix = "chrome-extension://";
  if (!origin.startsWith(prefix)) return false;
  if (allowedExtensionId === undefined) return true;
  return origin === `${prefix}${allowedExtensionId}`;
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerToken(req: IncomingMessage): string {
  const header = oneHeader(req.headers.authorization);
  if (header === undefined || !header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new BridgeRequestError("Request body too large.", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export type BridgeRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createBridgeHandler(options: BridgeServerOptions): BridgeRequestHandler {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return async function handle(req, res) {
    try {
      if (!isLoopbackHost(oneHeader(req.headers.host))) {
        sendJson(res, 403, { error: "Host header must be 127.0.0.1 or localhost (loopback only)." });
        return;
      }
      if (!isAllowedOrigin(oneHeader(req.headers.origin), options.allowedExtensionId)) {
        sendJson(res, 403, { error: "Origin is not an allowed chrome-extension:// origin." });
        return;
      }
      if (!tokenMatches(bearerToken(req), options.token)) {
        sendJson(res, 401, { error: "Missing or mismatched bridge token (Authorization: Bearer <token>)." });
        return;
      }

      const path = (req.url ?? "/").split("?")[0] ?? "/";
      const method = (req.method ?? "GET").toUpperCase();

      if (path === "/health") {
        if (method !== "GET") {
          sendJson(res, 405, { error: "Use GET /health." });
          return;
        }
        sendJson(res, 200, { ok: true, agents: options.registry.list().length });
        return;
      }

      if (path === "/analyze") {
        if (method !== "POST") {
          sendJson(res, 405, { error: "Use POST /analyze." });
          return;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(await readBody(req, maxBodyBytes));
        } catch {
          sendJson(res, 400, { error: "Request body must be valid JSON." });
          return;
        }
        let request;
        try {
          request = parseAnalyzeRequest(raw);
        } catch (err) {
          const status = err instanceof BridgeRequestError ? err.status : 400;
          sendJson(res, status, { error: err instanceof Error ? err.message : "Invalid request." });
          return;
        }
        try {
          await options.store.settings(request.projectId);
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : `Unknown project '${request.projectId}'.` });
          return;
        }
        const response = await runBridgeAnalyze(options.registry, options.store, request);
        sendJson(res, 200, response);
        return;
      }

      if (path.startsWith("/settings/")) {
        if (method !== "GET") {
          sendJson(res, 405, { error: "Use GET /settings/:projectId." });
          return;
        }
        let projectId: string;
        try {
          projectId = decodeURIComponent(path.slice("/settings/".length));
        } catch {
          sendJson(res, 400, { error: "Malformed project id encoding." });
          return;
        }
        if (projectId === "") {
          sendJson(res, 404, { error: "Missing project id." });
          return;
        }
        let settings: ProjectSettings;
        try {
          settings = await options.store.settings(projectId);
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : `Unknown project '${projectId}'.` });
          return;
        }
        sendJson(res, 200, settings);
        return;
      }

      sendJson(res, 404, { error: `No route for ${method} ${path}.` });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  };
}

export function createBridgeServer(options: BridgeServerOptions): Server {
  const handler = createBridgeHandler(options);
  return createServer((req, res) => {
    void handler(req, res);
  });
}
