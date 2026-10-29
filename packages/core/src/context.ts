import type { CanonContext, CanonSnapshot } from "./types.js";

function wordTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((t) => t.length > 1),
  );
}

export function selectRelevantContext(chunkText: string, snapshot: CanonSnapshot): CanonContext {
  const tokens = wordTokens(chunkText);
  const lower = chunkText.toLowerCase();
  const mentions = (name: string): boolean => tokens.has(name.toLowerCase()) || lower.includes(name.toLowerCase());
  const characters = snapshot.characters.filter(
    (c) => c.status === "confirmed" && (mentions(c.name) || c.aliases.some(mentions)),
  );
  const characterIds = new Set(characters.map((c) => c.id));
  const entries = snapshot.entries.filter(
    (e) =>
      e.status === "confirmed" &&
      (e.tags.some((t) => tokens.has(t.toLowerCase())) ||
        (e.locked && e.kind === "rule") ||
        e.kind === "rule"),
  );
  const events = snapshot.events.filter(
    (e) => e.status === "confirmed" && e.participants.some((p) => characterIds.has(p)),
  );
  return { entries, characters, events };
}
