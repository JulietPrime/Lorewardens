import type { AgentDescriptor, AnalyzeInput, CanonContext, Character, ContinuityAgent, Finding, TextChunk, TimelineEvent } from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import {
  aboutStatement,
  antonymConflict,
  capitalizedTokens,
  contentWords,
  gateForAgent,
  hasNegation,
  KNOWLEDGE_CUES,
  mentionsSubject,
  namesOf,
  nameVariantOf,
  RECOVERY_CUES,
  sentences,
} from "./lexical.js";

export type CharacterConsistencyOptions = { relationshipState?: boolean };

const RELATIONSHIP_CHANGE_CUES = ["now", "no longer", "used to be", "betrayed", "became", "turned against"] as const;
const RELATIONSHIP_TYPES = ["rival", "enemy", "friend", "ally", "lover", "stranger", "mentor", "apprentice"] as const;

interface Issue {
  character: Character;
  type: string;
  severity: "minor" | "info";
  confidence: number;
  minStrictness: "standard" | "strict";
  message: string;
  canonRefs: string[];
  quote: string;
  start: number;
  end: number;
  suggestion?: string;
}

function suggestionFor(character: Character): string {
  return (
    `Character proposal (advisory): if the change is intended, file a CanonProposal to update ` +
    `character '${character.id}'; otherwise align the passage with the established canon.`
  );
}

function pushIssue(issues: Issue[], seen: Set<string>, issue: Issue): void {
  const key = `${issue.character.id}:${issue.type}:${issue.start}`;
  if (seen.has(key)) return;
  seen.add(key);
  issues.push(issue);
}

export function detectCharacterIssues(chunkText: string, context: CanonContext): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();

  const characters = context.characters.filter((c) => c.status === "confirmed");
  const events = context.events.filter((e) => e.status === "confirmed");

  for (const character of characters) {
    const names = namesOf(character);
    for (const sentence of sentences(chunkText)) {
      if (!mentionsSubject(sentence.text, names)) continue;

      for (const ability of character.abilities) {
        if (hasNegation(sentence.text) && aboutStatement(sentence.text, ability, 1)) {
          pushIssue(issues, seen, {
            character,
            type: "ability-contradiction",
            severity: "minor",
            confidence: 0.8,
            minStrictness: "standard",
            message: `Passage negates an ability canon gives ${character.name} ('${ability}').`,
            canonRefs: [character.id],
            quote: sentence.text,
            start: sentence.start,
            end: sentence.end,
          });
        }
      }

      for (const trait of character.traits) {
        const antonym = antonymConflict(trait, sentence.text);
        if (antonym || (hasNegation(sentence.text) && aboutStatement(sentence.text, trait, 1))) {
          pushIssue(issues, seen, {
            character,
            type: "trait-contradiction",
            severity: "minor",
            confidence: 0.75,
            minStrictness: "standard",
            message: antonym
              ? `Passage characterizes ${character.name} contrary to the canon trait '${trait}' ('${antonym.opposite}' vs '${antonym.word}').`
              : `Passage negates the canon trait '${trait}' of ${character.name}.`,
            canonRefs: [character.id],
            quote: sentence.text,
            start: sentence.start,
            end: sentence.end,
          });
        }
      }

      for (const injury of character.injuries) {
        const keywords = contentWords(injury);
        const lower = ` ${sentence.text.toLowerCase()} `;
        const mentionsInjury = keywords.some((k) => lower.includes(` ${k}`));
        const recovery = RECOVERY_CUES.some((cue) => lower.includes(` ${cue}`));
        if (mentionsInjury && (recovery || hasNegation(sentence.text))) {
          pushIssue(issues, seen, {
            character,
            type: "injury-contradiction",
            severity: "minor",
            confidence: 0.8,
            minStrictness: "standard",
            message: `Passage treats ${character.name}'s canon injury ('${injury}') as absent or healed.`,
            canonRefs: [character.id],
            quote: sentence.text,
            start: sentence.start,
            end: sentence.end,
          });
        }
      }
    }
  }

  // Knowledge violations: a character has knowledge cues about an event whose
  // participant list excludes them, and canon records no way they learned of it.
  for (const event of events) {
    const participantIds = new Set(event.participants);
    for (const character of characters) {
      if (participantIds.has(character.id)) continue;
      const names = namesOf(character);
      for (const sentence of sentences(chunkText)) {
        const lower = sentence.text.toLowerCase();
        if (!mentionsSubject(sentence.text, names)) continue;
        const knowledgeCue = KNOWLEDGE_CUES.some((cue) => lower.includes(cue));
        if (!knowledgeCue) continue;
        if (aboutStatement(sentence.text, event.description, 1)) {
          pushIssue(issues, seen, {
            character,
            type: "knowledge-violation",
            severity: "minor",
            confidence: 0.72,
            minStrictness: "standard",
            message:
              `${character.name} shows knowledge of "${event.description}" (event '${event.id}'), ` +
              `whose canon participants exclude them and which canon records no way of their learning.`,
            canonRefs: [character.id, event.id],
            quote: sentence.text,
            start: sentence.start,
            end: sentence.end,
          });
        }
      }
    }
  }

  return issues;
}

