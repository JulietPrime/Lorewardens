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
import { gateForAgent, sentences, type Sentence } from "./lexical.js";

// Grammar / Mechanics — flags clear mechanical errors only: doubled words,
// stray whitespace before punctuation, doubled punctuation, and a lowercase
// standalone "i" or lowercase i-contraction. Never rewrites style or voice,
// and never comments on stylistic choices.
//
// Deliberately EXCLUDED, because incremental chunks legitimately end
// mid-sentence and these are style judgments rather than clear errors:
// - missing sentence-final punctuation
// - comma splices
// - passive voice

// Closed pattern table for this agent (deterministic, case rules noted).
const DOUBLED_WORD = /\b([a-z']+)\s+\1\b/i;
const SPACE_BEFORE_PUNCT = /\s+[,.;:!?]/;
const DOUBLED_COMMA = /,,/;
const DOUBLED_DOT = /(?<!\.)\.\.(?!\.)/;
const LOWERCASE_I_CONTRACTION = /\bi'(?:m|ve|ll|d)\b/;
const LOWERCASE_I = /\bi\b/;

interface MechanicalMatch {
  message: string;
}

function firstMechanicalMatch(sentence: string): MechanicalMatch | undefined {
  const doubled = sentence.match(DOUBLED_WORD);
  if (doubled) {
    return { message: `Doubled word '${doubled[1]}' — the same word appears twice in a row.` };
  }
  if (SPACE_BEFORE_PUNCT.test(sentence)) {
    return { message: "Whitespace before punctuation." };
  }
  if (DOUBLED_COMMA.test(sentence)) {
    return { message: "Doubled comma." };
  }
  if (DOUBLED_DOT.test(sentence)) {
    return { message: "Doubled period (an ellipsis is three dots, not two)." };
  }
  const contraction = sentence.match(LOWERCASE_I_CONTRACTION);
  if (contraction) {
    return { message: `Lowercase contraction '${contraction[0]}' — the pronoun 'i' should be capitalized.` };
  }
  if (LOWERCASE_I.test(sentence)) {
    return { message: "Standalone lowercase 'i' should be capitalized." };
  }
  return undefined;
}

function mechanicalFindings(chunk: TextChunk): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of sentences(chunk.text)) {
    const match = firstMechanicalMatch(sentence.text);
    if (!match) continue;
    findings.push(
      makeFinding({
        agent: "grammar-mechanics",
        category: "language",
        type: "grammar-mechanical-error",
        severity: "minor",
        confidence: 0.9,
        minStrictness: "gentle",
        message: match.message,
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
  return findings;
}

function heaviestQuoteSentence(chunkText: string): Sentence | undefined {
  const sents = sentences(chunkText);
  let best: Sentence | undefined;
  let bestCount = 0;
  for (const sentence of sents) {
    const count = (sentence.text.match(/"/g) ?? []).length;
    if (count > bestCount) {
      best = sentence;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Chunk-scoped check: an odd number of straight double quotes means dialogue
 * is probably left open. Incremental chunks often end mid-dialogue, which is
 * why this one is pinned at standard strictness instead of gentle.
 */
function unbalancedQuoteFindings(chunk: TextChunk): Finding[] {
  const total = (chunk.text.match(/"/g) ?? []).length;
  if (total % 2 === 0) return [];
  const sentence = heaviestQuoteSentence(chunk.text);
  if (!sentence) return [];
  return [
    makeFinding({
      agent: "grammar-mechanics",
      category: "language",
      type: "grammar-unbalanced-quotes",
      severity: "minor",
      confidence: 0.75,
      minStrictness: "standard",
      message:
        `Odd number of straight double quotes (${total}) in this chunk — dialogue may be left open. ` +
        `Incremental text often ends mid-dialogue, so this is a note, not an error.`,
      quote: sentence.text,
      location: {
        file: chunk.span.file,
        startOffset: chunk.span.startOffset + sentence.start,
        endOffset: chunk.span.startOffset + sentence.end,
      },
      canonRefs: [],
      suggestion: null,
    }),
  ];
}

export function grammarMechanicsFindings(chunk: TextChunk, _context: CanonContext, strictness: Strictness): Finding[] {
  const findings = [...mechanicalFindings(chunk), ...unbalancedQuoteFindings(chunk)];
  return gateForAgent(findings, strictness);
}

export function createGrammarMechanicsAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return grammarMechanicsFindings(input.chunk, input.context, input.strictness);
    },
  };
}
