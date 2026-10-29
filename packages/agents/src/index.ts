import type { AgentDescriptor, ContinuityAgent } from "@lorewardens/core";
import { createCanonLoreAgent } from "./canon-lore.js";
import { createCharacterConsistencyAgent } from "./character-consistency.js";
import { createTimelineAgent } from "./timeline.js";

export { createCanonLoreAgent, detectCanonContradictions, canonLoreFindings } from "./canon-lore.js";
export {
  createCharacterConsistencyAgent,
  detectCharacterIssues,
  detectRelationshipDrift,
} from "./character-consistency.js";
export { createTimelineAgent, detectTimelineIssues, timelineFindings } from "./timeline.js";

export const AGENT_DESCRIPTORS: AgentDescriptor[] = [
  {
    id: "canon-lore",
    family: "continuity",
    title: "Canon / Lore",
    description:
      "Tracks established facts, rules, history, and locked details of the world. Flags contradictions with previously confirmed canon. Optional strict checks for important objects and locations. Does not invent new lore or override the writer.",
    defaultStrictness: "standard",
    options: [
      {
        key: "objectLocationChecks",
        description: "Strict checks that important objects and locations stay where canon put them",
        default: false,
      },
    ],
  },
  {
    id: "character-consistency",
    family: "continuity",
    title: "Character Consistency",
    description:
      "Monitors character knowledge, traits, abilities, injuries, goals, and behavior. Flags moments where a character acts against established patterns or knows something they should not. Internal consistency, not style.",
    defaultStrictness: "standard",
    options: [
      {
        key: "relationshipState",
        description: "Include relationship-state continuity when enabled",
        default: false,
      },
    ],
  },
  {
    id: "timeline",
    family: "continuity",
    title: "Timeline / Chronology",
    description:
      "Checks sequence, ages, dates, travel time, and flashback placement. Flags impossible or unclear time jumps and chronological contradictions.",
    defaultStrictness: "standard",
    options: [],
  },
];

function agentById(id: string): AgentDescriptor {
  const descriptor = AGENT_DESCRIPTORS.find((d) => d.id === id);
  if (!descriptor) throw new Error(`No agent descriptor with id '${id}'`);
  return descriptor;
}

export const CANON_LORE_AGENT: ContinuityAgent = createCanonLoreAgent(agentById("canon-lore"));

export const CHARACTER_CONSISTENCY_AGENT: ContinuityAgent = createCharacterConsistencyAgent(
  agentById("character-consistency"),
);

export const TIMELINE_AGENT: ContinuityAgent = createTimelineAgent(agentById("timeline"));

export const CONTINUITY_AGENTS: ContinuityAgent[] = [
  CANON_LORE_AGENT,
  CHARACTER_CONSISTENCY_AGENT,
  TIMELINE_AGENT,
];
