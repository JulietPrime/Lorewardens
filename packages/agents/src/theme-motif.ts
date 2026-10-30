import type {
  AgentDescriptor,
  AnalyzeInput,
  CanonContext,
  CanonEntry,
  ContinuityAgent,
  Finding,
  Strictness,
  TextChunk,
} from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import {
  aboutStatement,
  antonymConflict,
  gateForAgent,
  hasNegation,
  numericConflict,
  sentences,
  type Sentence,
} from "./lexical.js";
import { countWordBoundary, narrationSentences } from "./narrative-helpers.js";
import { significantTerms } from "./light-helpers.js";

// ---------------------------------------------------------------------------
// Theme / Motif — silent until the writer marks motifs.
//
// One of the three OPTIONAL agents: off by default, enabled only by writer
// project settings. Canon input is the writer's marked motifs: CONFIRMED,
// kind "rule" canon entries tagged "motif" (the selector constraint — kind
// "rule" entries are passed to agents regardless of tags; see the selector
// note in the task). With zero confirmed motif-tagged entries the agent is
// fully silent at every strictness level: theme tracking is off until the
// writer marks motifs as intentional.
//
// motif-conflict mirrors plot-promise-conflict and reuses the increment-1
// conflict helpers (antonym table, negation-of-affirmed via aboutStatement +
// hasNegation, numeric conflict) over the entry text versus chunk sentences.
// A locked motif escalates. motif-recurrence, strict-only, notes when one
// entry's significant terms recur through the chunk's narration.
//
// v1 limits, documented deliberately: recurrence is chunk-internal only (the
// incremental contract has no cross-chunk state), and discovering unmarked
// motifs — images the writer never tagged — is out of scope and not faked.
// The agent observes the writer's own marks; it never decides what the theme
// should be.
// ---------------------------------------------------------------------------

// Closed stopword list for motif term extraction. Significant terms are the
// entry-text words of length >= 4 that are not stopwords, matched on word
// boundaries; no stemming.
export const MOTIF_STOPWORDS: readonly string[] = [
  "that", "with", "this", "from", "have", "must", "will", "would", "could", "should",
  "shall", "might", "been", "were", "when", "while", "until", "before", "after",
  "into", "onto", "over", "under", "then", "than", "they", "them", "their",
  "there", "these", "those", "what", "where", "which", "whose", "always",
  "never", "every", "each", "some", "such", "only", "also", "very", "upon",
  "amid", "toward", "towards", "through", "between", "because", "though",
  "although", "however", "itself", "himself", "herself", "your", "yours",
  "ours", "does", "doing", "done", "being", "once", "soon", "still", "just",
  "even", "ever", "here", "come", "comes", "went", "goes", "make", "makes", "made",
];

const MOTIF_TAG = "motif";
const RECURRENCE_THRESHOLD = 3;

/** Confirmed, kind-"rule" canon entries the writer tagged as motifs. */
export function motifEntries(context: CanonContext): CanonEntry[] {
  return context.entries.filter((e) => e.status === "confirmed" && e.kind === "rule" && e.tags.includes(MOTIF_TAG));
}

interface ConflictHit {
  sentence: Sentence;
  reason: string;
}

function conflictReason(entry: CanonEntry, sentence: Sentence): string | undefined {
  const antonym = antonymConflict(entry.text, sentence.text);
  if (antonym) {
    return `'${antonym.word}' here stands opposite '${antonym.opposite}' from the motif`;
  }
  if (aboutStatement(sentence.text, entry.text) && hasNegation(sentence.text)) {
    return "the passage negates what the motif affirms";
  }
  const numeric = numericConflict(entry.text, sentence.text);
  if (numeric) {
    return `the motif counts ${numeric.canon}, the passage counts ${numeric.text}`;
  }
  return undefined;
}

/** First sentence of the chunk that conflicts with the marked motif, if any. */
export function firstMotifConflict(entry: CanonEntry, chunk: TextChunk): ConflictHit | undefined {
  for (const sentence of sentences(chunk.text)) {
    const reason = conflictReason(entry, sentence);
    if (reason) return { sentence, reason };
  }
  return undefined;
}

export interface RecurrenceHit {
  sentence: Sentence;
  counts: [string, number][];
  total: number;
}

/**
 * Word-boundary occurrences of the entry's significant terms across the
 * chunk's narration. The reported sentence is the first narration sentence
 * containing any significant term.
 */
export function motifRecurrence(entry: CanonEntry, chunk: TextChunk): RecurrenceHit | undefined {
  const terms = significantTerms(entry.text, MOTIF_STOPWORDS);
  if (terms.length === 0) return undefined;
  const counts = new Map<string, number>();
  let firstSentence: Sentence | undefined;
  for (const sentence of narrationSentences(chunk.text)) {
    let matched = false;
    for (const term of terms) {
      const occurrences = countWordBoundary(sentence.text, [term]);
      if (occurrences > 0) {
        counts.set(term, (counts.get(term) ?? 0) + occurrences);
        matched = true;
      }
    }
    if (matched && !firstSentence) firstSentence = sentence;
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  if (total < RECURRENCE_THRESHOLD || !firstSentence) return undefined;
  const ordered = terms.filter((term) => counts.has(term)).map((term) => [term, counts.get(term)!] as [string, number]);
  return { sentence: firstSentence, counts: ordered, total };
}

function motifFindings(chunk: TextChunk, context: CanonContext): Finding[] {
  const findings: Finding[] = [];
  for (const entry of motifEntries(context)) {
    const conflict = firstMotifConflict(entry, chunk);
    if (conflict) {
      const locked = entry.locked;
      findings.push(
        makeFinding({
          agent: "theme-motif",
          category: "optional",
          type: "motif-conflict",
          severity: locked ? "major" : "minor",
          confidence: locked ? 0.95 : 0.75,
          minStrictness: locked ? "gentle" : "standard",
          message: locked
            ? `This passage runs against the motif you locked ('${entry.text}'): ${conflict.reason}.`
            : `This passage runs against a motif you marked ('${entry.text}'): ${conflict.reason}.`,
          quote: conflict.sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + conflict.sentence.start,
            endOffset: chunk.span.startOffset + conflict.sentence.end,
          },
          canonRefs: [entry.id],
          suggestion: null,
        }),
      );
    }
    const recurrence = motifRecurrence(entry, chunk);
    if (recurrence) {
      const termList = recurrence.counts.map(([term, n]) => `'${term}' ${n} time${n === 1 ? "" : "s"}`).join(", ");
      findings.push(
        makeFinding({
          agent: "theme-motif",
          category: "optional",
          type: "motif-recurrence",
          severity: "info",
          confidence: 0.55,
          minStrictness: "strict",
          message: `The motif you marked ('${entry.text}') recurs through this passage (${termList}). The writer decides whether the recurrence is intentional.`,
          quote: recurrence.sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + recurrence.sentence.start,
            endOffset: chunk.span.startOffset + recurrence.sentence.end,
          },
          canonRefs: [entry.id],
          suggestion: null,
        }),
      );
    }
  }
  return findings;
}

export function themeMotifFindings(chunk: TextChunk, context: CanonContext, strictness: Strictness): Finding[] {
  return gateForAgent(motifFindings(chunk, context), strictness);
}

export function createThemeMotifAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return themeMotifFindings(input.chunk, input.context, input.strictness);
    },
  };
}
