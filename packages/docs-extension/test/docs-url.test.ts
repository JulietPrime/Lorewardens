import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { documentIdFromUrl } from "../src/lib/docs-url.js";

test("documentIdFromUrl: single-account Docs URL yields the document id", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/d/abc123/edit"), "abc123");
});

test("documentIdFromUrl: fragment after the id does not change the result", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/d/abc123/edit#heading=h.x"), "abc123");
});

test("documentIdFromUrl: multi-account URL with /u/1/ resolves the same id", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/u/1/d/abc123/edit"), "abc123");
});

test("documentIdFromUrl: multi-account URL keeps the full id charset", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/u/2/d/docXYZ_9-/edit"), "docXYZ_9-");
});

test("documentIdFromUrl: account number 0 resolves like any other account", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/u/0/d/abc123/edit"), "abc123");
});

test("documentIdFromUrl: Slides URLs do not match (slides negative)", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/presentation/d/xyz123/edit"), null);
});

test("documentIdFromUrl: Sheets URLs do not match (sheets negative)", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/spreadsheets/d/xyz123/edit"), null);
});

test("documentIdFromUrl: Drive file URLs do not match (drive negative)", () => {
  assert.equal(documentIdFromUrl("https://drive.google.com/file/d/xyz123/view"), null);
});

test("documentIdFromUrl: plain https pages do not match (plain https negative)", () => {
  assert.equal(documentIdFromUrl("https://example.com/some/page"), null);
});

test("documentIdFromUrl: the u segment must be digits (u segment negative)", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/u/abc/d/abc123/edit"), null);
});

test("documentIdFromUrl: an empty id yields null (empty id negative)", () => {
  assert.equal(documentIdFromUrl("https://docs.google.com/document/d/"), null);
});

test("documentIdFromUrl: undefined yields null", () => {
  assert.equal(documentIdFromUrl(undefined), null);
});

test("the manifest grants persistent visibility of docs.google.com tabs (host_permissions)", () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../manifest.json", import.meta.url)), "utf8")) as {
    host_permissions?: string[];
  };
  assert.ok(
    manifest.host_permissions?.includes("https://docs.google.com/*"),
    "host permission 'https://docs.google.com/*' is present: tab.url stays visible for Docs tabs without an activeTab grant",
  );
});
