// ---------------------------------------------------------------------------
// Canon bootstrap: deterministic, offline extraction of a DRAFT canon
// proposal from a pasted story chunk (or any text a caller hands over).
//
// Governance (binding, see docs/canon-bootstrap.md):
//   - Nothing auto-confirms: every item is `status: "proposed"`. The canon
//     store is never touched; there is no confirm path in this module.
//   - Local-only: this module never touches the filesystem and never uses
//     the network. Writing the draft to disk is the caller's (tool's) choice.
//   - Deterministic: same input -> byte-identical output. No wall-clock, no
//     randomness, no locale-dependent APIs (all comparisons and sorting are
//     code-unit based).
//
// The curated cue tables live at the top of this file. They are pinned by
// docs/canon-bootstrap.md and by packages/core/test/bootstrap.test.ts.
// ---------------------------------------------------------------------------

import type {
  CanonEntry,
  CanonKind,
  CanonSnapshot,
  Character,
  Span,
  TimelineEvent,
} from "./types.js";

export const BOOTSTRAP_TEXT_CAP = 200_000;

export const DEFAULT_GENERATED_AT = "1970-01-01T00:00:00.000Z";

export interface BootstrapSourceInput {
  text: string;
  label: string;
}

export interface BootstrapInput {
  projectId: string;
  source: BootstrapSourceInput;
  generatedAt?: string;
}

export interface BootstrapResult {
  snapshot: CanonSnapshot;
  notes: string[];
}

// --- curated cue tables ----------------------------------------------------

const ATTRIBUTION_VERBS = new Set([
  "said",
  "asked",
  "whispered",
  "shouted",
  "replied",
  "muttered",
]);

const QUANTIFIER_CUES = new Set([
  "every",
  "all",
  "no",
  "any",
  "never",
  "always",
  "each",
]);

const MODAL_CUES = [" must ", " may only ", " cannot ", " is forbidden "];

const ERA_CUE_RE = /(?:years|centuries|long ago|since the|during the)/;

const PAST_COPULAR_RE = /\b(?:was|were|had)\b/;

const PLACE_CUES = [
  "gate",
  "wall",
  "tower",
  "harbor",
  "city",
  "village",
  "forest",
  "river",
  "castle",
  "keep",
  "temple",
  "inn",
  "road",
  "bridge",
  "valley",
  "mountain",
  "sea",
  "island",
  "kingdom",
  "street",
  "market",
  "tavern",
];

const PLACE_CUE_RE = new RegExp(`\\b(?:${PLACE_CUES.join("|")})\\b`);

const COPULAR_RE = /\b(?:is|are|has|have)\b/;

const ACTION_VERB_RE = new RegExp(
  "\\b(?:" +
    [
      "went",
      "came",
      "left",
      "arrived",
      "returned",
      "attacked",
      "fled",
      "fought",
      "died",
      "killed",
      "married",
      "traveled",
      "sailed",
      "rode",
      "walked",
      "entered",
      "escaped",
      "discovered",
      "found",
      "built",
      "destroyed",
      "betrayed",
      "swore",
      "cast",
      "met",
      "woke",
      "fell",
      "rose",
      "seized",
      "lost",
      "won",
      "surrendered",
      "rescued",
      "hid",
      "revealed",
    ].join("|") +
    ")\\b(?!')",
);

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


