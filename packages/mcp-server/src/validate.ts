const REQUIRED_FIELDS = [
  "id",
  "agent",
  "category",
  "type",
  "severity",
  "confidence",
  "minStrictness",
  "message",
  "quote",
  "location",
  "canonRefs",
  "suggestion",
  "createdAt",
] as const;

const SEVERITIES = new Set(["info", "minor", "major", "critical"]);
const MIN_STRICTNESS_LEVELS = new Set(["gentle", "standard", "strict"]);
const AGENT_IDS = new Set([
  "canon-lore",
  "character-consistency",
  "timeline",
  "grammar-mechanics",
  "vocabulary-repetition",
  "style-voice",
  "character-voice",
  "period-dialect",
  "plot-thread",
  "pacing-tension",
  "pov-consistency",
  "show-vs-tell",
  "sensitivity-representation",
  "theme-motif",
]);
const CATEGORIES = new Set(["canon", "character", "timeline", "language", "prose", "narrative", "optional"]);

export function validateFinding(finding: unknown): string[] {
  const problems: string[] = [];
  if (typeof finding !== "object" || finding === null) {
    return ["finding must be an object"];
  }
  const f = finding as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in f)) problems.push(`missing required field '${field}'`);
  }
  if (typeof f.id !== "string" || !f.id.startsWith("fnd_")) {
    problems.push("'id' must be a string starting with 'fnd_'");
  }
  if (typeof f.agent !== "string" || !AGENT_IDS.has(f.agent)) {
    problems.push(`'agent' must be one of ${[...AGENT_IDS].join(", ")}`);
  }
  if (typeof f.category !== "string" || !CATEGORIES.has(f.category)) {
    problems.push(`'category' must be one of ${[...CATEGORIES].join(", ")}`);
  }
  if (typeof f.type !== "string" || f.type.length === 0) {
    problems.push("'type' must be a non-empty string");
  }
  if (typeof f.severity !== "string" || !SEVERITIES.has(f.severity)) {
    problems.push(`'severity' must be one of ${[...SEVERITIES].join(", ")}`);
  }
  if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1) {
    problems.push("'confidence' must be a number between 0 and 1");
  }
  if (typeof f.minStrictness !== "string" || !MIN_STRICTNESS_LEVELS.has(f.minStrictness)) {
    problems.push(`'minStrictness' must be one of ${[...MIN_STRICTNESS_LEVELS].join(", ")}`);
  }
  if (typeof f.message !== "string" || f.message.length === 0) {
    problems.push("'message' must be a non-empty string");
  }
  if (typeof f.quote !== "string") {
    problems.push("'quote' must be a string");
  }
  const loc = f.location as Record<string, unknown> | undefined;
  if (typeof loc !== "object" || loc === null) {
    problems.push("'location' must be an object");
  } else {
    for (const field of ["file", "startOffset", "endOffset"] as const) {
      if (!(field in loc)) problems.push(`'location' is missing '${field}'`);
    }
    if (typeof loc.file !== "string" || loc.file.length === 0) {
      problems.push("'location.file' must be a non-empty string");
    }
    for (const field of ["startOffset", "endOffset"] as const) {
      if (typeof loc[field] !== "number" || !Number.isInteger(loc[field]) || (loc[field] as number) < 0) {
        problems.push(`'location.${field}' must be a non-negative integer`);
      }
    }
  }
  if (!Array.isArray(f.canonRefs) || f.canonRefs.some((r) => typeof r !== "string")) {
    problems.push("'canonRefs' must be an array of strings");
  }
  if (f.suggestion !== null && typeof f.suggestion !== "string") {
    problems.push("'suggestion' must be a string or null (advisory only, never applied)");
  }
  if (typeof f.createdAt !== "string" || Number.isNaN(Date.parse(f.createdAt))) {
    problems.push("'createdAt' must be an ISO-8601 date-time string");
  }
  return problems;
}

export function assertValidFindings(findings: unknown[]): void {
  for (const finding of findings) {
    const problems = validateFinding(finding);
    if (problems.length > 0) {
      throw new Error(
        `Finding does not match schemas/finding.schema.json: ${problems.join("; ")}. ` +
          `Offending finding: ${JSON.stringify(finding)}`,
      );
    }
  }
}
