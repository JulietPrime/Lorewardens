import type { Finding } from "@lorewardens/core";

export const COMMENT_MARKER = "🔎 Lorewardens";
export const HASH_LINE_PREFIX = "#lw:";

// Compact deterministic hash (FNV-1a over UTF-16 code units) of the fields
// that identify a finding for comment dedupe: agent, type, severity, exact
// location and quote.
export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function findingHash(
  finding: Pick<Finding, "agent" | "type" | "severity" | "quote" | "location">,
): string {
  const basis = JSON.stringify([
    finding.agent,
    finding.type,
    finding.severity,
    finding.location.startOffset,
    finding.location.endOffset,
    finding.quote,
  ]);
  return fnv1a32Hex(basis);
}

export function commentContentFor(finding: Finding): string {
  return [
    `${COMMENT_MARKER} · ${finding.agent} · ${finding.severity}`,
    `${finding.type}: ${finding.message}`,
    `${HASH_LINE_PREFIX}${findingHash(finding)}`,
  ].join("\n");
}

export function findingHashFromContent(content: string): string | null {
  const match = content.match(/#lw:([0-9a-f]{8})\s*$/);
  return match === null ? null : (match[1] as string);
}

export function isLorewardensComment(content: string | undefined): boolean {
  return typeof content === "string" && content.startsWith(COMMENT_MARKER);
}
