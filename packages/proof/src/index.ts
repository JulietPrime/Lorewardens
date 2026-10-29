import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const PROOF_TASK = "prove-agents-catch-seeded-errors";
export const MANUSCRIPT_RELATIVE_PATH = "manuscript/ch4.md";
export const MANUSCRIPT_FILE_LABEL = MANUSCRIPT_RELATIVE_PATH;

export interface ManuscriptParagraph {
  text: string;
  startOffset: number;
  endOffset: number;
}

export function defaultFixturesDir(): string {
  return fileURLToPath(new URL("../../fixtures", import.meta.url));
}

export function manuscriptPath(fixturesDir: string): string {
  return `${fixturesDir.replace(/\/$/, "")}/${MANUSCRIPT_RELATIVE_PATH}`;
}

/**
 * Loads the seeded chapter and computes each paragraph's real file-relative
 * offsets (paragraphs are separated by blank lines). The proof suite feeds
 * every seeded paragraph to the MCP tool path as its own changed chunk, so a
 * finding's offsets must slice exactly from the manuscript file on disk.
 */
export function loadManuscript(fixturesDir: string): {
  content: string;
  paragraphs: ManuscriptParagraph[];
} {
  const content = readFileSync(manuscriptPath(fixturesDir), "utf8");
  const paragraphs: ManuscriptParagraph[] = [];
  let cursor = 0;
  for (const raw of content.split("\n\n")) {
    const text = raw.trim();
    if (text.length > 0) {
      const startOffset = cursor + (raw.length - raw.trimStart().length);
      paragraphs.push({ text, startOffset, endOffset: startOffset + text.length });
    }
    cursor += raw.length + 2;
  }
  return { content, paragraphs };
}
