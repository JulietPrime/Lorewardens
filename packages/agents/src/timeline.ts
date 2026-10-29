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

interface EventRef {
  event: TimelineEvent;
  names: string[];
  keywords: string[];
}

function buildRefs(context: CanonContext): EventRef[] {
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

function keywordRefCount(refs: EventRef[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of refs) {
    for (const keyword of new Set(ref.keywords)) {
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }
  return counts;
}

function mentionScore(sentence: string, ref: EventRef): number {
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

function mentionsEvent(sentence: string, ref: EventRef, counts: Map<string, number>): boolean {
  const score = mentionScore(sentence, ref);
  return score >= 2 || (score >= 1 && uniqueKeywordHit(sentence, ref, counts));
}

function firstMentionIndex(sentence: string, ref: EventRef): number {
  const byName = firstMatchIndex(sentence, ref.names);
  const byKeyword = firstMatchIndex(sentence, ref.keywords);
  if (byName === -1) return byKeyword;
  if (byKeyword === -1) return byName;
  return Math.min(byName, byKeyword);
}

function cueBetween(sentence: string, cues: readonly string[], from: number, to: number): boolean {
  const lower = sentence.toLowerCase();
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return cues.some((cue) => {
    const idx = lower.indexOf(cue);
    return idx >= lo && idx + cue.length <= hi;
  });
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
 * order; hedged sequencing of two events is flagged as ambiguous.
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

    if (AMBIGUITY_CUES.some((cue) => sentence.text.toLowerCase().includes(cue))) {
      const key = `amb:${a.event.id}|${b.event.id}`;
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        ambiguities.push({ first: a, second: b, sentence });
      }
      continue;
    }

    const idxA = firstMentionIndex(sentence.text, a);
    const idxB = firstMentionIndex(sentence.text, b);
    if (idxA === -1 || idxB === -1 || idxA === idxB) continue;

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
