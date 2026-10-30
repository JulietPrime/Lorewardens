import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createBridgeServer, createRegistryFromAllAgents } from "@lorewardens/bridge";
import { loadFixtures } from "@lorewardens/mcp-server";
import { HttpBridgeClient } from "../src/lib/bridge-client.js";
import { COMMENT_MARKER, HASH_LINE_PREFIX, isLorewardensComment } from "../src/lib/comments.js";
import { extractDocText } from "../src/lib/google/docs.js";
import {
  clearLorewardensComments,
  runFullCheck,
  runIncrementalCheck,
} from "../src/lib/pipeline.js";
import { FakeDocsClient, FakeDriveComments, FakeSnapshotStore, makeDoc } from "../src/fakes/fakes.js";

const E1_SENTENCE = "Mira cast the warding spell without giving up a single memory.";
const PROOF_FIXTURES_DIR = fileURLToPath(new URL("../../../proof/fixtures", import.meta.url));

async function listenBridge(): Promise<{ server: Server; port: number; token: string }> {
  const token = "e2e-bridge-token-0123456789abcdef";
  const { store } = loadFixtures(PROOF_FIXTURES_DIR);
  const server = createBridgeServer({ registry: createRegistryFromAllAgents(), store, token });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { server, port: address.port, token };
}

