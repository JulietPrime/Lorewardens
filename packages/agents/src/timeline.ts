import type { AgentDescriptor, AnalyzeInput, CanonContext, ContinuityAgent, Finding, TextChunk, TimelineEvent } from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import {
  AMBIGUITY_CUES,
  contentWords,
  firstMatchIndex,
  gateForAgent,
  mentionsSubject,
  namesOf,
  SEQUENCE_CUES_AFTER,
  SEQUENCE_CUES_BEFORE,
  sentences,
  type Sentence,
} from "./lexical.js";
import { eventDateFindings } from "./event-dates.js";

// EventRef and the mention machinery below are exported for the date/age
// checks in event-dates.ts, which reuse them unchanged.
export interface EventRef {
  event: TimelineEvent;
  names: string[];
  keywords: string[];
}

export function buildRefs(context: CanonContext): EventRef[] {
  const charactersById = new Map(context.characters.map((c) => [c.id, c]));
  const refs: EventRef[] = [];
  for (const event of context.events) {
    if (event.status !== "confirmed") continue;
    const names = event.participants
      .map((id) => charactersById.get(id))
      .filter((c) => c !== undefined)
      .flatMap((c) => namesOf(c));
    const keywords = [
      ...contentWords(event.description),
      ...contentWords(event.location ?? ""),
      ...contentWords(names.join(" ")),
    ];
    refs.push({ event, names, keywords });
  }
  return refs;
}

