export type ProjectId = string;

export type Strictness = "off" | "gentle" | "standard" | "strict";

export type AgentFamily = "continuity" | "domain" | "language" | "narrative" | "optional";

export type ContinuityAgentId = "canon-lore" | "character-consistency" | "timeline";

export type Category = "canon" | "character" | "timeline";

export interface Span {
  file: string;
  startOffset: number;
  endOffset: number;
  line?: number;
  column?: number;
}

export interface TextChunk {
  text: string;
  span: Span;
}

export type CanonKind = "fact" | "rule" | "history" | "setting";

export type CanonStatus = "proposed" | "confirmed" | "retired";

export interface CanonEntry {
  id: string;
  projectId: ProjectId;
  kind: CanonKind;
  text: string;
  tags: string[];
  status: CanonStatus;
  locked: boolean;
  lockReason?: string;
  sources: Span[];
  createdAt: string;
  updatedAt: string;
}

export interface CharacterRelationship {
  targetCharacterId: string;
  type: string;
  notes?: string;
}

export interface Character {
  id: string;
  projectId: ProjectId;
  name: string;
  aliases: string[];
  summary: string;
  traits: string[];
  abilities: string[];
  injuries: string[];
  goals: string[];
  voice?: string;
  relationships: CharacterRelationship[];
  status: CanonStatus;
  locked: boolean;
  lockReason?: string;
  sources: Span[];
  createdAt: string;
  updatedAt: string;
}

export type TimePrecision = "moment" | "part-of-day" | "day" | "season" | "year" | "fuzzy";

export interface TimelineEvent {
  id: string;
  projectId: ProjectId;
  description: string;
  order: number;
  precision: TimePrecision;
  participants: string[];
  location?: string;
  status: CanonStatus;
  locked: boolean;
  lockReason?: string;
  sources: Span[];
  createdAt: string;
  updatedAt: string;
}

export interface CanonSnapshot {
  projectId: ProjectId;
  entries: CanonEntry[];
  characters: Character[];
  events: TimelineEvent[];
}

export interface CanonContext {
  entries: CanonEntry[];
  characters: Character[];
  events: TimelineEvent[];
}

export type CanonSubjectKind = "canon-entry" | "character" | "timeline-event";

export interface CanonProposal {
  id: string;
  projectId: ProjectId;
  proposedBy: ContinuityAgentId | "writer";
  subjectKind: CanonSubjectKind;
  action: "add" | "update" | "retire";
  payload: CanonEntry | Character | TimelineEvent;
  reason: string;
  createdAt: string;
}

export interface CanonException {
  id: string;
  projectId: ProjectId;
  agentId?: ContinuityAgentId;
  scope: "finding" | "passage" | "rule";
  ref: string;
  reason: string;
  createdAt: string;
}

export interface DismissedFinding {
  findingId: string;
  projectId: ProjectId;
  agentId?: ContinuityAgentId;
  reason?: string;
  dismissedAt: string;
}

export type Severity = "info" | "minor" | "major" | "critical";

export interface Finding {
  id: string;
  agent: ContinuityAgentId;
  category: Category;
  type: string;
  severity: Severity;
  confidence: number;
  minStrictness: Exclude<Strictness, "off">;
  message: string;
  quote: string;
  location: Span;
  canonRefs: string[];
  suggestion: string | null;
  createdAt: string;
}

export interface AgentSettings {
  agentId: ContinuityAgentId;
  enabled: boolean;
  strictness: Strictness;
  options?: Record<string, boolean | string | number>;
}

export interface ProjectSettings {
  projectId: ProjectId;
  agents: AgentSettings[];
  exceptions: CanonException[];
  dismissed: DismissedFinding[];
}

export type AgentDescriptorOption = {
  key: string;
  description: string;
  default: boolean | string | number;
};

export interface AgentDescriptor {
  id: ContinuityAgentId;
  family: AgentFamily;
  title: string;
  description: string;
  defaultStrictness: Strictness;
  options?: AgentDescriptorOption[];
}
