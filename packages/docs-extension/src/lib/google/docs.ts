import type {
  DocsClient,
  DocsDocument,
  DocsParagraphElement,
  DocsStructuralElement,
  ExtractedDoc,
  FetchLike,
  FetchResponseLike,
} from "../types.js";

export const DOCS_API_BASE = "https://docs.googleapis.com/v1/documents";

// Index-driven walker for documents.get: every local character records the
// Docs index (1-based UTF-16 code units) it came from. Gaps between text
// runs — paragraph separators, empty paragraphs, table boundaries — become
// "\n" mapped to their real doc indices; no index convention is hard-coded
// and no character is fabricated. First tab only: tabbed documents set
// isMultiTab so the sidebar can warn (documented v1 limit).
export function extractDocText(doc: DocsDocument): ExtractedDoc {
  const parts: string[] = [];
  const indexMap: number[] = [];
  let expected = 0;

  const pushChar = (docIndex: number, ch: string): void => {
    parts.push(ch);
    indexMap.push(docIndex);
  };

  const fillGap = (from: number, to: number): void => {
    for (let i = from; i < to; i++) pushChar(i, "\n");
  };

  const appendRun = (startIndex: number, content: string): void => {
    for (let i = 0; i < content.length; i++) pushChar(startIndex + i, content[i]);
    expected = startIndex + content.length;
  };

  const visitStructural = (elements: DocsStructuralElement[]): void => {
    for (const el of elements) {
      if ("paragraph" in el) {
        let lastEnd: number | null = null;
        for (const pe of el.paragraph.elements ?? []) {
          if (typeof pe.startIndex !== "number" || typeof pe.endIndex !== "number") continue;
          const content = paragraphElementContent(pe as DocsParagraphElement);
          if (content === null) {
            lastEnd = pe.endIndex;
            continue;
          }
          if (lastEnd === null && pe.startIndex > expected) fillGap(expected, pe.startIndex);
          appendRun(pe.startIndex, content);
          lastEnd = pe.endIndex;
        }
        if (lastEnd === null && typeof el.endIndex === "number") {
          fillGap(expected, el.endIndex);
          expected = el.endIndex;
        }
      } else if ("table" in el) {
        for (const row of el.table.tableRows ?? []) {
          for (const cell of row.tableCells ?? []) {
            visitStructural(cell.content ?? []);
          }
        }
      } else if ("tableOfContents" in el) {
        visitStructural(el.tableOfContents.content ?? []);
      }
    }
  };

  visitStructural(doc.body?.content ?? []);

  const tabs = doc.tabs ?? [];
  const firstTabId = tabs[0]?.tabProperties?.tabId;
  return {
    documentId: doc.documentId,
    title: doc.title ?? "",
    text: parts.join(""),
    indexMap,
    isMultiTab: tabs.length > 1,
    tabCount: Math.max(tabs.length, 1),
    ...(firstTabId !== undefined ? { tabId: firstTabId } : {}),
  };
}

function paragraphElementContent(el: DocsParagraphElement): string | null {
  if (el.textRun && typeof el.textRun.content === "string") return el.textRun.content;
  if (el.autoText && typeof el.autoText.content === "string") return el.autoText.content;
  return null;
}

// Maps a finding's local text range onto Docs document indices for the
// comment anchor. Returns null for empty or out-of-bounds ranges.
export function docRangeFor(
  startOffset: number,
  endOffset: number,
  extracted: ExtractedDoc,
): { start: number; end: number } | null {
  if (!Number.isInteger(startOffset) || !Number.isInteger(endOffset)) return null;
  if (startOffset < 0 || endOffset <= startOffset) return null;
  if (startOffset >= extracted.indexMap.length) return null;
  const last = Math.min(endOffset - 1, extracted.indexMap.length - 1);
  return { start: extracted.indexMap[startOffset], end: extracted.indexMap[last] + 1 };
}

export class DocsApi implements DocsClient {
  private readonly fetchLike: FetchLike;
  private readonly tokenProvider: () => Promise<string>;

  constructor(deps: { tokenProvider: () => Promise<string>; fetchLike?: FetchLike }) {
    this.tokenProvider = deps.tokenProvider;
    this.fetchLike = deps.fetchLike ?? defaultFetch;
  }

  async getDocument(documentId: string): Promise<DocsDocument> {
    const token = await this.tokenProvider();
    const response = await this.fetchLike(`${DOCS_API_BASE}/${encodeURIComponent(documentId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`documents.get failed with HTTP ${response.status}`);
    }
    return (await response.json()) as DocsDocument;
  }
}

function defaultFetch(input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchResponseLike> {
  return fetch(input, init) as unknown as Promise<FetchResponseLike>;
}
