import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_CONTEXT_CHARS,
  changedRegion,
  commonPrefixLength,
  commonSuffixLength,
  expandToParagraphContext,
} from "../src/lib/diff.js";

test("the minimum context window is the closed 1200-char constant from the spec", () => {
  assert.equal(MIN_CONTEXT_CHARS, 1200);
});

test("common prefix and suffix lengths behave at the edges", () => {
  assert.equal(commonPrefixLength("abcdef", "abcxyz"), 3);
  assert.equal(commonPrefixLength("", "abc"), 0);
  assert.equal(commonSuffixLength("abcdef", "xyzdef"), 3);
  assert.equal(commonSuffixLength("abcdef", "xyzdef", 2), 2, "the cap bounds the suffix scan");
  assert.equal(commonSuffixLength("abc", "abc", 0), 0);
});

test("changedRegion finds the edited span in the current text", () => {
  const previous = "The quick brown fox jumps over the lazy dog.";
  const current = "The quick red fox jumps over the lazy dog.";
  assert.deepEqual(changedRegion(previous, current), { start: 10, end: 13 });
  const appended = changedRegion(previous, `${previous} More prose.`);
  assert.deepEqual(appended, { start: previous.length, end: previous.length + " More prose.".length });
  const prepended = changedRegion(previous, `Once: ${previous}`);
  assert.deepEqual(prepended, { start: 0, end: "Once: ".length });
});

test("changedRegion returns null for identical text and an empty region for pure deletions", () => {
  const text = "Stable paragraph.\nAnother stable paragraph.";
  assert.equal(changedRegion(text, text), null);
  const deleted = changedRegion("abcdef", "abef");
  assert.deepEqual(deleted, { start: 2, end: 2 });
});

function paragraphText(count: number, width = 60): string {
  const paragraphs: string[] = [];
  for (let i = 0; i < count; i++) {
    const words: string[] = [];
    for (let w = 0; w < width; w++) words.push(`w${i}x${w}`);
    paragraphs.push(words.join(" "));
  }
  return paragraphs.join("\n");
}

test("expansion snaps the region to enclosing paragraph boundaries", () => {
  const paragraphs = ["alpha beta gamma", "delta epsilon zeta", "eta theta iota"];
  const text = paragraphs.join("\n");
  const p2Start = text.indexOf("delta");
  const region = expandToParagraphContext(text, { start: p2Start + 3, end: p2Start + 6 }, 0);
  assert.equal(region.start, p2Start);
  assert.equal(text.slice(region.start, region.end), "delta epsilon zeta\n", "paragraph end includes its newline");
});

test("expansion grows to at least the minimum context window, paragraph-wise", () => {
  const text = paragraphText(80, 30);
  assert.ok(text.length > 4000, "fixture long enough to require growth");
  const middle = text.indexOf("w40x15");
  const region = expandToParagraphContext(text, { start: middle, end: middle + 4 });
  assert.ok(region.end - region.start >= MIN_CONTEXT_CHARS, "context window at least 1200 chars");
  assert.ok(region.start < middle && region.end > middle, "region still covers the change");
  assert.equal(text[region.start - 1] ?? "\n", "\n", "region starts at a paragraph boundary");
  assert.ok(text[region.end] === undefined || text[region.end - 1] === "\n", "region ends at a paragraph boundary");
});

test("expansion respects document bounds and handles the empty region of a pure deletion", () => {
  const text = "Only one paragraph here.";
  const whole = expandToParagraphContext(text, { start: 5, end: 5 });
  assert.deepEqual(whole, { start: 0, end: text.length });
  const empty = expandToParagraphContext("", { start: 0, end: 0 });
  assert.deepEqual(empty, { start: 0, end: 0 });
  const grown = expandToParagraphContext(text, { start: 4, end: 4 });
  assert.deepEqual(grown, { start: 0, end: text.length });
});

test("expansion on a long single paragraph grows to exactly the whole paragraph", () => {
  const text = "x".repeat(3000);
  const region = expandToParagraphContext(text, { start: 1500, end: 1502 });
  assert.deepEqual(region, { start: 0, end: 3000 });
});
