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
import { gateForAgent, sentences, type Sentence } from "./lexical.js";
import { countWords, firstCue, hasCue, narrationSentences } from "./narrative-helpers.js";

// Pacing / Tension — purely observational notes about what the text does:
// long unbroken narration stretches, rushed passages of very short sentences,
// and abrupt turns between rising and falling tension. Every message
// describes; none advises, none rewrites, and every finding carries
// `suggestion: null`. All thresholds are closed constants below; incremental
// chunks are judged chunk-internally with no cross-chunk state.

// Closed pacing thresholds.
export const STATIC_STRETCH_MIN_SENTENCES = 8;
export const STATIC_STRETCH_MIN_WORDS = 100;
export const RUSHED_MIN_SENTENCES = 5;
export const RUSHED_MAX_WORDS = 6;

// Closed tension-cue tables (narration or dialogue, word-boundary matched).
export const ESCALATION_CUES: readonly string[] = [
  "suddenly",
  "without warning",
  "exploded",
  "shattered",
  "screamed",
  "attacked",
  "slammed",
  "lunged",
];

export const DEESCALATION_CUES: readonly string[] = [
  "calm",
  "settled",
  "quiet",
  "relaxed",
  "gently",
  "soothing",
  "at ease",
  "at peace",
];

interface Run {
  sentences: Sentence[];
}

/** Maximal adjacent runs of sentences passing `keep`. */
function runsOf(all: Sentence[], keep: (s: Sentence) => boolean): Run[] {
  const runs: Run[] = [];
  let current: Sentence[] = [];
  for (const sentence of all) {
    if (keep(sentence)) {
      current.push(sentence);
    } else if (current.length > 0) {
      runs.push({ sentences: current });
      current = [];
    }
  }
  if (current.length > 0) runs.push({ sentences: current });
  return runs;
}

/**
 * A static stretch: a run of consecutive narration sentences (no quoted
 * spans) long enough and wordy enough to read as unbroken. One finding per
 * run, located at the run's first sentence.
 */
export function staticStretchRuns(chunk: TextChunk): Run[] {
  const narrationStarts = new Set(narrationSentences(chunk.text).map((s) => s.start));
  return runsOf(sentences(chunk.text), (s) => narrationStarts.has(s.start)).filter((run) => {
    if (run.sentences.length < STATIC_STRETCH_MIN_SENTENCES) return false;
    const words = run.sentences.reduce((sum, s) => sum + countWords(s.text), 0);
    return words >= STATIC_STRETCH_MIN_WORDS;
  });
}

/**
 * A rushed passage: a run of consecutive very short sentences (any dialogue
 * state). One finding per run, located at the run's first sentence.
 */
export function rushedRuns(chunk: TextChunk): Run[] {
  return runsOf(sentences(chunk.text), (s) => countWords(s.text) <= RUSHED_MAX_WORDS).filter(
    (run) => run.sentences.length >= RUSHED_MIN_SENTENCES,
  );
}

function staticStretchFindings(chunk: TextChunk): Finding[] {
  return staticStretchRuns(chunk).map((run) => {
    const first = run.sentences[0];
    const words = run.sentences.reduce((sum, s) => sum + countWords(s.text), 0);
    return makeFinding({
      agent: "pacing-tension",
      category: "narrative",
      type: "pacing-static-stretch",
      severity: "info",
      confidence: 0.6,
      minStrictness: "standard",
      message: `Static stretch: ${run.sentences.length} sentences of unbroken narration (${words} words) starting here — no quoted dialogue across the run. The passage holds one uninterrupted register.`,
      quote: first.text,
      location: {
        file: chunk.span.file,
        startOffset: chunk.span.startOffset + first.start,
        endOffset: chunk.span.startOffset + first.end,
      },
      canonRefs: [],
      suggestion: null,
    });
  });
}

function rushedFindings(chunk: TextChunk): Finding[] {
  return rushedRuns(chunk).map((run) => {
    const first = run.sentences[0];
    return makeFinding({
      agent: "pacing-tension",
      category: "narrative",
      type: "pacing-rushed-passage",
      severity: "info",
      confidence: 0.55,
      minStrictness: "strict",
      message: `Rushed passage: ${run.sentences.length} consecutive sentences of ${RUSHED_MAX_WORDS} words or fewer, starting here. The text moves in very short beats.`,
      quote: first.text,
      location: {
        file: chunk.span.file,
        startOffset: chunk.span.startOffset + first.start,
        endOffset: chunk.span.startOffset + first.end,
      },
      canonRefs: [],
      suggestion: null,
    });
  });
}

interface TurnPair {
  from: Sentence;
  to: Sentence;
  fromCue: string;
  toCue: string;
  rising: boolean;
}

/** Adjacent sentence pairs where the tension direction turns. */
export function abruptTurns(chunk: TextChunk): TurnPair[] {
  const all = sentences(chunk.text);
  const turns: TurnPair[] = [];
  for (let i = 0; i + 1 < all.length; i++) {
    const a = all[i];
    const b = all[i + 1];
    const aEsc = hasCue(a.text, ESCALATION_CUES);
    const aDe = hasCue(a.text, DEESCALATION_CUES);
    const bEsc = hasCue(b.text, ESCALATION_CUES);
    const bDe = hasCue(b.text, DEESCALATION_CUES);
    if (aEsc && bDe) {
      turns.push({
        from: a,
        to: b,
        fromCue: firstCue(a.text, ESCALATION_CUES) ?? ESCALATION_CUES[0],
        toCue: firstCue(b.text, DEESCALATION_CUES) ?? DEESCALATION_CUES[0],
        rising: false,
      });
    } else if (aDe && bEsc) {
      turns.push({
        from: a,
        to: b,
        fromCue: firstCue(a.text, DEESCALATION_CUES) ?? DEESCALATION_CUES[0],
        toCue: firstCue(b.text, ESCALATION_CUES) ?? ESCALATION_CUES[0],
        rising: true,
      });
    }
  }
  return turns;
}

function abruptShiftFindings(chunk: TextChunk): Finding[] {
  return abruptTurns(chunk).map((turn) => {
    const direction = turn.rising
      ? "from a de-escalation beat into an escalation beat"
      : "from an escalation beat into a de-escalation beat";
    return makeFinding({
      agent: "pacing-tension",
      category: "narrative",
      type: "tension-abrupt-shift",
      severity: "info",
      confidence: 0.55,
      minStrictness: "strict",
      message: `Tension turns here (${direction}): '${turn.fromCue}' is followed immediately by '${turn.toCue}'. The passage changes direction between these two sentences.`,
      quote: chunk.text.slice(turn.from.start, turn.to.end),
      location: {
        file: chunk.span.file,
        startOffset: chunk.span.startOffset + turn.from.start,
        endOffset: chunk.span.startOffset + turn.to.end,
      },
      canonRefs: [],
      suggestion: null,
    });
  });
}

export function pacingTensionFindings(chunk: TextChunk, _context: CanonContext, strictness: Strictness): Finding[] {
  const findings = [...staticStretchFindings(chunk), ...rushedFindings(chunk), ...abruptShiftFindings(chunk)];
  return gateForAgent(findings, strictness);
}

export function createPacingTensionAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return pacingTensionFindings(input.chunk, input.context, input.strictness);
    },
  };
}
