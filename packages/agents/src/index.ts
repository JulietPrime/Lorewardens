import type { AgentDescriptor, AnalyzeInput, ContinuityAgent, Finding } from "@lorewardens/core";

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

function stubAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(_input: AnalyzeInput): Promise<Finding[]> {
      return [];
    },
  };
}

export const STUB_AGENTS: ContinuityAgent[] = AGENT_DESCRIPTORS.map(stubAgent);
