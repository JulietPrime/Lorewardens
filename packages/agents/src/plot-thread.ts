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
import { firstCue, narrationSentences } from "./narrative-helpers.js";

// Plot Thread / Promise — watches the promises the story makes against the
// writer's own confirmed canon. A plot promise is a CONFIRMED canon entry
// tagged 'plot-thread'; the agent reports text that conflicts with one and
// (at strict level only) notes newly planted promises and open questions the
// narration raises. Incremental by contract: it sees only the changed chunk
// plus the canon selected for it, so it observes the thread — it never
// demands outcomes, never says what the story must do next, and never
// applies anything. The writer tracks or retires threads by confirming or
// retiring canon entries.

// Closed promise-planting cue table (narration only — a sentence carrying
// dialogue is a character's promise, not the narration planting one).
export const PROMISE_CUES: readonly string[] = [
  "promised",
  "swore",
  "vowed",
  "pledged",
  "made a pact",
  "sworn to",
  "gave her word",
  "gave his word",
  "gave their word",
];

// Closed open-question cue table (narration only). One finding per sentence.
export const OPEN_QUESTION_CUES: readonly string[] = [
  "no one knew",
  "no one knows",
  "who had",
  "what had",
  "why had",
  "where had",
  "unexplained",
  "unsolved",
  "remained a mystery",
  "no clue",
];

const PLOT_THREAD_TAG = "plot-thread";

/** Confirmed canon entries the writer uses to track plot promises. */
export function plotPromises(context: CanonContext): CanonEntry[] {
  return context.entries.filter((e) => e.status === "confirmed" && e.tags.includes(PLOT_THREAD_TAG));
}

interface ConflictHit {
  sentence: Sentence;
  reason: string;
}

function conflictReason(entry: CanonEntry, sentence: Sentence): string | undefined {
  const antonym = antonymConflict(entry.text, sentence.text);
  if (antonym) {
    return `'${antonym.word}' here stands opposite '${antonym.opposite}' from the promise`;
  }
  if (aboutStatement(sentence.text, entry.text) && hasNegation(sentence.text)) {
    return "the passage negates what the promise affirms";
  }
  const numeric = numericConflict(entry.text, sentence.text);
  if (numeric) {
    return `the promise counts ${numeric.canon}, the passage counts ${numeric.text}`;
  }
  return undefined;
}

/** First sentence of the chunk that conflicts with the promise, if any. */
export function firstConflict(entry: CanonEntry, chunk: TextChunk): ConflictHit | undefined {
  for (const sentence of sentences(chunk.text)) {
    const reason = conflictReason(entry, sentence);
    if (reason) return { sentence, reason };
  }
  return undefined;
}

function conflictFindings(chunk: TextChunk, context: CanonContext): Finding[] {
  const findings: Finding[] = [];
  for (const entry of plotPromises(context)) {
    const hit = firstConflict(entry, chunk);
    if (!hit) continue;
    const locked = entry.locked;
    findings.push(
      makeFinding({
        agent: "plot-thread",
        category: "narrative",
        type: "plot-promise-conflict",
        severity: locked ? "major" : "minor",
        confidence: locked ? 0.95 : 0.75,
        minStrictness: locked ? "gentle" : "standard",
        message: locked
          ? `This passage runs against the promise you locked ('${entry.text}'): ${hit.reason}.`
          : `This passage runs against a promise you are tracking ('${entry.text}'): ${hit.reason}.`,
        quote: hit.sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + hit.sentence.start,
          endOffset: chunk.span.startOffset + hit.sentence.end,
        },
        canonRefs: [entry.id],
        suggestion: null,
      }),
    );
  }
  return findings;
}

function plantedPromiseFindings(chunk: TextChunk): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of narrationSentences(chunk.text)) {
    const cue = firstCue(sentence.text, PROMISE_CUES);
    if (!cue) continue;
    findings.push(
      makeFinding({
        agent: "plot-thread",
        category: "narrative",
        type: "plot-promise-planted",
        severity: "info",
        confidence: 0.55,
        minStrictness: "strict",
        message: `The narration plants a promise here ('${cue}'). If you want this thread tracked, it can live in canon as a plot-thread entry.`,
        quote: sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + sentence.start,
          endOffset: chunk.span.startOffset + sentence.end,
        },
        canonRefs: [],
        suggestion:
          "To track this promise, confirm a canon entry tagged 'plot-thread' for it — or dismiss this note if the thread is not meant to be tracked.",
      }),
    );
  }
  return findings;
}

function openQuestionFindings(chunk: TextChunk): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of narrationSentences(chunk.text)) {
    const cue = firstCue(sentence.text, OPEN_QUESTION_CUES);
    if (!cue) continue;
    findings.push(
      makeFinding({
        agent: "plot-thread",
        category: "narrative",
        type: "plot-open-question",
        severity: "info",
        confidence: 0.55,
        minStrictness: "strict",
        message: `The narration raises an open question here ('${cue}') — the passage leaves something unanswered. Threads like this can be tracked in canon if you want them answered later.`,
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
  return findings;
}

export function plotThreadFindings(chunk: TextChunk, context: CanonContext, strictness: Strictness): Finding[] {
  const findings = [...conflictFindings(chunk, context), ...plantedPromiseFindings(chunk), ...openQuestionFindings(chunk)];
  return gateForAgent(findings, strictness);
}

export function createPlotThreadAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return plotThreadFindings(input.chunk, input.context, input.strictness);
    },
  };
}
