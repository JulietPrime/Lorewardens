import type { Character, Strictness } from "@lorewardens/core";
import { STRICTNESS_CONFIDENCE_FLOOR, STRICTNESS_ORDER } from "@lorewardens/core";

// ---------------------------------------------------------------------------
// Deterministic lexical helpers for the continuity matchers.
//
// These are deliberately simple, offline and pure so a smarter engine
// (embedding or LLM-based) can replace them later without touching the agent
// contract. Every function here is side-effect free.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "by", "from",
  "is", "are", "was", "were", "be", "been", "being", "it", "its", "this", "that", "these", "those",
  "as", "if", "then", "than", "so", "such", "there", "here", "their", "they", "them", "he", "she",
  "his", "her", "we", "our", "you", "your", "i", "my", "me", "has", "have", "had", "do", "does",
  "did", "will", "would", "shall", "should", "may", "might", "must", "can", "could", "not", "no",
  "up", "out", "about", "into", "over", "under", "again", "while", "since", "each", "every", "all",
]);

export const NEGATION_CUES: readonly string[] = [
  "not", "never", "no longer", "nothing", "none", "isn't", "wasn't", "aren't", "weren't",
  "can't", "cannot", "couldn't", "wouldn't", "won't", "don't", "doesn't", "didn't",
  "without", "neither", "nor", "stopped", "no more",
];

export const RECOVERY_CUES: readonly string[] = [
  "healed", "recovered", "mended", "no longer hurt", "no longer sore", "fully healed",
  "good as new", "had never", "never been injured",
];

export const KNOWLEDGE_CUES: readonly string[] = [
  "knew", "knows", "know about", "knew about", "aware of", "aware that", "remembered",
  "had heard", "had told", "whispered to him", "whispered to her",
];

export const SEQUENCE_CUES_BEFORE = ["before", "prior to", "earlier than"] as const;
export const SEQUENCE_CUES_AFTER = ["after", "following", "later than"] as const;

export const AMBIGUITY_CUES: readonly string[] = [
  "sometime", "some time", "at some point", "around then", "around the same time",
  "before or after", "either before or after", "roughly", "or so", "unclear", "vaguely",
  "who knows when", "hard to say when",
];

// Small closed-class antonym table. Deterministic and documented; extend as
// needed. Keys are stems (see stem()).
const ANTONYM_PAIRS: [string, string][] = [
  ["seal", "open"], ["close", "open"], ["shut", "open"], ["lock", "unlock"],
  ["east", "west"], ["north", "south"], ["alive", "dead"], ["win", "lose"],
  ["lose", "find"], ["arrive", "leave"], ["arrive", "depart"], ["rise", "fall"],
  ["enter", "exit"], ["burn", "quench"], ["light", "dark"], ["day", "night"],
  ["summer", "winter"], ["friend", "enemy"], ["ally", "rival"], ["love", "hate"],
  ["careful", "careless"], ["methodical", "careless"], ["methodical", "scattered"], ["brave", "cowardly"],
  ["generous", "stingy"], ["strong", "weak"], ["fast", "slow"], ["always", "never"],
  ["everything", "nothing"], ["all", "none"], ["quiet", "loud"], ["hidden", "visible"],
  ["hidden", "public"], ["secret", "known"], ["present", "absent"], ["full", "empty"],
];

const ANTONYMS = new Map<string, Set<string>>();
for (const [a, b] of ANTONYM_PAIRS) {
  const sa = stem(a);
  const sb = stem(b);
  if (!ANTONYMS.has(sa)) ANTONYMS.set(sa, new Set());
  if (!ANTONYMS.has(sb)) ANTONYMS.set(sb, new Set());
  ANTONYMS.get(sa)!.add(sb);
  ANTONYMS.get(sb)!.add(sa);
}

const NUMBER_WORDS = new Map<string, number>([
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 1);
}

export function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ied")) return `${w.slice(0, -3)}y`;
  for (const suffix of ["ingly", "edly", "ing", "ed", "es", "s"]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function contentWords(text: string): string[] {
  return tokenize(text)
    .filter((t) => !STOPWORDS.has(t) && !NEGATION_CUES.includes(t))
    .map(stem);
}

export interface Sentence {
  text: string;
  start: number; // offset within the chunk text
  end: number;
}

export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?]+[.!?]*/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const trimmedStart = raw.length - raw.trimStart().length;
    const start = m.index + trimmedStart;
    const body = raw.trim();
    if (body.length > 0) {
      out.push({ text: body, start, end: start + body.length });
    }
  }
  return out;
}

