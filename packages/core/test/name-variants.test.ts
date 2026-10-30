import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonNamesOf,
  capitalizedTokens,
  isStoplistedName,
  nameVariantOf,
  stripPossessive,
  textHasNameVariant,
  wholeWordTokens,
} from "../src/name-variants.js";
import type { Character } from "../src/types.js";

function character(name: string, aliases: string[] = []): Character {
  return {
    id: "char_x",
    projectId: "p1",
    name,
    aliases,
    summary: "",
    traits: [],
    abilities: [],
    injuries: [],
    goals: [],
    relationships: [],
    status: "confirmed",
    locked: false,
    sources: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

test("rule table: single substitution is a variant", () => {
  assert.deepEqual(nameVariantOf("Wexfard", ["Wexford"]), { variantOf: "Wexford", canonical: "Wexford" });
});

test("rule table: single insertion is a variant", () => {
  assert.deepEqual(nameVariantOf("Wexforde", ["Wexford"]), { variantOf: "Wexford", canonical: "Wexford" });
});

test("rule table: single deletion is a variant", () => {
  assert.deepEqual(nameVariantOf("Wxford", ["Wexford"]), { variantOf: "Wexford", canonical: "Wexford" });
});

test("rule table: adjacent transposition is a variant (owner scenario Hazledown/Hazeldown)", () => {
  assert.deepEqual(nameVariantOf("Hazeldown", ["Hazledown"]), { variantOf: "Hazledown", canonical: "Hazledown" });
  assert.deepEqual(nameVariantOf("Wexofrd", ["Wexford"]), { variantOf: "Wexford", canonical: "Wexford" });
});

test("rule table: distance 2 (two substitutions) is not a variant", () => {
  assert.equal(nameVariantOf("Wexgzrd", ["Wexford"]), null);
});

test("rule table: distance 2 (substitution plus length change) is not a variant", () => {
  assert.equal(nameVariantOf("Wxfard", ["Wexford"]), null);
});

test("rule table: distance 2 (two disjoint transpositions) is not a variant", () => {
  assert.equal(nameVariantOf("Wexofdr", ["Wexford"]), null);
});

test("rule table: names shorter than 4 never variant-match", () => {
  assert.equal(nameVariantOf("Edwa", ["Edw"]), null);
  assert.equal(nameVariantOf("Edm", ["Edmu"]), null);
  assert.equal(nameVariantOf("Ed", ["Edward"]), null);
});

test("rule table: lowercase tokens never surface as variants", () => {
  assert.deepEqual(capitalizedTokens("the wexfard road"), []);
  assert.equal(textHasNameVariant("the wexfard road", ["Wexford"]), false);
  assert.equal(textHasNameVariant("The Wexfard road", ["Wexford"]), true);
});

test("rule table: exact canon name is never a variant (case-insensitive)", () => {
  assert.equal(nameVariantOf("Wexford", ["Wexford"]), null);
  assert.equal(nameVariantOf("wexford", ["Wexford"]), null);
});

test("rule table: exact alias is never a variant — locked variants stay silent", () => {
  assert.equal(nameVariantOf("Wexfard", ["Wexford", "Wexfard"]), null);
  assert.equal(nameVariantOf("WEXFARD", ["Wexford", "Wexfard"]), null);
});

test("rule table: possessives are stripped before comparing", () => {
  assert.equal(stripPossessive("Wexfard's"), "Wexfard");
  assert.equal(stripPossessive("Hazeldown’s"), "Hazeldown");
  assert.deepEqual(wholeWordTokens("Wexford's tower"), ["Wexford", "tower"]);
  assert.deepEqual(capitalizedTokens("Wexfard's tower"), ["Wexfard"]);
  assert.deepEqual(nameVariantOf("Wexfard's", ["Wexford"]), { variantOf: "Wexford", canonical: "Wexford" });
  assert.deepEqual(nameVariantOf("Hazeldown’s", ["Hazledown"]), { variantOf: "Hazledown", canonical: "Hazledown" });
});

test("rule table: tokenization keeps apostrophes inside whole words", () => {
  assert.deepEqual(capitalizedTokens("O'Brian met O'Brien."), ["O'Brian", "O'Brien"]);
  assert.deepEqual(nameVariantOf("O'Brien", ["O'Brian"]), { variantOf: "O'Brian", canonical: "O'Brian" });
});

test("rule table: stoplisted tokens are never variant candidates", () => {
  assert.equal(isStoplistedName("There's"), true);
  assert.equal(nameVariantOf("There", ["Theres"]), null);
});

test("rule table: first canon name in list order wins (deterministic)", () => {
  const match = nameVariantOf("Wexfard", ["Wexford", "Wexfardd"]);
  assert.deepEqual(match, { variantOf: "Wexford", canonical: "Wexford" });
});

test("rule table: canonical is the primary canon name even when the variant matches an alias", () => {
  assert.deepEqual(nameVariantOf("Bramwel", ["Daven", "Bramwell"]), { variantOf: "Bramwell", canonical: "Daven" });
});

test("canonNamesOf: name plus aliases, length > 1", () => {
  assert.deepEqual(canonNamesOf(character("Ed", ["X", "Ned"])), ["Ed", "Ned"]);
  assert.deepEqual(canonNamesOf(character("Mira", [])), ["Mira"]);
});

test("chunk-level helper: variant-only chunk is detected", () => {
  assert.equal(textHasNameVariant("Hazeldown watched the road.", ["Hazledown"]), true);
  assert.equal(textHasNameVariant("Hazledown watched the road.", ["Hazledown"]), false);
});
