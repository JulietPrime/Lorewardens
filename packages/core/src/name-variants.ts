import type { Character } from "./types.js";

// ---------------------------------------------------------------------------
// Closed name-variant rule table.
//
// Deterministic, pure, offline, side-effect free. This module is the ONLY
// spelling tolerance that exists in the engine: a token is a spelling variant
// of a canon name exactly when the rules below say so — one enumerated edit
// operation, no fuzzy thresholds, no phonetic rules.
//
// Rule: a candidate text token T is a spelling VARIANT of a canon name N iff
// ALL hold:
//   1. T and N are case-insensitively unequal (exact matches — canon name or
//      alias — are never variants);
//   2. restricted Damerau-Levenshtein distance between lower(T) and lower(N)
//      is exactly 1: ONE of — single substitution, single insertion, single
//      deletion, adjacent transposition. No other operation, no distance 2;
//   3. min(len(T), len(N)) >= 4 (short names never variant-match; avoids
//      'Ed'/'Edw' noise);
//   4. T appears as a CAPITALIZED whole word token in the sentence text
//      (proper-noun surfaces only; tokenization: [A-Za-z0-9'’]+ runs,
//      possessive 's/'’s stripped before comparing). Enforced by the
//      sentence-level helpers — callers feed the predicate tokens produced
//      by `capitalizedTokens`;
//   5. T is not stoplisted (see NAME_STOPLIST below — the same guard inputs
//      the place-name evidence uses).
//
// Canon name sources per character: canonNamesOf(character) = namesOf
// semantics = [character.name, ...character.aliases], each length > 1.
// Aliases are honored BY CONSTRUCTION: an exact case-insensitive alias match
// is never a variant, so a writer who locks a deliberate variant as an alias
// silences it permanently. Writer dismissal path = add the variant as an
// alias (or correct canon). No store plumbing, no exception plumbing.
// ---------------------------------------------------------------------------

/**
 * Verbatim copy of NAME_STOPLIST from `packages/core/src/bootstrap.ts`
 * (private there; that file is outside this task's allowed-file region).
 * Keep in sync with the source. Semantics: a token is stoplisted when its
 * possessive-stripped lowercase form is a member of this set.
 */
const NAME_STOPLIST = new Set([
  "a",
  "about",
  "across",
  "after",
  "against",
  "ain't",
  "all",
  "along",
  "also",
  "although",
  "always",
  "am",
  "amid",
  "an",
  "and",
  "any",
  "aren't",
  "around",
  "as",
  "at",
  "aunt",
  "auntie",
  "be",
  "because",
  "been",
  "before",
  "beneath",
  "beside",
  "besides",
  "between",
  "beyond",
  "brother",
  "but",
  "by",
  "can't",
  "chapter",
  "could",
  "couldn't",
  "cousin",
  "dad",
  "daddy",
  "december",
  "despite",
  "did",
  "didn't",
  "do",
  "does",
  "doesn't",
  "don't",
  "down",
  "dr",
  "during",
  "each",
  "epilogue",
  "even",
  "every",
  "except",
  "father",
  "february",
  "finally",
  "for",
  "friday",
  "from",
  "got",
  "grandfather",
  "grandma",
  "grandmother",
  "grandpa",
  "granny",
  "had",
  "hadn't",
  "has",
  "hasn't",
  "have",
  "haven't",
  "he",
  "he's",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "i'm",
  "if",
  "in",
  "inside",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "january",
  "july",
  "june",
  "just",
  "lady",
  "later",
  "let's",
  "lord",
  "madam",
  "mama",
  "maybe",
  "me",
  "might",
  "mom",
  "mommy",
  "monday",
  "mother",
  "mr",
  "mrs",
  "ms",
  "must",
  "my",
  "nana",
  "near",
  "nephew",
  "never",
  "niece",
  "no",
  "nor",
  "not",
  "november",
  "now",
  "october",
  "of",
  "off",
  "on",
  "once",
  "one",
  "only",
  "onto",
  "or",
  "other",
  "our",
  "out",
  "outside",
  "over",
  "papa",
  "part",
  "perhaps",
  "prologue",
  "saturday",
  "september",
  "should",
  "shouldn't",
  "since",
  "sister",
  "so",
  "some",
  "soon",
  "still",
  "suddenly",
  "sunday",
  "that",
  "that's",
  "the",
  "their",
  "them",
  "then",
  "there",
  "there's",
  "these",
  "they",
  "they're",
  "this",
  "those",
  "though",
  "through",
  "thursday",
  "to",
  "toward",
  "towards",
  "tuesday",
  "two",
  "uncle",
  "under",
  "until",
  "up",
  "upon",
  "us",
  "via",
  "was",
  "wasn't",
  "we",
  "we're",
  "wednesday",
  "were",
  "weren't",
  "what",
  "what's",
  "when",
  "where",
  "whether",
  "which",
  "while",
  "who",
  "who's",
  "whom",
  "whose",
  "why",
  "will",
  "with",
  "within",
  "without",
  "won't",
  "would",
  "wouldn't",
  "yet",
  "you",
  "you're",
  "your",
]);

