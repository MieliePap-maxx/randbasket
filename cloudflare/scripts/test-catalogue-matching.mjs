import assert from "node:assert/strict";
import {
  categoryFamily,
  compareCharacteristics,
  matchesSearchTerm,
  normaliseForTarget,
  parseMeasure,
  sizeCompatibility,
  sortClosestCandidates,
  stripRetailerAliases,
} from "../src/index.ts";

function measure(value, expected) {
  assert.deepEqual(parseMeasure(value), expected, `measure parsing failed for ${value}`);
}

function validCharacteristics(reference, offer) {
  assert.equal(
    compareCharacteristics(reference, offer).valid,
    true,
    `expected a valid equivalent: ${reference} -> ${offer}`,
  );
}

function invalidCharacteristics(reference, offer) {
  assert.equal(
    compareCharacteristics(reference, offer).valid,
    false,
    `expected an unrelated or conflicting product to be rejected: ${reference} -> ${offer}`,
  );
}

assert.equal(
  stripRetailerAliases("PnP Full Cream Fresh Milk 2L"),
  "full cream fresh milk 2 l",
);
assert.equal(categoryFamily("Fresh Meat, Poultry & Seafood"), "meat");
assert.equal(categoryFamily("Meat"), "meat");
assert.equal(categoryFamily("Food Cupboard"), "pantry");
assert.equal(categoryFamily("Frozen Food"), "frozen food");
assert.equal(
  stripRetailerAliases("Pick n Pay Brown Bread 700g"),
  "brown bread 700 g",
);

measure("2L", { amount: 2000, kind: "volume" });
measure("6 x 1L", { amount: 6000, kind: "volume" });
measure("700g", { amount: 700, kind: "mass" });
measure("1kg", { amount: 1000, kind: "mass" });
measure("18-pack eggs", { amount: 18, kind: "count" });
measure("18's large eggs", { amount: 18, kind: "count" });
measure("18 ea", { amount: 18, kind: "count" });
measure("per kg", { amount: 1000, kind: "mass" });

assert.equal(sizeCompatibility("2L", "1L").valid, true);
assert.equal(sizeCompatibility("2L", "2L").score > sizeCompatibility("2L", "1L").score, true);
assert.equal(sizeCompatibility("1kg", "2L").valid, false);
assert.equal(normaliseForTarget(20, "1L", "2L"), 40);
assert.equal(normaliseForTarget(75, "2.5kg", "1kg"), 30);

validCharacteristics("full cream fresh milk 2L", "Clover fresh full cream milk 1L");
invalidCharacteristics("full cream fresh milk 2L", "low fat fresh milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "full cream long life milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "fresh milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "full cream milk 2L");

validCharacteristics("brown bread 700g", "store brand brown bread loaf 700g");
invalidCharacteristics("brown bread 700g", "white bread loaf 700g");

validCharacteristics("large eggs 18 pack", "free range large eggs 18 pack");
validCharacteristics("large eggs 18 pack", "free range large 18 eggs");
invalidCharacteristics("large eggs 18 pack", "small eggs 18 pack");

validCharacteristics("beef mince 1kg", "lean beef mince per kg");
invalidCharacteristics("beef mince 1kg", "chicken mince 1kg");
validCharacteristics("lean beef mince 1kg", "extra lean beef mince 1kg");
invalidCharacteristics("lean beef mince 1kg", "savoury beef mince 400g");
invalidCharacteristics("beef mince 1kg", "bolognaise beef mince with vegetables 400g");
assert.equal(matchesSearchTerm("Tasty Nation Slow-cooked Beef Tripe 1kg", "mince"), false);
assert.equal(matchesSearchTerm("Lean Beef Mince Per kg", "mince"), true);

validCharacteristics("chicken portions 1kg", "fresh chicken portions 2kg");
validCharacteristics("chicken portions 1kg", "4 chicken drumsticks and 4 thighs per kg");
invalidCharacteristics("chicken portions 1kg", "pork portions 1kg");
invalidCharacteristics("chicken portions 1kg", "frozen chicken mala 1kg");
invalidCharacteristics("chicken portions 1kg", "whole chicken breast 1kg");
invalidCharacteristics("chicken portions 1kg", "chicken breast fillet 1.5kg");

validCharacteristics("cake flour 2.5kg", "wheat cake flour 2.5kg");
validCharacteristics("cake flour 2.5kg", "cake wheat flour 2.5kg");
invalidCharacteristics("cake flour 2.5kg", "self raising flour 2.5kg");

const ranked = sortClosestCandidates([
  { id: "cheap-poor", matchScore: 70, sizeDifference: 0, distance: 1, price: 10 },
  { id: "best-match", matchScore: 95, sizeDifference: 0.2, distance: 20, price: 35 },
  { id: "same-match-exact-size", matchScore: 95, sizeDifference: 0, distance: 30, price: 40 },
]);
assert.deepEqual(
  ranked.map((candidate) => candidate.id),
  ["same-match-exact-size", "best-match", "cheap-poor"],
  "semantic quality and compatible pack size must rank ahead of price",
);

console.log("Catalogue comparison matching tests passed.");
