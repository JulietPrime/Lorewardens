import type { CanonContext, CanonSnapshot } from "./types.js";
import { capitalizedTokens, canonNamesOf, isStoplistedName, nameVariantOf, wholeWordTokens } from "./name-variants.js";

function wordTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Place-name evidence for the variant-drift guard: the capitalized
 * proper-noun tokens of every CONFIRMED setting entry, in snapshot order.
 * A sentence became a `setting` entry because a place cue noun was present,
 * so its capitalized whole-word tokens ([A-Za-z0-9'’]+ runs, possessives
 * stripped) are place-name evidence. Rules per token: appears capitalized
 * at least once in its entry text, length >= 4, not stoplisted.
 *
 * Order: first occurrence across confirmed setting entries in snapshot
 * order (deterministic; pinned by tests). Deduplication is
 * case-insensitive; the first CAPITALIZED occurrence's casing is kept, so
 * every stored form is a capitalized proper noun.
 */
function collectPlaceNames(snapshot: CanonSnapshot): string[] {
  const seen = new Map<string, string>();
  for (const entry of snapshot.entries) {
    if (entry.status !== "confirmed" || entry.kind !== "setting") continue;
    for (const token of wholeWordTokens(entry.text)) {
      if (!/^[A-Z]/.test(token)) continue;
      if (token.length < 4) continue;
      const lower = token.toLowerCase();
      if (seen.has(lower)) continue;
      if (isStoplistedName(token)) continue;
      seen.set(lower, token);
    }
  }
  return [...seen.values()];
}

export function selectRelevantContext(chunkText: string, snapshot: CanonSnapshot): CanonContext {
  const tokens = wordTokens(chunkText);
  const lower = chunkText.toLowerCase();
  const mentions = (name: string): boolean => tokens.has(name.toLowerCase()) || lower.includes(name.toLowerCase());
  // Variant-tolerant selection: a confirmed character also enters context
  // when any capitalized whole token of the chunk is a rule-table variant of
  // the character's name or one of its aliases (same closed table via
  // name-variants.ts — no forked logic).
  const chunkCapTokens = capitalizedTokens(chunkText);
  const characters = snapshot.characters.filter((c) => {
    if (c.status !== "confirmed") return false;
    if (mentions(c.name) || c.aliases.some(mentions)) return true;
    const names = canonNamesOf(c);
    return chunkCapTokens.some((t) => nameVariantOf(t, names) !== null);
  });
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
  return { entries, characters, events, placeNames: collectPlaceNames(snapshot) };
}
