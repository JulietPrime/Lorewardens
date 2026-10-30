export interface DocsTextRun {
  content: string;
}

export interface DocsAutoText {
  content?: string;
}

export interface DocsParagraphElement {
  startIndex: number;
  endIndex: number;
  textRun?: DocsTextRun;
  autoText?: DocsAutoText;
  pageBreak?: Record<string, never>;
  horizontalRule?: Record<string, never>;
  columnBreak?: Record<string, never>;
  inlineObjectElement?: Record<string, never>;
  footnoteReference?: Record<string, never>;
}

export interface DocsParagraph {
  startIndex: number;
  endIndex: number;
  paragraph: {
    elements?: DocsParagraphElement[];
    paragraphStyle?: { namedStyleType?: string };
  };
}

export interface DocsTableCell {
  content?: DocsStructuralElement[];
}

export interface DocsTable {
  startIndex: number;
  endIndex: number;
  table: {
    rows: number;
    columns: number;
    tableRows?: { tableCells?: DocsTableCell[] }[];
  };
}

export interface DocsTableOfContents {
  startIndex: number;
  endIndex: number;
  tableOfContents: {
    content?: DocsStructuralElement[];
  };
}

export interface DocsSectionBreak {
  startIndex?: number;
  endIndex: number;
  sectionBreak: Record<string, never>;
}

export type DocsStructuralElement = DocsParagraph | DocsTable | DocsTableOfContents | DocsSectionBreak;

export interface DocsBody {
  content?: DocsStructuralElement[];
}

export interface DocsTabProperties {
  tabId?: string;
  title?: string;
  index?: number;
}

export interface DocsTab {
  tabProperties?: DocsTabProperties;
  documentTab?: {
    body?: DocsBody;
  };
}

export interface DocsDocument {
  documentId: string;
  title?: string;
  body?: DocsBody;
  tabs?: DocsTab[];
}

export interface ExtractedDoc {
  documentId: string;
  title: string;
  text: string;
  indexMap: number[];
  isMultiTab: boolean;
  tabCount: number;
  tabId?: string;
}

export interface DocsClient {
  getDocument(documentId: string): Promise<DocsDocument>;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<FetchResponseLike>;

export interface SnapshotStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}
