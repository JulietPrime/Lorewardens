import type { CanonContext } from "@lorewardens/core";
import { sentences, type Sentence } from "./lexical.js";
import { quotedSpans } from "./narrative-helpers.js";

// ---------------------------------------------------------------------------
// Shared, deterministic helpers for the three optional/light agents
// (show-vs-tell, sensitivity-representation, theme-motif).
//
// These helpers reuse the established narration definition and closed-table
// cue matching from narrative-helpers.ts / lexical.ts without touching either
// file. Everything here is offline, pure and side-effect free.
// ---------------------------------------------------------------------------

const EMOTION_PATTERNS = new Map<string, RegExp>();

function emotionPattern(emotion: string): RegExp {
  let pattern = EMOTION_PATTERNS.get(emotion);
  if (!pattern) {
    const escaped = emotion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern = new RegExp(`\\b(?:felt|was|were)\\s+${escaped}\\b`, "i");
    EMOTION_PATTERNS.set(emotion, pattern);
  }
  return pattern;
}

/**
 * The first emotion label (table order) carried by a felt/was construction,
 * e.g. "she felt terrified" or "he was furious". Adverb-interrupted
 * constructions ("was suddenly furious") are deliberately not matched — the
 * closed table is conservative by design.
 */
export function firstEmotionLabel(text: string, emotions: readonly string[]): string | undefined {
  return emotions.find((emotion) => emotionPattern(emotion).test(text));
}

/**
 * Maximal runs of consecutive narration sentences. A sentence carrying any
 * quoted span breaks the run — the light agents observe narration only.
 */
export function narrationRuns(chunkText: string): Sentence[][] {
  const runs: Sentence[][] = [];
  let current: Sentence[] = [];
  for (const sentence of sentences(chunkText)) {
    if (quotedSpans(sentence.text).length === 0) {
      current.push(sentence);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * Significant motif terms: the entry-text words of length >= 4 that are not
 * stopwords, deduplicated in first-occurrence order. Words are matched on
 * word boundaries downstream; no stemming.
 */
export function significantTerms(entryText: string, stopwords: readonly string[]): string[] {
  const stop = new Set(stopwords);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of entryText.toLowerCase().split(/[^a-z0-9']+/)) {
    if (token.length < 4 || stop.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Fictional-culture guard: true when the group term appears (word boundary,
 * case-insensitive) in any confirmed canon entry text or confirmed character
 * name/alias of the context. A term the writer's world already claims belongs
 * to the fictional culture and is never treated as a violation.
 */
export function canonClaimsTerm(term: string, context: CanonContext): boolean {
  const texts: string[] = [];
  for (const entry of context.entries) texts.push(entry.text);
  for (const character of context.characters) texts.push(character.name, ...character.aliases);
  return texts.some((text) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
}
