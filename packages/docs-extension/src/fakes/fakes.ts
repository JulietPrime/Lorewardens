import type {
  DocsClient,
  DocsDocument,
  DocsParagraphElement,
  DocsStructuralElement,
  SnapshotStore,
} from "../lib/types.js";
import type { DriveComment, DriveCommentsClient, NewDriveComment } from "../lib/google/drive-comments.js";

// Synthetic documents.get payload: consecutive paragraphs with contiguous
// indices, each paragraph carrying one text run and a trailing newline
// position, the way the Docs API represents simple documents.
export function makeDoc(documentId: string, title: string, paragraphs: string[]): DocsDocument {
  const content: DocsStructuralElement[] = [];
  let index = 1;
  for (const paragraph of paragraphs) {
    const startIndex = index;
    const elements: DocsParagraphElement[] = [];
    if (paragraph.length > 0) {
      elements.push({
        startIndex: index,
        endIndex: index + paragraph.length,
        textRun: { content: paragraph },
      });
      index += paragraph.length;
    }
    const endIndex = index + 1;
    content.push({ startIndex, endIndex, paragraph: { elements } });
    index = endIndex;
  }
  return { documentId, title, body: { content } };
}

export class FakeDocsClient implements DocsClient {
  private readonly documents = new Map<string, DocsDocument>();

  constructor(documents: DocsDocument[]) {
    for (const doc of documents) this.documents.set(doc.documentId, doc);
  }

  set(doc: DocsDocument): void {
    this.documents.set(doc.documentId, doc);
  }

  async getDocument(documentId: string): Promise<DocsDocument> {
    const doc = this.documents.get(documentId);
    if (doc === undefined) throw new Error(`unknown document '${documentId}'`);
    return doc;
  }
}

export class FakeDriveComments implements DriveCommentsClient {
  readonly byFile = new Map<string, DriveComment[]>();
  private nextId = 1;

  constructor(seed: { fileId: string; comments: DriveComment[] }[] = []) {
    for (const entry of seed) this.byFile.set(entry.fileId, [...entry.comments]);
  }

  add(fileId: string, comment: DriveComment): void {
    const list = this.byFile.get(fileId) ?? [];
    list.push(comment);
    this.byFile.set(fileId, list);
  }

  async list(fileId: string): Promise<DriveComment[]> {
    return [...(this.byFile.get(fileId) ?? [])].filter((c) => c.deleted !== true);
  }

  async create(fileId: string, comment: NewDriveComment): Promise<DriveComment> {
    const created: DriveComment = {
      id: `c${this.nextId}`,
      content: comment.content,
      ...(comment.anchor !== undefined ? { anchor: comment.anchor } : {}),
      quotedFileContent: { value: comment.quotedFileContent?.value ?? "" },
      author: { me: true },
    };
    this.nextId += 1;
    this.add(fileId, created);
    return created;
  }

  async patch(fileId: string, commentId: string, fields: { content?: string }): Promise<DriveComment> {
    const list = this.byFile.get(fileId) ?? [];
    const comment = list.find((c) => c.id === commentId);
    if (comment === undefined) throw new Error(`unknown comment '${commentId}'`);
    if (fields.content !== undefined) comment.content = fields.content;
    return comment;
  }

  async delete(fileId: string, commentId: string): Promise<void> {
    const list = this.byFile.get(fileId) ?? [];
    const comment = list.find((c) => c.id === commentId);
    if (comment === undefined) throw new Error(`unknown comment '${commentId}'`);
    comment.deleted = true;
  }
}

export class FakeSnapshotStore implements SnapshotStore {
  readonly data = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}
