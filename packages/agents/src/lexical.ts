import type { Character, Strictness } from "@lorewardens/core";
import { STRICTNESS_CONFIDENCE_FLOOR, STRICTNESS_ORDER } from "@lorewardens/core";

// Name-variant rule table (closed, documented): re-exported from core for
// call-site convenience. Thin re-export only — no logic duplication.
export {
  canonNamesOf,
  capitalizedTokens,
  isStoplistedName,
  nameVariantOf,
  stripPossessive,
  textHasNameVariant,
  wholeWordTokens,
} from "@lorewardens/core";
export type { NameVariantMatch } from "@lorewardens/core";

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

// ---------------------------------------------------------------------------
// Implicit-contradiction cue tables (canon-lore).
//
// The implicit shape flags a sentence that shows a caster keeping everything
// a confirmed cost rule says every casting costs ("She cast the ward and
// remembered every detail of it afterward" vs "Every spell costs the caster
// one personal memory"). It is deliberately over-gated: each table prefers
// false negatives over false positives, and a sentence must clear ALL gates
// (confirmed rule-kind entry with a cost cue + casting ACTION cue +
// full-retention cue + domain link) before a finding is emitted.
// ---------------------------------------------------------------------------

/**
 * Entry-side cost/loss cues: the rule text itself must state that casting
 * costs or loses something. Word-boundary matched against the entry text.
 * "takes" is the double-edged member (it also means duration) — accepted
 * because the shape additionally requires the casting + retention + domain
 * gates, so a duration-only rule ("takes a whole day") still needs a
 * full-retention sentence about a linked domain to misfire.
 */
export const COST_CUES: readonly string[] = [
  "cost", "costs", "price", "takes", "sacrifice", "sacrifices", "lose", "loses",
  "forfeit", "forfeits", "surrender", "surrenders", "pays", "paid", "give up",
  "gives up", "drains", "drain",
];

/**
 * Sentence-side casting ACTION cues. Verbs of performing magic only: bare
 * nouns ("spell", "magic", "ward") are deliberately NOT casting cues — that
 * is what keeps "she remembered every detail of the spell book" silent, and
 * what keeps simple mentions of magic objects from implying a casting.
 * Word-boundary matched against the sentence.
 */
export const CASTING_CUES: readonly string[] = [
  "cast", "casting", "casted", "wove", "weave", "weaving", "invoked", "invoke",
  "invoking",   "channelled", "channeled", "channel", "channeling",
  "conjured", "conjure", "conjuring", "enchanted", "enchant", "enchanting",
  "spoke the incantation", "uttered the incantation",
];

/**
 * Sentence-side FULL-retention cues. Each phrase asserts the caster kept
 * everything, which is what contradicts a cost rule. Generic memory words
 * ("remembered the map", "paid a memory") are not retention. Prefer false
 * negatives: every member is a specific multi-word phrase.
 */
export const RETENTION_CUES: readonly string[] = [
  "remembered every detail", "remembered everything", "recalled every detail",
  "remembered all", "recalled all", "nothing was lost", "nothing is lost",
  "kept every memory", "kept all her memories", "kept all his memories",
  "kept every one of her memories", "kept every one of his memories",
];

/**
 * Domain link between the casting side of a sentence and a rule's own
 * domain words (text + tags). Keys are words that may appear in the sentence:
 * the casting action cues AND the magic domain nouns (so "she invoked the
 * ward" binds to a ward-specific rule even though invoke's own family is
 * magic-only). Values are the domain families each key can bind to. The
 * implicit shape fires only when some key present in the sentence has a
 * family that intersects the rule's own domain words.
 */
