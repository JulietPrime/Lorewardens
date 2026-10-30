import type { AgentDescriptor, AnalyzeInput, CanonContext, CanonEntry, ContinuityAgent, Finding, Strictness, TextChunk } from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import {
  CASTING_CUES,
  CASTING_DOMAIN,
  COST_CUES,
  RETENTION_CUES,
  aboutStatement,
  antonymConflict,
  containsCue,
  contentWordPairs,
  contentWords,
  gateForAgent,
  hasNegation,
  normalizeText,
  numeralSpans,
  numericConflict,
  sentences,
  stem,
  type Sentence,
} from "./lexical.js";

export type CanonLoreOptions = { objectLocationChecks?: boolean };

const LOCATION_BINDING =
  /\b(rests|sits|stands|hangs|lies|is kept|is stored|is located)\s+(in|on|at|inside|under|within)\s+(?:the |his |her |their |its )?([a-z' ]+)/i;

const RELOCATION_CUES = ["now", "moved", "lay", "left", "brought", "set down", "no longer"] as const;

type Reason =
  | { kind: "antonym"; word: string; opposite: string }
  | { kind: "negation" }
  | { kind: "numeric"; canon: number; text: number }
  | { kind: "implicit"; retention: string }
  | { kind: "drift"; object: string; movedTo: string };

interface Detection {
  entry: CanonEntry;
  reason: Reason;
  sentence: Sentence;
}

function severityFor(entry: CanonEntry): "major" | "minor" {
  return entry.locked ? "major" : "minor";
}

function minStrictnessFor(entry: CanonEntry): "gentle" | "standard" {
  return entry.locked ? "gentle" : "standard";
}

function confidenceFor(entry: CanonEntry): number {
  return entry.locked ? 0.95 : 0.8;
}

function messageFor(entry: CanonEntry, reason: Reason): string {
  const what =
    reason.kind === "antonym"
      ? `it says the opposite of canon ('${reason.opposite}' vs canon '${reason.word}')`
      : reason.kind === "negation"
        ? "it negates what the canon entry affirms"
        : reason.kind === "numeric"
          ? `it states ${reason.text} where canon states ${reason.canon}`
          : reason.kind === "implicit"
            ? `it shows the caster keeping everything ('${reason.retention}') while the rule says every casting costs`
            : `it relocates '${reason.object}' toward '${reason.movedTo}'`;
  const locked = entry.locked ? " The canon entry is writer-locked, so this contradiction is serious." : "";
  return `Possible contradiction with confirmed canon ('${entry.text}'): ${what}.${locked}`;
}

function suggestionFor(entry: CanonEntry): string {
  return (
    `Canon proposal (advisory): if the new text is intended, file a CanonProposal to update or retire ` +
    `entry '${entry.id}'; otherwise revise the passage to match canon: "${entry.text}".`
  );
}

/**
 * Subject anchor of an entry: tags[0] plus the first `firstN` content words
 * of the entry text, stemmed. The FP guards require a sentence to engage
 * this anchor, not merely share incidental vocabulary with the entry.
 */
function subjectAnchor(entry: CanonEntry, firstN: number): Set<string> {
  const anchor = new Set<string>();
  if (entry.tags[0]) for (const word of contentWords(entry.tags[0])) anchor.add(word);
  for (const word of contentWords(entry.text).slice(0, firstN)) anchor.add(word);
  return anchor;
}

/**
 * Verbatim agreement: the entry restated word-for-word inside the sentence
 * (normalized: lowercase, punctuation/whitespace collapsed) is agreement,
 * never a conflict. Runs before every conflict shape.
 */
function verbatimAgreement(sentenceText: string, entryText: string): boolean {
  const sentence = normalizeText(sentenceText);
  const entry = normalizeText(entryText);
  if (entry.length === 0) return false;
  return sentence === entry || sentence.includes(entry);
}

/** Shared content words between entry and sentence that sit outside `anchor`. */
function sharedWordsBeyondAnchor(entry: CanonEntry, sentenceText: string, anchor: Set<string>): string[] {
  const sentenceWords = new Set(contentWords(sentenceText));
  const shared: string[] = [];
  for (const word of new Set(contentWords(entry.text))) {
    if (sentenceWords.has(word) && !anchor.has(word)) shared.push(word);
  }
  return shared;
}

/**
 * Unit-word adjacency for numeric conflicts: the two differing numerals must
 * share a unit word directly adjacent to each numeral ("9 years" vs "3 years"
 * conflicts; a stray "1" near a canon "30" does not, even when the texts
 * share other words).
 */
function numeralsShareAdjacentUnit(
  canonText: string,
  sentenceText: string,
  canonValue: number,
  textValue: number,
): boolean {
  const neighborStems = (text: string, value: number): Set<string> => {
    const tokens = [...text.matchAll(/[a-zA-Z0-9']+/g)].map((m) => ({
      text: m[0],
      start: m.index ?? 0,
    }));
    const stems = new Set<string>();
    for (const span of numeralSpans(text)) {
      if (span.value !== value) continue;
      const idx = tokens.findIndex((token) => token.start === span.start);
      if (idx === -1) continue;
      if (idx > 0) stems.add(stem(tokens[idx - 1].text));
      if (idx < tokens.length - 1) stems.add(stem(tokens[idx + 1].text));
    }
    return stems;
  };
  const canonNeighbors = neighborStems(canonText, canonValue);
  const sentenceNeighbors = neighborStems(sentenceText, textValue);
  for (const word of canonNeighbors) {
    if (sentenceNeighbors.has(word)) return true;
  }
  return false;
}

/**
 * Domain link for the implicit shape: some CASTING_DOMAIN key present in the
 * sentence must have a family that intersects the rule's own domain words
 * (entry text + tags, stemmed).
 */
function castingDomainLinked(sentenceText: string, entry: CanonEntry): boolean {
  const entryWords = new Set([...contentWords(entry.text), ...contentWords(entry.tags.join(" "))]);
  for (const [key, family] of Object.entries(CASTING_DOMAIN)) {
    if (!containsCue(sentenceText, [key])) continue;
    for (const domain of family) {
      if (entryWords.has(stem(domain))) return true;
    }
  }
  return false;
}

/**
 * Implicit full-retention shape: a confirmed rule-kind entry whose text
 * states a cost, against a sentence that shows a casting ACTION and asserts
 * full retention over a linked domain. Deliberately NOT gated behind
 * aboutStatement — the repro sentence shares fewer than two content words
 * with the rule text, so keyword overlap never opens that door. Every gate
 * must pass; when in doubt the shape stays silent.
 */
function detectImplicit(sentence: Sentence, entry: CanonEntry): Reason | undefined {
  if (entry.kind !== "rule") return undefined;
  if (!containsCue(entry.text, COST_CUES)) return undefined;
  if (!CASTING_CUES.some((cue) => containsCue(sentence.text, [cue]))) return undefined;
  const retention = RETENTION_CUES.find((cue) => containsCue(sentence.text, [cue]));
  if (!retention) return undefined;
  if (!castingDomainLinked(sentence.text, entry)) return undefined;
  return { kind: "implicit", retention };
}

/**
 * Deterministic contradiction detection between the chunk and confirmed canon
 * entries. Explicit shapes (antonym, negation-polarity, numeric) are gated on
 * keyword overlap with the entry and carry the false-positive guards; the
 * implicit full-retention shape has its own eligibility gates. Verbatim
 * agreement is checked first and never reported as a conflict. At most one
 * finding per (entry, sentence); explicit shapes take precedence over the
 * implicit one.
 */
export function detectCanonContradictions(chunk: TextChunk, context: CanonContext): Detection[] {
  const detections: Detection[] = [];
  const seen = new Set<string>();

  for (const entry of context.entries) {
    if (entry.status !== "confirmed") continue;
    const antonymAnchor = subjectAnchor(entry, 2);
    const negationAnchor = subjectAnchor(entry, 1);
    for (const sentence of sentences(chunk.text)) {
      const key = `${entry.id}:${sentence.start}`;
      if (seen.has(key)) continue;

      // Verbatim canon agreement is never a conflict, whatever cues the
      // surrounding sentence frame carries.
      if (verbatimAgreement(sentence.text, entry.text)) continue;

      const detected = ((): Reason | undefined => {
        if (!aboutStatement(sentence.text, entry.text)) return undefined;

        const antonym = antonymConflict(entry.text, sentence.text);
        if (antonym) {
          // Guard: the sentence must engage the entry's subject, so 'light in
          // every window' cannot collide with dark canon on 'light' alone.
          const sentenceWords = new Set(contentWords(sentence.text));
          if ([...antonymAnchor].some((word) => sentenceWords.has(word))) {
            return { kind: "antonym", word: antonym.word, opposite: antonym.opposite };
          }
        }

        const negated = hasNegation(sentence.text) !== hasNegation(entry.text);
        if (negated) {
          // Guard: polarity must conflict over shared content beyond the
          // subject anchor, not merely co-occur with it ('wolves' class).
          if (sharedWordsBeyondAnchor(entry, sentence.text, negationAnchor).length > 0) {
            return { kind: "negation" };
          }
        }

        const numeric = numericConflict(entry.text, sentence.text);
        if (numeric) {
          // Guard: the differing numerals must share a unit word adjacent to
          // each numeral, so stray counters cannot match canon numbers.
          if (numeralsShareAdjacentUnit(entry.text, sentence.text, numeric.canon, numeric.text)) {
            return { kind: "numeric", canon: numeric.canon, text: numeric.text };
          }
        }

        return undefined;
      })();

      if (detected) {
        seen.add(key);
        detections.push({ entry, reason: detected, sentence });
        continue;
      }

      const implicit = detectImplicit(sentence, entry);
      if (implicit) {
        seen.add(key);
        detections.push({ entry, reason: implicit, sentence });
      }
    }
  }
  return detections;
}

/**
 * Strict optional check (objectLocationChecks): flags important objects or
 * locations that the chunk moves contrary to where canon keeps them. The
 * object's identity comes from the entry's own text — the subject words
 * before the binding verb — with tags[0] as fallback; the drift carries its
 * own reason kind instead of borrowing the antonym shape.
 */
export function detectLocationDrift(chunk: TextChunk, context: CanonContext): Detection[] {
  const bindings: {
    entry: CanonEntry;
    placeStems: Set<string>;
    placeWords: { stem: string; word: string }[];
    objectWords: { stem: string; word: string }[];
    fallbackLabel?: string;
  }[] = [];
  for (const entry of context.entries) {
    if (entry.status !== "confirmed") continue;
    const match = entry.text.match(LOCATION_BINDING);
    if (!match) continue;
    const subjectWords = contentWordPairs(entry.text.slice(0, match.index ?? 0));
    const fallback = entry.tags[0] || undefined;
    const objectWords =
      subjectWords.length > 0 ? subjectWords : fallback ? contentWordPairs(fallback) : [];
    if (objectWords.length === 0) continue;
    bindings.push({
      entry,
      placeStems: new Set(contentWords(match[3])),
      placeWords: contentWordPairs(match[3]),
      objectWords,
      fallbackLabel: subjectWords.length > 0 ? undefined : fallback,
    });
  }
  if (bindings.length < 1) return [];

  const detections: Detection[] = [];
  for (const sentence of sentences(chunk.text)) {
    const lower = sentence.text.toLowerCase();
    const relocating = RELOCATION_CUES.some((cue) => lower.includes(cue));
    if (!relocating) continue;
    const sentenceStems = new Set(contentWords(sentence.text));
    for (const binding of bindings) {
      const objectHit = binding.objectWords.find((candidate) => sentenceStems.has(candidate.stem));
      if (!objectHit) continue;
      let movedTo: string | undefined;
      for (const other of bindings) {
        if (other.entry.id === binding.entry.id) continue;
        for (const candidate of other.placeWords) {
          if (sentenceStems.has(candidate.stem) && !binding.placeStems.has(candidate.stem)) {
            movedTo = candidate.word;
            break;
          }
        }
        if (movedTo) break;
      }
      if (movedTo) {
        const label = binding.fallbackLabel ?? objectHit.word;
        detections.push({ entry: binding.entry, reason: { kind: "drift", object: label, movedTo }, sentence });
      }
    }
  }
  return detections;
}

export function canonLoreFindings(
  chunk: TextChunk,
  context: CanonContext,
  options: CanonLoreOptions,
  strictness: Strictness,
): Finding[] {
  const findings: Finding[] = [];
  const detections = [
    ...detectCanonContradictions(chunk, context),
    ...(options.objectLocationChecks && strictness === "strict" ? detectLocationDrift(chunk, context) : []),
  ];
  for (const detection of detections) {
    const { entry, reason, sentence } = detection;
    const isDrift = reason.kind === "drift";
    findings.push(
      makeFinding({
        agent: "canon-lore",
        category: "canon",
        type: isDrift ? "canon-location-drift" : reason.kind === "implicit" ? "canon-implicit-contradiction" : "canon-contradiction",
        severity: isDrift ? "info" : severityFor(entry),
        confidence: isDrift ? 0.55 : confidenceFor(entry),
        minStrictness: isDrift ? "strict" : minStrictnessFor(entry),
        message: isDrift
          ? `Canon places '${reason.object}' elsewhere ("${entry.text}"); the passage relocates it toward '${reason.movedTo}'.`
          : messageFor(entry, reason),
        quote: sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + sentence.start,
          endOffset: chunk.span.startOffset + sentence.end,
        },
        canonRefs: [entry.id],
        suggestion: suggestionFor(entry),
      }),
    );
  }
  return findings;
}

export function createCanonLoreAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      const options = (input.settings.agents.find((a) => a.agentId === "canon-lore")?.options ?? {}) as CanonLoreOptions;
      const findings = canonLoreFindings(input.chunk, input.context, options, input.strictness);
      return gateForAgent(findings, input.strictness);
    },
  };
}
