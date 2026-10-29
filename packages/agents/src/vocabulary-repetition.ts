import type {
  AgentDescriptor,
  AnalyzeInput,
  CanonContext,
  ContinuityAgent,
  Finding,
  Strictness,
  TextChunk,
} from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import { contentWords, gateForAgent, namesOf, sentences, stem, tokenize } from "./lexical.js";

// Vocabulary / Repetition — flags word-usage PATTERNS, never isolated word
// choices: a stem that keeps recurring across the chunk, or repeats within a
// single sentence. Messages name the stem and the count; they never suggest
// replacement words. No "weak verb" or adverb policing in v1.

interface StemHits {
  stem: string;
  chunkCount: number;
  firstSentence: number;
}

function excludedNameStems(context: CanonContext): Set<string> {
  return new Set(
    context.characters
      .filter((c) => c.status === "confirmed")
      .flatMap((c) => namesOf(c))
      .flatMap((n) => tokenize(n).map(stem)),
  );
}

/**
 * Content stems of one sentence: non-stopword tokens of length > 2, stemmed.
 * Character name/alias stems are excluded so recurring names never count as
 * repetition.
 */
function sentenceStems(text: string, excluded: Set<string>): string[] {
  return contentWords(text).filter((s) => s.length > 2 && !excluded.has(s));
}

export function vocabularyRepetitionFindings(
  chunk: TextChunk,
  context: CanonContext,
  strictness: Strictness,
): Finding[] {
  const excluded = excludedNameStems(context);
  const sents = sentences(chunk.text);
  const perSentence = sents.map((s) => sentenceStems(s.text, excluded));

  const chunkCounts = new Map<string, number>();
  const firstSentence = new Map<string, number>();
  perSentence.forEach((stems, index) => {
    for (const stemValue of stems) {
      chunkCounts.set(stemValue, (chunkCounts.get(stemValue) ?? 0) + 1);
      if (!firstSentence.has(stemValue)) firstSentence.set(stemValue, index);
    }
  });

  const findings: Finding[] = [];

  const overuse: StemHits[] = [...chunkCounts.entries()]
    .filter(([stemValue, count]) => count >= 3)
    .map(([stemValue, count]) => ({ stem: stemValue, chunkCount: count, firstSentence: firstSentence.get(stemValue) ?? 0 }));
  for (const hit of overuse) {
    const sentence = sents[hit.firstSentence];
    findings.push(
      makeFinding({
        agent: "vocabulary-repetition",
        category: "language",
        type: "vocabulary-overuse",
        severity: "info",
        confidence: 0.7,
        minStrictness: "standard",
        message:
          `The stem '${hit.stem}' appears ${hit.chunkCount} times in this passage — flagging the ` +
          `repetition pattern, not any single use of the word.`,
        quote: sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + sentence.start,
          endOffset: chunk.span.startOffset + sentence.end,
        },
        canonRefs: [],
        suggestion: null,
      }),
    );
  }

  perSentence.forEach((stems, index) => {
    const counts = new Map<string, number>();
    for (const stemValue of stems) counts.set(stemValue, (counts.get(stemValue) ?? 0) + 1);
    for (const [stemValue, count] of counts) {
      if (count < 2) continue;
      const sentence = sents[index];
      findings.push(
        makeFinding({
          agent: "vocabulary-repetition",
          category: "language",
          type: "vocabulary-echo",
          severity: "info",
          confidence: 0.55,
          minStrictness: "strict",
          message: `The stem '${stemValue}' appears ${count} times within this single sentence.`,
          quote: sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + sentence.start,
            endOffset: chunk.span.startOffset + sentence.end,
          },
          canonRefs: [],
          suggestion: null,
        }),
      );
    }
  });

  return gateForAgent(findings, strictness);
}

export function createVocabularyRepetitionAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return vocabularyRepetitionFindings(input.chunk, input.context, input.strictness);
    },
  };
}
