import type {
  AgentDescriptor,
  CanonContext,
  ContinuityAgentId,
  Finding,
  ProjectSettings,
  Strictness,
  TextChunk,
} from "./types.js";

export interface AnalyzeInput {
  projectId: string;
  chunk: TextChunk;
  context: CanonContext;
  strictness: Strictness;
  settings: ProjectSettings;
}

export interface ContinuityAgent {
  id: ContinuityAgentId;
  descriptor: AgentDescriptor;
  analyze(input: AnalyzeInput): Promise<Finding[]>;
}

export const AGENT_CONTRACT_RULES = [
  "Agents are read-only: they never mutate the manuscript, the Canon store, or project settings.",
  "Agents return findings only. suggestion is advisory text and is never applied automatically.",
  "Agents receive only the changed chunk plus the minimal canon context selected for it.",
  "Every finding carries type, severity, confidence, minStrictness, location and canonRefs.",
  "Agents return an empty array when nothing is wrong; clean text produces zero findings.",
  "Strictness off means the runtime never invokes the agent.",
  "Locked canon is inviolable: contradictions with locked items are at least major severity.",
] as const;
