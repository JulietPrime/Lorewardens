import type { CanonStore, ContinuityAgent, Finding, Strictness } from "@lorewardens/core";
import { createRegistry, type AgentRegistry } from "@lorewardens/core";
import { ALL_AGENTS } from "@lorewardens/agents";
import { runAnalyzeTool } from "@lorewardens/mcp-server";

export type AnalyzeToolOutcome = Awaited<ReturnType<typeof runAnalyzeTool>>;

export type AnalyzeInvoker = (
  agent: ContinuityAgent,
  store: CanonStore,
  input: unknown,
) => Promise<AnalyzeToolOutcome>;

export const DEFAULT_FILE_LABEL = "document";

const STRICTNESS_VALUES: readonly Strictness[] = ["off", "gentle", "standard", "strict"];

export interface BridgeAnalyzeRequest {
  projectId: string;
  text: string;
  spanStart?: number;
  strictness?: Strictness;
  title?: string;
}

export interface SkippedAgent {
  agent: string;
  reason: string;
}

export interface BridgeAnalyzeResponse {
  findings: Finding[];
  invokedAgents: string[];
  skipped: SkippedAgent[];
}

export class BridgeRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "BridgeRequestError";
    this.status = status;
  }
}

export function createRegistryFromAllAgents(): AgentRegistry {
  return createRegistry(ALL_AGENTS);
}

const ALLOWED_REQUEST_FIELDS: readonly string[] = ["projectId", "text", "spanStart", "strictness", "title"];

function requireNonEmptyString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new BridgeRequestError(`Request field '${field}' must be a non-empty string.`, 400);
  }
  return value;
}

export function parseAnalyzeRequest(raw: unknown): BridgeAnalyzeRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new BridgeRequestError("Request body must be a JSON object.", 400);
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_REQUEST_FIELDS.includes(key)) {
      throw new BridgeRequestError(`Unknown request field '${key}'.`, 400);
    }
  }
  const request: BridgeAnalyzeRequest = {
    projectId: requireNonEmptyString(body, "projectId"),
    text: requireNonEmptyString(body, "text"),
  };
  if (body.spanStart !== undefined) {
    const spanStart = body.spanStart;
    if (typeof spanStart !== "number" || !Number.isInteger(spanStart) || spanStart < 0) {
      throw new BridgeRequestError("Request field 'spanStart' must be a non-negative integer.", 400);
    }
    request.spanStart = spanStart;
  }
  if (body.strictness !== undefined) {
    const strictness = body.strictness;
    if (typeof strictness !== "string" || !STRICTNESS_VALUES.includes(strictness as Strictness)) {
      throw new BridgeRequestError("Request field 'strictness' must be one of off, gentle, standard, strict.", 400);
    }
    request.strictness = strictness as Strictness;
  }
  if (body.title !== undefined) {
    request.title = requireNonEmptyString(body, "title");
  }
  return request;
}

// The chunk span uses UTF-16 code-unit offsets: JS string indices and the
// Google Docs indexing unit agree, so findings come back document-absolute
// with no client-side arithmetic.
export async function runBridgeAnalyze(
  registry: AgentRegistry,
  store: CanonStore,
  request: BridgeAnalyzeRequest,
  invoke: AnalyzeInvoker = runAnalyzeTool,
): Promise<BridgeAnalyzeResponse> {
  const spanStart = request.spanStart ?? 0;
  const chunk = {
    text: request.text,
    file: request.title ?? DEFAULT_FILE_LABEL,
    startOffset: spanStart,
    endOffset: spanStart + request.text.length,
  };
  const findings: Finding[] = [];
  const invokedAgents: string[] = [];
  const skipped: SkippedAgent[] = [];
  for (const descriptor of registry.list()) {
    const agent = registry.get(descriptor.id);
    if (!agent) continue;
    const result = await invoke(agent, store, {
      projectId: request.projectId,
      chunk,
      ...(request.strictness !== undefined ? { strictness: request.strictness } : {}),
    });
    if (result.invoked) {
      invokedAgents.push(agent.id);
      findings.push(...((result.findings ?? []) as Finding[]));
    } else {
      skipped.push({ agent: agent.id, reason: result.reason ?? "agent was not invoked" });
    }
  }
  return { findings, invokedAgents, skipped };
}
