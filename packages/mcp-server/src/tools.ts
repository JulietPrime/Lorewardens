import { z } from "zod";
import type { AgentRegistry, CanonStore, ContinuityAgent, ProjectSettings, Strictness } from "@lorewardens/core";
import { filterFindings, selectRelevantContext } from "@lorewardens/core";
import { assertValidFindings } from "./validate.js";

export const AnalyzeToolInput = z.object({
  projectId: z.string().min(1).describe("Project to analyze against (a seeded canon fixture)."),
  chunk: z
    .object({
      text: z.string().min(1).describe("The new or changed manuscript text."),
      file: z.string().min(1).describe("Manuscript file the chunk belongs to."),
      startOffset: z.number().int().min(0).describe("Character offset of the chunk start within the file."),
      endOffset: z.number().int().min(0).describe("Character offset of the chunk end within the file."),
    })
    .describe("The changed text plus its location."),
  strictness: z
    .enum(["off", "gentle", "standard", "strict"])
    .optional()
    .describe(
      "Strictness for this call. Defaults to the project's agent setting, then the agent's defaultStrictness. 'off' never invokes the agent.",
    ),
});

export const CanonListInput = z.object({
  projectId: z.string().min(1).describe("Project whose canon snapshot to return."),
});

export interface AnalyzeToolArgs {
  projectId: string;
  chunk: { text: string; file: string; startOffset: number; endOffset: number };
  strictness?: Strictness;
}

export interface CanonListArgs {
  projectId: string;
}

export interface AnalyzeToolResult {
  agent: string;
  projectId: string;
  strictness: Strictness;
  invoked: boolean;
  reason?: string;
  findings?: unknown[];
  findingsCount?: number;
  contextSummary?: { entries: number; characters: number; events: number };
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (args: unknown) => Promise<unknown>;
}

function notInvoked(agent: string, projectId: string, strictness: Strictness, reason: string): AnalyzeToolResult {
  return { agent, projectId, strictness, invoked: false, reason, findings: [], findingsCount: 0 };
}

export async function runAnalyzeTool(
  agent: ContinuityAgent,
  store: CanonStore,
  rawInput: unknown,
): Promise<AnalyzeToolResult> {
  const input = AnalyzeToolInput.parse(rawInput) as AnalyzeToolArgs;
  const settings: ProjectSettings = await store.settings(input.projectId);
  const agentSettings = settings.agents.find((a) => a.agentId === agent.id);

  if (agentSettings && !agentSettings.enabled) {
    return notInvoked(
      agent.id,
      input.projectId,
      input.strictness ?? agentSettings.strictness,
      `Agent '${agent.id}' is disabled for project '${input.projectId}'; nothing was analyzed.`,
    );
  }

  const effectiveStrictness: Strictness =
    input.strictness ?? agentSettings?.strictness ?? agent.descriptor.defaultStrictness;

  if (effectiveStrictness === "off") {
    return notInvoked(
      agent.id,
      input.projectId,
      effectiveStrictness,
      "Strictness is 'off': the agent is not invoked, zero cost.",
    );
  }

  const snapshot = await store.read(input.projectId);
  const context = selectRelevantContext(input.chunk.text, snapshot);
  const findings = await agent.analyze({
    projectId: input.projectId,
    chunk: {
      text: input.chunk.text,
      span: {
        file: input.chunk.file,
        startOffset: input.chunk.startOffset,
        endOffset: input.chunk.endOffset,
      },
    },
    context,
    strictness: effectiveStrictness,
    settings,
  });

  const gated = filterFindings(findings, { strictness: effectiveStrictness, settings, agentId: agent.id });
  assertValidFindings(gated);

  return {
    agent: agent.id,
    projectId: input.projectId,
    strictness: effectiveStrictness,
    invoked: true,
    findings: gated,
    findingsCount: gated.length,
    contextSummary: {
      entries: context.entries.length,
      characters: context.characters.length,
      events: context.events.length,
    },
  };
}

function countByStatus(items: { status: string }[]): Record<string, number> {
  const counts: Record<string, number> = { confirmed: 0, proposed: 0, retired: 0 };
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

export async function runCanonListTool(store: CanonStore, rawInput: unknown): Promise<unknown> {
  const input = CanonListInput.parse(rawInput) as CanonListArgs;
  const snapshot = await store.read(input.projectId);
  return {
    projectId: input.projectId,
    snapshot,
    counts: {
      entries: countByStatus(snapshot.entries),
      characters: countByStatus(snapshot.characters),
      events: countByStatus(snapshot.events),
    },
    note: "Read-only view of the seeded canon fixture. Writers confirm canon through the Lorewardens app, not through MCP tools.",
  };
}

export function buildTools(registry: AgentRegistry, store: CanonStore): ToolDef[] {
  const tools: ToolDef[] = [];

  for (const descriptor of registry.list()) {
    const agent = registry.get(descriptor.id);
    if (!agent) continue;
    tools.push({
      name: `analyze_${descriptor.id.replace(/-/g, "_")}`,
      description:
        `Run the ${descriptor.title} continuity agent over new or changed text and return ` +
        `structured, non-destructive findings (no writes, no network). ${descriptor.description}`,
      inputSchema: AnalyzeToolInput,
      handler: (args) => runAnalyzeTool(agent, store, args),
    });
  }

  tools.push({
    name: "canon_list",
    description:
      "Return the seeded canon snapshot for a project (entries, characters, timeline events with their " +
      "confirmation status). Read-only; no writes and no network.",
    inputSchema: CanonListInput,
    handler: (args) => runCanonListTool(store, args),
  });

  return tools;
}
