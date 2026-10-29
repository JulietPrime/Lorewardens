import type { AgentDescriptor, AnalyzeInput, CanonContext, CanonEntry, ContinuityAgent, Finding, Strictness, TextChunk } from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import {
  aboutStatement,
  antonymConflict,
  contentWords,
  gateForAgent,
  hasNegation,
  numericConflict,
  sentences,
  type Sentence,
} from "./lexical.js";

export type CanonLoreOptions = { objectLocationChecks?: boolean };

const LOCATION_BINDING =
  /\b(rests|sits|stands|hangs|lies|is kept|is stored|is located)\s+(in|on|at|inside|under|within)\s+(?:the |his |her |their |its )?([a-z' ]+)/i;

const RELOCATION_CUES = ["now", "moved", "lay", "left", "brought", "set down", "no longer"] as const;

type Reason =
  | { kind: "antonym"; word: string; opposite: string }
  | { kind: "negation" }
  | { kind: "numeric"; canon: number; text: number };

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
        : `it states ${reason.text} where canon states ${reason.canon}`;
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
 * Deterministic contradiction detection between the chunk and confirmed canon
 * entries: antonym conflicts, negation of an affirmed statement, and numeric
 * conflicts with a shared unit word. A smarter matcher can replace this later.
 */
export function detectCanonContradictions(chunk: TextChunk, context: CanonContext): Detection[] {
  const detections: Detection[] = [];
  const seen = new Set<string>();

  for (const entry of context.entries) {
    if (entry.status !== "confirmed") continue;
    for (const sentence of sentences(chunk.text)) {
      if (!aboutStatement(sentence.text, entry.text)) continue;
      const key = `${entry.id}:${sentence.start}`;
      if (seen.has(key)) continue;

      const antonym = antonymConflict(entry.text, sentence.text);
      if (antonym) {
        seen.add(key);
        detections.push({ entry, reason: { kind: "antonym", word: antonym.word, opposite: antonym.opposite }, sentence });
        continue;
      }

      const negated = hasNegation(sentence.text) !== hasNegation(entry.text);
      if (negated) {
        seen.add(key);
        detections.push({ entry, reason: { kind: "negation" }, sentence });
        continue;
      }

      const numeric = numericConflict(entry.text, sentence.text);
      if (numeric) {
        seen.add(key);
        detections.push({ entry, reason: { kind: "numeric", canon: numeric.canon, text: numeric.text }, sentence });
      }
    }
  }
  return detections;
}

/**
 * Strict optional check (objectLocationChecks): flags important objects or
 * locations that the chunk moves contrary to where canon keeps them.
 */
export function detectLocationDrift(chunk: TextChunk, context: CanonContext): Detection[] {
  const bindings: { entry: CanonEntry; placeStems: Set<string> }[] = [];
  for (const entry of context.entries) {
    if (entry.status !== "confirmed") continue;
    const match = entry.text.match(LOCATION_BINDING);
    if (match) bindings.push({ entry, placeStems: new Set(contentWords(match[3])) });
  }
  if (bindings.length < 1) return [];

  const detections: Detection[] = [];
  for (const sentence of sentences(chunk.text)) {
    const lower = sentence.text.toLowerCase();
    const relocating = RELOCATION_CUES.some((cue) => lower.includes(cue));
    if (!relocating) continue;
    for (const binding of bindings) {
      const objectKey = binding.entry.tags[0];
      if (!objectKey || !lower.includes(objectKey.toLowerCase())) continue;
      const sentenceStems = new Set(contentWords(sentence.text));
      let movedTo: string | undefined;
      for (const other of bindings) {
        if (other.entry.id === binding.entry.id) continue;
        for (const stem of other.placeStems) {
          if (sentenceStems.has(stem) && !binding.placeStems.has(stem)) {
            movedTo = stem;
            break;
          }
        }
        if (movedTo) break;
      }
      if (movedTo) {
        detections.push({ entry: binding.entry, reason: { kind: "antonym", word: movedTo, opposite: movedTo }, sentence });
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
    const isDrift = reason.kind === "antonym" && reason.word === reason.opposite;
    findings.push(
      makeFinding({
        agent: "canon-lore",
        category: "canon",
        type: isDrift ? "canon-location-drift" : "canon-contradiction",
        severity: isDrift ? "info" : severityFor(entry),
        confidence: isDrift ? 0.55 : confidenceFor(entry),
        minStrictness: isDrift ? "strict" : minStrictnessFor(entry),
        message: isDrift
          ? `Canon places '${entry.tags[0]}' elsewhere ("${entry.text}"); the passage relocates it.`
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