export function keywordRefCount(refs: EventRef[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    for (const keyword of new Set(ref.keywords)) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return counts;
}

export function mentionScore(sentence: string, ref: EventRef): number {
  let score = mentionsSubject(sentence, ref.names) ? 2 : 0;
  const lower = sentence.toLowerCase();
  for (const keyword of new Set(ref.keywords)) {
    if (lower.includes(keyword)) score += 1;
  }
  return score;
}

function uniqueKeywordHit(sentence: string, ref: EventRef, counts: Map<string, number>): boolean {
  const lower = sentence.toLowerCase();
  for (const keyword of new Set(ref.keywords)) {
    if (lower.includes(keyword) && counts.get(keyword) === 1) return true;
  }
  return false;
}

export function mentionsEvent(sentence: string, ref: EventRef, counts: Map<string, number>): boolean {
  const score = mentionScore(sentence, ref);
  return score >= 2 || (score >= 1 && uniqueKeywordHit(sentence, ref, counts));
}

export function firstMentionIndex(sentence: string, ref: EventRef): number {
  const byName = firstMatchIndex(sentence, ref.names);
  const byKeyword = firstMatchIndex(sentence, ref.keywords);
  if (byName === -1) return byKeyword;
  if (byKeyword === -1) return byName;
  return Math.min(byName, byKeyword);
}

/**
 * True when ANY occurrence of some cue lies fully inside [from, to] (caution
 * fix: every occurrence is considered, not just the first — a sentence whose
 * first "after" sits outside the mention window but whose second one sits
 * inside it still asserts a sequence).
 */
function cueBetween(sentence: string, cues: readonly string[], from: number, to: number): boolean {
  const lower = sentence.toLowerCase();
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return cues.some((cue) => {
    let idx = lower.indexOf(cue);
    while (idx !== -1) {
      if (idx >= lo && idx + cue.length <= hi) return true;
      idx = lower.indexOf(cue, idx + 1);
    }
    return false;
  });
}

/**
 * Position of an ambiguity cue in the sentence (first occurrence of any cue),
 * or -1. Positions let the ambiguity gate require the hedge to sit inside the
 * mention window instead of anywhere in the sentence.
 */
function ambiguityCuePosition(sentence: string, cues: readonly string[]): number {
  const lower = sentence.toLowerCase();
  let best = -1;
  for (const cue of cues) {
    const idx = lower.indexOf(cue);
    if (idx !== -1 && (best === -1 || idx < best)) best = idx;
  }
  return best;
}

/**
 * First index of a keyword that DISTINGUISHES this event from the other one
 * (not shared between the two keyword sets). When the two events share a
 * participant, their first-mention indices collapse onto that shared name
 * (documented limitation); the distinguishing keyword restores a usable
 * mention window for the ambiguity gate.
 */
function distinguishingMentionIndex(sentence: string, ref: EventRef, other: EventRef): number {
  const shared = new Set(ref.keywords.filter((keyword) => other.keywords.includes(keyword)));
  const own = ref.keywords.filter((keyword) => !shared.has(keyword));
  const idx = firstMatchIndex(sentence, own);
  return idx !== -1 ? idx : firstMentionIndex(sentence, ref);
}

interface SequenceDetection {
  first: EventRef;
  second: EventRef;
  assertedFirstPrecedes: boolean;
  sentence: Sentence;
}

export interface TimelineDetections {
  contradictions: SequenceDetection[];
  ambiguities: { first: EventRef; second: EventRef; sentence: Sentence }[];
}

/**
 * Deterministic sequence checks against confirmed timeline events: comparative
 * cues ("before"/"after") between two event mentions are compared with canon
 * order; hedged sequencing of two events is flagged as ambiguous only when
 * the hedge belongs to the mention pair (it does not trail the second event
 * mention) and no comparative cue sits between the two mentions — a
 * comparative there asserts an order instead (caution fixes: every cue
 * occurrence counts, and hedges no longer fire from anywhere in the sentence).
 */
export function detectTimelineIssues(chunkText: string, context: CanonContext): TimelineDetections {
  const refs = buildRefs(context);
  const counts = keywordRefCount(refs);
  const contradictions: SequenceDetection[] = [];
  const ambiguities: { first: EventRef; second: EventRef; sentence: Sentence }[] = [];
  const seenPairs = new Set<string>();

  for (const sentence of sentences(chunkText)) {
    const mentioned = refs
      .filter((ref) => mentionsEvent(sentence.text, ref, counts))
      .sort((x, y) => mentionScore(sentence.text, y) - mentionScore(sentence.text, x));

    if (mentioned.length < 2) continue;
    const [a, b] = mentioned;

    const idxA = firstMentionIndex(sentence.text, a);
    const idxB = firstMentionIndex(sentence.text, b);
    const collapsed = idxA === -1 || idxB === -1 || idxA === idxB;

    // Mention window for the pair. First-mentions when they differ; when they
    // collapse onto a shared participant name, fall back to each event's first
    // distinguishing keyword so the window spans the two actual mentions.
    let windowLo = -1;
    let windowHi = -1;
    if (!collapsed) {
      windowLo = Math.min(idxA, idxB);
      windowHi = Math.max(idxA, idxB);
    } else {
      const dA = distinguishingMentionIndex(sentence.text, a, b);
      const dB = distinguishingMentionIndex(sentence.text, b, a);
      if (dA !== -1 && dB !== -1 && dA !== dB) {
        windowLo = Math.min(dA, dB);
        windowHi = Math.max(dA, dB);
      }
    }

    // A comparative cue between the two mentions asserts a positional
    // reading: "p ... before ... q" => p precedes q; "p ... after ... q" =>
    // q precedes p. This wins over any hedge elsewhere in the sentence.
    const comparative =
      windowLo !== -1 &&
      (cueBetween(sentence.text, SEQUENCE_CUES_BEFORE, windowLo, windowHi) ||
        cueBetween(sentence.text, SEQUENCE_CUES_AFTER, windowLo, windowHi));

    if (comparative && !collapsed) {
      // A comparative cue between two mentions asserts the positional reading:
      // "p ... before ... q" => p precedes q; "p ... after ... q" => q precedes p.
      const [p, q] = idxA < idxB ? [a, b] : [b, a];
      let assertedPQ: boolean | undefined;
      if (cueBetween(sentence.text, SEQUENCE_CUES_BEFORE, idxA, idxB)) assertedPQ = true;
      else if (cueBetween(sentence.text, SEQUENCE_CUES_AFTER, idxA, idxB)) assertedPQ = false;
      if (assertedPQ === undefined) continue;

      // Canonicalize the pair by canon order so findings are deterministic.
      let first: EventRef;
      let second: EventRef;
      let assertedFirstPrecedes: boolean;
      if (p.event.order <= q.event.order) {
        first = p;
        second = q;
        assertedFirstPrecedes = assertedPQ;
      } else {
        first = q;
        second = p;
        assertedFirstPrecedes = !assertedPQ;
      }

      const key = `seq:${first.event.id}|${second.event.id}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      contradictions.push({ first, second, assertedFirstPrecedes, sentence });
      continue;
    }

    // Ambiguity: a hedge fires only while it still precedes the second event
    // mention (windowHi) — a hedge trailing both mentions describes something
    // else — and no comparative cue sits between the two mentions.
    if (!comparative && windowHi !== -1) {
      const hedgeAt = ambiguityCuePosition(sentence.text, AMBIGUITY_CUES);
      if (hedgeAt !== -1 && hedgeAt < windowHi) {
        const key = `amb:${a.event.id}|${b.event.id}`;
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          ambiguities.push({ first: a, second: b, sentence });
        }
      }
    }
  }

  return { contradictions, ambiguities };
}

export function timelineFindings(chunk: TextChunk, context: CanonContext): Finding[] {
  const findings: Finding[] = [];
  const { contradictions, ambiguities } = detectTimelineIssues(chunk.text, context);
  for (const { first, second, assertedFirstPrecedes, sentence } of contradictions) {
    const canonFirstPrecedes = first.event.order < second.event.order;
    if (assertedFirstPrecedes === canonFirstPrecedes) continue;
    const locked = first.event.locked || second.event.locked;
    findings.push(
      makeFinding({
        agent: "timeline",
        category: "timeline",
        type: "timeline-contradiction",
        severity: locked ? "major" : "minor",
        confidence: locked ? 0.95 : 0.8,
        minStrictness: locked ? "gentle" : "standard",
        message:
          `Passage places "${first.event.description}" ${assertedFirstPrecedes ? "before" : "after"} ` +
          `"${second.event.description}", but canon order (events '${first.event.id}', '${second.event.id}') is the reverse.`,
        quote: sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + sentence.start,
          endOffset: chunk.span.startOffset + sentence.end,
        },
        canonRefs: [first.event.id, second.event.id],
        suggestion:
          "Timeline proposal (advisory): confirm the intended sequence with the writer; " +
          "either reorder the events in canon or revise the passage.",
      }),
    );
  }

  for (const { first, second, sentence } of ambiguities) {
    findings.push(
      makeFinding({
        agent: "timeline",
        category: "timeline",
        type: "unclear-time-jump",
        severity: "minor",
        confidence: 0.7,
        minStrictness: "standard",
        message:
          `The sequence between "${first.event.description}" and "${second.event.description}" is genuinely ambiguous ` +
          `in this passage; canon fixes their order but the text only hedges it.`,
        quote: sentence.text,
        location: {
          file: chunk.span.file,
          startOffset: chunk.span.startOffset + sentence.start,
          endOffset: chunk.span.startOffset + sentence.end,
        },
        canonRefs: [first.event.id, second.event.id],
        suggestion:
          "Clarify the sequencing for the reader, or accept the ambiguity and dismiss this finding.",
      }),
    );
  }

  // Date and age checks (canon dates + birthDate) run on the same chunk;
  // they are silent for undated canon, so they add nothing otherwise.
  findings.push(...eventDateFindings(chunk, context));

  return findings;
}

export function createTimelineAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      const findings = timelineFindings(input.chunk, input.context);
      return gateForAgent(findings, input.strictness);
    },
  };
}
