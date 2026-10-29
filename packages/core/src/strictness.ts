import type { Finding, Strictness } from "./types.js";

export const STRICTNESS_ORDER: Record<Strictness, number> = {
  off: 0,
  gentle: 1,
  standard: 2,
  strict: 3,
};

export const STRICTNESS_CONFIDENCE_FLOOR: Record<Exclude<Strictness, "off">, number> = {
  gentle: 0.9,
  standard: 0.7,
  strict: 0.4,
};

export function atLeastStrictness(a: Strictness, b: Strictness): boolean {
  return STRICTNESS_ORDER[a] >= STRICTNESS_ORDER[b];
}

export function surfacesAt(finding: Finding, projectStrictness: Strictness): boolean {
  if (projectStrictness === "off") return false;
  if (STRICTNESS_ORDER[projectStrictness] < STRICTNESS_ORDER[finding.minStrictness]) return false;
  return finding.confidence >= STRICTNESS_CONFIDENCE_FLOOR[projectStrictness];
}