/** Strict optional check (relationshipState): relationship-state drift against canon. */
export function detectRelationshipDrift(chunkText: string, context: CanonContext): Issue[] {
  const characters = context.characters.filter((c) => c.status === "confirmed");
  const issues: Issue[] = [];
  for (const sentence of sentences(chunkText)) {
    const lower = sentence.text.toLowerCase();
    if (!RELATIONSHIP_CHANGE_CUES.some((cue) => lower.includes(cue))) continue;
    for (const character of characters) {
      for (const relationship of character.relationships) {
        const target = characters.find((c) => c.id === relationship.targetCharacterId);
        if (!target) continue;
        if (!mentionsSubject(sentence.text, namesOf(character)) || !mentionsSubject(sentence.text, namesOf(target))) {
          continue;
        }
        const contradiction = RELATIONSHIP_TYPES.some((type) => {
          const conflict = antonymConflict(relationship.type, type);
          return conflict && lower.includes(type);
        });
        if (contradiction) {
          issues.push({
            character,
            type: "relationship-drift",
            severity: "info",
            confidence: 0.55,
            minStrictness: "strict",
            message: `Passage drifts the canon relationship between ${character.name} and ${target.name} ('${relationship.type}').`,
            canonRefs: [character.id, target.id],
            quote: sentence.text,
            start: sentence.start,
            end: sentence.end,
          });
        }
      }
    }
  }
  return issues;
}

/**
 * Name-variant drift (stateless): the canon spelling is the reference, so
 * EVERY variant occurrence flags — there is no document-order "first
 * mention" tracking. The owner's scenario (canon spelling first, drift
 * later) is fully covered; a variant-first occurrence also flags, which is
 * minor, advisory, and dismissible by locking the variant as an alias.
 * Determinism and the chunk-wise contract outrank the literal "after first
 * mention" wording.
 *
 * Place-name guard: a proper noun evidenced as a place in confirmed setting
 * canon must not be treated as a character name. The issue is suppressed
 * when EITHER the character's canon name (name or alias) OR the variant
 * token T is a member of context.placeNames — this prevents the canon
 * extractor's documented v1 gap (recurring proper-noun places proposed as
 * characters) from compounding into drift findings.
 */
export function detectNameVariantDrift(chunkText: string, context: CanonContext): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const placeNames = new Set((context.placeNames ?? []).map((p) => p.toLowerCase()));
  const characters = context.characters.filter((c) => c.status === "confirmed");
  for (const character of characters) {
    const names = namesOf(character);
    const canonNameIsPlaceEvidenced = names.some((n) => placeNames.has(n.toLowerCase()));
    for (const sentence of sentences(chunkText)) {
      for (const token of capitalizedTokens(sentence.text)) {
        // Exact case-insensitive members (canon name or alias) never flag.
        if (names.some((n) => n.toLowerCase() === token.toLowerCase())) continue;
        const match = nameVariantOf(token, names);
        if (!match) continue;
        if (canonNameIsPlaceEvidenced || placeNames.has(token.toLowerCase())) continue;
        pushIssue(issues, seen, {
          character,
          type: "name-variant-drift",
          severity: "minor",
          confidence: 0.72,
          minStrictness: "standard",
          message: `Passage spells ${character.name} as '${token}' (canon: '${match.canonical}').`,
          canonRefs: [character.id],
          quote: sentence.text,
          start: sentence.start,
          end: sentence.end,
          suggestion:
            `Character proposal (advisory): align the passage with the canon spelling, ` +
            `or lock the variant as an alias of ${character.name} if it is deliberate.`,
        });
      }
    }
  }
  return issues;
}

export function characterConsistencyFindings(
  chunk: TextChunk,
  context: CanonContext,
  options: CharacterConsistencyOptions,
  strictness: "off" | "gentle" | "standard" | "strict",
): Finding[] {
  const issues = [
    ...detectCharacterIssues(chunk.text, context),
    ...detectNameVariantDrift(chunk.text, context),
    ...(options.relationshipState && strictness === "strict" ? detectRelationshipDrift(chunk.text, context) : []),
  ];
  return issues.map((issue) =>
    makeFinding({
      agent: "character-consistency",
      category: "character",
      type: issue.type,
      severity: issue.severity,
      confidence: issue.confidence,
      minStrictness: issue.minStrictness,
      message: issue.message,
      quote: issue.quote,
      location: {
        file: chunk.span.file,
        startOffset: chunk.span.startOffset + issue.start,
        endOffset: chunk.span.startOffset + issue.end,
      },
      canonRefs: issue.canonRefs,
      suggestion: issue.suggestion ?? suggestionFor(issue.character),
    }),
  );
}

export function createCharacterConsistencyAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      const options = (input.settings.agents.find((a) => a.agentId === "character-consistency")?.options ??
        {}) as CharacterConsistencyOptions;
      const findings = characterConsistencyFindings(input.chunk, input.context, options, input.strictness);
      return gateForAgent(findings, input.strictness);
    },
  };
}
