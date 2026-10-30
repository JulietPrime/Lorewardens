import assert from "node:assert/strict";
import { test } from "node:test";
import { docRangeFor, extractDocText } from "../src/lib/google/docs.js";
import { makeDoc } from "../src/fakes/fakes.js";

test("walker: single paragraph maps every local character to its Docs index", () => {
  const doc = makeDoc("doc-1", "Chapter One", ["Hello world"]);
  const extracted = extractDocText(doc);
  assert.equal(extracted.documentId, "doc-1");
  assert.equal(extracted.title, "Chapter One");
  // The implicit leading newline (doc index 0) plus the paragraph text.
  assert.equal(extracted.text, "\nHello world");
  assert.equal(extracted.indexMap.length, extracted.text.length);
  assert.equal(extracted.indexMap[0], 0);
  assert.equal(extracted.indexMap[1], 1, "local 1 is doc index 1 ('H')");
  assert.equal(extracted.indexMap[11], 11, "local 11 is doc index 11 ('d')");
  assert.equal(extracted.isMultiTab, false);
  assert.equal(extracted.tabCount, 1);
});

test("walker: multi-paragraph text keeps paragraph separators on real doc indices", () => {
  const first = "First paragraph stands alone.";
  const second = "Second paragraph continues.";
  const extracted = extractDocText(makeDoc("doc-2", "T", [first, second]));
  const at1 = extracted.text.indexOf(first);
  const at2 = extracted.text.indexOf(second);
  assert.ok(at1 > 0 && at2 > at1 + first.length, "both paragraphs present in order");
  assert.equal(extracted.text[at2 - 1], "\n", "a newline separates the paragraphs");
  assert.equal(extracted.indexMap[at1], 1, "first paragraph starts at doc index 1");
  assert.equal(extracted.indexMap[at1 + first.length - 1], first.length, "first paragraph ends inside its run");
  assert.equal(
    extracted.indexMap[at2],
    first.length + 2,
    "second paragraph starts right after the separator newline",
  );
  assert.equal(
    extracted.text.slice(at1, at1 + first.length),
    first,
    "local slice reproduces the paragraph exactly",
  );
});

test("walker: a blank paragraph yields a real blank line in local text", () => {
  const extracted = extractDocText(makeDoc("doc-3", "T", ["AA", "", "BB"]));
  assert.equal(extracted.text, "\nAA\n\nBB");
  assert.equal(extracted.indexMap[extracted.text.indexOf("BB")], 5, "'B' sits at its own doc index");
});

test("walker: emoji occupy two UTF-16 units mapped to two consecutive doc indices", () => {
  const content = "Hi \u{1F600}!";
  const extracted = extractDocText(makeDoc("doc-4", "T", [content]));
  const at = extracted.text.indexOf(content);
  assert.ok(at > 0);
  assert.equal(
    extracted.text.slice(at, at + content.length),
    content,
    "emoji and trailing character round-trip through the map",
  );
  for (let i = 0; i < content.length; i++) {
    assert.equal(extracted.indexMap[at + i], 1 + i, `unit ${i} maps to doc index ${1 + i}`);
  }
  assert.equal(extracted.indexMap[extracted.text.length - 1], content.length, "final '!' maps to its doc index");
});

test("walker: table cells contribute their text with in-order index mapping", () => {
  const cellA = "Cell one";
  const cellB = "Cell two";
  const doc: ReturnType<typeof makeDoc> = {
    documentId: "doc-5",
    title: "Tables",
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: 9,
          paragraph: { elements: [{ startIndex: 1, endIndex: 8, textRun: { content: "Prose:" } }] },
        },
        {
          startIndex: 10,
          endIndex: 44,
          table: {
            rows: 1,
            columns: 2,
            tableRows: [
              {
                tableCells: [
                  {
                    content: [
                      {
                        startIndex: 12,
                        endIndex: 21,
                        paragraph: { elements: [{ startIndex: 12, endIndex: 20, textRun: { content: cellA } }] },
                      },
                    ],
                  },
                  {
                    content: [
                      {
                        startIndex: 24,
                        endIndex: 33,
                        paragraph: { elements: [{ startIndex: 24, endIndex: 32, textRun: { content: cellB } }] },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  };
  const extracted = extractDocText(doc);
  const atA = extracted.text.indexOf(cellA);
  const atB = extracted.text.indexOf(cellB);
  assert.ok(atA > 0 && atB > atA, "both cells present in document order");
  assert.equal(extracted.indexMap[atA], 12, "cell A text maps to its run start");
  assert.equal(extracted.indexMap[atB], 24, "cell B text maps to its run start");
  const map = extracted.indexMap;
  for (let i = 1; i < map.length; i++) {
    assert.ok(map[i] > map[i - 1], "indexMap is strictly increasing");
  }
});

test("walker: multi-tab documents are flagged with a tab count and first-tab id", () => {
  const base = makeDoc("doc-6", "Tabbed", ["Only the first tab is walked."]);
  const doc = {
    ...base,
    tabs: [
      { tabProperties: { tabId: "t.first", title: "First", index: 0 } },
      { tabProperties: { tabId: "t.second", title: "Second", index: 1 } },
    ],
  };
  const extracted = extractDocText(doc);
  assert.equal(extracted.isMultiTab, true);
  assert.equal(extracted.tabCount, 2);
  assert.equal(extracted.tabId, "t.first");
  assert.ok(extracted.text.includes("Only the first tab is walked."));
});

test("walker: autoText contributes its content", () => {
  const doc = {
    documentId: "doc-7",
    title: "Auto",
    body: {
      content: [
        {
          startIndex: 1,
          endIndex: 7,
          paragraph: {
            elements: [{ startIndex: 1, endIndex: 6, autoText: { content: "Page 1" } }],
          },
        },
      ],
    },
  };
  const extracted = extractDocText(doc);
  assert.equal(extracted.text, "\nPage 1");
  assert.equal(extracted.indexMap[1], 1);
});

test("docRangeFor maps finding ranges for anchors and rejects empty or out-of-bounds ranges", () => {
  const extracted = extractDocText(makeDoc("doc-8", "T", ["Find me here", "Second line"]));
  const start = extracted.text.indexOf("Find me here");
  const range = docRangeFor(start, start + "Find me here".length, extracted);
  assert.deepEqual(range, { start: 1, end: 1 + "Find me here".length });
  assert.equal(docRangeFor(start, start, extracted), null, "empty range -> null");
  assert.equal(docRangeFor(-1, 4, extracted), null, "negative start -> null");
  assert.equal(docRangeFor(extracted.indexMap.length + 10, extracted.indexMap.length + 20, extracted), null, "out of bounds -> null");
  assert.equal(docRangeFor(1.5, 4, extracted), null, "non-integer -> null");
});