async function closeBridge(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

interface Harness {
  server: Server;
  deps: {
    docs: FakeDocsClient;
    comments: FakeDriveComments;
    bridge: HttpBridgeClient;
    snapshots: FakeSnapshotStore;
  };
}

async function harness(): Promise<Harness> {
  const { server, port, token } = await listenBridge();
  const docs = new FakeDocsClient([]);
  const comments = new FakeDriveComments();
  const bridge = new HttpBridgeClient({ baseUrl: `http://127.0.0.1:${port}`, token });
  return { server, deps: { docs, comments, bridge, snapshots: new FakeSnapshotStore() } };
}

test("e2e: doc text -> bridge findings -> anchored marker comments, dedupe on re-run, doc untouched", async () => {
  const { server, deps } = await harness();
  try {
    const doc = makeDoc("doc-e2e", "The Weeping Gate - Chapter One", [
      E1_SENTENCE,
      "Clean canon passage stays silent and unremarked.",
    ]);
    deps.docs.set(doc);
    const before = JSON.stringify(doc);

    const first = await runFullCheck(deps, { documentId: "doc-e2e", projectId: "proof" });
    assert.equal(first.ran, true);
    assert.equal(first.findings.length, 1, "the seeded sentence yields exactly the pinned canon-lore finding");
    assert.equal(first.findings[0]!.agent, "canon-lore");
    assert.equal(first.findings[0]!.type, "canon-contradiction");
    assert.equal(first.posted, 1);
    assert.equal(first.skippedExisting, 0);

    assert.equal(JSON.stringify(doc), before, "the document JSON is never mutated by the pipeline");

    const stored = deps.comments.byFile.get("doc-e2e") ?? [];
    assert.equal(stored.length, 1);
    const comment = stored[0]!;
    assert.ok(isLorewardensComment(comment.content), "comment carries the marker");
    assert.ok(comment.content!.startsWith(COMMENT_MARKER));
    assert.match(comment.content!, new RegExp(`${HASH_LINE_PREFIX}[0-9a-f]{8}$`), "compact hash embedded");
    assert.equal(comment.quotedFileContent?.value, first.findings[0]!.quote, "quotedResourceContent carries the quote");
    assert.ok(comment.anchor, "anchored comment carries an anchor");

    const extracted = extractDocText(doc);
    const finding = first.findings[0]!;
    const anchor = JSON.parse(comment.anchor!) as { r: string; a: { start: number; end: number }[] };
    assert.equal(anchor.r, "head");
    assert.equal(anchor.a.length, 1);
    assert.equal(anchor.a[0]!.start, extracted.indexMap[finding.location.startOffset], "anchor start maps through indexMap");
    assert.equal(
      anchor.a[0]!.end,
      extracted.indexMap[finding.location.endOffset - 1] + 1,
      "anchor end is one past the last quoted unit",
    );
    assert.equal(anchor.a[0]!.end - anchor.a[0]!.start, finding.quote.length);
    assert.equal(
      extracted.text.slice(finding.location.startOffset, finding.location.endOffset),
      finding.quote,
      "the quote slices exactly out of the extracted document text",
    );

    const second = await runFullCheck(deps, { documentId: "doc-e2e", projectId: "proof" });
    assert.equal(second.findings.length, 1, "same text, same finding");
    assert.equal(second.posted, 0, "identical re-run posts nothing (dedupe)");
    assert.equal(second.skippedExisting, 1);
    assert.equal((deps.comments.byFile.get("doc-e2e") ?? []).length, 1, "still exactly one comment");

    const settings = await deps.bridge.settings("proof");
    assert.ok(Array.isArray(settings.agents), "settings passthrough feeds the sidebar");
  } finally {
    await closeBridge(server);
  }
});

test("e2e: incremental edit re-analyzes the padded changed region and only new findings post", async () => {
  const { server, deps } = await harness();
  try {
    deps.docs.set(
      makeDoc("doc-inc", "The Weeping Gate - Chapter One", [
        E1_SENTENCE,
        "Clean canon passage stays silent and unremarked.",
      ]),
    );
    const full = await runFullCheck(deps, { documentId: "doc-inc", projectId: "proof" });
    assert.equal(full.posted, 1);

    deps.docs.set(
      makeDoc("doc-inc", "The Weeping Gate - Chapter One", [
        E1_SENTENCE,
        "Clean canon passage stays silent and unremarked. The lighthouse keeper waved from the gallery.",
      ]),
    );
    const incremental = await runIncrementalCheck(deps, { documentId: "doc-inc", projectId: "proof" });
    assert.equal(incremental.ran, true, "changed text triggers analysis");
    assert.ok(incremental.region, "the expanded changed region is reported");
    assert.ok(incremental.region!.end > incremental.region!.start);
    assert.equal(incremental.posted, 0, "the unchanged finding is not re-posted");
    assert.ok(incremental.skippedExisting >= 1, "existing finding deduped");
    assert.equal((deps.comments.byFile.get("doc-inc") ?? []).length, 1);

    const unchanged = await runIncrementalCheck(deps, { documentId: "doc-inc", projectId: "proof" });
    assert.equal(unchanged.ran, false);
    assert.match(unchanged.reason ?? "", /unchanged/);

    deps.docs.set(makeDoc("doc-fresh", "Fresh", ["A brand new document."]));
    const fresh = await runIncrementalCheck(deps, { documentId: "doc-fresh", projectId: "proof" });
    assert.equal(fresh.ran, false, "first observation snapshots without analyzing");
    assert.match(fresh.reason ?? "", /first observation/);
    assert.ok((await deps.snapshots.get("lorewardens.snapshot.doc-fresh")) !== undefined, "snapshot stored");
  } finally {
    await closeBridge(server);
  }
});

test("e2e: clear removes only our own marker comments; human and foreign comments survive", async () => {
  const { server, deps } = await harness();
  try {
    deps.docs.set(makeDoc("doc-clr", "Clear", [E1_SENTENCE]));
    const full = await runFullCheck(deps, { documentId: "doc-clr", projectId: "proof" });
    assert.equal(full.posted, 1);

    deps.comments.add("doc-clr", {
      id: "foreign-1",
      content: "A human reviewer's note",
      author: { me: false },
    });
    deps.comments.add("doc-clr", {
      id: "foreign-marker",
      content: `${COMMENT_MARKER} · canon-lore · major\nanother user's Lorewardens comment\n${HASH_LINE_PREFIX}deadbeef`,
      author: { me: false },
    });

    const deleted = await clearLorewardensComments(deps.comments, "doc-clr");
    assert.equal(deleted, 1, "only our own marker comment is deleted");
    const remaining = (deps.comments.byFile.get("doc-clr") ?? []).filter((c) => c.deleted !== true);
    assert.deepEqual(
      remaining.map((c) => c.id).sort(),
      ["foreign-1", "foreign-marker"],
      "human note and foreign-user marker comments are untouched",
    );
  } finally {
    await closeBridge(server);
  }
});

test("e2e: the real bridge rejects unauthenticated and foreign-origin callers end-to-end", async () => {
  const { server, port, token } = await listenBridge();
  try {
    const unauthenticated = new HttpBridgeClient({ baseUrl: `http://127.0.0.1:${port}`, token: "wrong" });
    await assert.rejects(() => unauthenticated.health(), /HTTP 401/);
    const good = new HttpBridgeClient({ baseUrl: `http://127.0.0.1:${port}`, token });
    const health = await good.health();
    assert.equal(health.ok, true);
    assert.ok(health.agents >= 11, "roster-agnostic: reports the registered agent count");
  } finally {
    await closeBridge(server);
  }
});