export const CASTING_DOMAIN: Readonly<Record<string, readonly string[]>> = {
  "cast": ["spell", "magic", "ward", "incantation", "ritual", "enchantment", "hex", "charm"],
  "casting": ["spell", "magic", "ward", "incantation", "ritual", "enchantment", "hex", "charm"],
  "casted": ["spell", "magic", "ward", "incantation", "ritual", "enchantment", "hex", "charm"],
  "wove": ["spell", "magic", "ward", "enchantment", "charm", "weaving"],
  "weave": ["spell", "magic", "ward", "enchantment", "charm", "weaving"],
  "weaving": ["spell", "magic", "ward", "enchantment", "charm", "weaving"],
  "invoked": ["magic", "ritual", "spell", "blessing"],
  "invoke": ["magic", "ritual", "spell", "blessing"],
  "invoking": ["magic", "ritual", "spell", "blessing"],
  "channelled": ["magic", "power", "spell", "storm"],
  "channeled": ["magic", "power", "spell", "storm"],
  "channel": ["magic", "power", "spell", "storm"],
  "channeling": ["magic", "power", "spell", "storm"],
  "conjured": ["magic", "spell", "spirit", "creature"],
  "conjure": ["magic", "spell", "spirit", "creature"],
  "conjuring": ["magic", "spell", "spirit", "creature"],
  "enchanted": ["magic", "enchantment", "object", "spell"],
  "enchant": ["magic", "enchantment", "object", "spell"],
  "enchanting": ["magic", "enchantment", "object", "spell"],
  "spoke the incantation": ["incantation", "spell", "magic"],
  "uttered the incantation": ["incantation", "spell", "magic"],
  // Domain nouns: not casting cues on their own (see CASTING_CUES), but they
  // carry the domain link when they co-occur with a casting action cue.
  "ward": ["ward", "spell", "magic", "protection"],
  "warding": ["ward", "spell", "magic", "protection"],
  "spell": ["spell", "magic"],
  "magic": ["magic", "spell"],
  "incantation": ["incantation", "spell", "magic"],
  "ritual": ["ritual", "magic", "spell"],
  "hex": ["hex", "magic", "spell"],
  "charm": ["charm", "magic", "spell"],
  "enchantment": ["enchantment", "magic", "spell"],
  "blessing": ["blessing", "magic", "spell"],
};

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

/**
 * Content words paired with their original surface form ({ stem, word }).
 * Same filtering as contentWords; the surface form keeps user-facing
 * messages readable while matching stays stem-based.
 */
export function contentWordPairs(text: string): { stem: string; word: string }[] {
  const seen = new Set<string>();
  const out: { stem: string; word: string }[] = [];
  for (const token of tokenize(text)) {
    if (STOPWORDS.has(token) || NEGATION_CUES.includes(token)) continue;
    const s = stem(token);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push({ stem: s, word: token });
  }
  return out;
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Word-boundary cue membership. Phrases and single words alike; the boundary
 * keeps "cast" out of "castle" and "remembered all" out of "remembered
 * allegiance". Deterministic and side-effect free.
 */
export function containsCue(text: string, cues: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return cues.some((cue) => new RegExp(`\\b${escapeRegExp(cue)}\\b`).test(lower));
}

/**
 * Normalized form used for verbatim agreement: lowercase, every run of
 * non-alphanumeric characters collapsed to one space, trimmed. "City's"
 * and "city s" normalize identically, so punctuation cannot hide or fake
 * a restatement.
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface NumeralSpan {
  value: number;
  start: number; // offset within the given text
  end: number; // exclusive
}

/**
 * Every concrete numeral in `text` with its position: digit runs and the
 * closed number-word table (zero..ten). Used by the numeric-conflict guard
 * to check that a shared unit word sits adjacent to EACH numeral.
 */
export function numeralSpans(text: string): NumeralSpan[] {
  const spans: NumeralSpan[] = [];
  for (const m of text.toLowerCase().matchAll(/\b\d+\b/g)) {
    spans.push({ value: Number(m[0]), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  for (const [word, value] of NUMBER_WORDS) {
    const re = new RegExp(`\\b${word}\\b`, "g");
    for (const m of text.toLowerCase().matchAll(re)) {
      spans.push({ value, start: m.index ?? 0, end: (m.index ?? 0) + word.length });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
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
