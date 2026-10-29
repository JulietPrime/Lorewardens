import type {
  AgentDescriptor,
  AnalyzeInput,
  CanonContext,
  ContinuityAgent,
  Finding,
  Strictness,
  TextChunk,
} from "@lorewardens/core";
import { makeFinding } from "@lorewardens/core";
import { gateForAgent, sentences } from "./lexical.js";

// Style / Voice Consistency — chunk-internal observations about the writer's
// own established voice: a sudden sentence-length outlier against the
// passage's median rhythm, or a contraction-driven formality shift between
// the two halves of a longer passage. The baseline is whatever the chunk
// itself establishes; no canon anchor, no external style is imposed.

// Word-final contraction list (same list the character-voice agent uses).
const CONTRACTION = /(?:n't|'re|'ve|'ll|'m|'d)\b/g;

function wordCount(sentence: string): number {
  return sentence.trim().split(/\s+/).length;
}

function contractionCount(sentence: string): number {
  return (sentence.toLowerCase().match(CONTRACTION) ?? []).length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function styleVoiceFindings(chunk: TextChunk, _context: CanonContext, strictness: Strictness): Finding[] {
  const findings: Finding[] = [];
  const sents = sentences(chunk.text);

  if (sents.length >= 4) {
    const med = median(sents.map((s) => wordCount(s.text)));
    for (const sentence of sents) {
      const count = wordCount(sentence.text);
      if (count >= 3 * med && count >= 20) {
        findings.push(
          makeFinding({
            agent: "style-voice",
            category: "prose",
            type: "style-rhythm-shift",
            severity: "info",
            confidence: 0.55,
            minStrictness: "strict",
            message: `This sentence runs ${count} words against a passage median of ${med} — the rhythm breaks inside this chunk.`,
            quote: sentence.text,
            location: {
              file: chunk.span.file,
              startOffset: chunk.span.startOffset + sentence.start,
              endOffset: chunk.span.startOffset + sentence.end,
            },
            canonRefs: [],
            suggestion: null,
          }),
        );
      }
    }
  }

  if (sents.length >= 8) {
    const mid = Math.floor(sents.length / 2);
    const firstCount = sents.slice(0, mid).reduce((sum, s) => sum + contractionCount(s.text), 0);
    const secondCount = sents.slice(mid).reduce((sum, s) => sum + contractionCount(s.text), 0);
    let deviantStart: number | undefined;
    let deviantCount: number | undefined;
    let otherCount: number | undefined;
    if (firstCount >= 3 && firstCount - secondCount >= 3 && secondCount <= 1) {
      deviantStart = 0;
      deviantCount = firstCount;
      otherCount = secondCount;
    } else if (secondCount >= 3 && secondCount - firstCount >= 3 && firstCount <= 1) {
      deviantStart = mid;
      deviantCount = secondCount;
      otherCount = firstCount;
    }
    if (deviantStart !== undefined && deviantCount !== undefined && otherCount !== undefined) {
      const sentence = sents[deviantStart];
      findings.push(
        makeFinding({
          agent: "style-voice",
          category: "prose",
          type: "style-formality-shift",
          severity: "info",
          confidence: 0.7,
          minStrictness: "standard",
          message:
            `Contraction use shifts here: ${deviantCount} contractions in this half of the passage ` +
            `against ${otherCount} in the other — the formality of the voice changes mid-chunk.`,
          quote: sentence.text,
          location: {
            file: chunk.span.file,
            startOffset: chunk.span.startOffset + sentence.start,
            endOffset: chunk.span.startOffset + sentence.end,
          },
          canonRefs: [],
          suggestion: null,
        }),
      );
    }
  }

  return gateForAgent(findings, strictness);
}

export function createStyleVoiceAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return styleVoiceFindings(input.chunk, input.context, input.strictness);
    },
  };
}
