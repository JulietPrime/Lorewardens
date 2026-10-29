import type {
  AgentDescriptor,
  AnalyzeInput,
  CanonContext,
  CanonEntry,
  Character,
  ContinuityAgent,
  Finding,
  Strictness,
  TextChunk,
} from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import { gateForAgent, mentionsSubject, namesOf, type Sentence } from "./lexical.js";
import { countWordBoundary, hasCue, narrationSentences } from "./narrative-helpers.js";

// POV Consistency — watches point of view inside the changed chunk. Inner
// state belongs to whoever's head the narration is in: a narration sentence
// that names a confirmed character and carries a thought cue attributes inner
// state to that character. When the writer confirms a 'pov' canon entry that
// names a single POV character, inner-state attribution to anyone else is a
// head-hop; with no declared POV rule, two or more characters receiving
// inner-state attribution in one chunk is treated the same way. A pov entry
// containing "omniscient" means the shifts are intentional and the agent
// stays silent. A first- to third-person drift inside the chunk is reported
// statistically, with quoted dialogue excluded everywhere (characters speak
// in their own person). Incremental by contract: chunk-internal only, no
// cross-chunk state, writer owns every POV decision.
//
// Known v1 limit: "impossible knowledge" (a POV character perceiving the
// imperceivable) needs a scene model the chunk contract does not provide —
// deliberately out of scope; this agent does not fake it.

// Closed thought-cue table (word-boundary matched, narration only).
export const THOUGHT_CUES: readonly string[] = [
  "thought",
  "wondered",
  "realized",
  "felt",
  "knew",
  "remembered",
  "decided",
  "hoped",
  "feared",
  "suspected",
];

// Closed person-pronoun tables (word-boundary matched, narration only).
export const FIRST_PERSON_PRONOUNS: readonly string[] = ["i", "we", "us", "our", "my", "me"];
export const THIRD_PERSON_PRONOUNS: readonly string[] = ["he", "she", "they", "him", "her", "them"];

const POV_TAG = "pov";
const OMNISCIENT_MARKER = "omniscient";
const DISTANCE_MIN_SENTENCES = 8;
const DISTANCE_STRONG = 3;
const DISTANCE_WEAK = 1;
const DISTANCE_MIN_DELTA = 3;

/** Confirmed canon entries the writer uses to declare the POV rule. */
export function povRules(context: CanonContext): CanonEntry[] {
  return context.entries.filter((e) => e.status === "confirmed" && e.tags.includes(POV_TAG));
}

/** Confirmed characters the chunk names, in context order. */
export function confirmedCharacters(context: CanonContext): Character[] {
  return context.characters.filter((c) => c.status === "confirmed");
}

interface Attribution {
  character: Character;
  sentence: Sentence;
}

/**
 * Inner-state attributions in the chunk: one per character, at the first
 * narration sentence that names the character and carries a thought cue.
 */
export function innerStateAttributions(chunk: TextChunk, context: CanonContext): Attribution[] {
  const characters = confirmedCharacters(context);
  if (characters.length === 0) return [];
  const firstSentence = new Map<string, Attribution>();
  for (const sentence of narrationSentences(chunk.text)) {
    if (!hasCue(sentence.text, THOUGHT_CUES)) continue;
    for (const character of characters) {
      if (firstSentence.has(character.id)) continue;
      if (mentionsSubject(sentence.text, namesOf(character))) {
        firstSentence.set(character.id, { character, sentence });
      }
    }
  }
  return [...firstSentence.values()].sort((a, b) => a.sentence.start - b.sentence.start);
}

/**
 * The single POV character a confirmed pov entry names (name/alias match),
 * or undefined when the entry is absent, not confirmed, names no confirmed
 * character, or names more than one.
 */
export function declaredPovCharacter(pov: CanonEntry | undefined, context: CanonContext): Character | undefined {
  if (!pov) return undefined;
  const matches = confirmedCharacters(context).filter((c) => mentionsSubject(pov.text, namesOf(c)));
  return matches.length === 1 ? matches[0] : undefined;
}

