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
import { gateForAgent } from "./lexical.js";
import { firstCue, hasCue, narrationSentences } from "./narrative-helpers.js";
import { canonClaimsTerm } from "./light-helpers.js";

// ---------------------------------------------------------------------------
// Sensitivity / Representation — advisory notes, narration only.
//
// One of the three OPTIONAL agents: off by default, enabled only by writer
// project settings. The agent observes essentialist or dehumanizing phrasing
// about real groups in the narration and reports the pattern; it is advisory
// only — messages describe what the text does, suggestion is null everywhere,
// and nothing prescribes content changes. The writer owns every creative
// decision, including how characters speak: quoted dialogue is excluded.
//
// Guards (all unit-tested):
// - Narration only — a sentence carrying any quoted span is excluded.
// - Fictional-culture guard — if the matched group term appears in any
//   confirmed canon entry text or confirmed character name/alias, the agent
//   stays silent: the term belongs to the writer's fictional world, and
//   locked world rules are never treated as violations.
// - Real groups only, by lexicon construction: REAL_GROUP_TERMS is a closed
//   list of generic human-group nouns; there is no fictional-group detection.
//
// v1 limit, documented deliberately: the phrase table and group lexicon below
// are closed, narrow and conservative. This agent is not an ethics engine and
// does not fake broader coverage; a finding means "this pattern appeared",
// never "this book is offensive".
// ---------------------------------------------------------------------------

// Closed essentialist/dehumanizing phrase table (~8). Matched on word
// boundaries, case-insensitive; multi-word phrases allow whitespace runs.
export const STEREOTYPE_PHRASES: readonly string[] = [
  "those people",
  "one of the good ones",
  "they are all the same",
  "not like the rest of them",
  "people like that",
  "their kind",
  "all of them are",
  "the sort of people who",
];

// Closed lexicon of generic human-group nouns (~12). Real groups only, by
// construction: no fictional group names are inferred.
export const REAL_GROUP_TERMS: readonly string[] = [
  "men",
  "women",
  "boys",
  "girls",
  "elders",
  "strangers",
  "outsiders",
  "foreigners",
  "villagers",
  "townsfolk",
  "old people",
  "young people",
];

// Closed essentialist frames over which a group term is generalized.
const ESSENTIALIST_FRAMES: readonly string[] = ["all", "every", "always", "never"];

function stereotypePhraseFindings(chunk: TextChunk, narration: ReturnType<typeof narrationSentences>): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of narration) {
    const phrase = firstCue(sentence.text, STEREOTYPE_PHRASES);
    if (!phrase) continue;
    findings.push(
      makeFinding({
        agent: "sensitivity-representation",
        category: "optional",
        type: "sensitivity-stereotype-phrase",
        severity: "minor",
        confidence: 0.9,
        minStrictness: "gentle",
        message: `The narration describes people with the essentialist phrase ('${phrase}'). Advisory note: it names the observed pattern, not a required change; the writer owns the decision.`,
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

function broadBrushFindings(
  chunk: TextChunk,
  narration: ReturnType<typeof narrationSentences>,
  context: CanonContext,
): Finding[] {
  const findings: Finding[] = [];
  for (const sentence of narration) {
    const frame = firstCue(sentence.text, ESSENTIALIST_FRAMES);
    if (!frame) continue;
    const term = REAL_GROUP_TERMS.find((group) => hasCue(sentence.text, [group]) && !canonClaimsTerm(group, context));
    if (!term) continue;
    findings.push(
      makeFinding({
        agent: "sensitivity-representation",
        category: "optional",
        type: "sensitivity-broad-brush",
        severity: "info",
        confidence: 0.7,
        minStrictness: "standard",
        message: `The narration generalizes about ${term} with the essentialist frame ('${frame}'). Advisory note: it names the observed pattern, not a required change; the writer owns the decision.`,
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

export function sensitivityFindings(chunk: TextChunk, context: CanonContext, strictness: Strictness): Finding[] {
  const narration = narrationSentences(chunk.text);
  const findings = [...stereotypePhraseFindings(chunk, narration), ...broadBrushFindings(chunk, narration, context)];
  return gateForAgent(findings, strictness);
}

export function createSensitivityRepresentationAgent(descriptor: AgentDescriptor): ContinuityAgent {
  return {
    id: descriptor.id,
    descriptor,
    async analyze(input: AnalyzeInput): Promise<Finding[]> {
      return sensitivityFindings(input.chunk, input.context, input.strictness);
    },
  };
}
