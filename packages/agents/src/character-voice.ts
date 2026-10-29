import type {
  AgentDescriptor,
  AnalyzeInput,
  CanonContext,
  Character,
  ContinuityAgent,
  Finding,
  Strictness,
  TextChunk,
} from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import { gateForAgent, mentionsSubject, namesOf, sentences } from "./lexical.js";

// Character Voice — flags dialogue (and internal thought) that drifts from a
// character's confirmed `voice` canon field. Two deterministic paths, both
// anchored in quoted phrase(s) inside the voice text itself:
//   1. Avoid-phrase: a quoted phrase in the voice text preceded by an
//      avoid-cue, appearing inside the character's quoted dialogue.
//   2. Contraction cue: the voice text says the character doesn't use
//      contractions, and their quoted dialogue contains one.
//
// Attribution heuristic (deliberately simple and deterministic): a quoted
// span ("..." or '...') inside a sentence that also mentions the character's
// name or alias is treated as that character speaking. Internal thought
// counts as quoted when it is wrapped in quote marks (italics-free quotes);
// markdown italics are not parsed. Characters without a `voice` field, or
// with voice text carrying no usable cue, stay silent — graceful degradation.

// Closed avoid-cue table (spec): single cues match on word boundaries,
// multi-word cues as substrings.
const AVOID_SINGLE_CUES = ["not", "never", "avoid"] as const;
const AVOID_PHRASE_CUES = ["instead of", "rather than", "doesn't say"] as const;

// Closed no-contraction cue table (spec list plus its spelled-out form).
const NO_CONTRACTION_CUES = [
  "no contractions",
  "never contract",
  "doesn't use contractions",
  "does not use contractions",
  "avoids contractions",
] as const;

// Word-final contraction list (same list the style-voice agent uses).
const CONTRACTION = /(?:n't|'re|'ve|'ll|'m|'d)\b/gi;

const QUOTED_SPAN = /"([^"]*)"|'([^']*)'/g;

interface QuotedSpan {
  text: string;
  start: number;
  end: number;
}

function quotedSpans(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  for (const m of text.matchAll(QUOTED_SPAN)) {
    const inner = m[1] ?? m[2];
    if (inner !== undefined) {
      spans.push({ text: inner, start: m.index, end: m.index + m[0].length });
    }
  }
  // Attribution heuristic edge: sentence splitting consumes a period that
  // sits inside a closing double quote ("...like this."), leaving the
  // opening quote unmatched in its sentence. Treat an unpaired double quote
  // as dialogue running to the end of the sentence. Single quotes keep
  // pair-only matching — apostrophes make an unpaired single quote ambiguous.
  const doubleQuotes = [...text.matchAll(/"/g)].map((m) => m.index);
  if (doubleQuotes.length % 2 === 1) {
    const last = doubleQuotes[doubleQuotes.length - 1];
    const insidePairedSpan = spans.some((s) => s.start <= last && s.end > last);
    if (!insidePairedSpan) {
      spans.push({ text: text.slice(last + 1), start: last, end: text.length });
    }
  }
  return spans;
}

function containsCue(text: string, cue: string): boolean {
  const lower = text.toLowerCase();
  if (cue.includes(" ")) return lower.includes(cue);
  return new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower);
}

/** Quoted phrases in `voice` that an avoid-cue tells the character to avoid. */
function avoidPhrasesInVoice(voice: string): string[] {
  const phrases: string[] = [];
  let lastEnd = 0;
  for (const span of quotedSpans(voice)) {
    const between = voice.slice(lastEnd, span.start);
    const cued =
      AVOID_SINGLE_CUES.some((cue) => containsCue(between, cue)) ||
      AVOID_PHRASE_CUES.some((cue) => containsCue(between, cue));
    if (cued) phrases.push(span.text);
    lastEnd = span.end;
  }
  return phrases;
}

function voiceForbidsContractions(voice: string): boolean {
  return NO_CONTRACTION_CUES.some((cue) => voice.toLowerCase().includes(cue));
}

function dialogueUsesContraction(spans: QuotedSpan[]): boolean {
  return spans.some((span) => (span.text.match(CONTRACTION) ?? []).length > 0);
}

function suggestionFor(character: Character): string {
  return (
    `Voice proposal (advisory): if the line is intended, file a CanonProposal to update the ` +
    `voice of character '${character.id}'; otherwise align the dialogue with the established voice.`
  );
}

export function characterVoiceFindings(chunk: TextChunk, context: CanonContext, strictness: Strictness): Finding[] {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const character of context.characters) {
    if (character.status !== "confirmed" || !character.voice) continue;
    const avoidPhrases = avoidPhrasesInVoice(character.voice);
    const forbidsContractions = voiceForbidsContractions(character.voice);
    if (avoidPhrases.length === 0 && !forbidsContractions) continue;

    const names = namesOf(character);
    for (const sentence of sentences(chunk.text)) {
      if (!mentionsSubject(sentence.text, names)) continue;
      const spans = quotedSpans(sentence.text);
      if (spans.length === 0) continue;

      const phrase = avoidPhrases.find((p) => spans.some((span) => span.text.toLowerCase().includes(p.toLowerCase())));
      const contracts = forbidsContractions && dialogueUsesContraction(spans);
      if (!phrase && !contracts) continue;

      const key = `${character.id}:${sentence.start}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const message = phrase
        ? `${character.name}'s dialogue uses '${phrase}', which the voice canon records as something ${character.name} avoids saying.`
        : `${character.name}'s dialogue uses contractions, but the voice canon says ${character.name} doesn't use them.`;
      findings.push(
        makeFinding({
          agent: "character-voice",
          category: "prose",
          type: "voice-drift",
          severity: character.locked ? "major" : "minor",
          confidence: character.locked ? 0.95 : 0.8,
          minStrictness: character.locked ? "gentle" : "standard",
          message,
          quote: sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + sentence.start,
            endOffset: chunk.span.startOffset + sentence.end,
          },
          canonRefs: [character.id],
          suggestion: suggestionFor(character),
        }),
      );
    }
  }

  return gateForAgent(findings, strictness);
}

export function createCharacterVoiceAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return characterVoiceFindings(input.chunk, input.context, input.strictness);
    },
  };
}
