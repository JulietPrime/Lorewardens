import { sentences, type Sentence } from "./lexical.js";

// ---------------------------------------------------------------------------
// Shared, deterministic helpers for the three narrative agents
// (plot-thread, pacing-tension, pov-consistency).
//
// Narration definition (documented choice, used consistently by all three
// agents): a sentence is NARRATION when it contains no quoted span at all —
// equivalently, no straight double quote. We implement "sentences minus
// quoted-span sentences" rather than "sentence text with quoted spans
// stripped": dialogue attribution fragments ("she said", "he asked") would
// otherwise survive inside narration checks. Any sentence that carries
// dialogue, in whole or in part, is excluded from narration analysis.
// ---------------------------------------------------------------------------

export interface QuotedSpan {
  start: number;
  end: number; // exclusive
  text: string;
}

/**
 * Maximal straight-double-quote spans in `text`. An unterminated quote
 * (odd number of quotes) runs to the end of the text, so a sentence holding
 * any part of a quoted span always tests as non-narration.
 */
export function quotedSpans(text: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (start === -1) {
      start = i;
    } else {
      spans.push({ start, end: i + 1, text: text.slice(start, i + 1) });
      start = -1;
    }
  }
  if (start !== -1) spans.push({ start, end: text.length, text: text.slice(start) });
  return spans;
}

/** Sentences of the chunk that contain no quoted span (pure narration). */
export function narrationSentences(chunkText: string): Sentence[] {
  return sentences(chunkText).filter((s) => quotedSpans(s.text).length === 0);
}

// Closed-table cue matching. Cues are matched case-insensitively on word
// boundaries (multi-word cues allow whitespace runs), so "calm" never fires
// inside "becalmed" and "what had" never fires inside "somewhat had". Tables
// themselves live in the agent files.

const CUE_PATTERNS = new Map<string, RegExp>();

function cuePattern(cue: string): RegExp {
  let pattern = CUE_PATTERNS.get(cue);
  if (!pattern) {
    const escaped = cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    pattern = new RegExp(`\\b${escaped}\\b`, "i");
    CUE_PATTERNS.set(cue, pattern);
  }
  return pattern;
}

/** True when any cue from the closed table appears in `text` on a word boundary. */
export function hasCue(text: string, cues: readonly string[]): boolean {
  return cues.some((cue) => cuePattern(cue).test(text));
}

/** The first cue from the closed table (table order) that appears in `text`. */
export function firstCue(text: string, cues: readonly string[]): string | undefined {
  return cues.find((cue) => cuePattern(cue).test(text));
}

/** Whitespace word count of a sentence or span of text. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

const WORD_PATTERNS = new Map<string, RegExp>();

function wordPattern(word: string): RegExp {
  let pattern = WORD_PATTERNS.get(word);
  if (!pattern) {
    pattern = new RegExp(`\\b${word}\\b`, "gi");
    WORD_PATTERNS.set(word, pattern);
  }
  return pattern;
}

/** Total occurrences of the given words in `text`, matched on word boundaries. */
export function countWordBoundary(text: string, words: readonly string[]): number {
  let count = 0;
  for (const word of words) {
    count += (text.match(wordPattern(word)) ?? []).length;
  }
  return count;
}
