// Longest common prefix/suffix diff against the last snapshot, then region
// expansion to enclosing paragraph boundaries with a minimum context window
// so chunk-internal agents (pacing, POV distance) still see enough text.

export const MIN_CONTEXT_CHARS = 1200;

export interface TextRegion {
  start: number;
  end: number;
}

export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export function commonSuffixLength(a: string, b: string, cap?: number): number {
  const max = Math.min(cap ?? a.length, a.length, b.length);
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

// The changed region in the CURRENT text. Pure deletions yield an empty
// region ({start, start}); callers still re-snapshot and expansion grows it
// to the surrounding paragraphs. Identical texts yield null.
export function changedRegion(previous: string, current: string): TextRegion | null {
  if (previous === current) return null;
  const prefix = commonPrefixLength(previous, current);
  const suffix = commonSuffixLength(previous, current, Math.min(previous.length, current.length) - prefix);
  const start = prefix;
  const end = current.length - suffix;
  if (start > end) return null;
  return { start, end };
}

export function paragraphStartBefore(text: string, pos: number): number {
  if (pos <= 0) return 0;
  const i = text.lastIndexOf("\n", pos - 1);
  return i === -1 ? 0 : i + 1;
}

export function paragraphEndAfter(text: string, pos: number): number {
  const i = text.indexOf("\n", pos);
  return i === -1 ? text.length : i + 1;
}

export function expandToParagraphContext(
  text: string,
  region: TextRegion,
  minContext: number = MIN_CONTEXT_CHARS,
): TextRegion {
  if (text.length === 0) return { start: 0, end: 0 };
  let start = paragraphStartBefore(text, region.start);
  let end = paragraphEndAfter(text, region.end);
  let growBack = true;
  while (end - start < minContext && (start > 0 || end < text.length)) {
    if (growBack && start > 0) {
      const back = start - 1;
      start = back <= 0 ? 0 : paragraphStartBefore(text, back);
    } else if (end < text.length) {
      end = paragraphEndAfter(text, end);
    } else if (start > 0) {
      const back = start - 1;
      start = back <= 0 ? 0 : paragraphStartBefore(text, back);
    }
    growBack = !growBack;
  }
  return { start, end };
}