function headHopFindings(chunk: TextChunk, context: CanonContext): Finding[] {
  const pov = povRules(context)[0];
  if (pov && pov.text.toLowerCase().includes(OMNISCIENT_MARKER)) return [];
  const attributions = innerStateAttributions(chunk, context);
  if (attributions.length === 0) return [];

  const declared = declaredPovCharacter(pov, context);
  const findings: Finding[] = [];

  if (declared) {
    for (const attribution of attributions) {
      if (attribution.character.id === declared.id) continue;
      const locked = pov.locked;
      findings.push(
        makeFinding({
          agent: "pov-consistency",
          category: "narrative",
          type: "pov-head-hop",
          severity: locked ? "major" : "minor",
          confidence: locked ? 0.95 : 0.75,
          minStrictness: locked ? "gentle" : "standard",
          message: locked
            ? `Inner state is attributed to ${attribution.character.name} here, but your locked POV rule keeps the narration with ${declared.name}.`
            : `Inner state is attributed to ${attribution.character.name} here, while the POV rule you are tracking keeps the narration with ${declared.name}.`,
          quote: attribution.sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + attribution.sentence.start,
            endOffset: chunk.span.startOffset + attribution.sentence.end,
          },
          canonRefs: [pov.id],
          suggestion: null,
        }),
      );
    }
    return findings;
  }

  // No usable POV anchor: two or more characters receiving inner-state
  // attribution in one chunk is a head-hop for every character after the
  // first one the narration enters.
  if (attributions.length < 2) return [];
  for (const attribution of attributions.slice(1)) {
    findings.push(
      makeFinding({
        agent: "pov-consistency",
        category: "narrative",
        type: "pov-head-hop",
        severity: "minor",
        confidence: 0.75,
        minStrictness: "standard",
        message: `The narration enters ${attributions[0].character.name}'s inner state and also ${attribution.character.name}'s within this chunk — a head-hop between viewpoints.`,
        quote: attribution.sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + attribution.sentence.start,
          endOffset: chunk.span.startOffset + attribution.sentence.end,
        },
        canonRefs: [attribution.character.id],
        suggestion: null,
      }),
    );
  }
  return findings;
}

interface HalfCounts {
  first: number;
  third: number;
}

function halfCounts(sents: Sentence[]): HalfCounts {
  let first = 0;
  let third = 0;
  for (const sentence of sents) {
    first += countWordBoundary(sentence.text, FIRST_PERSON_PRONOUNS);
    third += countWordBoundary(sentence.text, THIRD_PERSON_PRONOUNS);
  }
  return { first, third };
}

/**
 * First- vs third-person narration drift inside the chunk, same statistical
 * shape as style-voice's formality check but over narration sentences only:
 * at least DISTANCE_MIN_SENTENCES narration sentences, split at the midpoint;
 * a shift fires when one half carries DISTANCE_STRONG or more of one person's
 * pronoun set while the other carries DISTANCE_WEAK or fewer, with a delta of
 * DISTANCE_MIN_DELTA or more.
 */
export function distanceShift(chunk: TextChunk): { half: "first" | "second"; counts: HalfCounts; other: HalfCounts } | undefined {
  const narration = narrationSentences(chunk.text);
  if (narration.length < DISTANCE_MIN_SENTENCES) return undefined;
  const mid = Math.floor(narration.length / 2);
  const a = halfCounts(narration.slice(0, mid));
  const b = halfCounts(narration.slice(mid));
  if (a.first >= DISTANCE_STRONG && b.first <= DISTANCE_WEAK && a.first - b.first >= DISTANCE_MIN_DELTA) {
    return { half: "first", counts: a, other: b };
  }
  if (b.first >= DISTANCE_STRONG && a.first <= DISTANCE_WEAK && b.first - a.first >= DISTANCE_MIN_DELTA) {
    return { half: "second", counts: b, other: a };
  }
  if (a.third >= DISTANCE_STRONG && b.third <= DISTANCE_WEAK && a.third - b.third >= DISTANCE_MIN_DELTA) {
    return { half: "first", counts: a, other: b };
  }
  if (b.third >= DISTANCE_STRONG && a.third <= DISTANCE_WEAK && b.third - a.third >= DISTANCE_MIN_DELTA) {
    return { half: "second", counts: b, other: a };
  }
  return undefined;
}

function distanceShiftFindings(chunk: TextChunk): Finding[] {
  const shift = distanceShift(chunk);
  if (!shift) return [];
  const narration = narrationSentences(chunk.text);
  const mid = Math.floor(narration.length / 2);
  const deviant = shift.half === "first" ? narration[0] : narration[mid];
  return [
    makeFinding({
      agent: "pov-consistency",
      category: "narrative",
      type: "pov-distance-shift",
      severity: "minor",
      confidence: 0.7,
      minStrictness: "standard",
      message:
        `Narration distance drifts inside this chunk: the ${shift.half} half of the narration carries ` +
        `${shift.counts.first} first-person and ${shift.counts.third} third-person pronouns against ` +
        `${shift.other.first} first-person and ${shift.other.third} third-person in the other half ` +
        `(dialogue excluded). The person of the narration changes mid-chunk.`,
      quote: deviant.text,
      location: {
        file: chunk.span.file,
        startOffset: chunk.span.startOffset + deviant.start,
        endOffset: chunk.span.startOffset + deviant.end,
      },
      canonRefs: [],
      suggestion: null,
    }),
  ];
}

export function povConsistencyFindings(chunk: TextChunk, context: CanonContext, strictness: Strictness): Finding[] {
  const findings = [...headHopFindings(chunk, context), ...distanceShiftFindings(chunk)];
  return gateForAgent(findings, strictness);
}

export function createPovConsistencyAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return povConsistencyFindings(input.chunk, input.context, input.strictness);
    },
  };
}
