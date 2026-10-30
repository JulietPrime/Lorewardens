import type { Finding, Strictness } from "@lorewardens/core";
import type { BridgeClient } from "./bridge-client.js";
import { findingHash, findingHashFromContent, commentContentFor, isLorewardensComment } from "./comments.js";
import type { TextRegion } from "./diff.js";
import { changedRegion, expandToParagraphContext } from "./diff.js";
import { docRangeFor, extractDocText } from "./google/docs.js";
import { buildAnchor, type DriveCommentsClient } from "./google/drive-comments.js";
import type { DocsClient, ExtractedDoc, SnapshotStore } from "./types.js";

export interface CheckDeps {
  docs: DocsClient;
  comments: DriveCommentsClient;
  bridge: BridgeClient;
  snapshots: SnapshotStore;
}

export interface CheckParams {
  documentId: string;
  projectId: string;
  strictness?: Strictness;
}

export interface CheckOutcome {
  ran: boolean;
  reason?: string;
  findings: Finding[];
  posted: number;
  skippedExisting: number;
  invokedAgents: string[];
  region?: TextRegion;
  multiTab: boolean;
}

export function snapshotKey(documentId: string): string {
  return `lorewardens.snapshot.${documentId}`;
}

export async function listOwnHashes(comments: DriveCommentsClient, fileId: string): Promise<Set<string>> {
  const hashes = new Set<string>();
  for (const comment of await comments.list(fileId)) {
    if (comment.deleted === true) continue;
    if (!isLorewardensComment(comment.content)) continue;
    const hash = findingHashFromContent(comment.content ?? "");
    if (hash !== null) hashes.add(hash);
  }
  return hashes;
}

export interface CommentPostResult {
  posted: number;
  skippedExisting: number;
}

// Non-destructive by construction: the only write surface is comments.create.
// The document's text is never edited, nothing is resolved, and dedupe skips
// findings whose compact hash already exists among our own marker comments.
export async function postFindingsAsComments(
  comments: DriveCommentsClient,
  fileId: string,
  extracted: ExtractedDoc,
  findings: Finding[],
): Promise<CommentPostResult> {
  const existing = await listOwnHashes(comments, fileId);
  let posted = 0;
  let skippedExisting = 0;
  for (const finding of findings) {
    const hash = findingHash(finding);
    if (existing.has(hash)) {
      skippedExisting += 1;
      continue;
    }
    const range = docRangeFor(finding.location.startOffset, finding.location.endOffset, extracted);
    await comments.create(fileId, {
      content: commentContentFor(finding),
      ...(range !== null ? { anchor: buildAnchor({ start: range.start, end: range.end, tabId: extracted.tabId }) } : {}),
      quotedFileContent: { value: finding.quote },
    });
    existing.add(hash);
    posted += 1;
  }
  return { posted, skippedExisting };
}

export async function clearLorewardensComments(
  comments: DriveCommentsClient,
  fileId: string,
): Promise<number> {
  let deleted = 0;
  for (const comment of await comments.list(fileId)) {
    if (comment.deleted === true) continue;
    if (!isLorewardensComment(comment.content)) continue;
    if (comment.author !== undefined && comment.author.me === false) continue;
    await comments.delete(fileId, comment.id);
    deleted += 1;
  }
  return deleted;
}

export async function runFullCheck(deps: CheckDeps, params: CheckParams): Promise<CheckOutcome> {
  const doc = await deps.docs.getDocument(params.documentId);
  const extracted = extractDocText(doc);
  const response = await deps.bridge.analyze({
    projectId: params.projectId,
    text: extracted.text,
    spanStart: 0,
    ...(params.strictness !== undefined ? { strictness: params.strictness } : {}),
    title: extracted.title,
  });
  const post = await postFindingsAsComments(deps.comments, params.documentId, extracted, response.findings);
  await deps.snapshots.set(snapshotKey(params.documentId), extracted.text);
  return {
    ran: true,
    findings: response.findings,
    posted: post.posted,
    skippedExisting: post.skippedExisting,
    invokedAgents: response.invokedAgents,
    multiTab: extracted.isMultiTab,
  };
}

export async function runIncrementalCheck(deps: CheckDeps, params: CheckParams): Promise<CheckOutcome> {
  const doc = await deps.docs.getDocument(params.documentId);
  const extracted = extractDocText(doc);
  const key = snapshotKey(params.documentId);
  const previous = await deps.snapshots.get(key);
  if (previous === undefined) {
    await deps.snapshots.set(key, extracted.text);
    return {
      ran: false,
      reason: "first observation: snapshot stored, run a full check for a whole-document pass",
      findings: [],
      posted: 0,
      skippedExisting: 0,
      invokedAgents: [],
      multiTab: extracted.isMultiTab,
    };
  }
  const region = changedRegion(previous, extracted.text);
  if (region === null) {
    return {
      ran: false,
      reason: "document unchanged since the last analysis",
      findings: [],
      posted: 0,
      skippedExisting: 0,
      invokedAgents: [],
      multiTab: extracted.isMultiTab,
    };
  }
  const expanded = expandToParagraphContext(extracted.text, region);
  const text = extracted.text.slice(expanded.start, expanded.end);
  await deps.snapshots.set(key, extracted.text);
  if (text.length === 0) {
    return {
      ran: false,
      reason: "changed region is empty after expansion",
      findings: [],
      posted: 0,
      skippedExisting: 0,
      invokedAgents: [],
      multiTab: extracted.isMultiTab,
    };
  }
  const response = await deps.bridge.analyze({
    projectId: params.projectId,
    text,
    spanStart: expanded.start,
    ...(params.strictness !== undefined ? { strictness: params.strictness } : {}),
    title: extracted.title,
  });
  const post = await postFindingsAsComments(deps.comments, params.documentId, extracted, response.findings);
  return {
    ran: true,
    findings: response.findings,
    posted: post.posted,
    skippedExisting: post.skippedExisting,
    invokedAgents: response.invokedAgents,
    region: expanded,
    multiTab: extracted.isMultiTab,
  };
}