/** Strips a possessive suffix ('s / ’s) from a token. Idempotent. */
export function stripPossessive(token: string): string {
  return token.replace(/['’]s$/, "");
}

/**
 * Whole-word tokens of `text`: [A-Za-z0-9'’]+ runs with possessives
 * stripped, every occurrence in text order, any casing. Unduplicated.
 */
export function wholeWordTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[A-Za-z0-9'’]+/g)) {
    const token = stripPossessive(m[0]);
    if (token.length > 0) out.push(token);
  }
  return out;
}

/**
 * Capitalized whole-word tokens of `text`: the subset of wholeWordTokens
 * whose stripped form starts with an uppercase letter (proper-noun
 * surfaces). Every occurrence in text order, unduplicated.
 */
export function capitalizedTokens(text: string): string[] {
  return wholeWordTokens(text).filter((t) => /^[A-Z]/.test(t));
}

/** Stoplist semantics shared with the place-name evidence guard. */
export function isStoplistedName(token: string): boolean {
  return NAME_STOPLIST.has(stripPossessive(token).toLowerCase());
}

/**
 * A character's canon names: [name, ...aliases], each length > 1 — the same
 * semantics as the agents package's `namesOf`.
 */
export function canonNamesOf(character: Character): string[] {
  return [character.name, ...character.aliases].filter((n) => n.length > 1);
}

export interface NameVariantMatch {
  /** The canon name from `canonNames` that the token is a variant of. */
  variantOf: string;
  /**
   * The canonical spelling shown to writers: the first entry of
   * `canonNames` (which canonNamesOf puts as the character's primary name).
   */
  canonical: string;
}

/**
 * Exactly-one-edit check over the CLOSED operation set: single substitution,
 * single insertion, single deletion, adjacent transposition. Inputs are
 * already lowercase. Returns true iff the two strings differ by exactly one
 * of those operations (restricted DL distance exactly 1).
 */
function oneEnumeratedEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (la === lb) {
    // Single substitution: exactly one differing position. (Two differing
    // positions fall through to the transposition check below — an adjacent
    // transposition IS two mismatched positions.)
    let diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) diffs += 1;
    }
    if (diffs === 1) return true;
    // Adjacent transposition: one adjacent pair swapped, rest identical.
    for (let i = 0; i + 1 < la; i++) {
      if (a[i] === b[i]) continue;
      if (a[i] === b[i + 1] && a[i + 1] === b[i]) {
        let restMatches = true;
        for (let j = i + 2; j < la; j++) {
          if (a[j] !== b[j]) {
            restMatches = false;
            break;
          }
        }
        if (restMatches) return true;
      }
      return false;
    }
    return false;
  }
  if (Math.abs(la - lb) !== 1) return false;
  // Single insertion/deletion: the shorter is the longer with one character
  // removed.
  const [shorter, longer] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }
  // Any remaining tail of `longer` is the single insertion; a remaining tail
  // of `shorter` would mean two insertions, impossible after the loop above
  // (i can only trail j by at most the one skip).
  return true;
}

function variantRuleMatches(token: string, name: string): boolean {
  // Rule 3: short names never variant-match.
  if (Math.min(token.length, name.length) < 4) return false;
  // Rule 2: distance exactly 1 over the enumerated operations.
  return oneEnumeratedEdit(token.toLowerCase(), name.toLowerCase());
}

/**
 * Rule-table lookup: is `token` a spelling variant of one of `canonNames`?
 *
 * Precondition: `token` is a capitalized whole-word token (as produced by
 * `capitalizedTokens`). Exact case-insensitive matches and stoplisted tokens
 * return null — an exact canon name or alias is never a variant.
 *
 * Deterministic: canon names are tested in list order; the first match wins.
 */
export function nameVariantOf(token: string, canonNames: string[]): NameVariantMatch | null {
  const stripped = stripPossessive(token);
  if (stripped.length === 0 || canonNames.length === 0) return null;
  const lower = stripped.toLowerCase();
  // Rule 1: exact matches — canon name or alias — are never variants.
  if (canonNames.some((n) => n.toLowerCase() === lower)) return null;
  // Rule 5: stoplisted tokens are never variant candidates.
  if (NAME_STOPLIST.has(lower)) return null;
  for (const name of canonNames) {
    if (variantRuleMatches(stripped, name)) {
      return { variantOf: name, canonical: canonNames[0] };
    }
  }
  return null;
}

/**
 * Sentence/chunk-level helper: true when any capitalized whole-word token of
 * `text` is a rule-table variant of one of `canonNames`.
 */
export function textHasNameVariant(text: string, canonNames: string[]): boolean {
  for (const token of capitalizedTokens(text)) {
    if (nameVariantOf(token, canonNames) !== null) return true;
  }
  return false;
}
