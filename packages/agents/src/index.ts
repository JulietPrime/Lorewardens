import type { AgentDescriptor, ContinuityAgent } from "@lorewardens/core";
import { createCanonLoreAgent } from "./canon-lore.js";
import { createCharacterConsistencyAgent } from "./character-consistency.js";
import { createTimelineAgent } from "./timeline.js";
import { createGrammarMechanicsAgent } from "./grammar-mechanics.js";
import { createVocabularyRepetitionAgent } from "./vocabulary-repetition.js";
import { createStyleVoiceAgent } from "./style-voice.js";
import { createCharacterVoiceAgent } from "./character-voice.js";
import { createPeriodDialectAgent } from "./period-dialect.js";

export { createCanonLoreAgent, detectCanonContradictions, canonLoreFindings } from "./canon-lore.js";
export {
  createCharacterConsistencyAgent,
  detectCharacterIssues,
  detectRelationshipDrift,
} from "./character-consistency.js";
export { createTimelineAgent, detectTimelineIssues, timelineFindings } from "./timeline.js";
export { grammarMechanicsFindings } from "./grammar-mechanics.js";
export { vocabularyRepetitionFindings } from "./vocabulary-repetition.js";
export { styleVoiceFindings } from "./style-voice.js";
export { characterVoiceFindings } from "./character-voice.js";
export { periodDialectFindings } from "./period-dialect.js";

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
  {
    id: "grammar-mechanics",
    family: "language",
    title: "Grammar / Mechanics",
    description:
      "Flags clear mechanical errors — doubled words, stray whitespace before punctuation, doubled punctuation, a lowercase standalone 'i'. Clear mistakes only; never rewrites style or voice.",
    defaultStrictness: "standard",
    options: [],
  },
  {
    id: "vocabulary-repetition",
    family: "language",
    title: "Vocabulary / Repetition",
    description:
      "Flags overused words and weak or repeated verbs as patterns, not isolated choices: a stem recurring across the passage or echoing within one sentence. Names the pattern; never suggests replacement words.",
    defaultStrictness: "standard",
    options: [],
  },
  {
    id: "style-voice",
    family: "language",
    title: "Style / Voice Consistency",
    description:
      "Flags sudden shifts in sentence rhythm or formality that break the voice the passage itself establishes. Never imposes an external style.",
    defaultStrictness: "standard",
    options: [],
  },
  {
    id: "character-voice",
    family: "language",
    title: "Character Voice",
    description:
      "Checks dialogue and internal thought against each character's established voice (the Character.voice canon field). Flags lines that drift from known speech patterns, such as phrases the voice canon says the character avoids.",
    defaultStrictness: "standard",
    options: [],
  },
  {
    id: "period-dialect",
    family: "language",
    title: "Period / Dialect / Language",
    description:
      "Gated behind a confirmed period setting in canon: flags modern anachronisms and casual slang that break a pre-1900 Earth-like period, and respects intentional modern or invented language when the writer says so in canon.",
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

export const GRAMMAR_MECHANICS_AGENT: ContinuityAgent = createGrammarMechanicsAgent(agentById("grammar-mechanics"));

export const VOCABULARY_REPETITION_AGENT: ContinuityAgent = createVocabularyRepetitionAgent(
  agentById("vocabulary-repetition"),
);

export const STYLE_VOICE_AGENT: ContinuityAgent = createStyleVoiceAgent(agentById("style-voice"));

export const CHARACTER_VOICE_AGENT: ContinuityAgent = createCharacterVoiceAgent(agentById("character-voice"));

export const PERIOD_DIALECT_AGENT: ContinuityAgent = createPeriodDialectAgent(agentById("period-dialect"));

export const CONTINUITY_AGENTS: ContinuityAgent[] = [
  CANON_LORE_AGENT,
  CHARACTER_CONSISTENCY_AGENT,
  TIMELINE_AGENT,
];

export const LANGUAGE_AGENTS: ContinuityAgent[] = [
  GRAMMAR_MECHANICS_AGENT,
  VOCABULARY_REPETITION_AGENT,
  STYLE_VOICE_AGENT,
  CHARACTER_VOICE_AGENT,
  PERIOD_DIALECT_AGENT,
];

export const ALL_AGENTS: ContinuityAgent[] = [...CONTINUITY_AGENTS, ...LANGUAGE_AGENTS];
