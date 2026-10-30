import type { FetchLike, FetchResponseLike } from "../types.js";

export const DRIVE_COMMENTS_BASE = "https://www.googleapis.com/drive/v3/files";

export interface DriveCommentAuthor {
  me?: boolean;
  displayName?: string;
  emailAddress?: string;
}

export interface DriveComment {
  id: string;
  content?: string;
  anchor?: string;
  deleted?: boolean;
  resolved?: boolean;
  author?: DriveCommentAuthor;
  quotedFileContent?: { value?: string; mimeType?: string };
}

export interface NewDriveComment {
  content: string;
  anchor?: string;
  quotedFileContent?: { value: string };
}

export interface DriveCommentsClient {
  list(fileId: string): Promise<DriveComment[]>;
  create(fileId: string, comment: NewDriveComment): Promise<DriveComment>;
  patch(fileId: string, commentId: string, fields: { content?: string }): Promise<DriveComment>;
  delete(fileId: string, commentId: string): Promise<void>;
}

export interface DocsRangeAnchor {
  start: number;
  end: number;
  tabId?: string;
  revision?: string;
}

// Drive stores the anchor as an opaque JSON string; for Docs files the
// range shape below carries 1-based UTF-16 indices and an optional tab id.
// Payload spellings are verified against live Google behavior at the gated
// OAuth E2E (google-oauth-credentials-v1); the shape lives only here.
export function buildAnchor(anchor: DocsRangeAnchor): string {
  return JSON.stringify({
    r: anchor.revision ?? "head",
    a: [
      {
        start: anchor.start,
        end: anchor.end,
        ...(anchor.tabId !== undefined ? { ti: anchor.tabId } : {}),
      },
    ],
  });
}

export class DriveCommentsApi implements DriveCommentsClient {
  private readonly fetchLike: FetchLike;
  private readonly tokenProvider: () => Promise<string>;

  constructor(deps: { tokenProvider: () => Promise<string>; fetchLike?: FetchLike }) {
    this.tokenProvider = deps.tokenProvider;
    this.fetchLike = deps.fetchLike ?? defaultFetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.tokenProvider();
    const response = await this.fetchLike(`${DRIVE_COMMENTS_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new Error(`Drive comments ${method} failed with HTTP ${response.status}`);
    }
    if (method === "DELETE") {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  async list(fileId: string): Promise<DriveComment[]> {
    const comments: DriveComment[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({
        fields: "*",
        pageSize: "100",
        ...(pageToken !== undefined ? { pageToken } : {}),
      });
      const page = await this.call<{ comments?: DriveComment[]; nextPageToken?: string }>(
        "GET",
        `/${encodeURIComponent(fileId)}/comments?${query.toString()}`,
      );
      comments.push(...(page.comments ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken !== undefined && pageToken !== "");
    return comments;
  }

  create(fileId: string, comment: NewDriveComment): Promise<DriveComment> {
    return this.call<DriveComment>("POST", `/${encodeURIComponent(fileId)}/comments?fields=*`, comment);
  }

  patch(fileId: string, commentId: string, fields: { content?: string }): Promise<DriveComment> {
    return this.call<DriveComment>(
      "PATCH",
      `/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}?fields=*`,
      fields,
    );
  }

  async delete(fileId: string, commentId: string): Promise<void> {
    await this.call<void>("DELETE", `/${encodeURIComponent(fileId)}/comments/${encodeURIComponent(commentId)}`);
  }
}

function defaultFetch(input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchResponseLike> {
  return fetch(input, init) as unknown as Promise<FetchResponseLike>;
}
