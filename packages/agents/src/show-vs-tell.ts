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
import { gateForAgent } from "./lexical.js";
import { countWords, firstCue, hasCue, narrationSentences } from "./narrative-helpers.js";
import { firstEmotionLabel, narrationRuns } from "./light-helpers.js";

// ---------------------------------------------------------------------------
// Show vs Tell / Craft — light craft notes on narration only.
//
// One of the three OPTIONAL agents: off by default, enabled only by writer
// project settings. Every finding is info severity with suggestion null —
// light means light: no minor-or-worse findings, no advice, no rewrites.
// Quoted dialogue is excluded everywhere (the established narration-sentences
// approach): characters speak in their own voice and the writer owns speech.
//
// v1 limits, documented deliberately: the three tables below are closed and
// conservative. Emotion labels are caught only in uninterrupted felt/was
// constructions ("she felt terrified", "he was furious") — adverb-interrupted
// and figurative constructions are missed rather than over-reported. This
// agent is a craft lens, not a style judge, and does not fake broader
// coverage.
// ---------------------------------------------------------------------------

// Closed emotion-label table (~20 emotion words) for felt/was constructions.
export const EMOTION_LABELS: readonly string[] = [
  "terrified",
  "furious",
  "angry",
  "sad",
  "happy",
  "miserable",
  "anxious",
  "nervous",
  "scared",
  "afraid",
  "excited",
  "cheerful",
  "gloomy",
  "frustrated",
  "relieved",
  "ashamed",
  "guilty",
  "jealous",
  "lonely",
  "hopeful",
];

// Closed exposition cue table (~10 stock cues). Cues are matched
// case-insensitively on word boundaries by the shared cue matcher.
export const EXPOSITION_CUES: readonly string[] = [
  "had always been",
  "for as long as",
  "it was said",
  "everyone knew",
  "over the years",
  "in those days",
  "it was known",
  "by tradition",
  "in the old days",
  "as long as anyone could remember",
];

// Closed filter-phrase table (~10) — narration filtering perception through
// the point-of-view character.
export const FILTER_PHRASES: readonly string[] = [
  "saw that",
  "felt that",
  "realized that",
  "could see",
  "could feel",
  "could hear",
  "could tell",
  "noticed that",
  "watched as",
  "heard that",
];

const MIN_RUN_SENTENCES = 6;
const MIN_RUN_WORDS = 80;
const MIN_DISTINCT_CUES = 2;

function finding(
  chunk: TextChunk,
  sentence: { text: string; start: number; end: number },
  type: string,
  confidence: number,
  minStrictness: "standard" | "strict",
  message: string,
): Finding {
  return makeFinding({
    agent: "show-vs-tell",
    category: "optional",
    type,
    severity: "info",
    confidence,
    minStrictness,
    message,
    quote: sentence.text,
    location: {
      file: chunk.span.file,
      startOffset: chunk.span.startOffset + sentence.start,
      endOffset: chunk.span.startOffset + sentence.end,
    },
    canonRefs: [],
    suggestion: null,
  });
}

/** One finding per narration sentence, at the first labeled emotion. */
function emotionLabelFindings(chunk: TextChunk): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of narrationSentences(chunk.text)) {
    const label = firstEmotionLabel(sentence.text, EMOTION_LABELS);
    if (!label) continue;
    findings.push(
      finding(
        chunk,
        sentence,
        "craft-emotion-label",
        0.75,
        "standard",
        `The narration names the emotion directly ('felt/was ${label}') instead of dramatizing it. Observed pattern only; the writer owns the choice.`,
      ),
    );
  }
  return findings;
}

/** One finding per run, at the run's first sentence. */
function expositionBlockFindings(chunk: TextChunk): Finding[] {
  const findings: Finding[] = [];
  for (const run of narrationRuns(chunk.text)) {
    if (run.length < MIN_RUN_SENTENCES) continue;
    const words = run.reduce((sum, sentence) => sum + countWords(sentence.text), 0);
    if (words < MIN_RUN_WORDS) continue;
    const runText = run.map((sentence) => sentence.text).join(" ");
    const cues = EXPOSITION_CUES.filter((cue) => hasCue(runText, [cue]));
    if (cues.length < MIN_DISTINCT_CUES) continue;
    const cueList = cues.map((cue) => `'${cue}'`).join(", ");
    findings.push(
      finding(
        chunk,
        run[0],
        "craft-exposition-block",
        0.6,
        "strict",
        `An exposition block: ${run.length} consecutive narration sentences (${words} words) carrying ${cues.length} stock exposition cues (${cueList}). Observed pattern only; the writer owns the passage.`,
      ),
    );
  }
  return findings;
}

/** One finding per narration sentence, at the first filter phrase. */
function filterPhraseFindings(chunk: TextChunk): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of narrationSentences(chunk.text)) {
    const phrase = firstCue(sentence.text, FILTER_PHRASES);
    if (!phrase) continue;
    findings.push(
      finding(
        chunk,
        sentence,
        "craft-filter-phrase",
        0.55,
        "strict",
        `The narration filters perception through the point-of-view character ('${phrase}'). Observed pattern only; the writer owns the choice.`,
      ),
    );
  }
  return findings;
}

export function showVsTellFindings(chunk: TextChunk, _context: CanonContext, strictness: Strictness): Finding[] {
  const findings = [...emotionLabelFindings(chunk), ...expositionBlockFindings(chunk), ...filterPhraseFindings(chunk)];
  return gateForAgent(findings, strictness);
}

export function createShowVsTellAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return showVsTellFindings(input.chunk, input.context, input.strictness);
    },
  };
}
