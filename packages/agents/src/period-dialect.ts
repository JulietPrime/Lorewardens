import type {
  AgentDescriptor,
  AnalyzeInput,
  CanonContext,
  CanonEntry,
  ContinuityAgent,
  Finding,
  Strictness,
  TextChunk,
} from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import { gateForAgent, sentences } from "./lexical.js";

// Period / Dialect / Language — flags diction that does not fit the story's
// established period: modern anachronisms and casual slang. The agent is
// gated entirely behind canon: it only speaks when a CONFIRMED rule or
// setting entry states a pre-1900 Earth-like period, and no confirmed entry
// declares modern language intentional. Every closed table below is fixed
// and documented; the agent does not invent vocabulary judgments.

// Closed pre-1900 period cue table: a four-digit year in the 1000s-1800s,
// or one of these period words (single words match on word boundaries).
const PERIOD_YEAR = /\b1[0-8]\d\d\b/;
const PERIOD_SINGLE_WORDS = [
  "medieval",
  "renaissance",
  "victorian",
  "georgian",
  "elizabethan",
  "ancient",
  "antiquity",
] as const;
const PERIOD_PHRASES = ["middle ages", "bronze age", "iron age"] as const;

// Closed modern-language-intent cue table: any confirmed entry carrying one
// of these switches the agent off for the project (writer said so).
const MODERN_INTENT_CUES = [
  "modern language",
  "modern speech",
  "deliberately anachronistic",
  "anachronistic language intentional",
] as const;

// Closed modern-anachronism table (spec).
const ANACHRONISM_WORDS = [
  "telephone",
  "phone",
  "computer",
  "laptop",
  "internet",
  "email",
  "television",
  "radio",
  "helicopter",
  "tank",
  "robot",
  "laser",
  "smartphone",
  "okay",
  "ok",
] as const;

// Closed casual-slang table (spec).
const SLANG_WORDS = ["gonna", "wanna", "gotta", "kinda", "sorta", "yeah", "nah", "yup", "nope"] as const;

function wordPresent(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function periodGateEntry(context: CanonContext): CanonEntry | undefined {
  const confirmed = context.entries.filter((e) => e.status === "confirmed");
  const modernIntent = confirmed.find((e) => MODERN_INTENT_CUES.some((cue) => e.text.toLowerCase().includes(cue)));
  if (modernIntent) return undefined;
  return confirmed.find(
    (e) =>
      (e.kind === "rule" || e.kind === "setting") &&
      (PERIOD_YEAR.test(e.text) ||
        PERIOD_SINGLE_WORDS.some((w) => wordPresent(e.text, w)) ||
        PERIOD_PHRASES.some((w) => e.text.toLowerCase().includes(w))),
  );
}

function wordsPresentIn(sentence: string, words: readonly string[]): string[] {
  return words.filter((w) => wordPresent(sentence, w));
}

export function periodDialectFindings(chunk: TextChunk, context: CanonContext, strictness: Strictness): Finding[] {
  const gate = periodGateEntry(context);
  if (!gate) return [];

  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences(chunk.text)) {
    const anachronisms = wordsPresentIn(sentence.text, ANACHRONISM_WORDS);
    if (anachronisms.length > 0) {
      const key = `a:${sentence.start}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push(
          makeFinding({
            agent: "period-dialect",
            category: "language",
            type: "period-anachronism",
            severity: gate.locked ? "major" : "minor",
            confidence: gate.locked ? 0.95 : 0.85,
            minStrictness: gate.locked ? "gentle" : "standard",
            message: `Modern anachronism '${anachronisms[0]}' against the confirmed period ('${gate.text}').`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [gate.id],
            suggestion: null,
          }),
        );
      }
    }

    const slang = wordsPresentIn(sentence.text, SLANG_WORDS);
    if (slang.length > 0) {
      const key = `s:${sentence.start}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push(
          makeFinding({
            agent: "period-dialect",
            category: "language",
            type: "period-register-mismatch",
            severity: "info",
            confidence: 0.7,
            minStrictness: "standard",
            message: `Register mismatch: casual slang '${slang[0]}' against the confirmed period's formal diction ('${gate.text}').`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [gate.id],
            suggestion: null,
          }),
        );
      }
    }
  }

  return gateForAgent(findings, strictness);
}

export function createPeriodDialectAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return periodDialectFindings(input.chunk, input.context, input.strictness);
    },
  };
}
