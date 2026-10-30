import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding } from "@lorewardens/core";
import {
  COMMENT_MARKER,
  HASH_LINE_PREFIX,
  commentContentFor,
  findingHash,
  findingHashFromContent,
  fnv1a32Hex,
  isLorewardensComment,
} from "../src/lib/comments.js";

function aFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    agent: "canon-lore",
    category: "canon",
    type: "canon-contradiction",
    severity: "major",
    confidence: 0.95,
    minStrictness: "standard",
    message: "Canon says every spell costs a memory.",
    quote: "Mira cast the warding spell without giving up a single memory.",
    location: { file: "My Novel", startOffset: 12, endOffset: 74 },
    canonRefs: ["canon_rule_magic_memory"],
    suggestion: null,
    createdAt: "2026-10-29T00:00:00.000Z",
    ...overrides,
  };
}

test("fnv1a32Hex matches the standard FNV-1a 32-bit vectors", () => {
  assert.equal(fnv1a32Hex(""), "811c9dc5");
  assert.equal(fnv1a32Hex("a"), "e40c292c");
  assert.equal(fnv1a32Hex("foobar"), "bf9cf968");
});

test("comment content carries the marker, agent, severity, message and compact hash", () => {
  const finding = aFinding();
  const content = commentContentFor(finding);
  const lines = content.split("\n");
  assert.equal(lines.length, 3);
  assert.ok(lines[0]!.startsWith(COMMENT_MARKER), "first line starts with the marker");
  assert.ok(lines[0]!.includes(finding.agent), "agent in the marker line");
  assert.ok(lines[0]!.includes(finding.severity), "severity in the marker line");
  assert.ok(lines[1]!.includes(finding.type), "type on the message line");
  assert.ok(lines[1]!.includes(finding.message), "human message present");
  assert.match(lines[2]!, /^#lw:[0-9a-f]{8}$/, "last line is the compact finding hash");
  assert.equal(lines[2]!, `${HASH_LINE_PREFIX}${findingHash(finding)}`);
});

test("hash dedupe: identical findings collide, meaningful changes differ", () => {
  const base = aFinding();
  assert.equal(findingHash(base), findingHash(aFinding()));
  assert.notEqual(
    findingHash(base),
    findingHash(aFinding({ location: { file: base.location.file, startOffset: 500, endOffset: 562 } })),
    "a different location is a different finding",
  );
  assert.notEqual(
    findingHash(base),
    findingHash(aFinding({ quote: "A different sentence entirely." })),
    "a different quote is a different finding",
  );
  assert.notEqual(
    findingHash(base),
    findingHash(aFinding({ severity: "minor" })),
    "a different severity is a different finding",
  );
});

test("hash round-trips through the comment content", () => {
  const content = commentContentFor(aFinding());
  assert.equal(findingHashFromContent(content), findingHash(aFinding()));
  assert.equal(findingHashFromContent("a human comment without a hash"), null);
  assert.equal(findingHashFromContent("#lw:notahash"), null);
});

test("marker detection distinguishes our comments from everything else", () => {
  assert.equal(isLorewardensComment(commentContentFor(aFinding())), true);
  assert.equal(isLorewardensComment("Just a human remark"), false);
  assert.equal(isLorewardensComment(undefined), false);
  assert.equal(isLorewardensComment(""), false);
});

test("suggestion-free discipline: comment content never proposes rewrites", () => {
  const finding = aFinding({ suggestion: null });
  const content = commentContentFor(finding);
  assert.ok(!content.includes("suggestion"), "no suggestion machinery leaks into comment content");
  assert.ok(!/consider (changing|rewriting)/i.test(content));
});