export function hasNegation(text: string): boolean {
  const lower = ` ${text.toLowerCase()} `;
  return NEGATION_CUES.some((cue) => lower.includes(` ${cue} `) || lower.includes(` ${cue}.`) || lower.includes(` ${cue},`));
}

function stemSet(text: string): Set<string> {
  return new Set(tokenize(text).map(stem));
}

/** True when `text` mentions `subject` by name or alias (word-ish match). */
export function mentionsSubject(text: string, names: string[]): boolean {
  const lower = text.toLowerCase();
  return names.some((n) => {
    const k = n.toLowerCase();
    if (k.length <= 2) return false;
    return lower.includes(k);
  });
}

/**
 * True when the sentence is "about" the canon statement: enough content-word
 * overlap to treat the statement's keywords as present in the sentence.
 */
export function aboutStatement(sentence: string, statement: string, minOverlap = 2): boolean {
  const keys = new Set(contentWords(statement));
  if (keys.size === 0) return false;
  const sent = stemSet(sentence);
  let hits = 0;
  for (const k of keys) if (sent.has(k)) hits += 1;
  return hits >= Math.min(minOverlap, keys.size);
}

/** Antonym conflict between two texts: a word in one stems to the antonym of a word in the other. */
export function antonymConflict(a: string, b: string): { word: string; opposite: string } | undefined {
  const sa = [...stemSet(a)];
  const sb = [...stemSet(b)];
  for (const x of sa) {
    const opposites = ANTONYMS.get(x);
    if (!opposites) continue;
    for (const y of sb) {
      if (opposites.has(y)) return { word: x, opposite: y };
    }
  }
  return undefined;
}

function numbersIn(text: string): number[] {
  const values: number[] = [];
  for (const m of text.toLowerCase().matchAll(/\b\d+\b/g)) {
    values.push(Number(m[0]));
  }
  for (const [word, value] of NUMBER_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text.toLowerCase())) values.push(value);
  }
  return values;
}

/**
 * Numeric conflict: both texts contain concrete numbers, they differ, and the
 * texts share a unit-like content word (so "three memories" conflicts with
 * "one memory", but "chapter 3" does not).
 */
export function numericConflict(canonText: string, sentence: string): { canon: number; text: number } | undefined {
  const canonNums = numbersIn(canonText);
  const textNums = numbersIn(sentence);
  if (canonNums.length === 0 || textNums.length === 0) return undefined;
  const shared = stemSet(canonText.replace(/\b\d+\b/g, " "));
  const sentenceStems = stemSet(sentence);
  let sharesUnit = false;
  for (const w of shared) {
    if (sentenceStems.has(w) && !NUMBER_WORDS.has(w)) {
      sharesUnit = true;
      break;
    }
  }
  if (!sharesUnit) return undefined;
  for (const c of canonNums) {
    for (const t of textNums) {
      if (c !== t) return { canon: c, text: t };
    }
  }
  return undefined;
}

/** Names a character goes by (name + aliases). */
export function namesOf(character: Character): string[] {
  return [character.name, ...character.aliases].filter((n) => n.length > 1);
}

export function firstMatchIndex(sentence: string, needles: readonly string[]): number {
  const lower = sentence.toLowerCase();
  let best = -1;
  for (const n of needles) {
    const idx = lower.indexOf(n.toLowerCase());
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/**
 * Agent-side self-gating (contract rule: agents never emit below-floor noise).
 * The runtime re-gate in core remains authoritative.
 */
export function gateForAgent<T extends { minStrictness: Strictness; confidence: number }>(
  findings: T[],
  strictness: Strictness,
): T[] {
  if (strictness === "off") return [];
  const floor = STRICTNESS_CONFIDENCE_FLOOR[strictness];
  return findings.filter(
    (f) => STRICTNESS_ORDER[f.minStrictness] <= STRICTNESS_ORDER[strictness] && f.confidence >= floor,
  );
}
