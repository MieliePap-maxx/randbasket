import assert from "node:assert/strict";
import { addVocabularyText, vocabularySqlStatements } from "./search-vocabulary.mjs";
import {
  MIN_SEMANTIC_SIMILARITY,
  PRODUCT_EMBEDDING_DIMENSIONS,
  PRODUCT_EMBEDDING_MODEL,
  assessCatalogueMatch,
  buildRetailerDiagnostics,
  buildProductEmbeddingText,
  categoryFamily,
  calculateBasketLineTotalCents,
  chooseVocabularyCorrection,
  compareCharacteristics,
  findBalancedProductCandidates,
  findSemanticProductCandidates,
  exactQueryCoverage,
  fuzzyQueryCoverage,
  fuzzyTokenSimilarity,
  inferredCategoryFamily,
  levenshteinDistance,
  matchesSearchTerm,
  mergeHybridCandidates,
  normalizeRetailerId,
  normaliseForTarget,
  normalizedProductFamily,
  parsePackageMeasure,
  parseQueryIntent,
  parseMeasure,
  planPackageFulfilment,
  scoreStore,
  semanticCandidatePassesHardRules,
  semanticScoreBonus,
  sizeCompatibility,
  sortClosestCandidates,
  stripRetailerAliases,
  summarizeRetailerBasket,
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
assert.equal(categoryFamily("Fresh Fruit & Vegetables"), "produce");
assert.equal(categoryFamily("Breakfast Milk Long Life"), "dairy");
assert.equal(categoryFamily("Perishables Eggs"), "dairy");
assert.equal(categoryFamily("Main Meal Flour"), "pantry");
assert.equal(categoryFamily("Perishables Frozen Poultry"), "meat");
assert.equal(inferredCategoryFamily("Makro Parmalat Full Cream Milk 6 x 1L"), "dairy");
assert.equal(inferredCategoryFamily("Colgate Total Toothpaste 75ml"), "personal care");
assert.equal(
  stripRetailerAliases("Pick n Pay Brown Bread 700g"),
  "brown bread 700 g",
);
assert.equal(normalizeRetailerId("pick-n-pay"), "pick-n-pay");
assert.equal(normalizeRetailerId("Pick n Pay"), "pick-n-pay");
assert.equal(normalizeRetailerId("WOOLWORTHS"), "woolworths");
assert.equal(levenshteinDistance("cream", "creem"), 1);
assert.equal(levenshteinDistance("avocado", "avocdo"), 1);
assert.equal(levenshteinDistance("milk", "milk"), 0);
assert.equal(fuzzyTokenSimilarity("creem", "cream"), 0.8);
assert.equal(fuzzyTokenSimilarity("chiken", "chicken") > 0.85, true);
assert.equal(fuzzyTokenSimilarity("avocdo", "avocado") > 0.85, true);
assert.equal(fuzzyTokenSimilarity("yogert", "yogurt") > 0.83, true);
assert.equal(fuzzyTokenSimilarity("minse", "mince"), 0.8);
assert.equal(fuzzyTokenSimilarity("beef", "beer"), 0.75);
assert.equal(fuzzyTokenSimilarity("ham", "jam"), 0);
assert.equal(fuzzyTokenSimilarity("tea", "pea"), 0);
assert.equal(fuzzyTokenSimilarity("1", "2"), 0);
assert.equal(fuzzyTokenSimilarity("18", "6"), 0);
assert.equal(fuzzyTokenSimilarity("kg", "g"), 0);
assert.equal(fuzzyTokenSimilarity("ml", "l"), 0);
assert.equal(fuzzyQueryCoverage("full cream milk", "SPAR full cream or low fat fresh milk") > 0.99, true);
assert.equal(fuzzyQueryCoverage("full cream milk", "full cream plain yoghurt") < 0.75, true);
assert.equal(fuzzyQueryCoverage("chiken fillets", "Fresh Chicken Breast Fillets") > 0.9, true);
assert.equal(exactQueryCoverage("full cream milk", "Clover full cream fresh milk 2L"), 1);
assert.equal(exactQueryCoverage("full cream milk", "Clover low fat fresh milk 2L") < 0.5, true);
assert.equal(matchesSearchTerm("SPAR Full Cream or Low Fat Fresh Milk 2 L", "full cream milk"), true);
assert.equal(matchesSearchTerm("Plain Double Cream Yogurt 1kg", "yoghurt"), false, "request-time matching no longer uses edit distance");
assert.equal(matchesSearchTerm("Colgate Total Toothpase 75ml", "toothpaste"), false, "known query corrections happen before exact matching");
assert.equal(matchesSearchTerm("Silk hair treatment", "milk"), false);

const vocabulary = (terms) => terms.map(([term, usage_count = 1]) => ({ term, usage_count }));
assert.equal(chooseVocabularyCorrection("avocdo", vocabulary([["avocado", 20]])), "avocado");
assert.equal(chooseVocabularyCorrection("creem", vocabulary([["cream", 30]])), "cream");
assert.equal(chooseVocabularyCorrection("chiken", vocabulary([["chicken", 50]])), "chicken");
assert.equal(chooseVocabularyCorrection("yogert", vocabulary([["yogurt", 12], ["yoghurt", 40]])), "yogurt");
assert.equal(chooseVocabularyCorrection("minse", vocabulary([["mince", 30]])), "mince");
assert.equal(chooseVocabularyCorrection("ham", vocabulary([["jam", 100]])), "ham");
assert.equal(chooseVocabularyCorrection("jam", vocabulary([["ham", 100]])), "jam");
assert.equal(chooseVocabularyCorrection("tea", vocabulary([["pea", 100]])), "tea");
assert.equal(chooseVocabularyCorrection("pea", vocabulary([["tea", 100]])), "pea");
assert.equal(chooseVocabularyCorrection("beef", vocabulary([["beer", 100]])), "beef");
assert.equal(chooseVocabularyCorrection("beer", vocabulary([["beef", 100]])), "beer");

const generatedVocabulary = new Map();
addVocabularyText(
  generatedVocabulary,
  "Clover Fresh Full Cream Milk 2L",
  "clover fresh full cream milk dairy",
  ["milk", "full cream milk"],
  "Clover",
);
assert.equal(generatedVocabulary.has("clover"), true);
assert.equal(generatedVocabulary.has("fresh"), true);
assert.equal(generatedVocabulary.has("cream"), true);
assert.equal(generatedVocabulary.has("milk"), true);
assert.equal(generatedVocabulary.has("2"), false);
assert.equal(generatedVocabulary.has("pack"), false);
assert.equal(vocabularySqlStatements(generatedVocabulary).some((statement) =>
  statement.includes("ON CONFLICT(term) DO UPDATE")), true);

const milkProduct = {
  id: "milk",
  canonical_name: "Clover Fresh Full Cream Milk 2L",
  category: "Dairy",
  target_size: "2 L",
  search_terms_json: "[]",
  search_text: "clover fresh full cream milk 2 l dairy",
};
const embeddingText = buildProductEmbeddingText(milkProduct, {
  brands: ["Douglasdale", "Clover", "Clover"],
  retailerNames: [
    "Fresh Full Cream Milk 2L",
    "Clover Full Cream Fresh Milk 2L",
  ],
  profiles: [{
    term: "full cream milk",
    category: "Dairy",
    search_text: "full cream fresh milk whole milk full fat milk",
    exclude_terms_json: JSON.stringify(["low fat", "long life"]),
    preferred_terms_json: JSON.stringify(["fresh milk", "whole milk"]),
  }],
});
assert.equal(embeddingText, buildProductEmbeddingText(milkProduct, {
  brands: ["Clover", "Douglasdale"],
  retailerNames: [
    "Clover Full Cream Fresh Milk 2L",
    "Fresh Full Cream Milk 2L",
  ],
  profiles: [{
    term: "full cream milk",
    category: "Dairy",
    search_text: "full cream fresh milk whole milk full fat milk",
    exclude_terms_json: JSON.stringify(["low fat", "long life"]),
    preferred_terms_json: JSON.stringify(["fresh milk", "whole milk"]),
  }],
}), "embedding text must be deterministic regardless of brand and retailer input order");
assert.equal(embeddingText.includes("Product: clover fresh full cream milk 2 l"), true);
assert.equal(embeddingText.includes("Aliases: fresh dairy milk, full cream milk, full fat milk, whole milk"), true);
assert.equal(embeddingText.includes("R 34"), false, "prices must never be embedded");
assert.equal(PRODUCT_EMBEDDING_MODEL, "@cf/baai/bge-small-en-v1.5");
assert.equal(PRODUCT_EMBEDDING_DIMENSIONS, 384);
assert.equal(MIN_SEMANTIC_SIMILARITY, 0.78);

assert.deepEqual(mergeHybridCandidates(
  [
    { productId: "milk", lexicalScore: 8 },
    { productId: "bread", lexicalScore: 5 },
  ],
  [
    { productId: "milk", score: 0.88 },
    { productId: "boerewors", score: 0.84 },
    { productId: "below-threshold", score: 0.77 },
  ],
), [
  {
    productId: "milk",
    lexicalScore: 8,
    semanticScore: 0.88,
    sources: ["keyword", "vector"],
  },
  {
    productId: "bread",
    lexicalScore: 5,
    semanticScore: 0,
    sources: ["keyword"],
  },
  {
    productId: "boerewors",
    lexicalScore: 0,
    semanticScore: 0.84,
    sources: ["vector"],
  },
]);
assert.equal(semanticScoreBonus(0.77), 0);
assert.equal(semanticScoreBonus(0.88) < 1, true, "semantic weighting must remain secondary");

assert.equal(semanticCandidatePassesHardRules(
  "whole milk",
  milkProduct,
  { productName: "Clover Fresh Full Cream Milk 2L", brand: "Clover", size: "2 L" },
  [],
), true);
assert.equal(semanticCandidatePassesHardRules(
  "whole milk",
  { ...milkProduct, canonical_name: "Low Fat Fresh Milk", search_text: "low fat fresh milk dairy" },
  { productName: "Low Fat Fresh Milk 2L", size: "2 L" },
  [],
), false, "whole milk must not admit low-fat milk through vector similarity");
assert.equal(semanticCandidatePassesHardRules(
  "beef mince 1kg",
  { ...milkProduct, canonical_name: "Chicken Mince", category: "Meat", search_text: "chicken mince meat" },
  { productName: "Chicken Mince 1kg", size: "1 kg" },
  [],
), false);
assert.equal(semanticCandidatePassesHardRules(
  "brown bread 700g",
  { ...milkProduct, canonical_name: "White Bread", category: "Bakery", search_text: "white bread bakery" },
  { productName: "White Bread 700g", size: "700 g" },
  [],
), false);
assert.equal(semanticCandidatePassesHardRules(
  "large eggs 18 pack",
  { ...milkProduct, canonical_name: "Large Eggs 6 Pack", category: "Dairy", search_text: "large eggs dairy" },
  { productName: "Large Eggs 6 Pack", size: "6 pack" },
  [],
), false, "semantic discovery must not substitute a different egg count");

assert.equal(scoreStore(
  "ful cream milk 2 l",
  milkProduct,
  { productName: "Clover Fresh Full Cream Milk 2L", brand: "Clover", size: "2 L" },
  [],
) > 0, true, "the corrected longer typo plus exact core words should still find full cream milk");

const chickenProduct = {
  id: "chicken-fillets",
  canonical_name: "Fresh Chicken Breast Fillets 1kg",
  category: "Meat",
  target_size: "1 kg",
  search_terms_json: "[]",
  search_text: "fresh chicken breast fillets 1 kg meat",
};
assert.equal(scoreStore(
  "chiken fillets 1 kg",
  chickenProduct,
  { productName: "Fresh Chicken Breast Fillets 1kg", size: "1 kg" },
  [],
) > 0, true, "fuzzy core-token coverage should tolerate chiken while preserving the 1kg measure");

const embeddingVector = Array.from({ length: PRODUCT_EMBEDDING_DIMENSIONS }, () => 0.01);
const semanticEnvironment = {
  AI: {
    run: async () => ({ data: [embeddingVector] }),
  },
  PRODUCT_VECTORS: {
    query: async () => ({
      matches: [
        { id: "milk", score: 0.91 },
        { id: "unsafe-low-score", score: 0.72 },
      ],
    }),
  },
};
assert.deepEqual(
  await findSemanticProductCandidates(semanticEnvironment, "whole milk"),
  [{ productId: "milk", score: 0.91 }],
);
const originalWarn = console.warn;
console.warn = () => {};
assert.deepEqual(
  await findSemanticProductCandidates({
    ...semanticEnvironment,
    AI: { run: async () => { throw new Error("Workers AI unavailable"); } },
  }, "whole milk"),
  [],
  "Workers AI failure must fall back to lexical search",
);
assert.deepEqual(
  await findSemanticProductCandidates({
    ...semanticEnvironment,
    PRODUCT_VECTORS: { query: async () => { throw new Error("Vectorize unavailable"); } },
  }, "whole milk"),
  [],
  "Vectorize failure must fall back to lexical search",
);
console.warn = originalWarn;
assert.deepEqual(
  await findSemanticProductCandidates({
    ...semanticEnvironment,
    PRODUCT_VECTORS: { query: async () => ({ matches: [] }) },
  }, "whole milk"),
  [],
  "an empty vector index must leave keyword search functional",
);
assert.deepEqual(
  await findSemanticProductCandidates(semanticEnvironment, "https://www.pnp.co.za/product/123"),
  [],
  "product URL searches must not call semantic search",
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
assert.equal(normaliseForTarget(75, "2.5kg", "1kg"), 75, "a larger compatible package remains a valid one-pack alternative");
assert.deepEqual(parsePackageMeasure("10 x 500 ml"), {
  amount: 5000,
  kind: "volume",
  packageQuantity: 5000,
  singleUnitAmount: 500,
  multipackCount: 10,
  normalizedUnit: "ml",
});
assert.equal(parsePackageMeasure("not a package"), null);
assert.equal(planPackageFulfilment("2L", "1L").unitsRequired, 2);
assert.equal(planPackageFulfilment("2L", "1L").totalSupplied, 2000);
assert.equal(planPackageFulfilment("2L", "2L").score > planPackageFulfilment("2L", "1L").score, true);
assert.equal(planPackageFulfilment("1kg", "2.5kg").valid, true);
assert.equal(planPackageFulfilment("1kg", "2.5kg").unitsRequired, 1);
assert.equal(calculateBasketLineTotalCents(3499, 2, 3), 20994);
assert.equal(calculateBasketLineTotalCents(null, 1, 1), null);
assert.deepEqual(summarizeRetailerBasket([3499, 1799]), {
  knownSubtotalCents: 5298,
  knownSubtotal: 52.98,
  matchedItemCount: 2,
  missingItemCount: 0,
  isComplete: true,
});
assert.deepEqual(summarizeRetailerBasket([3499, null]), {
  knownSubtotalCents: 3499,
  knownSubtotal: 34.99,
  matchedItemCount: 1,
  missingItemCount: 1,
  isComplete: false,
});
assert.equal(normalizedProductFamily("Clover fresh full cream milk 2L"), "milk");
assert.equal(normalizedProductFamily("Albany brown bread 700g"), "bread");

validCharacteristics("full cream fresh milk 2L", "Clover fresh full cream milk 1L");
validCharacteristics("full cream fresh milk 2L", "Housebrand full cream fresh milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "low fat fresh milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "full cream long life milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "full cream oat milk 2L");
invalidCharacteristics("full cream fresh milk 2L", "chocolate full cream fresh milk 2L");
invalidCharacteristics("lactose free full cream fresh milk 2L", "full cream fresh milk 2L");
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

const intentCases = [
  ["full cream milk 2l", "milk", "dairy"],
  ["brown bread 700g", "bread", "bakery"],
  ["large eggs 18 pack", "eggs", "dairy"],
  ["beef mince 1kg", "mince", "meat"],
  ["chicken fillets 1kg", "chicken", "meat"],
  ["cake flour 2.5kg", "flour", "pantry"],
  ["white sugar 2kg", "sugar", "pantry"],
  ["long grain rice 2kg", "rice", "pantry"],
  ["sunflower oil 2l", "oil", "pantry"],
  ["instant coffee 200g", "coffee", "beverages"],
  ["rooibos tea 80 pack", "tea", "beverages"],
  ["toothpaste 75ml", "toothpaste", "personal care"],
  ["2 ply toilet paper 18 pack", "toilet paper", "household"],
  ["laundry washing powder 2kg", "laundry detergent", "household"],
  ["dishwashing liquid 750ml", "dishwashing", "household"],
  ["adult dog food 8kg", "dog food", "pet"],
  ["breakfast cereal 750g", "cereal", "pantry"],
  ["braai wors 1kg", "braai", "meat"],
];
for (const [query, family, category] of intentCases) {
  const intent = parseQueryIntent(query);
  assert.equal(intent.productFamily, family, `family intent failed for ${query}`);
  assert.equal(intent.categoryFamily, category, `category intent failed for ${query}`);
  assert.equal(intent.discoveryTerms.length > 0, true, `discovery terms missing for ${query}`);
}
assert.equal(parseQueryIntent("PnP Clover full cream milk 2L").retailerId, "pick-n-pay");
assert.equal(parseQueryIntent("Clover full cream milk 2L").brand, "clover");
assert.deepEqual(parseQueryIntent("lactose free full cream milk 2L").requiredCharacteristics, ["lactose free"]);
assert.equal(parseQueryIntent("chicken flavour adult dog food 8kg").productFamily, "dog food");
assert.equal(parseQueryIntent("baby rice cereal 500g").productFamily, "cereal");

const genericMilkProduct = {
  id: "generic-milk",
  canonical_name: "Fresh Milk",
  category: "Dairy",
  target_size: "2 L",
  search_terms_json: "[]",
  search_text: "fresh full cream milk dairy",
};
const exactAssessment = assessCatalogueMatch(
  "full cream fresh milk 2L",
  genericMilkProduct,
  { productName: "Housebrand Full Cream Fresh Milk 2L", size: "2 L", price: 34.99 },
);
assert.equal(exactAssessment.accepted, true);
assert.equal(exactAssessment.matchTier, 1);
assert.equal(exactAssessment.matchType, "exact");
assert.equal(exactAssessment.isExactMatch, true);
assert.equal(exactAssessment.effectiveTotalPrice, 34.99);
assert.equal(exactAssessment.scoreBreakdown.tier, 100);

const equivalentAssessment = assessCatalogueMatch(
  "full cream fresh milk 2L",
  genericMilkProduct,
  { productName: "Housebrand Full Cream Fresh Milk 1L", size: "1 L", price: 18 },
);
assert.equal(equivalentAssessment.matchTier, 2);
assert.equal(equivalentAssessment.unitsRequired, 2);
assert.equal(equivalentAssessment.totalSupplied, 2000);
assert.equal(equivalentAssessment.effectiveTotalPrice, 36);

const closestAssessment = assessCatalogueMatch(
  "full cream fresh milk 2L",
  genericMilkProduct,
  { productName: "Housebrand Full Cream Fresh Milk 1.5L", size: "1.5 L", price: 29 },
);
assert.equal(closestAssessment.matchTier, 3);
assert.equal(closestAssessment.unitsRequired, 2);
assert.equal(closestAssessment.totalSupplied, 3000);
assert.equal(closestAssessment.sizeDifferencePercent, 50);

const relatedAssessment = assessCatalogueMatch(
  "full cream fresh milk 2L",
  { ...genericMilkProduct, search_text: "fresh low fat milk dairy" },
  { productName: "Housebrand Low Fat Fresh Milk 2L", size: "2 L", price: 32 },
);
assert.equal(relatedAssessment.matchTier, 4);
assert.equal(relatedAssessment.isAlternative, true);
assert.equal(relatedAssessment.relaxedCriteria.length > 0, true);

const categoryFallbackAssessment = assessCatalogueMatch(
  "dairy",
  genericMilkProduct,
  { productName: "Housebrand Fresh Milk 2L", size: "2 L", price: 32 },
);
assert.equal(categoryFallbackAssessment.accepted, true);
assert.equal(categoryFallbackAssessment.matchTier, 5);

assert.equal(assessCatalogueMatch(
  "full cream milk 2L",
  { ...genericMilkProduct, category: "Bakery", search_text: "white bread bakery" },
  { productName: "White Bread 700g", size: "700 g", price: 18 },
).accepted, false, "genuinely different product families must be rejected");
assert.equal(assessCatalogueMatch(
  "lactose free full cream milk 2L",
  genericMilkProduct,
  { productName: "Full Cream Fresh Milk 2L", size: "2 L", price: 35 },
).accepted, false, "required dietary characteristics must not be relaxed");
assert.equal(assessCatalogueMatch(
  "milk",
  { ...genericMilkProduct, canonical_name: "Nestle Aero Milk Chocolate", category: "Confectionery", search_text: "milk chocolate bar" },
  { productName: "Nestle Aero Milk Chocolate Bar 40g", size: "40 g", price: 16.99 },
).accepted, false, "plain milk search must reject milk chocolate");
assert.equal(assessCatalogueMatch(
  "milk",
  { ...genericMilkProduct, canonical_name: "Milk Rolls", category: "Bakery", search_text: "milk rolls bakery" },
  { productName: "Milk Rolls 6 Pack", size: "6 pack", price: 29.99 },
).accepted, false, "plain milk search must reject milk rolls");
assert.equal(assessCatalogueMatch(
  "milk",
  { ...genericMilkProduct, canonical_name: "SPAR Evaporated Milk", search_text: "spar evaporated milk" },
  { productName: "SPAR Evaporated Milk 410g", size: "410 g", price: null },
).accepted, false, "plain milk search must reject evaporated milk");
assert.equal(assessCatalogueMatch(
  "eggs",
  { ...genericMilkProduct, canonical_name: "Pickled Quail Eggs", category: "Dairy", search_text: "pickled quail eggs" },
  { productName: "Pickled Quail Eggs 290g", size: "290 g", price: 109.99 },
).accepted, false, "generic eggs search must reject speciality egg products");
assert.equal(assessCatalogueMatch(
  "bread",
  { ...genericMilkProduct, canonical_name: "Bread Flour", category: "Pantry", search_text: "bread flour" },
  { productName: "Stoneground Bread Flour 2.5kg", size: "2.5 kg", price: 49.99 },
).accepted, false, "bread search must reject bread flour");
assert.equal(assessCatalogueMatch(
  "mince",
  { ...genericMilkProduct, canonical_name: "Savoury Mince", category: "Prepared meals", search_text: "savoury mince with vegetables" },
  { productName: "Savoury Mince With Vegetables 400g", size: "400 g", price: 54.99 },
).accepted, false, "plain mince search must reject prepared mince dishes");
assert.equal(assessCatalogueMatch(
  "chicken",
  { ...genericMilkProduct, canonical_name: "SPAR Chicken Livers", category: "Perishables Frozen Poultry", search_text: "spar chicken livers" },
  { productName: "SPAR Chicken Livers 500g", size: "500 g", price: null },
).accepted, false, "generic chicken search must reject offal");

for (const [query, family, category] of intentCases) {
  const product = {
    id: family,
    canonical_name: query,
    category,
    target_size: null,
    search_terms_json: "[]",
    search_text: `${query} ${family} ${category}`,
  };
  const assessment = assessCatalogueMatch(query, product, { productName: query, price: 10 });
  assert.equal(assessment.accepted, true, `representative search should be accepted for ${query}`);
  assert.equal(assessment.matchTier, 1, `representative search should be exact for ${query}`);
}

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

const balancedCalls = [];
const balancedProducts = await findBalancedProductCandidates({
  DB: {
    prepare(sql) {
      const call = { sql, bindings: [] };
      balancedCalls.push(call);
      return {
        bind(...bindings) {
          call.bindings = bindings;
          return {
            async all() {
              return {
                results: [
                  { id: "milk-a", canonical_name: "Milk A", category: "Dairy", target_size: "2 L", search_terms_json: "[]", search_text: "milk a" },
                  { id: "milk-a", canonical_name: "Milk A", category: "Dairy", target_size: "2 L", search_terms_json: "[]", search_text: "milk a" },
                  { id: "milk-b", canonical_name: "Milk B", category: "Dairy", target_size: "2 L", search_terms_json: "[]", search_text: "milk b" },
                ],
              };
            },
          };
        },
      };
    },
  },
}, ["full", "cream", "milk"], [
  { id: "pick-n-pay", name: "Pick n Pay" },
  { id: "checkers", name: "Checkers" },
  { id: "woolworths", name: "Woolworths" },
  { id: "spar", name: "SPAR" },
  { id: "makro", name: "Makro" },
], { matchAll: true, limitPerRetailer: 24 });
assert.equal(balancedCalls.length, 1, "balanced matching must use one D1 statement");
assert.doesNotMatch(balancedCalls[0].sql, /UNION ALL/, "catalogue discovery must not repeat the wildcard scan per retailer");
assert.match(balancedCalls[0].sql, /JOIN catalogue_offers/, "catalogue discovery should use the indexed product-offer relationship");
assert.match(balancedCalls[0].sql, /ROW_NUMBER\(\) OVER/, "catalogue discovery should rank candidates per retailer");
assert.match(balancedCalls[0].sql, /PARTITION BY retailer_id/, "candidate limits must be applied independently to every retailer");
assert.match(balancedCalls[0].sql, /retailer_rank <= 24/, "each retailer should retain its bounded candidate allowance");
assert.match(balancedCalls[0].sql, /LIMIT 160/, "candidate discovery must remain globally bounded");
assert.deepEqual(balancedCalls[0].bindings, [
  "pick-n-pay", "checkers", "woolworths", "spar", "makro",
  "%full%", "%cream%", "%milk%",
]);
assert.deepEqual(balancedProducts.map((product) => product.id), ["milk-a", "milk-b"]);

await findBalancedProductCandidates({
  DB: {
    prepare(sql) {
      const call = { sql, bindings: [] };
      balancedCalls.push(call);
      return {
        bind(...bindings) {
          call.bindings = bindings;
          return { async all() { return { results: [] }; } };
        },
      };
    },
  },
}, ["milk"], [
  { id: "spar", name: "SPAR" },
], { matchAll: true, limitPerRetailer: 30, preferredCategoryFamily: "dairy" });
assert.match(balancedCalls[1].sql, /category_priority DESC/, "matching category rows should rank first within a retailer");
assert.deepEqual(balancedCalls[1].bindings, [
  "spar", "%milk%", "%dairy%", "%milk%", "%egg%", "%cream%", "%butter%", "%yogh%",
]);

const diagnostics = buildRetailerDiagnostics(
  [
    { id: "pick-n-pay", name: "Pick n Pay" },
    { id: "checkers", name: "Checkers" },
    { id: "woolworths", name: "Woolworths" },
  ],
  { "pick-n-pay": 4, checkers: 3, woolworths: 0 },
  { "pick-n-pay": 2, checkers: 0, woolworths: 0 },
  { "pick-n-pay": 2, checkers: 0, woolworths: 0 },
  { checkers: { "Different product family (bread)": 3 } },
);
assert.equal(diagnostics["pick-n-pay"].emptyReason, null);
assert.match(diagnostics.checkers.emptyReason, /none were compatible/i);
assert.equal(diagnostics.checkers.rejectionReasons["Different product family (bread)"], 3);
assert.match(diagnostics.woolworths.emptyReason, /No current catalogue candidates/i);

console.log("Catalogue comparison matching tests passed.");