const NAME_TOKEN_RE = /[A-Z][A-Za-z]*(?:['’-][A-Za-z]+)*/g;

const EPITHET_RE = /([A-Z][A-Za-z'’-]*)\s*,\s+the\s+([^,."!?\n'’]{2,40}?)\s*,/g;

// --- small deterministic helpers -------------------------------------------

function stripPossessive(token: string): string {
  return token.replace(/['’]s$/, "");
}

function kebabToken(word: string): string {
  return word
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstWordsKebab(text: string, count: number): string {
  const tokens = text.match(/[A-Za-z0-9'’]+/g) ?? [];
  const parts: string[] = [];
  for (const token of tokens) {
    const kebab = kebabToken(token);
    if (kebab.length > 0) parts.push(kebab);
    if (parts.length === count) break;
  }
  return parts.join("-");
}

function uniqueId(base: string, seen: Map<string, number>): string {
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function surfaceRegExp(surface: string): RegExp {
  return new RegExp(`(?<![A-Za-z])(?:${escapeRegExp(surface)})(?![A-Za-z])`, "i");
}

function collapseKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

// --- segmentation ----------------------------------------------------------

export interface BootstrapSentence {
  text: string;
  start: number;
  end: number;
  hasQuotes: boolean;
}

function segmentSentences(text: string): BootstrapSentence[] {
  const sentences: BootstrapSentence[] = [];
  const n = text.length;
  let start = 0;
  let i = 0;
  const emit = (rawEnd: number): void => {
    let s = start;
    let e = rawEnd;
    while (s < e && /\s/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) {
      const slice = text.slice(s, e);
      sentences.push({ text: slice, start: s, end: e, hasQuotes: slice.includes('"') });
    }
  };
  while (i < n) {
    const ch = text[i]!;
    if (ch === "." || ch === "!" || ch === "?") {
      let j = i;
      while (j < n && (text[j] === "." || text[j] === "!" || text[j] === "?")) j++;
      if (j < n && text[j] === '"') j++;
      emit(j);
      i = j;
      start = j;
      continue;
    }
    if (ch === "\n") {
      emit(i);
      i++;
      start = i;
      continue;
    }
    i++;
  }
  emit(n);
  return sentences;
}

// --- name scanning ---------------------------------------------------------

interface NameToken {
  text: string;
  start: number;
  end: number;
}

interface NameRun {
  name: string;
  start: number;
  end: number;
  initial: boolean;
  quotedAlias?: string;
}

interface QuoteSegment {
  open: number;
  close: number;
}

function quoteSegments(sentence: string): QuoteSegment[] {
  const segments: QuoteSegment[] = [];
  let open = -1;
  for (let i = 0; i < sentence.length; i++) {
    if (sentence[i] === '"') {
      if (open === -1) {
        open = i;
      } else {
        segments.push({ open, close: i });
        open = -1;
      }
    }
  }
  return segments;
}

function isStopToken(token: string): boolean {
  return NAME_STOPLIST.has(stripPossessive(token).toLowerCase());
}

function neighborWordAfter(sentence: string, end: number): string {
  let i = end;
  while (i < sentence.length && /\s/.test(sentence[i]!)) i++;
  const m = /^[A-Za-z]+/.exec(sentence.slice(i));
  return m ? m[0].toLowerCase() : "";
}

function neighborWordBefore(sentence: string, start: number): string {
  let i = start;
  while (i > 0 && /\s/.test(sentence[i - 1]!)) i--;
  let j = i;
  while (j > 0 && /[A-Za-z]/.test(sentence[j - 1]!)) j--;
  return j === i ? "" : sentence.slice(j, i).toLowerCase();
}

function scanNameRuns(sentence: string): NameRun[] {
  const tokens: NameToken[] = [];
  for (const m of sentence.matchAll(NAME_TOKEN_RE)) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  const quotes = quoteSegments(sentence);
  const kept = tokens.filter(
    (t) => !quotes.some((q) => t.start > q.open && t.end <= q.close) && !isStopToken(t.text),
  );

  const runs: NameRun[] = [];
  let current: { tokens: NameToken[]; aliases: string[]; end: number } | null = null;

  const gapToQuoteAlias = (from: number, to: number): string | null => {
    const gap = sentence.slice(from, to);
    const m = /^ +"([^"]{1,40})"(?: +)?$/.exec(gap);
    return m ? m[1].trim() : null;
  };

  const flush = (): void => {
    if (!current || current.tokens.length === 0) {
      current = null;
      return;
    }
    const first = current.tokens[0]!;
    const last = current.tokens[current.tokens.length - 1]!;
    const name = current.tokens.map((t) => stripPossessive(t.text)).join(" ");
    runs.push({
      name,
      start: first.start,
      end: Math.max(last.end, current.end),
      initial: first.start === 0,
      ...(current.aliases.length > 0 ? { quotedAlias: current.aliases[0] } : {}),
    });
    current = null;
  };

  for (const token of kept) {
    if (current === null) {
      current = { tokens: [token], aliases: [], end: token.end };
      continue;
    }
    const alias = gapToQuoteAlias(current.end, token.start);
    if (alias !== null) {
      current.aliases.push(alias);
      current.tokens.push(token);
      current.end = token.end;
      continue;
    }
    if (/^ +$/.test(sentence.slice(current.end, token.start))) {
      current.tokens.push(token);
      current.end = token.end;
      continue;
    }
    flush();
    current = { tokens: [token], aliases: [], end: token.end };
  }

  if (current !== null && current.tokens.length > 0) {
    const rest = sentence.slice(current.end);
    const leading = /^ +/.exec(rest);
    const from = current.end + (leading ? leading[0].length : 0);
    if (leading && sentence[from] === '"') {
      const segment = quotes.find((q) => q.open === from);
      if (segment) {
        const inner = sentence.slice(segment.open + 1, segment.close).trim();
        if (inner.length > 0 && inner.length <= 40) {
          current.aliases.push(inner);
          current.end = segment.close + 1;
        }
      }
    }
  }
  flush();

  return runs;
}

interface NameEvidence {
  canonicalName: string;
  nonInitial: number;
  attributed: boolean;
  occurrences: { sentenceIdx: number; name: string }[];
  aliases: string[];
}

function mentionOffset(sentence: string, surfaces: string[]): number {
  let best = -1;
  for (const surface of surfaces) {
    const m = surfaceRegExp(surface).exec(sentence);
    if (m && m.index >= 0 && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

// --- main entry point ------------------------------------------------------

export function bootstrapCanon(input: BootstrapInput): BootstrapResult {
  const projectId = input.projectId;
  const text = input.source.text;
  const label = input.source.label;
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;

  if (text.length > BOOTSTRAP_TEXT_CAP) {
    throw new Error(
      `Source text is ${text.length} characters; the bootstrap cap is ${BOOTSTRAP_TEXT_CAP}. ` +
        "Split the story and bootstrap it in parts.",
    );
  }

  const sentences = segmentSentences(text);

  // Pass 1: characters (evidence-gated), plus alias collection.
  const evidence = new Map<string, NameEvidence>();
  const epithetAliases = new Map<string, string[]>();

  for (const [sentenceIdx, sentence] of sentences.entries()) {
    for (const m of sentence.text.matchAll(EPITHET_RE)) {
      const key = stripPossessive(m[1]).toLowerCase();
      const alias = `the ${m[2].trim()}`;
      const list = epithetAliases.get(key) ?? [];
      if (!list.some((a) => a.toLowerCase() === alias.toLowerCase())) list.push(alias);
      epithetAliases.set(key, list);
    }

    const runs = scanNameRuns(sentence.text);
    for (const run of runs) {
      const key = run.name.toLowerCase();
      let entry = evidence.get(key);
      if (!entry) {
        entry = {
          canonicalName: run.name,
          nonInitial: 0,
          attributed: false,
          occurrences: [],
          aliases: [],
        };
        evidence.set(key, entry);
      }
      if (!run.initial) entry.nonInitial++;
      entry.occurrences.push({ sentenceIdx, name: run.name });

      const wordAfter = neighborWordAfter(sentence.text, run.end);
      const wordBefore = neighborWordBefore(sentence.text, run.start);
      if (ATTRIBUTION_VERBS.has(wordAfter) || ATTRIBUTION_VERBS.has(wordBefore)) {
        entry.attributed = true;
      }

      if (run.quotedAlias !== undefined && run.quotedAlias.toLowerCase() !== key) {
        if (!entry.aliases.some((a) => a.toLowerCase() === run.quotedAlias!.toLowerCase())) {
          entry.aliases.push(run.quotedAlias);
        }
      }
    }
  }

  const seenIds = new Map<string, number>();
  const characters: Character[] = [];
  for (const [key, ev] of evidence) {
    if (!ev.attributed && ev.nonInitial < 2) continue;
    const id = uniqueId(`char_${kebabToken(ev.canonicalName.replace(/ /g, "-"))}`, seenIds);
    const sourceSentences: Span[] = [];
    const seenSentences = new Set<number>();
    for (const occ of ev.occurrences) {
      if (seenSentences.has(occ.sentenceIdx)) continue;
      seenSentences.add(occ.sentenceIdx);
      const s = sentences[occ.sentenceIdx]!;
      sourceSentences.push({ file: label, startOffset: s.start, endOffset: s.end });
    }
    const aliasList = [...ev.aliases];
    for (const alias of epithetAliases.get(key) ?? []) {
      if (!aliasList.some((a) => a.toLowerCase() === alias.toLowerCase())) aliasList.push(alias);
    }
    characters.push({
      id,
      projectId,
      name: ev.canonicalName,
      aliases: aliasList,
      summary: sentences[ev.occurrences[0]!.sentenceIdx]!.text,
      traits: [],
      abilities: [],
      injuries: [],
      goals: [],
      relationships: [],
      status: "proposed",
      locked: false,
      sources: sourceSentences,
      createdAt: generatedAt,
      updatedAt: generatedAt,
    });
  }
  const proposedCharacters = characters;
  const characterSurfaces = new Map<string, string[]>();
  for (const c of proposedCharacters) {
    const surfaces = [c.name, ...c.aliases];
    const key = c.name.toLowerCase();
    const variants = (evidence.get(key)?.occurrences ?? []).map((o) => o.name);
    for (const v of variants) if (!surfaces.some((s) => s.toLowerCase() === v.toLowerCase())) surfaces.push(v);
    characterSurfaces.set(c.id, surfaces);
  }

  // Pass 2: canon entries (dialogue sentences skipped) and events.
  const entries: CanonEntry[] = [];
  const events: TimelineEvent[] = [];
  const seenEntryKeys = new Map<string, number>();
  const kindCounts: Record<CanonKind, number> = { fact: 0, rule: 0, history: 0, setting: 0 };
  let dialogueSentences = 0;

  const classify = (sentence: string): CanonKind | null => {
    const lower = sentence.toLowerCase();
    const padded = ` ${lower} `;
    const firstWord = (sentence.match(/[A-Za-z0-9'’]+/g) ?? [""])[0]!.toLowerCase();
    if (QUANTIFIER_CUES.has(firstWord) || MODAL_CUES.some((c) => padded.includes(c))) return "rule";
    if (PAST_COPULAR_RE.test(lower) && ERA_CUE_RE.test(lower)) return "history";
    if (PLACE_CUE_RE.test(lower)) return "setting";
    if (COPULAR_RE.test(lower)) return "fact";
    return null;
  };

  const tagsFor = (sentence: string): string[] => {
    const tags: string[] = [];
    for (const m of sentence.matchAll(/[A-Za-z0-9'’]+/g)) {
      const stripped = m[0].replace(/['’]/g, "").toLowerCase();
      if (stripped.length < 2) continue;
      if (NAME_STOPLIST.has(m[0].toLowerCase()) || NAME_STOPLIST.has(stripped)) continue;
      if (!tags.includes(stripped)) tags.push(stripped);
      if (tags.length === 3) break;
    }
    return tags;
  };

  for (const sentence of sentences) {
    if (!sentence.hasQuotes) {
      const kind = classify(sentence.text);
      if (kind !== null) {
        const dedupeKey = `${kind}|${collapseKey(sentence.text)}`;
        const dupeCount = seenEntryKeys.get(dedupeKey) ?? 0;
        seenEntryKeys.set(dedupeKey, dupeCount + 1);
        if (dupeCount === 0) {
          kindCounts[kind]++;
          entries.push({
            id: uniqueId(`canon_${kind}_${firstWordsKebab(sentence.text, 3)}`, seenIds),
            projectId,
            kind,
            text: sentence.text,
            tags: tagsFor(sentence.text),
            status: "proposed",
            locked: false,
            sources: [{ file: label, startOffset: sentence.start, endOffset: sentence.end }],
            createdAt: generatedAt,
            updatedAt: generatedAt,
          });
        }
      }
    } else {
      dialogueSentences++;
    }

    if (ACTION_VERB_RE.test(sentence.text.toLowerCase())) {
      const participants: { id: string; offset: number }[] = [];
      for (const c of proposedCharacters) {
        const offset = mentionOffset(sentence.text, characterSurfaces.get(c.id)!);
        if (offset >= 0) participants.push({ id: c.id, offset });
      }
      participants.sort((a, b) => (a.offset !== b.offset ? a.offset - b.offset : a.id < b.id ? -1 : 1));
      if (participants.length > 0) {
        events.push({
          id: uniqueId(`event_${firstWordsKebab(sentence.text, 3)}`, seenIds),
          projectId,
          description: sentence.text,
          order: events.length + 1,
          precision: "fuzzy",
          participants: participants.map((p) => p.id),
          status: "proposed",
          locked: false,
          sources: [{ file: label, startOffset: sentence.start, endOffset: sentence.end }],
          createdAt: generatedAt,
          updatedAt: generatedAt,
        });
      }
    }
  }

  const snapshot: CanonSnapshot = { projectId, entries, characters, events };

  const notes: string[] = [];
  const totalItems = entries.length + characters.length + events.length;
  notes.push(
    `Draft only: ${totalItems} proposed item(s). Review, edit and confirm them through the ` +
      "writer-confirmation flow; nothing auto-confirms and the canon store is untouched.",
  );
  if (dialogueSentences > 0) {
    notes.push(
      `${dialogueSentences} sentence(s) inside double quotes were skipped for fact/rule/history/setting ` +
        "extraction: dialogue is character voice, not established world fact.",
    );
  }
  if (characters.length === 0) {
    notes.push(
      "No characters passed the evidence gate (dialogue attribution, or 2+ non-sentence-initial mentions).",
    );
  }
  if (events.length === 0) {
    notes.push(
      "No events proposed: an event needs a proposed character and a curated action verb in one sentence.",
    );
  }
  if (entries.length === 0) {
    notes.push(
      "No canon entries proposed: entries need a quantifier/modal cue, a past-tense + era cue, a " +
        "place-cue noun or a copular declaration (see docs/canon-bootstrap.md).",
    );
  }

  return { snapshot, notes };
}
