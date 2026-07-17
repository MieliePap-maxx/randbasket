export interface Env {
  APP_ORIGIN: string;
  AI: Ai;
  DB: D1Database;
  PRODUCT_VECTORS?: VectorizeIndex;
  FEEDBACK_EMAIL: {
    send(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<{ messageId?: string }>;
  };
  FEEDBACK_FROM: string;
  FEEDBACK_TO: string;
  TURNSTILE_SECRET_KEY: string;
  VECTOR_INDEX_TOKEN?: string;
}

type TurnstileVerification = {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

type ProductRow = {
  id: string;
  canonical_name: string;
  category: string | null;
  target_size: string | null;
  search_terms_json: string;
  search_text: string;
};

type OfferRow = {
  product_id: string;
  retailer_id: string;
  retailer_name: string;
  product_name: string;
  brand: string | null;
  size_label: string | null;
  unit_label: string | null;
  price_cents: number | null;
  regular_price_cents: number | null;
  normalized_price_cents: number | null;
  promo_text: string | null;
  promo_type: string | null;
  promo_applied: number;
  image_url: string | null;
  product_url: string;
  location_key: string | null;
  store_code: string | null;
  store_display_name: string | null;
  latitude: number | null;
  longitude: number | null;
  last_seen_at: string | null;
};

type SearchProfileRow = {
  term: string;
  category: string | null;
  search_text: string | null;
  exclude_terms_json: string;
  preferred_terms_json: string;
};

type VocabularyRow = {
  term: string;
  usage_count: number;
};

type EmbeddingProductRow = ProductRow & {
  brands: string | null;
  retailer_names: string | null;
};

export type SemanticCandidate = {
  productId: string;
  score: number;
};

type HybridCandidate = {
  productId: string;
  lexicalScore: number;
  semanticScore: number;
  sources: Array<"keyword" | "vector">;
};

type BasketRequirement = {
  id?: string;
  productFamily?: string;
  desiredAmount?: number;
  normalizedUnit?: "mass" | "volume" | "count";
  requestedQuantity?: number;
  brandRequired?: boolean;
  sourceRetailerId?: string;
  sourceProductId?: string;
  sourceProductName?: string;
  displayLabel?: string;
};

type BasketItem = {
  id?: string;
  name?: string;
  query?: string;
  comparisonQuery?: string;
  targetSize?: string;
  quantity?: number;
  category?: string;
  selectedProductId?: string;
  selectedProductName?: string;
  selectedBrand?: string;
  imageUrl?: string;
  links?: Record<string, string>;
  requirement?: BasketRequirement;
};

type BasketSettings = {
  stores?: Record<string, boolean>;
  location?: ShopperLocation;
};

type ShopperLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  updatedAt?: string;
};

const retailers = [
  { id: "pick-n-pay", name: "Pick n Pay" },
  { id: "checkers", name: "Checkers" },
  { id: "woolworths", name: "Woolworths" },
  { id: "spar", name: "SPAR" },
  { id: "makro", name: "Makro" },
];

export const PRODUCT_EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const PRODUCT_EMBEDDING_DIMENSIONS = 384;
export const PRODUCT_EMBEDDING_POOLING = "cls";
export const PRODUCT_VECTOR_INDEX_NAME = "randbasket-products";
export const MIN_SEMANTIC_SIMILARITY = 0.78;
const SEMANTIC_CANDIDATE_LIMIT = 40;
const VECTOR_INDEX_BATCH_SIZE = 32;

export type MatchTier = 1 | 2 | 3 | 4 | 5;

export type QueryIntent = {
  originalQuery: string;
  normalizedQuery: string;
  retailerId: string | null;
  productFamily: string;
  categoryFamily: string;
  brand: string | null;
  requestedSize: PackageMeasure | null;
  requiredCharacteristics: string[];
  preferredCharacteristics: string[];
  informationalTerms: string[];
  discoveryTerms: string[];
};

export type CatalogueMatchAssessment = {
  accepted: boolean;
  rejectionReason: string | null;
  matchTier: MatchTier;
  matchType: "exact" | "equivalent-quantity" | "closest-size" | "related-variant" | "category-fallback";
  matchScore: number;
  matchConfidence: number;
  matchReasons: string[];
  relaxedCriteria: string[];
  requestedSize: string | null;
  offeredSize: string | null;
  unitsRequired: number;
  totalSupplied: number | null;
  effectiveTotalPrice: number | null;
  sizeDifferencePercent: number | null;
  isExactMatch: boolean;
  isAlternative: boolean;
  alternativeReason: string | null;
  scoreBreakdown: Record<string, number>;
};

const familyRules: Array<{ family: string; category: string; pattern: RegExp; aliases: string[] }> = [
  { family: "milk", category: "dairy", pattern: /\b(?:milk|maas|amasi)\b/, aliases: ["milk", "maas", "amasi"] },
  { family: "bread", category: "bakery", pattern: /\b(?:bread|loaf)\b/, aliases: ["bread", "loaf"] },
  { family: "eggs", category: "dairy", pattern: /\beggs?\b/, aliases: ["egg", "eggs"] },
  { family: "mince", category: "meat", pattern: /\b(?:mince|minced meat|ground (?:beef|meat))\b/, aliases: ["mince", "minced", "ground beef"] },
  { family: "chicken", category: "meat", pattern: /\b(?:chicken|poultry)\b/, aliases: ["chicken", "poultry"] },
  { family: "flour", category: "pantry", pattern: /\bflour\b/, aliases: ["flour"] },
  { family: "sugar", category: "pantry", pattern: /\bsugar\b/, aliases: ["sugar"] },
  { family: "rice", category: "pantry", pattern: /\brice\b/, aliases: ["rice"] },
  { family: "oil", category: "pantry", pattern: /\b(?:(?:cooking|sunflower|canola|vegetable|olive)\s+oil|oil)\b/, aliases: ["oil", "cooking oil"] },
  { family: "coffee", category: "beverages", pattern: /\bcoffee\b/, aliases: ["coffee"] },
  { family: "tea", category: "beverages", pattern: /\btea\b/, aliases: ["tea"] },
  { family: "toothpaste", category: "personal care", pattern: /\b(?:toothpaste|tooth paste)\b/, aliases: ["toothpaste", "tooth paste"] },
  { family: "toilet paper", category: "household", pattern: /\b(?:toilet paper|toilet tissue|bathroom tissue|loo roll)\b/, aliases: ["toilet paper", "toilet tissue", "bathroom tissue"] },
  { family: "laundry detergent", category: "household", pattern: /\b(?:laundry detergent|washing powder|washing liquid|laundry capsules?|laundry pods?)\b/, aliases: ["laundry detergent", "washing powder", "washing liquid"] },
  { family: "dishwashing", category: "household", pattern: /\b(?:dishwashing|dish washing|dishwasher|dish soap|washing up liquid)\b/, aliases: ["dishwashing", "dish soap", "washing up liquid"] },
  { family: "dog food", category: "pet", pattern: /\b(?:dog food|dog pellets?|dog kibble)\b/, aliases: ["dog food", "dog pellets", "dog kibble"] },
  { family: "cat food", category: "pet", pattern: /\b(?:cat food|cat pellets?|cat kibble)\b/, aliases: ["cat food", "cat pellets", "cat kibble"] },
  { family: "cereal", category: "pantry", pattern: /\b(?:cereal|corn flakes|muesli|granola|porridge|oats)\b/, aliases: ["cereal", "corn flakes", "muesli", "oats"] },
  { family: "braai", category: "meat", pattern: /\b(?:braai|barbecue|boerewors|wors)\b/, aliases: ["braai", "barbecue", "boerewors", "wors"] },
];

const specificFamilyPriority = [
  "dog food", "cat food", "toilet paper", "laundry detergent", "dishwashing", "toothpaste", "cereal", "braai",
];

function matchingFamilyRule(text: string) {
  return familyRules
    .filter(({ pattern }) => pattern.test(text))
    .sort((left, right) => {
      const leftIndex = specificFamilyPriority.indexOf(left.family);
      const rightIndex = specificFamilyPriority.indexOf(right.family);
      return (leftIndex < 0 ? Number.POSITIVE_INFINITY : leftIndex)
        - (rightIndex < 0 ? Number.POSITIVE_INFINITY : rightIndex);
    })[0];
}

const semanticAliasRules = [
  {
    matches: /\b(?:full cream|whole|full fat)\s+(?:fresh\s+)?milk\b/,
    aliases: ["full cream milk", "whole milk", "full fat milk", "fresh dairy milk"],
  },
  {
    matches: /\b(?:boerewors|steaks?|lamb chops?|sosaties?|chicken wings?|chicken drumsticks?)\b/,
    aliases: ["food for a braai", "braai food", "barbecue meat"],
  },
  {
    matches: /\b(?:children s|childrens|kids?|family)\s+(?:breakfast\s+)?cereal\b|\bbreakfast cereal\b/,
    aliases: ["children's cereal", "kids cereal", "family breakfast cereal"],
  },
  {
    matches: /\bbread\b/,
    aliases: ["bread for toast", "toast bread", "sandwich bread"],
  },
  {
    matches: /\b(?:washing powder|laundry detergent)\b/,
    aliases: ["washing powder", "laundry detergent", "clothes washing detergent"],
  },
  {
    matches: /\bsensitive(?: skin)?\b/,
    aliases: ["sensitive skin", "gentle", "hypoallergenic"],
  },
];

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  const allowed = [env.APP_ORIGIN, "https://randbasket.co.za", "https://www.randbasket.co.za"];
  return {
    "access-control-allow-origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
}

function json(request: Request, env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clean(text: unknown) {
  return String(text || "")
    .replace(/(?<=\d)(?=[a-zA-Z])/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeRetailerId(value: unknown) {
  const normalized = clean(value);
  return retailers.find((retailer) =>
    clean(retailer.id) === normalized || clean(retailer.name) === normalized)?.id || normalized.replace(/\s+/g, "-");
}

function tokens(text: string) {
  return [...new Set(clean(text).split(" ").filter((term) => term.length > 1))];
}

const fuzzyMeasurementTokens = new Set(["kg", "g", "ml", "l", "ct", "pk", "pack"]);

function orderedTokens(text: string) {
  return clean(text).split(" ").filter(Boolean);
}

function isNumericToken(value: string) {
  return /\d/.test(value);
}

function isMeaningfulFuzzyToken(value: string) {
  return Boolean(value)
    && !isNumericToken(value)
    && !fuzzyMeasurementTokens.has(value);
}

export function levenshteinDistance(leftValue: string, rightValue: string) {
  const left = clean(leftValue);
  const right = clean(rightValue);
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

export function fuzzyTokenSimilarity(queryToken: string, candidateToken: string) {
  const left = clean(queryToken);
  const right = clean(candidateToken);
  if (!left || !right) return 0;
  if (!isMeaningfulFuzzyToken(left) || !isMeaningfulFuzzyToken(right)) return 0;
  if (left === right) return 1;
  if (left.length < 4 || right.length < 4) return 0;
  const maximumDistance = Math.max(left.length, right.length) <= 5 ? 1 : 2;
  const distance = levenshteinDistance(left, right);
  if (distance > maximumDistance) return 0;
  const longest = Math.max(left.length, right.length);
  return longest ? Math.max(0, 1 - distance / longest) : 0;
}

export function fuzzyQueryCoverage(query: string, candidateText: string) {
  const queryTokens = orderedTokens(query).filter(isMeaningfulFuzzyToken);
  const candidateTokens = orderedTokens(candidateText).filter(isMeaningfulFuzzyToken);
  if (!queryTokens.length || !candidateTokens.length) return 0;
  const usedCandidates = new Set<number>();
  let total = 0;
  for (const queryToken of queryTokens) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < candidateTokens.length; index += 1) {
      if (usedCandidates.has(index)) continue;
      const candidateToken = candidateTokens[index];
      const score = queryToken === candidateToken ? 1 : fuzzyTokenSimilarity(queryToken, candidateToken);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex >= 0) usedCandidates.add(bestIndex);
    total += bestScore;
  }
  return total / queryTokens.length;
}

export const fuzzyTermCoverage = fuzzyQueryCoverage;

export function exactQueryCoverage(query: string, candidateText: string) {
  const queryTokens = orderedTokens(query).filter((term) =>
    !fuzzyMeasurementTokens.has(term) && !/^\d+(?:\.\d+)?$/.test(term));
  const candidateTokens = new Set(orderedTokens(candidateText));
  if (!queryTokens.length || !candidateTokens.size) return 0;
  return queryTokens.filter((term) => candidateTokens.has(term)).length / queryTokens.length;
}

export function stripRetailerAliases(text: string) {
  return clean(text)
    .replace(/\b(?:pick n pay|pick and pay|pnp|checkers|woolworths|woolies|spar|makro)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chooseVocabularyCorrection(tokenValue: string, candidates: VocabularyRow[]) {
  const token = clean(tokenValue);
  if (token.length < 4 || !isMeaningfulFuzzyToken(token)) return token;
  const ranked = candidates
    .map((candidate) => ({
      term: clean(candidate.term),
      usageCount: Number(candidate.usage_count || 0),
      similarity: fuzzyTokenSimilarity(token, candidate.term),
    }))
    .filter((candidate) => candidate.term && candidate.similarity >= 0.8)
    .sort((left, right) =>
      right.similarity - left.similarity
      || right.usageCount - left.usageCount
      || left.term.localeCompare(right.term));
  const best = ranked[0];
  if (!best) return token;
  const second = ranked[1];
  if (second
    && best.similarity - second.similarity < 0.05
    && best.usageCount < Math.max(2, second.usageCount * 2)) return token;
  return best.term;
}

async function correctCatalogueQuery(env: Env, originalQuery: string, correctionEnabled: boolean) {
  const normalizedQuery = clean(originalQuery);
  if (!correctionEnabled) {
    return { correctedQuery: normalizedQuery, correctionApplied: false };
  }
  // Deliberate, constant-time corrections only. Search no longer performs a
  // Levenshtein vocabulary scan during customer requests.
  const knownCorrections: Record<string, string> = {
    chiken: "chicken",
    minse: "mince",
    creem: "cream",
    flouer: "flour",
    bred: "bread",
    yogert: "yogurt",
    avocdo: "avocado",
    toothpase: "toothpaste",
  };
  const queryTokens = orderedTokens(normalizedQuery);
  const correctedTokens = queryTokens.map((token) => knownCorrections[token] || token);
  return {
    correctedQuery: correctedTokens.join(" "),
    correctionApplied: correctedTokens.some((token, index) => token !== queryTokens[index]),
  };
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function uniqueCleanValues(values: Array<string | null | undefined>, limit = 12) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function sortedUniqueCleanValues(values: Array<string | null | undefined>, limit = 12) {
  return uniqueCleanValues(values, Number.MAX_SAFE_INTEGER).sort().slice(0, limit);
}

function controlledSemanticAliases(text: string) {
  const normalized = clean(text);
  return uniqueCleanValues(semanticAliasRules
    .filter((rule) => rule.matches.test(normalized))
    .flatMap((rule) => rule.aliases), 16);
}

export function buildProductEmbeddingText(
  product: ProductRow,
  options: {
    brands?: string[];
    retailerNames?: string[];
    profiles?: SearchProfileRow[];
  } = {},
) {
  const searchTerms = parseJsonArray(product.search_terms_json);
  const profileTerms = (options.profiles || [])
    .filter((profile) => matchesSearchTerm(
      `${product.canonical_name} ${product.search_text}`,
      profile.term,
    ))
    .flatMap((profile) => [
      profile.term,
      ...parseJsonArray(profile.preferred_terms_json),
    ]);
  const aliases = controlledSemanticAliases([
    product.canonical_name,
    product.category,
    product.search_text,
    ...searchTerms,
    ...profileTerms,
  ].join(" "));
  const lines = [
    `Product: ${clean(product.canonical_name)}`,
    product.category ? `Category: ${clean(product.category)}` : "",
    product.target_size ? `Target size: ${clean(product.target_size)}` : "",
    searchTerms.length ? `Search terms: ${sortedUniqueCleanValues(searchTerms).join(", ")}` : "",
    product.search_text ? `Search text: ${clean(product.search_text)}` : "",
    profileTerms.length ? `Preferred terms: ${sortedUniqueCleanValues(profileTerms).join(", ")}` : "",
    aliases.length ? `Aliases: ${aliases.sort().join(", ")}` : "",
    options.brands?.length ? `Brands: ${sortedUniqueCleanValues(options.brands, 8).join(", ")}` : "",
    options.retailerNames?.length
      ? `Retailer names: ${sortedUniqueCleanValues(options.retailerNames, 5).join("; ")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function mergeHybridCandidates(
  lexicalCandidates: Array<{ productId: string; lexicalScore: number }>,
  semanticCandidates: SemanticCandidate[],
) {
  const merged = new Map<string, HybridCandidate>();
  for (const candidate of lexicalCandidates) {
    merged.set(candidate.productId, {
      productId: candidate.productId,
      lexicalScore: candidate.lexicalScore,
      semanticScore: 0,
      sources: ["keyword"],
    });
  }
  for (const candidate of semanticCandidates) {
    if (candidate.score < MIN_SEMANTIC_SIMILARITY) continue;
    const existing = merged.get(candidate.productId);
    if (existing) {
      existing.semanticScore = Math.max(existing.semanticScore, candidate.score);
      if (!existing.sources.includes("vector")) existing.sources.push("vector");
    } else {
      merged.set(candidate.productId, {
        productId: candidate.productId,
        lexicalScore: 0,
        semanticScore: candidate.score,
        sources: ["vector"],
      });
    }
  }
  return [...merged.values()];
}

export function semanticScoreBonus(score: number) {
  if (score < MIN_SEMANTIC_SIMILARITY) return 0;
  return Math.min(0.8, (score - MIN_SEMANTIC_SIMILARITY) * 4);
}

function embeddingVectors(response: unknown) {
  if (!response || typeof response !== "object") return [] as number[][];
  const data = (response as { data?: unknown }).data;
  if (!Array.isArray(data)) return [] as number[][];
  if (data.length && data.every((value) => typeof value === "number")) return [data as number[]];
  return data.filter((value): value is number[] =>
    Array.isArray(value) && value.every((entry) => typeof entry === "number"));
}

function shouldRunSemanticSearch(query: string) {
  const normalized = stripRetailerAliases(query);
  if (!normalized || /^https?:\/\//i.test(query)) return false;
  const meaningful = orderedTokens(normalized).filter((term) =>
    isMeaningfulFuzzyToken(term) && term.length >= 3);
  return meaningful.length > 0 && !/^[a-z]{0,4}\d{5,}$/i.test(normalized.replace(/\s+/g, ""));
}

export async function findSemanticProductCandidates(
  env: Pick<Env, "AI" | "PRODUCT_VECTORS">,
  query: string,
  options: { limit?: number } = {},
): Promise<SemanticCandidate[]> {
  const productVectors = env.PRODUCT_VECTORS;
  if (!shouldRunSemanticSearch(query) || !env.AI || !productVectors) return [];
  try {
    const response = await env.AI.run(PRODUCT_EMBEDDING_MODEL, {
      text: [stripRetailerAliases(query)],
      pooling: PRODUCT_EMBEDDING_POOLING,
    });
    const vector = embeddingVectors(response)[0];
    if (!vector || vector.length !== PRODUCT_EMBEDDING_DIMENSIONS) return [];
    const topK = Math.min(50, Math.max(1, options.limit || SEMANTIC_CANDIDATE_LIMIT));
    const result = await productVectors.query(vector, {
      topK,
      returnMetadata: "none",
      returnValues: false,
    });
    return (result.matches || [])
      .map((match) => ({ productId: String(match.id), score: Number(match.score) }))
      .filter((candidate) =>
        candidate.productId
        && Number.isFinite(candidate.score)
        && candidate.score >= MIN_SEMANTIC_SIMILARITY);
  } catch (error) {
    console.warn("Semantic catalogue search unavailable; using lexical search only.", error);
    return [];
  }
}

function semanticSafetyQuery(query: string) {
  const normalized = stripRetailerAliases(query);
  if (/\b(?:whole|full fat)\s+(?:fresh\s+)?milk\b/.test(normalized)
    && !includesPhrase(normalized, "full cream")) {
    return `${normalized} full cream`;
  }
  return normalized;
}

export function semanticCandidatePassesHardRules(
  query: string,
  product: ProductRow,
  store: { productName: string; brand?: string; size?: string },
  profiles: SearchProfileRow[],
) {
  const safetyQuery = semanticSafetyQuery(query);
  const offerText = clean([store.productName, store.brand, store.size].join(" "));
  const requestedFamily = inferredCategoryFamily(safetyQuery);
  const offeredFamily = resolvedCategoryFamily(product.category, `${product.search_text} ${offerText}`);
  if (requestedFamily && offeredFamily && requestedFamily !== offeredFamily) return false;
  if (!compareCharacteristics(safetyQuery, offerText).valid) return false;
  const size = sizeCompatibility(query, store.size || store.productName);
  if (!size.valid) return false;
  const requestedMeasure = parseMeasure(query);
  const offeredMeasure = parseMeasure(store.size || store.productName);
  if (requestedMeasure?.kind === "count"
    && offeredMeasure?.kind === "count"
    && requestedMeasure.amount !== offeredMeasure.amount) return false;
  return isStoreEligible(safetyQuery, product.category || undefined, store, profiles);
}

export function scoreProduct(query: string, product: ProductRow, profiles: SearchProfileRow[]) {
  const normalizedQuery = stripRetailerAliases(query);
  const searchText = product.search_text || "";
  const queryTokens = tokens(normalizedQuery);
  const searchTokens = tokens(searchText);
  const exactHits = queryTokens.filter((term) => searchTokens.includes(term)).length;
  const exactCoverage = exactHits / Math.max(queryTokens.length, 1);
  const fuzzyCoverage = fuzzyQueryCoverage(normalizedQuery, searchText);
  if (!exactHits && fuzzyCoverage < 0.72) return -999;

  let score = Math.max(exactCoverage, fuzzyCoverage);
  if (fuzzyCoverage > exactCoverage) score += Math.min(0.25, (fuzzyCoverage - exactCoverage) * 0.35);
  const canonical = clean(product.canonical_name);
  if (canonical === normalizedQuery) score += 5;
  else if (canonical.startsWith(normalizedQuery)) score += 2.5;
  else if (canonical.includes(normalizedQuery)) score += 1.25;
  if (product.target_size && normalizedQuery.includes(clean(product.target_size))) score += 2;

  const longestProfile = matchingProfile(normalizedQuery, canonical, profiles);
  if (longestProfile) {
    const profileFamily = categoryFamily(longestProfile.category);
    const productFamily = resolvedCategoryFamily(product.category, searchText);
    if (profileFamily && productFamily === profileFamily) score += 3;
    else if (profileFamily && productFamily) score -= 1.5;
    for (const term of parseJsonArray(longestProfile.exclude_terms_json)) {
      const excluded = clean(term);
      if (excluded && !normalizedQuery.includes(excluded) && searchText.includes(excluded)) score -= 5;
    }
    for (const term of parseJsonArray(longestProfile.preferred_terms_json)) {
      const preferred = clean(term);
      if (preferred && searchText.includes(preferred)) score += 2;
    }
  }
  return score;
}

export function scoreStore(query: string, product: ProductRow, store: { productName: string; brand?: string; size?: string }, profiles: SearchProfileRow[]) {
  const normalizedQuery = stripRetailerAliases(query);
  const offerText = clean([store.productName, store.brand, store.size].join(" "));
  const profile = matchingProfile(normalizedQuery, offerText, profiles);
  const queryTokens = tokens(normalizedQuery);
  const coreTokens = queryTokens.filter((term) => !["kg", "g", "ml", "l"].includes(term) && !/^\d+(?:\.\d+)?$/.test(term));
  const offerTokens = tokens(offerText);
  const exactCoreHits = coreTokens.filter((term) => offerTokens.includes(term)).length;
  const exactRequirement = Math.max(1, coreTokens.length - 1);
  const fuzzyCoreCoverage = fuzzyQueryCoverage(coreTokens.join(" "), offerText);
  if (exactCoreHits < exactRequirement && fuzzyCoreCoverage < 0.78) return -999;

  const requestedMeasure = parseMeasure(query);
  const offeredMeasure = parseMeasure(store.size || store.productName);
  if (requestedMeasure && offeredMeasure && requestedMeasure.kind !== offeredMeasure.kind) return -999;

  let score = scoreProduct(query, product, profiles)
    + exactCoreHits * 3
    + (fuzzyCoreCoverage > exactCoreHits / Math.max(coreTokens.length, 1) ? fuzzyCoreCoverage * 1.5 : 0);
  if (requestedMeasure && offeredMeasure) {
    const ratio = offeredMeasure.amount / requestedMeasure.amount;
    if (Math.abs(1 - ratio) < 0.01) score += 5;
    else score += Math.max(0, 3 - Math.abs(Math.log(ratio)));
  }
  if (profile) {
    for (const term of parseJsonArray(profile.exclude_terms_json)) {
      const excluded = clean(term);
      if (excluded && !normalizedQuery.includes(excluded) && offerText.includes(excluded)) score -= 15;
    }
    for (const term of parseJsonArray(profile.preferred_terms_json)) {
      const preferred = clean(term);
      if (preferred && offerText.includes(preferred)) score += 2;
    }
  }
  return score;
}

export function categoryFamily(value: string | undefined | null) {
  const category = clean(value);
  if (!category) return "";
  if (/\b(?:meat|poultry|seafood)\b/.test(category)) return "meat";
  if (/\b(?:dairy|milk|eggs?)\b/.test(category)) return "dairy";
  if (/\b(?:bakery|bread)\b/.test(category)) return "bakery";
  if (/\b(?:pantry|food cupboard)\b/.test(category)) return "pantry";
  if (/\b(?:fruit|vegetables?|produce)\b/.test(category)) return "produce";
  if (/\b(?:beverages?|drinks?)\b/.test(category)) return "beverages";
  if (/\b(?:frozen|freezer)\b/.test(category)) return "frozen food";
  if (/\b(?:cleaning|household|laundry)\b/.test(category)) return "household";
  if (/\b(?:personal care|health|beauty|toiletries)\b/.test(category)) return "personal care";
  if (/\b(?:baby|infant)\b/.test(category)) return "baby";
  if (/\b(?:pet|dog|cat)\b/.test(category)) return "pet";
  return category;
}

export function inferredCategoryFamily(text: string) {
  const normalized = clean(text);
  if (/\b(?:milk|cheese|butter|yogh?urt|cream|eggs?)\b/.test(normalized)) return "dairy";
  if (/\b(?:bread|rolls?|buns?|croissants?|wraps?)\b/.test(normalized)) return "bakery";
  if (/\b(?:beef|chicken|pork|lamb|turkey|venison|mince|steak|boerewors|seafood|fish|braai|barbecue)\b/.test(normalized)) return "meat";
  if (/\b(?:apples?|bananas?|potatoes|onions?|vegetables?|fruit|mushrooms?|butternut)\b/.test(normalized)) return "produce";
  if (/\b(?:juice|coffee|tea|cooldrink|soft drink|water)\b/.test(normalized)) return "beverages";
  if (/\b(?:flour|sugar|rice|pasta|cereal|sauce|spices?|oil|peanut butter)\b/.test(normalized)) return "pantry";
  if (/\b(?:toothpaste|shampoo|soap|deodorant|lotion|toiletries)\b/.test(normalized)) return "personal care";
  if (/\b(?:detergent|washing powder|dishwashing|bleach|toilet tissue|cleaner)\b/.test(normalized)) return "household";
  return "";
}

function resolvedCategoryFamily(category: string | undefined | null, text = "") {
  const family = categoryFamily(category);
  if (family && !["groceries", "grocery", "food", "all products", "uncategorized", "other"].includes(family)) return family;
  return inferredCategoryFamily(text) || family;
}

function isStoreEligible(query: string, productCategory: string | undefined, store: { productName: string; brand?: string; size?: string }, profiles: SearchProfileRow[]) {
  const normalizedQuery = stripRetailerAliases(query);
  const requestedMeasure = parseMeasure(query);
  const offeredMeasure = parseMeasure(store.size || store.productName);
  if (requestedMeasure && !offeredMeasure) return false;
  if (requestedMeasure && offeredMeasure && requestedMeasure.kind !== offeredMeasure.kind) return false;
  const offerText = clean([store.productName, store.brand, store.size].join(" "));
  if (!compareCharacteristics(normalizedQuery, offerText).valid) return false;
  const profile = matchingProfile(normalizedQuery, offerText, profiles);
  if (!profile) return true;
  if (profile.category
    && resolvedCategoryFamily(productCategory, offerText)
    && categoryFamily(profile.category) !== resolvedCategoryFamily(productCategory, offerText)) return false;
  if (!matchesSearchTerm(offerText, profile.term)) return false;
  const hasExcludedTerm = parseJsonArray(profile.exclude_terms_json).some((term) => {
    const excluded = clean(term);
    return excluded && !normalizedQuery.includes(excluded) && offerText.includes(excluded);
  });
  if (hasExcludedTerm) return false;
  return true;
}

function centsToPrice(cents: number | null) {
  return cents == null ? null : Number((cents / 100).toFixed(2));
}

type Measure = { amount: number; kind: "mass" | "volume" | "count" };

type PackageMeasure = Measure & {
  packageQuantity: number;
  singleUnitAmount: number;
  multipackCount: number;
  normalizedUnit: "g" | "ml" | "count";
};

function normalizeMeasureText(value: string | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[']/g, "")
    .replace(/litres?|liters?/g, "l")
    .replace(/millilitres?|milliliters?/g, "ml")
    .replace(/kilograms?/g, "kg")
    .replace(/grams?/g, "g")
    .replace(/[×Ã—]/g, "x");
}

export function parsePackageMeasure(value: string | undefined): PackageMeasure | null {
  const text = normalizeMeasureText(value);
  const multipack = text.match(/\b(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  const match = multipack || text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (match) {
    const multipackCount = multipack ? Number(match[1]) : 1;
    const rawAmount = Number(multipack ? match[2] : match[1]);
    const unit = multipack ? match[3] : match[2];
    if (!Number.isFinite(multipackCount) || !Number.isFinite(rawAmount) || multipackCount <= 0 || rawAmount <= 0) return null;
    const kind = unit === "kg" || unit === "g" ? "mass" : "volume";
    const singleUnitAmount = unit === "kg" || unit === "l" ? rawAmount * 1000 : rawAmount;
    return {
      amount: multipackCount * singleUnitAmount,
      kind,
      packageQuantity: multipackCount * singleUnitAmount,
      singleUnitAmount,
      multipackCount,
      normalizedUnit: kind === "mass" ? "g" : "ml",
    };
  }
  const perUnit = text.match(/\bper\s+(kg|g|ml|l)\b/);
  if (perUnit) return parsePackageMeasure(`1 ${perUnit[1]}`);
  const count = text.match(/\b(\d+(?:\.\d+)?)[\s-]*(?:pack|pk|count|ct|pieces?|units?|eggs?|ea|s)\b/);
  if (count && Number(count[1]) > 0) {
    const amount = Number(count[1]);
    return { amount, kind: "count", packageQuantity: amount, singleUnitAmount: 1, multipackCount: amount, normalizedUnit: "count" };
  }
  if (/\bdozen\b/.test(text)) {
    return { amount: 12, kind: "count", packageQuantity: 12, singleUnitAmount: 1, multipackCount: 12, normalizedUnit: "count" };
  }
  return null;
}

export function planPackageFulfilment(targetText: string | undefined, offerText: string | undefined) {
  const target = parsePackageMeasure(targetText);
  const offered = parsePackageMeasure(offerText);
  if (!target) {
    return { valid: true, unitsRequired: 1, totalSupplied: offered?.amount ?? null, oversupplyRatio: 0, score: 0, difference: 0, reason: "No requested pack size" };
  }
  if (!offered || target.kind !== offered.kind) {
    return { valid: false, unitsRequired: 0, totalSupplied: null, oversupplyRatio: Number.POSITIVE_INFINITY, score: Number.NEGATIVE_INFINITY, difference: Number.POSITIVE_INFINITY, reason: "Incompatible pack size" };
  }
  const unitsRequired = Math.ceil(target.amount / offered.amount);
  const totalSupplied = offered.amount * unitsRequired;
  const oversupplyRatio = Math.max(0, (totalSupplied - target.amount) / target.amount);
  const exact = Math.abs(totalSupplied - target.amount) < 0.01;
  const difference = Math.abs(Math.log(totalSupplied / target.amount));
  return {
    valid: true,
    unitsRequired,
    totalSupplied,
    oversupplyRatio,
    score: exact ? (unitsRequired === 1 ? 40 : Math.max(24, 36 - unitsRequired)) : Math.max(0, 28 - Math.min(24, oversupplyRatio * 18) - Math.min(10, (unitsRequired - 1) * 1.25)),
    difference,
    reason: exact
      ? (unitsRequired === 1 ? "Exact pack size" : `${unitsRequired} packs exactly meet the requested size`)
      : `${unitsRequired} pack${unitsRequired === 1 ? "" : "s"} supply ${Math.round(oversupplyRatio * 100)}% extra`,
  };
}

export function parseMeasure(value: string | undefined) {
  const packageMeasure = parsePackageMeasure(value);
  if (packageMeasure) return { amount: packageMeasure.amount, kind: packageMeasure.kind } satisfies Measure;
  const text = String(value || "").toLowerCase().replace(/[']/g, "");
  const multipack = text.match(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  const match = multipack || text.match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (match) {
    const amount = multipack ? Number(match[1]) * Number(match[2]) : Number(match[1]);
    const unit = multipack ? match[3] : match[2];
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === "kg") return { amount: amount * 1000, kind: "mass" } satisfies Measure;
    if (unit === "g") return { amount, kind: "mass" } satisfies Measure;
    if (unit === "l") return { amount: amount * 1000, kind: "volume" } satisfies Measure;
    return { amount, kind: "volume" } satisfies Measure;
  }
  const perUnit = text.match(/\bper\s+(kg|g|ml|l)\b/);
  if (perUnit) return parseMeasure(`1 ${perUnit[1]}`);
  const count = text.match(/\b(\d+(?:\.\d+)?)[\s-]*(?:pack|pk|count|ct|pieces?|units?|eggs?|ea|s)\b/);
  if (count && Number(count[1]) > 0) return { amount: Number(count[1]), kind: "count" };
  if (/\bdozen\b/.test(text)) return { amount: 12, kind: "count" };
  return null;
}

export function normaliseForTarget(price: number | null, offeredSize: string | undefined, targetSize: string | undefined) {
  if (price == null) return null;
  const target = parseMeasure(targetSize);
  if (!target) return price;
  const fulfilment = planPackageFulfilment(targetSize, offeredSize);
  return fulfilment.valid ? Number((price * fulfilment.unitsRequired).toFixed(2)) : null;
}

function validLocation(value: unknown): ShopperLocation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ShopperLocation>;
  if (candidate.latitude == null || candidate.longitude == null) return undefined;
  const latitude = Number(candidate.latitude);
  const longitude = Number(candidate.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude, accuracy: Number(candidate.accuracy) || undefined, updatedAt: candidate.updatedAt };
}

function distanceKm(location: ShopperLocation | undefined, latitude: number | null, longitude: number | null) {
  if (!location || latitude == null || longitude == null) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(latitude - location.latitude);
  const lonDelta = radians(longitude - location.longitude);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(location.latitude)) * Math.cos(radians(latitude)) * Math.sin(lonDelta / 2) ** 2;
  return Number((6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
}

function isOfferVisibleAtLocation(offer: OfferRow, location?: ShopperLocation) {
  if (!offer.location_key || offer.location_key.startsWith("national")) return true;
  const distance = distanceKm(location, offer.latitude, offer.longitude);
  return distance != null && distance <= 120;
}

function offerToStore(offer: OfferRow, location?: ShopperLocation) {
  const price = offer.price_cents && offer.price_cents > 0 ? centsToPrice(offer.price_cents) : null;
  const normalizedPrice = offer.normalized_price_cents && offer.normalized_price_cents > 0
    ? centsToPrice(offer.normalized_price_cents)
    : null;
  const regularPrice = centsToPrice(offer.regular_price_cents);
  return {
    storeId: offer.retailer_id,
    storeName: offer.retailer_name,
    productName: offer.product_name,
    brand: offer.brand || undefined,
    size: offer.size_label || undefined,
    unit: offer.unit_label || undefined,
    priceCents: offer.price_cents && offer.price_cents > 0 ? offer.price_cents : null,
    price,
    normalizedPrice,
    regularPrice,
    promoText: offer.promo_text || undefined,
    promoApplied: Boolean(offer.promo_applied),
    imageUrl: offer.image_url || undefined,
    status: price == null ? "catalogue-price-missing" : "cached",
    url: offer.product_url,
    retailerProductId: offer.product_id,
    storeCode: offer.store_code || undefined,
    storeDisplayName: offer.store_display_name || undefined,
    distanceKm: distanceKm(location, offer.latitude, offer.longitude),
    lastSeenAt: offer.last_seen_at || undefined,
  };
}

function comparableStoreValue(query: string, product: { targetSize?: string }, store: ReturnType<typeof offerToStore>) {
  if (store.price == null) return Number.POSITIVE_INFINITY;
  const offered = parseMeasure(store.size || store.productName);
  const requested = parseMeasure(query);
  if (requested && store.normalizedPrice != null) return store.normalizedPrice;
  if (offered && requested && offered.kind === requested.kind) {
    return store.price * requested.amount / offered.amount;
  }
  if (offered) return store.price * 1000 / offered.amount;
  return store.price;
}

const characteristicGroups = [
  { terms: ["full cream", "low fat", "fat free", "skim", "medium fat"], required: true },
  { terms: ["fresh", "long life", "uht", "powdered", "powder"], requiredContexts: ["milk"] },
  { terms: ["plain", "chocolate", "strawberry", "vanilla", "flavoured", "flavored"], required: true },
  { terms: ["white", "brown", "whole wheat", "wholewheat"], required: true },
  { terms: ["beef", "chicken", "pork", "lamb", "turkey", "venison"], required: true },
];

function includesPhrase(text: string, phrase: string) {
  return ` ${clean(text)} `.includes(` ${clean(phrase)} `);
}

export function matchesSearchTerm(text: string, term: string) {
  const normalizedTerm = clean(term);
  if (includesPhrase(text, normalizedTerm)) return true;
  return exactQueryCoverage(normalizedTerm, text) >= 0.8;
}

function eggSize(text: string) {
  const normalized = clean(text);
  if (!/\beggs?\b/.test(normalized)) return "";
  return ["extra large", "jumbo", "large", "medium", "small"]
    .find((size) => includesPhrase(normalized, size)) || "";
}

function flourType(text: string) {
  const normalized = clean(text);
  if (!/\bflour\b/.test(normalized)) return "";
  if (includesPhrase(normalized, "self raising")) return "self raising";
  if (includesPhrase(normalized, "whole wheat") || includesPhrase(normalized, "wholewheat")) return "whole wheat";
  if (includesPhrase(normalized, "bread")) return "bread";
  if (includesPhrase(normalized, "cake")) return "cake";
  return "";
}

function chickenForm(text: string) {
  const normalized = clean(text);
  if (!/\bchicken\b/.test(normalized)) return "";
  if (/\b(?:mala|offal|giblets?|livers?|necks?|heads?|feet)\b/.test(normalized)) return "offal";
  if (includesPhrase(normalized, "mixed portions") || includesPhrase(normalized, "chicken portions")) return "portions";
  if (/\b(?:breasts?|fillets?)\b/.test(normalized)) return "breast";
  const cutHits = ["drumstick", "thigh", "wing"]
    .filter((cut) => new RegExp(`\\b${cut}s?\\b`).test(normalized));
  if (cutHits.length > 1) return "portions";
  if (includesPhrase(normalized, "whole chicken")) return "whole";
  return cutHits[0] || "";
}

function processedMinceTerms(text: string) {
  const normalized = clean(text);
  return [
    "savoury",
    "savory",
    "bolognaise",
    "chilli",
    "curried",
    "curry",
    "soya",
    "plant based",
    "with vegetables",
    "sauce",
    "seasoning",
    "dog food",
    "cat food",
    "pet food",
    "pet mince",
  ].filter((term) => includesPhrase(normalized, term));
}

export function normalizedProductFamily(text: string, category = "") {
  const normalized = clean(`${category} ${text}`);
  return matchingFamilyRule(normalized)?.family || "";
}

export function compareCharacteristics(referenceText: string, offerText: string) {
  const referenceFamily = normalizedProductFamily(referenceText);
  const offerFamily = normalizedProductFamily(offerText);
  if (referenceFamily && offerFamily && referenceFamily !== offerFamily) return { valid: false, matches: 0 };
  if (referenceFamily === "milk") {
    const plantMilk = /\b(?:almond|oat|soy|soya|coconut|rice)\s+(?:drink|milk)\b/;
    const referencePlant = plantMilk.test(clean(referenceText));
    const offerPlant = plantMilk.test(clean(offerText));
    if (referencePlant !== offerPlant) return { valid: false, matches: 0 };
    const referenceLactoseFree = includesPhrase(referenceText, "lactose free");
    const offerLactoseFree = includesPhrase(offerText, "lactose free");
    if (referenceLactoseFree !== offerLactoseFree) return { valid: false, matches: 0 };
    const flavourTerms = ["chocolate", "strawberry", "vanilla", "flavoured", "flavored"];
    const referenceFlavoured = flavourTerms.some((term) => includesPhrase(referenceText, term));
    const offerFlavoured = flavourTerms.some((term) => includesPhrase(offerText, term));
    if (referenceFlavoured !== offerFlavoured) return { valid: false, matches: 0 };
  }
  if (includesPhrase(referenceText, "sensitive")
    && !includesPhrase(offerText, "sensitive")
    && !includesPhrase(offerText, "hypoallergenic")) {
    return { valid: false, matches: 0 };
  }
  const requestedEggSize = eggSize(referenceText);
  if (requestedEggSize && eggSize(offerText) !== requestedEggSize) {
    return { valid: false, matches: 0 };
  }
  const requestedFlourType = flourType(referenceText);
  if (requestedFlourType && flourType(offerText) !== requestedFlourType) {
    return { valid: false, matches: 0 };
  }
  const requestedChickenForm = chickenForm(referenceText);
  const offeredChickenForm = chickenForm(offerText);
  if (requestedChickenForm && offeredChickenForm !== requestedChickenForm) {
    return { valid: false, matches: 0 };
  }
  if (includesPhrase(referenceText, "chicken") && !requestedChickenForm && offeredChickenForm === "offal") {
    return { valid: false, matches: 0 };
  }
  if (matchesSearchTerm(referenceText, "mince")) {
    const referenceProcessed = processedMinceTerms(referenceText);
    const offerProcessed = processedMinceTerms(offerText);
    if (!referenceProcessed.length && offerProcessed.length) return { valid: false, matches: 0 };
    if (includesPhrase(referenceText, "extra lean") && !includesPhrase(offerText, "extra lean")) {
      return { valid: false, matches: 0 };
    }
    if (includesPhrase(referenceText, "lean") && !includesPhrase(offerText, "lean")) {
      return { valid: false, matches: 0 };
    }
  }
  let matches = 0;
  for (const group of characteristicGroups) {
    const requested = group.terms.filter((term) => includesPhrase(referenceText, term));
    if (!requested.length) continue;
    const offered = group.terms.filter((term) => includesPhrase(offerText, term));
    const requiresExplicitMatch = group.required
      || group.requiredContexts?.some((term) => includesPhrase(referenceText, term));
    if (!offered.length && requiresExplicitMatch) return { valid: false, matches };
    if (offered.length && !offered.some((term) => requested.includes(term))) {
      return { valid: false, matches };
    }
    if (offered.some((term) => requested.includes(term))) matches += 1;
  }
  return { valid: true, matches };
}

const requiredCharacteristicTerms = [
  "gluten free", "lactose free", "sugar free", "dairy free", "nut free",
  "vegan", "vegetarian", "halal", "kosher", "sensitive", "hypoallergenic",
];
const preferredCharacteristicTerms = [
  "full cream", "low fat", "fat free", "skim", "medium fat", "fresh", "long life", "uht",
  "powdered", "white", "brown", "whole wheat", "wholewheat", "extra large", "jumbo", "large",
  "medium", "small", "self raising", "cake", "bread flour", "whole chicken", "chicken portions",
  "breast", "fillet", "drumstick", "thigh", "wing", "lean", "extra lean", "instant", "decaf",
  "plain", "chocolate", "strawberry", "vanilla", "original", "free range", "organic",
];
const commonBrands = [
  "clover", "parmalat", "first choice", "douglasdale", "crystal valley", "albany", "sasko",
  "blue ribbon", "tastic", "spekkor", "ace", "iwisa", "white star", "koo", "all gold",
  "five roses", "ricoffy", "nescafe", "jacobs", "colgate", "oral b", "sunlight", "omo",
  "skip", "ariel", "handy andy", "pedigree", "royal canin", "purina", "kelloggs", "bokomo",
];

function phrasesPresent(text: string, phrases: string[]) {
  return phrases.filter((phrase) => includesPhrase(text, phrase));
}

function retailerFromQuery(query: string) {
  const normalized = clean(query);
  return retailers.find((retailer) =>
    includesPhrase(normalized, retailer.id)
    || includesPhrase(normalized, retailer.name)
    || (retailer.id === "pick-n-pay" && /\bpnp\b/.test(normalized))
    || (retailer.id === "woolworths" && /\bwoolies\b/.test(normalized)))?.id || null;
}

export function parseQueryIntent(query: string): QueryIntent {
  const originalQuery = String(query || "").trim();
  const normalizedQuery = stripRetailerAliases(originalQuery);
  const familyRule = matchingFamilyRule(normalizedQuery);
  const productFamily = familyRule?.family || normalizedProductFamily(normalizedQuery);
  const category = familyRule?.category || inferredCategoryFamily(normalizedQuery);
  const requiredCharacteristics = phrasesPresent(normalizedQuery, requiredCharacteristicTerms);
  const preferredCharacteristics = phrasesPresent(normalizedQuery, preferredCharacteristicTerms)
    .filter((term) => !requiredCharacteristics.includes(term));
  const brand = commonBrands.find((candidate) => includesPhrase(normalizedQuery, candidate)) || null;
  const ignored = new Set([
    ...tokens(productFamily),
    ...requiredCharacteristics.flatMap(tokens),
    ...preferredCharacteristics.flatMap(tokens),
    ...tokens(brand || ""),
    "kg", "g", "ml", "l", "ct", "pk", "pack", "packs", "each", "per",
  ]);
  const informationalTerms = orderedTokens(normalizedQuery).filter((term) =>
    !ignored.has(term) && !/^\d+(?:\.\d+)?$/.test(term));
  const discoveryTerms = [...new Set([
    ...tokens(productFamily),
    ...tokens(normalizedQuery).filter((term) =>
      !fuzzyMeasurementTokens.has(term) && !/^\d+(?:\.\d+)?$/.test(term)),
    ...(familyRule?.aliases || []).flatMap(tokens),
  ])].slice(0, 8);
  return {
    originalQuery,
    normalizedQuery,
    retailerId: retailerFromQuery(originalQuery),
    productFamily,
    categoryFamily: category,
    brand,
    requestedSize: parsePackageMeasure(originalQuery),
    requiredCharacteristics,
    preferredCharacteristics,
    informationalTerms,
    discoveryTerms,
  };
}

function explicitSpecies(text: string) {
  return ["beef", "chicken", "pork", "lamb", "turkey", "venison", "fish"]
    .find((species) => includesPhrase(text, species)) || "";
}

function severeIncompatibility(intent: QueryIntent, offerText: string, offeredFamily: string, offeredCategory: string) {
  if (intent.productFamily && offeredFamily && intent.productFamily !== offeredFamily) {
    return `Different product family (${offeredFamily})`;
  }
  if (intent.categoryFamily && offeredCategory && intent.categoryFamily !== offeredCategory) {
    return `Different product category (${offeredCategory})`;
  }
  const requestedSpecies = explicitSpecies(intent.normalizedQuery);
  const offeredSpecies = explicitSpecies(offerText);
  if (requestedSpecies && offeredSpecies && requestedSpecies !== offeredSpecies) {
    return `Different species (${offeredSpecies})`;
  }
  const queryPet = /\b(?:dog|cat|pet)\s+(?:food|mince|pellets?|kibble)\b/.test(intent.normalizedQuery);
  const offerPet = /\b(?:dog|cat|pet)\s+(?:food|mince|pellets?|kibble)\b/.test(offerText);
  if (queryPet !== offerPet && (queryPet || offerPet)) return "Pet food cannot be compared with human food";
  if (intent.productFamily === "milk") {
    const plantMilk = /\b(?:almond|oat|soy|soya|coconut|rice)\s+(?:drink|milk)\b/;
    if (plantMilk.test(intent.normalizedQuery) !== plantMilk.test(offerText)) return "Plant and dairy milk are incompatible";
  }
  const offeredMeasure = parsePackageMeasure(offerText);
  if (intent.requestedSize && offeredMeasure && intent.requestedSize.kind !== offeredMeasure.kind) {
    return "Pack dimensions are incompatible";
  }
  const missingRequired = intent.requiredCharacteristics.filter((term) => !includesPhrase(offerText, term));
  if (missingRequired.length) return `Missing required characteristic: ${missingRequired.join(", ")}`;
  return null;
}

function relatedVariantDifferences(intent: QueryIntent, offerText: string) {
  const relaxed: string[] = [];
  for (const group of characteristicGroups) {
    const requested = group.terms.filter((term) => includesPhrase(intent.normalizedQuery, term));
    if (!requested.length) continue;
    const offered = group.terms.filter((term) => includesPhrase(offerText, term));
    if (!offered.some((term) => requested.includes(term))) {
      relaxed.push(`${requested.join("/")} requested${offered.length ? `; ${offered.join("/")} offered` : "; not stated"}`);
    }
  }
  const requestedEggSize = eggSize(intent.normalizedQuery);
  if (requestedEggSize && eggSize(offerText) !== requestedEggSize) relaxed.push(`${requestedEggSize} egg size requested`);
  const requestedFlour = flourType(intent.normalizedQuery);
  if (requestedFlour && flourType(offerText) !== requestedFlour) relaxed.push(`${requestedFlour} flour requested`);
  const requestedChicken = chickenForm(intent.normalizedQuery);
  if (requestedChicken && chickenForm(offerText) !== requestedChicken) relaxed.push(`${requestedChicken} chicken requested`);
  return [...new Set(relaxed)];
}

function displayPackageMeasure(measure: PackageMeasure | null) {
  if (!measure) return null;
  const amount = measure.normalizedUnit === "g" && measure.amount >= 1000
    ? `${Number((measure.amount / 1000).toFixed(2))} kg`
    : measure.normalizedUnit === "ml" && measure.amount >= 1000
      ? `${Number((measure.amount / 1000).toFixed(2))} L`
      : `${Number(measure.amount.toFixed(2))} ${measure.normalizedUnit}`;
  return amount;
}

export function assessCatalogueMatch(
  intentOrQuery: QueryIntent | string,
  product: ProductRow,
  store: { productName: string; brand?: string; size?: string; price?: number | null },
  options: { lexicalScore?: number; semanticScore?: number } = {},
): CatalogueMatchAssessment {
  const intent = typeof intentOrQuery === "string" ? parseQueryIntent(intentOrQuery) : intentOrQuery;
  const offerText = clean([product.canonical_name, product.category, product.search_text, store.productName, store.brand, store.size].join(" "));
  const offeredFamily = normalizedProductFamily(offerText, product.category || "");
  const offeredCategory = resolvedCategoryFamily(product.category, offerText);
  const rejectionReason = severeIncompatibility(intent, offerText, offeredFamily, offeredCategory);
  const rejected: CatalogueMatchAssessment = {
    accepted: false,
    rejectionReason,
    matchTier: 5,
    matchType: "category-fallback",
    matchScore: 0,
    matchConfidence: 0,
    matchReasons: [],
    relaxedCriteria: [],
    requestedSize: displayPackageMeasure(intent.requestedSize),
    offeredSize: store.size || displayPackageMeasure(parsePackageMeasure(offerText)),
    unitsRequired: 1,
    totalSupplied: null,
    effectiveTotalPrice: null,
    sizeDifferencePercent: null,
    isExactMatch: false,
    isAlternative: true,
    alternativeReason: rejectionReason,
    scoreBreakdown: {},
  };
  if (rejectionReason) return rejected;

  const offeredMeasure = parsePackageMeasure(store.size || store.productName || offerText);
  const fulfilment = planPackageFulfilment(intent.originalQuery, store.size || store.productName || offerText);
  const relaxedCriteria = relatedVariantDifferences(intent, offerText);
  const familyMatch = Boolean(intent.productFamily && intent.productFamily === offeredFamily);
  const categoryMatch = Boolean(intent.categoryFamily && intent.categoryFamily === offeredCategory);
  const hasRequestedSize = Boolean(intent.requestedSize);
  const exactQuantity = Boolean(intent.requestedSize && offeredMeasure && fulfilment.valid
    && Math.abs((fulfilment.totalSupplied || 0) - intent.requestedSize.amount) < 0.01);
  let matchTier: MatchTier;
  if (familyMatch && !relaxedCriteria.length && (!hasRequestedSize || (exactQuantity && fulfilment.unitsRequired === 1))) matchTier = 1;
  else if (familyMatch && !relaxedCriteria.length && exactQuantity) matchTier = 2;
  else if (familyMatch && !relaxedCriteria.length && intent.requestedSize && offeredMeasure) matchTier = 3;
  else if (familyMatch) matchTier = 4;
  else matchTier = 5;
  const matchTypes = ["exact", "equivalent-quantity", "closest-size", "related-variant", "category-fallback"] as const;
  const matchType = matchTypes[matchTier - 1];
  const lexicalCoverage = exactQueryCoverage(intent.normalizedQuery, offerText);
  const exactTokenCoverage = tokens(intent.normalizedQuery).filter((term) => tokens(offerText).includes(term)).length
    / Math.max(1, tokens(intent.normalizedQuery).length);
  const requestedPreferred = intent.preferredCharacteristics;
  const characteristicMatches = requestedPreferred.filter((term) => includesPhrase(offerText, term)).length;
  const sizeDifferencePercent = intent.requestedSize && fulfilment.valid && fulfilment.totalSupplied != null
    ? Number((Math.abs(fulfilment.totalSupplied - intent.requestedSize.amount) / intent.requestedSize.amount * 100).toFixed(1))
    : null;
  const scoreBreakdown = {
    tier: [100, 86, 72, 56, 40][matchTier - 1],
    family: familyMatch ? 20 : categoryMatch ? 8 : 0,
    lexical: Number((Math.max(lexicalCoverage, exactTokenCoverage) * 30).toFixed(2)),
    characteristics: characteristicMatches * 5 - relaxedCriteria.length * 4,
    size: sizeDifferencePercent == null ? 0 : Number(Math.max(0, 15 - Math.min(15, sizeDifferencePercent / 8)).toFixed(2)),
    brand: intent.brand && includesPhrase(offerText, intent.brand) ? 6 : 0,
    semantic: 0,
    lexicalCandidate: Number(Math.min(8, Math.max(0, options.lexicalScore || 0)).toFixed(2)),
  };
  const matchScore = Number(Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0).toFixed(3));
  const unitsRequired = fulfilment.valid ? Math.max(1, fulfilment.unitsRequired) : 1;
  const effectiveTotalPrice = store.price == null ? null : Number((store.price * unitsRequired).toFixed(2));
  const matchReasons = [
    familyMatch ? `Same ${intent.productFamily} product family` : categoryMatch ? `Same ${intent.categoryFamily} category` : "Related catalogue product",
    hasRequestedSize ? (fulfilment.valid ? fulfilment.reason : "Pack size is not stated") : "No pack size requested",
    characteristicMatches ? `${characteristicMatches} requested characteristic${characteristicMatches === 1 ? "" : "s"} matched` : "Core product wording matched",
  ];
  return {
    accepted: familyMatch || categoryMatch || (!intent.productFamily && lexicalCoverage >= 0.55),
    rejectionReason: null,
    matchTier,
    matchType,
    matchScore,
    matchConfidence: Number(Math.max(0, Math.min(1, matchScore / 165)).toFixed(3)),
    matchReasons,
    relaxedCriteria,
    requestedSize: displayPackageMeasure(intent.requestedSize),
    offeredSize: store.size || displayPackageMeasure(offeredMeasure),
    unitsRequired,
    totalSupplied: fulfilment.valid ? fulfilment.totalSupplied : offeredMeasure?.amount ?? null,
    effectiveTotalPrice,
    sizeDifferencePercent,
    isExactMatch: matchTier === 1,
    isAlternative: matchTier > 1,
    alternativeReason: matchTier > 1 ? relaxedCriteria[0] || matchReasons[1] : null,
    scoreBreakdown,
  };
}

export function sizeCompatibility(targetText: string, offerText: string) {
  const fulfilment = planPackageFulfilment(targetText, offerText);
  return {
    valid: fulfilment.valid,
    score: fulfilment.score,
    difference: fulfilment.difference,
    unitsRequired: fulfilment.unitsRequired,
    totalSupplied: fulfilment.totalSupplied,
    reason: fulfilment.reason,
  };
}

function matchingProfile(query: string, referenceText: string, profiles: SearchProfileRow[]) {
  const normalizedQuery = stripRetailerAliases(query);
  const normalizedReference = stripRetailerAliases(referenceText);
  return profiles
    .map((profile) => {
      const profileTerm = clean(profile.term);
      const queryCoverage = exactQueryCoverage(profileTerm, normalizedQuery);
      const referenceCoverage = exactQueryCoverage(profileTerm, normalizedReference);
      const exactBonus = includesPhrase(normalizedQuery, profileTerm) ? 2 : 0;
      const lengthBonus = Math.min(tokens(profileTerm).length, 4) * 0.08;
      return {
        profile,
        queryCoverage,
        score: queryCoverage + referenceCoverage * 0.12 + exactBonus + lengthBonus,
      };
    })
    .filter((entry) => entry.queryCoverage >= 0.82)
    .sort((left, right) =>
      right.score - left.score
      || clean(right.profile.term).length - clean(left.profile.term).length)[0]?.profile;
}

function withoutBrand(text: string, brand: string | undefined) {
  const normalized = stripRetailerAliases(text);
  const normalizedBrand = clean(brand);
  if (!normalizedBrand) return normalized;
  return ` ${normalized} `.replace(` ${normalizedBrand} `, " ").replace(/\s+/g, " ").trim();
}

function importantDescriptorTokens(referenceText: string, profile?: SearchProfileRow) {
  const generic = new Set([
    ...tokens(profile?.term || ""),
    "pack",
    "each",
    "freshly",
  ]);
  return tokens(referenceText).filter((term) =>
    !generic.has(term)
    && !["kg", "g", "ml", "l", "ct", "pk"].includes(term)
    && !/^\d+(?:\.\d+)?$/.test(term));
}

type RankedComparisonCandidate = {
  matchScore: number;
  sizeDifference: number;
  distance: number;
  price: number;
};

type ClosestBasketMatch = RankedComparisonCandidate & {
  product: ProductRow;
  store: ReturnType<typeof offerToStore>;
  matchTier: MatchTier;
  matchType: CatalogueMatchAssessment["matchType"];
  unitsRequired: number;
  totalSupplied: number | null;
  effectiveTotalPrice: number | null;
  sizeDifferencePercent: number | null;
  matchConfidence: number;
  matchReasons: string[];
  relaxedCriteria: string[];
  alternativeReason: string | null;
};

export function sortClosestCandidates<T extends RankedComparisonCandidate>(candidates: T[]) {
  return [...candidates].sort((left, right) =>
    right.matchScore - left.matchScore
    || left.sizeDifference - right.sizeDifference
    || left.distance - right.distance
    || left.price - right.price);
}

export async function findBalancedProductCandidates(
  env: Env,
  searchTerms: string[],
  targetRetailers: typeof retailers,
  options: { matchAll?: boolean; limitPerRetailer?: number } = {},
) {
  const terms = [...new Set(searchTerms.filter(Boolean))].slice(0, 8);
  if (!terms.length || !targetRetailers.length) return [] as ProductRow[];
  const operator = options.matchAll === false ? " OR " : " AND ";
  const perRetailerLimit = Math.min(30, Math.max(1, Math.round(options.limitPerRetailer || 16)));
  const globalLimit = Math.min(160, perRetailerLimit * targetRetailers.length * 2);
  const retailerBindings = targetRetailers.map((_, index) => `?${index + 1}`);
  const termOffset = targetRetailers.length;
  const searchClauses = terms
    .map((_, index) => `p.search_text LIKE ?${termOffset + index + 1}`)
    .join(operator);
  // Scan the product catalogue once. The old UNION repeated the same leading-
  // wildcard product scan for every retailer and caused production Error 1102.
  // Retailer balancing happens after the indexed offer lookup and ranking.
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.canonical_name, p.category, p.target_size, p.search_terms_json, p.search_text
     FROM catalogue_products p
     WHERE (${searchClauses})
       AND EXISTS (
         SELECT 1 FROM catalogue_offers o
         WHERE o.product_id = p.id
           AND o.retailer_id IN (${retailerBindings.join(",")})
       )
     ORDER BY LENGTH(p.search_text) ASC, p.id ASC
     LIMIT ${globalLimit}`,
  ).bind(
    ...targetRetailers.map((retailer) => retailer.id),
    ...terms.map((term) => `%${term}%`),
  )
    .all<ProductRow>();
  const unique = new Map<string, ProductRow>();
  for (const product of results) unique.set(product.id, product);
  return [...unique.values()];
}

async function findClosestBasketMatches(
  env: Env,
  item: BasketItem,
  enabledRetailers: typeof retailers,
  profiles: SearchProfileRow[],
  location?: ShopperLocation,
) {
  const comparisonQuery = stripRetailerAliases(String(item.comparisonQuery || item.query || item.name || ""));
  const referenceText = withoutBrand(String(item.selectedProductName || item.name || comparisonQuery), item.selectedBrand);
  const intent = parseQueryIntent(`${comparisonQuery} ${referenceText} ${item.targetSize || ""}`);
  const profile = matchingProfile(comparisonQuery, referenceText, profiles);
  const targetCategory = resolvedCategoryFamily(item.category, `${comparisonQuery} ${referenceText}`)
    || categoryFamily(profile?.category || "");
  const targetFamily = normalizedProductFamily(
    item.requirement?.productFamily || `${comparisonQuery} ${referenceText}`,
    item.category,
  );
  const profileTerms = tokens(profile?.term || "");
  const queryTerms = tokens(comparisonQuery).filter((term) =>
    !["kg", "g", "ml", "l", "ct", "pk"].includes(term)
    && !/^\d+(?:\.\d+)?$/.test(term));
  const discoveryTerms = intent.discoveryTerms.length ? intent.discoveryTerms : (profileTerms.length ? profileTerms : queryTerms);
  if (!discoveryTerms.length || !enabledRetailers.length) return new Map<string, ClosestBasketMatch>();

  // Discover products once, then use the indexed product_id/retailer_id offer
  // lookups below. The previous implementation repeated a wildcard JOIN for
  // every retailer and could exceed the Worker CPU limit on common searches.
  const candidateProducts = await findBalancedProductCandidates(env, discoveryTerms, enabledRetailers, {
    matchAll: false,
    limitPerRetailer: 18,
  });
  if (!candidateProducts.length) return new Map<string, ClosestBasketMatch>();

  const productsById = new Map(candidateProducts.map((product) => [product.id, product]));
  const retailerIds = enabledRetailers.map((retailer) => retailer.id);
  const offersByRetailer = new Map(retailerIds.map((retailerId) => [retailerId, [] as OfferRow[]]));
  for (let start = 0; start < candidateProducts.length; start += 75) {
    const productIds = candidateProducts.slice(start, start + 75).map((product) => product.id);
    const retailerPlaceholders = retailerIds.map(() => "?").join(",");
    const productPlaceholders = productIds.map(() => "?").join(",");
    const { results: offers } = await env.DB.prepare(
      `SELECT product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label,
              price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type,
              promo_applied, image_url, product_url, location_key, store_code, store_display_name,
              latitude, longitude, last_seen_at
       FROM catalogue_offers
       WHERE retailer_id IN (${retailerPlaceholders})
         AND product_id IN (${productPlaceholders})`,
    ).bind(...retailerIds, ...productIds).all<OfferRow>();
    for (const offer of offers) offersByRetailer.get(offer.retailer_id)?.push(offer);
  }
  const matches = new Map<string, ClosestBasketMatch>();

  enabledRetailers.forEach((retailer) => {
    const ranked = (offersByRetailer.get(retailer.id) || [])
      .filter((offer) => isOfferVisibleAtLocation(offer, location))
      .map((offer) => {
        const row = productsById.get(offer.product_id);
        if (!row) return null;
        const store = offerToStore(offer, location);
        if (store.price == null) return null;
        const assessment = assessCatalogueMatch(intent, row, store, {
          lexicalScore: exactQueryCoverage(comparisonQuery, `${row.search_text} ${store.productName}`) * 8,
        });
        if (!assessment.accepted) return null;
        return {
          product: row,
          store,
          matchTier: assessment.matchTier,
          matchType: assessment.matchType,
          matchScore: assessment.matchScore + (item.selectedProductId === row.id ? 2 : 0),
          sizeDifference: assessment.sizeDifferencePercent ?? Number.POSITIVE_INFINITY,
          distance: store.distanceKm ?? Number.POSITIVE_INFINITY,
          price: store.price,
          unitsRequired: assessment.unitsRequired,
          totalSupplied: assessment.totalSupplied,
          effectiveTotalPrice: assessment.effectiveTotalPrice,
          sizeDifferencePercent: assessment.sizeDifferencePercent,
          matchConfidence: assessment.matchConfidence,
          matchReasons: assessment.matchReasons,
          relaxedCriteria: assessment.relaxedCriteria,
          alternativeReason: assessment.alternativeReason,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)) as ClosestBasketMatch[];
    const closest = sortClosestCandidates(ranked)[0];
    if (closest) matches.set(retailer.id, closest);
  });
  return matches;
}

export function buildRetailerDiagnostics(
  retailerList: Array<{ id: string; name: string }>,
  candidateCounts: Record<string, number>,
  acceptedCounts: Record<string, number>,
  selectedCounts: Record<string, number>,
  rejectionCounts: Record<string, Record<string, number>>,
) {
  return Object.fromEntries(retailerList.map((retailer) => {
    const candidateCount = candidateCounts[retailer.id] || 0;
    const acceptedCount = acceptedCounts[retailer.id] || 0;
    return [retailer.id, {
      candidateCount,
      acceptedCount,
      selectedCount: selectedCounts[retailer.id] || 0,
      emptyReason: acceptedCount ? null : candidateCount
        ? "Candidates were found, but none were compatible enough to compare."
        : "No current priced catalogue candidates were found for this retailer.",
      rejectionReasons: rejectionCounts[retailer.id] || {},
    }];
  }));
}

async function findCatalogue(
  env: Env,
  query: string,
  page: number,
  pageSize: number,
  location?: ShopperLocation,
  perRetailer = 0,
  debug = false,
) {
  query = stripRetailerAliases(query);
  const intent = parseQueryIntent(query);
  const queryTokens = tokens(intent.normalizedQuery);
  if (!queryTokens.length) return { products: [], retailerMatches: [], hasMore: false };
  const coreTokens = queryTokens.filter((term) => !["kg", "g", "ml", "l"].includes(term) && !/^\d+(?:\.\d+)?$/.test(term));
  const strictTerms = coreTokens.length ? coreTokens : queryTokens;
  const candidateLimit = perRetailer > 0
    ? Math.min(18, Math.max(8, perRetailer + 6))
    : 12;
  const [strictResults, profileResult] = await Promise.all([
    findBalancedProductCandidates(env, strictTerms, retailers, {
      matchAll: true,
      limitPerRetailer: candidateLimit,
    }),
    env.DB.prepare(
      "SELECT term, category, search_text, exclude_terms_json, preferred_terms_json FROM search_profiles",
    ).all<SearchProfileRow>(),
  ]);
  const profiles = profileResult.results;
  const strictById = new Map(strictResults.map((product) => [product.id, product]));
  const fuzzyProfile = matchingProfile(query, query, profiles);
  const profileTerms = tokens(fuzzyProfile?.term || "");
  const fallbackUsed: string[] = [];
  const familyTerms = tokens(intent.productFamily);
  const profileLookupDiffers = profileTerms.length && profileTerms.join("|") !== strictTerms.join("|");
  const familyLookupDiffers = familyTerms.length && familyTerms.join("|") !== strictTerms.join("|");
  // A second bounded lookup is intentional: strict wording finds exact items,
  // while the family/profile lookup recovers retailer titles that omit a
  // descriptor or use an equivalent phrase. It never scans unbounded rows.
  if ((familyLookupDiffers || profileLookupDiffers) && strictById.size < retailers.length * 2) {
    const relaxedTerms = familyLookupDiffers ? familyTerms : profileTerms;
    const relaxedResults = await findBalancedProductCandidates(env, relaxedTerms, retailers, {
      matchAll: true,
      limitPerRetailer: candidateLimit,
    });
    for (const product of relaxedResults) strictById.set(product.id, product);
    fallbackUsed.push(familyLookupDiffers ? "product-family" : "search-profile");
  }
  if (strictById.size < retailers.length && intent.discoveryTerms.length) {
    const broadResults = await findBalancedProductCandidates(env, intent.discoveryTerms, retailers, {
      matchAll: false,
      limitPerRetailer: Math.max(8, candidateLimit),
    });
    for (const product of broadResults) strictById.set(product.id, product);
    fallbackUsed.push("alias-or-fuzzy");
  }
  const results = [...strictById.values()];
  const scored = results
    .map((product) => ({
      product,
      score: Number((exactQueryCoverage(query, product.search_text) * 30).toFixed(3)),
    }))
    .sort((a, b) => b.score - a.score || a.product.canonical_name.localeCompare(b.product.canonical_name));

  const productIds = scored.map(({ product }) => product.id);
  const offerMap = new Map<string, OfferRow[]>();
  if (productIds.length) {
    // D1 limits parameters on a prepared statement. Search can deliberately
    // produce hundreds of broad candidates, so retrieve offers in safe chunks.
    for (let start = 0; start < productIds.length; start += 90) {
      const ids = productIds.slice(start, start + 90);
      const placeholders = ids.map(() => "?").join(",");
      const { results: offers } = await env.DB.prepare(
        `SELECT product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label,
                price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type,
                promo_applied, image_url, product_url, location_key, store_code, store_display_name,
                latitude, longitude, last_seen_at
         FROM catalogue_offers WHERE product_id IN (${placeholders})`,
      ).bind(...ids).all<OfferRow>();
      for (const offer of offers) {
        const group = offerMap.get(offer.product_id) || [];
        group.push(offer);
        offerMap.set(offer.product_id, group);
      }
    }
  }

  const candidateCounts = Object.fromEntries(retailers.map((retailer) => [retailer.id, 0])) as Record<string, number>;
  const rejectionCounts = Object.fromEntries(retailers.map((retailer) => [retailer.id, {} as Record<string, number>])) as Record<string, Record<string, number>>;
  const rejectedSamples: Array<{ retailerId: string; productId: string; productName: string; reason: string }> = [];
  const rankedMatches = scored.flatMap(({ product, score }) =>
    (offerMap.get(product.id) || [])
      .filter((offer) => isOfferVisibleAtLocation(offer, location))
      .filter((offer) => offer.price_cents != null && offer.price_cents > 0)
      .map((offer) => {
        candidateCounts[offer.retailer_id] = (candidateCounts[offer.retailer_id] || 0) + 1;
        const store = offerToStore(offer, location);
        const assessment = assessCatalogueMatch(intent, product, store, {
          lexicalScore: score,
        });
        if (!assessment.accepted) {
          const reason = assessment.rejectionReason || "Insufficient product relevance";
          rejectionCounts[offer.retailer_id][reason] = (rejectionCounts[offer.retailer_id][reason] || 0) + 1;
          if (debug && rejectedSamples.length < 30) {
            rejectedSamples.push({
              retailerId: offer.retailer_id,
              productId: product.id,
              productName: offer.product_name,
              reason,
            });
          }
          return null;
        }
        const productView = {
          id: product.id,
          canonicalName: product.canonical_name,
          category: product.category || undefined,
          targetSize: product.target_size || undefined,
          searchTerms: parseJsonArray(product.search_terms_json),
          stores: [{ ...store, ...assessment }],
          score: assessment.matchScore,
        };
        return {
          product: productView,
          store: productView.stores[0],
          matchTier: assessment.matchTier,
          matchScore: assessment.matchScore,
          comparableValue: assessment.effectiveTotalPrice ?? comparableStoreValue(query, productView, store),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)))
    .sort((left, right) => left.matchTier - right.matchTier
      || right.matchScore - left.matchScore
      || left.comparableValue - right.comparableValue
      || (left.store.distanceKm ?? Number.POSITIVE_INFINITY) - (right.store.distanceKm ?? Number.POSITIVE_INFINITY)
      || left.store.productName.localeCompare(right.store.productName));
  const seenMatches = new Set<string>();
  const valueRankedMatches = rankedMatches
    .filter((entry) => {
      const key = `${entry.store.storeId}|${clean(entry.store.productName)}|${clean(entry.store.size)}`;
      if (seenMatches.has(key)) return false;
      seenMatches.add(key);
      return true;
    })
    .map((entry) => ({ ...entry.product, stores: [entry.store] }));
  const leaderKeys = new Set<string>();
  const leaders = [
    valueRankedMatches[0],
    ...retailers.map((retailer) => valueRankedMatches.find((product) => product.stores[0]?.storeId === retailer.id)),
  ].filter((product) => {
    if (!product) return false;
    const store = product.stores[0];
    const key = `${store.storeId}|${clean(store.productName)}|${clean(store.size)}`;
    if (leaderKeys.has(key)) return false;
    leaderKeys.add(key);
    return true;
  });
  const retailerMatches = [
    ...leaders,
    ...valueRankedMatches.filter((product) => {
      const store = product.stores[0];
      return !leaderKeys.has(`${store.storeId}|${clean(store.productName)}|${clean(store.size)}`);
    }),
  ];
  if (perRetailer > 0) {
    const retailerStart = (page - 1) * perRetailer;
    const groupedMatches = retailers.flatMap((retailer) =>
      valueRankedMatches
        .filter((product) => product.stores[0]?.storeId === retailer.id)
        .slice(retailerStart, retailerStart + perRetailer));
    const retailerHasMore = Object.fromEntries(retailers.map((retailer) => [
      retailer.id,
      valueRankedMatches.filter((product) => product.stores[0]?.storeId === retailer.id).length > retailerStart + perRetailer,
    ]));
    const acceptedCounts = Object.fromEntries(retailers.map((retailer) => [
      retailer.id,
      valueRankedMatches.filter((product) => product.stores[0]?.storeId === retailer.id).length,
    ]));
    const selectedCounts = Object.fromEntries(retailers.map((retailer) => [
      retailer.id,
      groupedMatches.filter((product) => product.stores[0]?.storeId === retailer.id).length,
    ]));
    const retailerDiagnostics = buildRetailerDiagnostics(
      retailers,
      candidateCounts,
      acceptedCounts,
      selectedCounts,
      rejectionCounts,
    );
    return {
      products: groupedMatches,
      retailerMatches: groupedMatches,
      retailerHasMore,
      retailerDiagnostics,
      hasMore: Object.values(retailerHasMore).some(Boolean),
      ...(debug ? {
        parsedIntent: intent,
        candidateCounts,
        rejectedByRetailer: rejectionCounts,
        rejectedCandidates: rejectedSamples,
        selectedTiers: groupedMatches.map((product) => ({
          retailerId: product.stores[0]?.storeId,
          productId: product.id,
          tier: product.stores[0]?.matchTier,
          score: product.stores[0]?.matchScore,
          scoreBreakdown: product.stores[0]?.scoreBreakdown,
        })),
        fallbackUsed,
        semanticSearchApplied: false,
        semanticCandidateCount: 0,
      } : {}),
    };
  }
  const start = (page - 1) * pageSize;
  const pageMatches = retailerMatches.slice(start, start + pageSize);
  return {
    products: pageMatches,
    retailerMatches: pageMatches,
    hasMore: retailerMatches.length > start + pageSize,
    ...(debug ? {
      parsedIntent: intent,
      candidateCounts,
      rejectedByRetailer: rejectionCounts,
      rejectedCandidates: rejectedSamples,
      fallbackUsed,
      semanticSearchApplied: false,
      semanticCandidateCount: 0,
    } : {}),
  };
}

async function catalogueResponse(request: Request, env: Env, url: URL) {
  const query = (url.searchParams.get("q") || "").trim();
  const correctionEnabled = url.searchParams.get("correct") !== "false";
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "10", 10) || 10));
  const perRetailer = Math.min(12, Math.max(0, Number.parseInt(url.searchParams.get("perRetailer") || "0", 10) || 0));
  const debug = url.searchParams.get("debug") === "true" || url.searchParams.get("debug") === "1";
  const location = validLocation({ latitude: url.searchParams.get("latitude"), longitude: url.searchParams.get("longitude") });
  const correction = await correctCatalogueQuery(env, query, correctionEnabled);
  const result = await findCatalogue(env, correction.correctedQuery, page, pageSize, location, perRetailer, debug);
  return json(request, env, {
    ok: true,
    query,
    correctedQuery: correction.correctedQuery,
    correctionApplied: correction.correctionApplied,
    page,
    pageSize,
    perRetailer: perRetailer || undefined,
    locationApplied: Boolean(location),
    ...result,
  });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function embeddingContentHash(text: string) {
  return sha256Hex(`${PRODUCT_EMBEDDING_MODEL}\n${PRODUCT_EMBEDDING_POOLING}\n${text}`);
}

async function authorizedVectorIndexRequest(request: Request, env: Env) {
  if (!env.VECTOR_INDEX_TOKEN) return false;
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.replace(/^Bearer\s+/i, "");
  if (!supplied) return false;
  const [suppliedHash, expectedHash] = await Promise.all([
    sha256Hex(supplied),
    sha256Hex(env.VECTOR_INDEX_TOKEN),
  ]);
  return suppliedHash === expectedHash;
}

async function withRetries<T>(operation: () => Promise<T>, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }
  throw lastError;
}

function splitAggregatedValues(value: string | null) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    if (Array.isArray(parsed)) {
      return sortedUniqueCleanValues(parsed.filter((entry) => entry != null).map(String), 20);
    }
  } catch {
    // Older local SQLite builds may return a normal GROUP_CONCAT value.
  }
  return sortedUniqueCleanValues(String(value || "").split(","), 20);
}

async function indexProductVectorsResponse(request: Request, env: Env) {
  const productVectors = env.PRODUCT_VECTORS;
  if (!productVectors || !env.VECTOR_INDEX_TOKEN) {
    return json(request, env, { ok: false, error: "Vector indexing is not configured." }, 503);
  }
  if (!await authorizedVectorIndexRequest(request, env)) {
    return json(request, env, { ok: false, error: "Unauthorized" }, 401);
  }
  const body = await request.json<{
    cursor?: string;
    limit?: number;
    force?: boolean;
  }>().catch(() => ({} as {
    cursor?: string;
    limit?: number;
    force?: boolean;
  }));
  const cursor = String(body.cursor || "").trim();
  const limit = Math.min(VECTOR_INDEX_BATCH_SIZE, Math.max(1, Number(body.limit) || VECTOR_INDEX_BATCH_SIZE));
  const force = Boolean(body.force);
  const [{ results: products }, { results: profiles }] = await Promise.all([
    env.DB.prepare(
      `SELECT p.id, p.canonical_name, p.category, p.target_size, p.search_terms_json, p.search_text,
              json_group_array(DISTINCT o.brand) AS brands,
              json_group_array(DISTINCT o.product_name) AS retailer_names
       FROM catalogue_products p
       LEFT JOIN catalogue_offers o ON o.product_id = p.id
       WHERE p.id > ?1
       GROUP BY p.id
       ORDER BY p.id
       LIMIT ?2`,
    ).bind(cursor, limit).all<EmbeddingProductRow>(),
    env.DB.prepare(
      "SELECT term, category, search_text, exclude_terms_json, preferred_terms_json FROM search_profiles",
    ).all<SearchProfileRow>(),
  ]);

  if (!products.length) {
    return json(request, env, {
      ok: true,
      processed: 0,
      indexed: 0,
      skipped: 0,
      failed: 0,
      nextCursor: null,
      done: true,
    });
  }

  const prepared = await Promise.all(products.map(async (product) => {
    const embeddingText = buildProductEmbeddingText(product, {
      brands: splitAggregatedValues(product.brands),
      retailerNames: splitAggregatedValues(product.retailer_names),
      profiles,
    });
    return {
      product,
      embeddingText,
      embeddingHash: await embeddingContentHash(embeddingText),
    };
  }));
  const productIds = prepared.map((entry) => entry.product.id);
  const placeholders = productIds.map(() => "?").join(",");
  const statuses = await env.DB.prepare(
    `SELECT product_id, embedding_hash, embedding_model
     FROM product_embedding_status WHERE product_id IN (${placeholders})`,
  ).bind(...productIds).all<{
    product_id: string;
    embedding_hash: string;
    embedding_model: string;
  }>();
  const statusById = new Map(statuses.results.map((status) => [status.product_id, status]));
  const changed = prepared.filter((entry) => {
    if (force) return true;
    const status = statusById.get(entry.product.id);
    return !status
      || status.embedding_hash !== entry.embeddingHash
      || status.embedding_model !== PRODUCT_EMBEDDING_MODEL;
  });

  let indexed = 0;
  let failed = 0;
  if (changed.length) {
    try {
      const embeddingResponse = await withRetries(() => env.AI.run(PRODUCT_EMBEDDING_MODEL, {
        text: changed.map((entry) => entry.embeddingText),
        pooling: PRODUCT_EMBEDDING_POOLING,
      }));
      const vectors = embeddingVectors(embeddingResponse);
      if (vectors.length !== changed.length
        || vectors.some((vector) => vector.length !== PRODUCT_EMBEDDING_DIMENSIONS)) {
        throw new Error("Workers AI returned an unexpected embedding shape.");
      }
      await withRetries(() => productVectors.upsert(changed.map((entry, index) => ({
        id: entry.product.id,
        values: vectors[index],
        metadata: {
          productId: entry.product.id,
          category: clean(entry.product.category),
          categoryFamily: resolvedCategoryFamily(
            entry.product.category,
            `${entry.product.canonical_name} ${entry.product.search_text}`,
          ),
          measureKind: parseMeasure(entry.product.target_size || "")?.kind || "",
        },
      }))));
      const embeddedAt = new Date().toISOString();
      await env.DB.batch(changed.map((entry) => env.DB.prepare(
        `INSERT INTO product_embedding_status
          (product_id, embedding_hash, embedding_model, embedded_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(product_id) DO UPDATE SET
           embedding_hash = excluded.embedding_hash,
           embedding_model = excluded.embedding_model,
           embedded_at = excluded.embedded_at`,
      ).bind(entry.product.id, entry.embeddingHash, PRODUCT_EMBEDDING_MODEL, embeddedAt)));
      indexed = changed.length;
    } catch (error) {
      failed = changed.length;
      console.error("Product vector indexing batch failed.", error);
    }
  }

  const done = products.length < limit;
  return json(request, env, {
    ok: failed === 0,
    processed: products.length,
    indexed,
    skipped: products.length - changed.length,
    failed,
    nextCursor: done ? null : products.at(-1)?.id || null,
    done,
    model: PRODUCT_EMBEDDING_MODEL,
    dimensions: PRODUCT_EMBEDDING_DIMENSIONS,
  }, failed ? 502 : 200);
}

async function categoriesResponse(request: Request, env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT category, COUNT(*) AS count FROM catalogue_products
     WHERE category IS NOT NULL AND category <> '' GROUP BY category ORDER BY category`,
  ).all<{ category: string; count: number }>();
  return json(request, env, { ok: true, categories: results.map((row) => ({ name: row.category, count: row.count, products: [] })) });
}

async function specialsResponse(request: Request, env: Env, url: URL) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "24", 10) || 24));
  const retailer = url.searchParams.get("retailer") ? normalizeRetailerId(url.searchParams.get("retailer")) : "";
  const perRetailer = Math.min(12, Math.max(0, Number.parseInt(url.searchParams.get("perRetailer") || "0", 10) || 0));
  const category = String(url.searchParams.get("category") || "").trim().toLowerCase();
  const location = validLocation({ latitude: url.searchParams.get("latitude"), longitude: url.searchParams.get("longitude") });
  const clauses = ["o.promo_applied = 1", "o.price_cents IS NOT NULL", "o.price_cents > 0"];
  const bindings: string[] = [];
  if (retailer) {
    clauses.push("o.retailer_id = ?");
    bindings.push(retailer);
  }
  if (category) {
    clauses.push("LOWER(p.category) = ?");
    bindings.push(category);
  }
  const selectSpecials = (whereClauses: string[], values: string[], limit: number) => env.DB.prepare(
    `SELECT p.id, p.canonical_name, p.category, p.target_size, p.search_terms_json, p.search_text,
            o.product_id, o.retailer_id, o.retailer_name, o.product_name, o.brand, o.size_label,
            o.unit_label, o.price_cents, o.regular_price_cents, o.normalized_price_cents,
            o.promo_text, o.promo_type, o.promo_applied, o.image_url, o.product_url,
            o.location_key, o.store_code, o.store_display_name, o.latitude, o.longitude, o.last_seen_at
     FROM catalogue_offers o
     JOIN catalogue_products p ON p.id = o.product_id
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY
       CASE WHEN o.regular_price_cents > o.price_cents
         THEN CAST(o.regular_price_cents - o.price_cents AS REAL) / o.regular_price_cents
       ELSE 0 END DESC,
       o.last_seen_at DESC,
       p.canonical_name
     LIMIT ${limit}`,
  ).bind(...values).all<ProductRow & OfferRow>();
  const results = !retailer && perRetailer > 0
    ? (await Promise.all(retailers.map((store) =>
      selectSpecials([...clauses, "o.retailer_id = ?"], [...bindings, store.id], 500))))
      .flatMap((result) => result.results)
    : (await selectSpecials(clauses, bindings, 500)).results;
  const visible = results.filter((offer) => isOfferVisibleAtLocation(offer, location));
  const start = (page - 1) * pageSize;
  const selected = !retailer && perRetailer > 0
    ? retailers.flatMap((store) =>
      visible.filter((offer) => offer.retailer_id === store.id).slice(0, perRetailer))
    : visible.slice(start, start + pageSize);
  const specials = selected.map((row) => {
    const store = offerToStore(row, location);
    const saving = store.regularPrice && store.price != null
      ? Number((store.regularPrice - store.price).toFixed(2))
      : null;
    const discountPercent = store.regularPrice && saving && saving > 0
      ? Math.round((saving / store.regularPrice) * 100)
      : null;
    return {
      id: `${row.product_id}:${row.retailer_id}:${row.location_key || "national"}:${row.product_url}`,
      productId: row.product_id,
      canonicalName: row.canonical_name,
      category: row.category || undefined,
      targetSize: row.target_size || undefined,
      saving,
      discountPercent,
      store,
    };
  });
  return json(request, env, {
    ok: true,
    page,
    pageSize,
    perRetailer: perRetailer || undefined,
    hasMore: perRetailer > 0 ? false : visible.length > start + pageSize,
    locationApplied: Boolean(location),
    specials,
  });
}

async function queueRequest(request: Request, env: Env) {
  const body = await request.json<{ query?: string; source?: string }>()
    .catch(() => ({} as { query?: string; source?: string }));
  const query = String(body.query || "").trim();
  if (!query) return json(request, env, { ok: false, error: "Missing catalogue request query." }, 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO search_requests (id, query, source, status, requested_at, updated_at)
     VALUES (?1, ?2, ?3, 'queued', ?4, ?4)`,
  ).bind(id, query, String(body.source || "public-app"), now).run();
  return json(request, env, { ok: true, request: { id, query, source: body.source || "public-app", status: "queued", createdAt: now, updatedAt: now } }, 202);
}

async function submitFeedback(request: Request, env: Env) {
  const body = await request.json<{
    name?: string;
    email?: string;
    feedbackType?: string;
    message?: string;
    page?: string;
    honeypot?: string;
    turnstileToken?: string;
  }>().catch(() => ({} as {
    name?: string;
    email?: string;
    feedbackType?: string;
    message?: string;
    page?: string;
    honeypot?: string;
    turnstileToken?: string;
  }));
  if (String(body.honeypot || "").trim()) return json(request, env, { ok: true }, 202);

  const turnstileToken = String(body.turnstileToken || "").trim();
  if (!turnstileToken) {
    return json(request, env, { ok: false, error: "Please complete the security check." }, 400);
  }

  let verification: TurnstileVerification;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: request.headers.get("CF-Connecting-IP") || undefined,
        idempotency_key: crypto.randomUUID(),
      }),
    });
    verification = await response.json<TurnstileVerification>();
  } catch (error) {
    console.error("Turnstile verification request failed", error);
    return json(request, env, { ok: false, error: "The security check is temporarily unavailable. Please try again." }, 503);
  }

  const allowedHostnames = new Set(["randbasket.co.za", "www.randbasket.co.za"]);
  if (!verification.success || verification.action !== "feedback" || !verification.hostname || !allowedHostnames.has(verification.hostname)) {
    console.warn("Turnstile verification rejected", {
      hostname: verification.hostname,
      action: verification.action,
      errors: verification["error-codes"],
    });
    return json(request, env, { ok: false, error: "Security verification failed. Please try again." }, 403);
  }

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 254);
  const feedbackType = String(body.feedbackType || "Other").trim().slice(0, 80);
  const message = String(body.message || "").trim().slice(0, 5000);
  const page = String(body.page || "RandBasket web app").trim().slice(0, 500);
  if (message.length < 5) return json(request, env, { ok: false, error: "Please enter a longer suggestion." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(request, env, { ok: false, error: "Please enter a valid email address." }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO feedback_submissions
      (id, name, email, feedback_type, message, page, delivery_status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)`,
  ).bind(id, name, email, feedbackType, message, page, now).run();

  const text = [
    `Type: ${feedbackType}`,
    `Name: ${name || "Not provided"}`,
    `Reply email: ${email || "Not provided"}`,
    `Page: ${page}`,
    "",
    message,
    "",
    `Submission ID: ${id}`,
  ].join("\n");

  try {
    const delivery = await env.FEEDBACK_EMAIL.send({
      from: env.FEEDBACK_FROM,
      to: env.FEEDBACK_TO,
      subject: `RandBasket suggestion: ${feedbackType.replace(/[\r\n]+/g, " ")}`,
      text,
    });
    await env.DB.prepare(
      `UPDATE feedback_submissions SET delivery_status = 'sent', email_message_id = ?2, updated_at = ?3 WHERE id = ?1`,
    ).bind(id, String(delivery.messageId || ""), new Date().toISOString()).run();
    return json(request, env, { ok: true, id });
  } catch (error) {
    console.error("Feedback email delivery failed", id, error);
    await env.DB.prepare(
      `UPDATE feedback_submissions SET delivery_status = 'failed', updated_at = ?2 WHERE id = ?1`,
    ).bind(id, new Date().toISOString()).run();
    return json(request, env, {
      ok: false,
      saved: true,
      error: "Your suggestion was saved, but the email notification could not be sent yet.",
    }, 503);
  }
}

async function exactOffer(env: Env, retailerId: string, productUrl: string, location?: ShopperLocation) {
  if (!productUrl) return null;
  const { results } = await env.DB.prepare(
    `SELECT product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label,
            price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type,
            promo_applied, image_url, product_url, location_key, store_code, store_display_name,
            latitude, longitude, last_seen_at
     FROM catalogue_offers WHERE retailer_id = ?1 AND product_url = ?2 LIMIT 25`,
  ).bind(retailerId, productUrl).all<OfferRow>();
  return results.filter((offer) => isOfferVisibleAtLocation(offer, location)).sort((left, right) => {
    const leftDistance = distanceKm(location, left.latitude, left.longitude) ?? Number.POSITIVE_INFINITY;
    const rightDistance = distanceKm(location, right.latitude, right.longitude) ?? Number.POSITIVE_INFINITY;
    return leftDistance - rightDistance;
  })[0] || null;
}

export function calculateBasketLineTotalCents(priceCents: number | null, unitsRequired: number, basketQuantity: number) {
  if (priceCents == null || priceCents <= 0 || unitsRequired < 1 || basketQuantity < 1) return null;
  return Math.round(priceCents) * Math.round(unitsRequired) * Math.round(basketQuantity);
}

export function summarizeRetailerBasket(lineTotalsCents: Array<number | null>) {
  const valid = lineTotalsCents.filter((value): value is number => value != null && Number.isFinite(value));
  const knownSubtotalCents = valid.reduce((sum, value) => sum + Math.round(value), 0);
  const missingItemCount = lineTotalsCents.length - valid.length;
  return {
    knownSubtotalCents,
    knownSubtotal: centsToPrice(knownSubtotalCents) || 0,
    matchedItemCount: valid.length,
    missingItemCount,
    isComplete: missingItemCount === 0,
  };
}

async function scanBasket(request: Request, env: Env) {
  const body = await request.json<{ items?: BasketItem[]; settings?: BasketSettings }>()
    .catch(() => ({} as { items?: BasketItem[]; settings?: BasketSettings }));
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  if (!items.length) return json(request, env, { ok: false, error: "Add at least one item before checking prices." }, 400);
  const enabledRetailers = retailers.filter((retailer) => body.settings?.stores?.[retailer.id] !== false);
  const location = validLocation(body.settings?.location);
  const { results: profiles } = await env.DB.prepare(
    "SELECT term, category, search_text, exclude_terms_json, preferred_terms_json FROM search_profiles",
  ).all<SearchProfileRow>();
  const scans = [];

  for (const item of items) {
    const query = withoutBrand(
      String(item.comparisonQuery || item.query || item.name || "").trim(),
      item.selectedBrand,
    );
    const quantity = Math.max(1, Math.round(Number(item.quantity || 1)));
    const requestedSize = String(item.targetSize || item.requirement?.displayLabel || query);
    const requestedMeasure = parsePackageMeasure(requestedSize);
    const requirement = {
      id: item.requirement?.id || String(item.id || crypto.randomUUID()),
      productFamily: normalizedProductFamily(item.requirement?.productFamily || query, item.category),
      desiredAmount: item.requirement?.desiredAmount || requestedMeasure?.amount || null,
      normalizedUnit: item.requirement?.normalizedUnit || requestedMeasure?.kind || null,
      requestedQuantity: quantity,
      brandRequired: Boolean(item.requirement?.brandRequired),
      sourceRetailerId: item.requirement?.sourceRetailerId || null,
      sourceProductId: item.requirement?.sourceProductId || item.selectedProductId || null,
      sourceProductName: item.requirement?.sourceProductName || item.selectedProductName || item.name || null,
      displayLabel: item.requirement?.displayLabel || item.name || query,
    };
    let closestMatches = new Map<string, ClosestBasketMatch>();
    if (query) {
      try {
        closestMatches = await findClosestBasketMatches(env, item, enabledRetailers, profiles, location);
      } catch (error) {
        console.warn("Basket matching failed for one requirement", { itemId: item.id, error: String(error) });
      }
    }
    const results = [];
    for (const retailer of enabledRetailers) {
      let linkedOffer: OfferRow | null = null;
      try {
        linkedOffer = await exactOffer(env, retailer.id, String(item.links?.[retailer.id] || ""), location);
      } catch (error) {
        console.warn("Exact basket offer lookup failed", { itemId: item.id, retailerId: retailer.id, error: String(error) });
      }
      const closest = closestMatches.get(retailer.id);
      const store = linkedOffer ? offerToStore(linkedOffer, location) : closest?.store;
      const effectivePrice = store?.price ?? null;
      const fulfilment = store
        ? planPackageFulfilment(requestedSize, store.size || store.productName)
        : { valid: false, unitsRequired: 0, totalSupplied: null, reason: "No safe comparable product found" };
      const packageMeasure = store ? parsePackageMeasure(store.size || store.productName) : null;
      const exactQuantity = Boolean(requestedMeasure && fulfilment.valid && fulfilment.totalSupplied != null
        && Math.abs(fulfilment.totalSupplied - requestedMeasure.amount) < 0.01);
      const linkedTier: MatchTier = exactQuantity
        ? (fulfilment.unitsRequired === 1 ? 1 : 2)
        : 3;
      const linkedMatchType = (["exact", "equivalent-quantity", "closest-size"] as const)[linkedTier - 1];
      const sizeDifferencePercent = requestedMeasure && fulfilment.valid && fulfilment.totalSupplied != null
        ? Number((Math.abs(fulfilment.totalSupplied - requestedMeasure.amount) / requestedMeasure.amount * 100).toFixed(1))
        : null;
      const lineTotalCents = fulfilment.valid
        ? calculateBasketLineTotalCents(store?.priceCents ?? null, fulfilment.unitsRequired, quantity)
        : null;
      const normalizedPrice = lineTotalCents == null ? null : centsToPrice(lineTotalCents / quantity);
      const status = !store
        ? "no-match"
        : effectivePrice == null
          ? "price-unavailable"
          : !fulfilment.valid
            ? "incompatible-size"
            : "matched";
      results.push({
        storeId: retailer.id,
        storeName: retailer.name,
        status,
        queryUrl: store?.url,
        price: effectivePrice,
        priceCents: store?.priceCents ?? null,
        effectivePrice,
        normalizedPrice,
        unitPrice: store?.normalizedPrice ?? null,
        unitPriceLabel: store?.unit ?? null,
        lineTotalCents,
        lineTotal: centsToPrice(lineTotalCents),
        productName: store?.productName || null,
        brand: store?.brand || null,
        size: store?.size || null,
        unit: store?.unit || null,
        productUrl: store?.url || null,
        imageUrl: store?.imageUrl || null,
        productMeasure: store?.size ? { label: store.size } : null,
        packageQuantity: packageMeasure?.singleUnitAmount ?? null,
        packageUnit: packageMeasure?.normalizedUnit ?? null,
        multipackCount: packageMeasure?.multipackCount ?? null,
        normalizedQuantity: packageMeasure?.amount ?? null,
        normalizedUnit: packageMeasure?.normalizedUnit ?? null,
        matchedProductId: linkedOffer?.product_id || closest?.product.id || null,
        retailerProductId: store?.retailerProductId || null,
        matchScore: linkedOffer ? null : closest?.matchScore ?? null,
        matchConfidence: linkedOffer ? 1 : closest?.matchConfidence ?? null,
        matchTier: store ? (linkedOffer ? linkedTier : closest?.matchTier ?? 5) : null,
        matchType: store ? (linkedOffer ? linkedMatchType : closest?.matchType ?? "category-fallback") : null,
        matchReasons: linkedOffer
          ? ["Exact product selected from this retailer", fulfilment.reason]
          : closest?.matchReasons || [],
        relaxedCriteria: linkedOffer ? [] : closest?.relaxedCriteria || [],
        requestedSize: requestedMeasure ? displayPackageMeasure(requestedMeasure) : null,
        offeredSize: store?.size || (packageMeasure ? displayPackageMeasure(packageMeasure) : null),
        unitsRequired: fulfilment.valid ? fulfilment.unitsRequired : null,
        totalSupplied: fulfilment.valid ? fulfilment.totalSupplied : null,
        effectiveTotalPrice: fulfilment.valid && effectivePrice != null
          ? Number((effectivePrice * fulfilment.unitsRequired).toFixed(2))
          : closest?.effectiveTotalPrice ?? null,
        sizeDifferencePercent: linkedOffer ? sizeDifferencePercent : closest?.sizeDifferencePercent ?? null,
        isExactMatch: Boolean(store && (linkedOffer ? linkedTier === 1 : closest?.matchTier === 1)),
        isAlternative: Boolean(store && (linkedOffer ? linkedTier > 1 : (closest?.matchTier || 5) > 1)),
        alternativeReason: linkedOffer
          ? (linkedTier > 1 ? fulfilment.reason : null)
          : closest?.alternativeReason ?? null,
        regularPrice: store?.regularPrice ?? null,
        savings: store?.regularPrice && effectivePrice != null ? Number((store.regularPrice - effectivePrice).toFixed(2)) : null,
        promoText: store?.promoText,
        promoApplied: store?.promoApplied,
      });
    }
    const priced = results
      .filter((result) => result.normalizedPrice != null)
      .sort((left, right) => (left.normalizedPrice ?? Number.POSITIVE_INFINITY) - (right.normalizedPrice ?? Number.POSITIVE_INFINITY));
    scans.push({
      itemId: String(item.id || crypto.randomUUID()),
      name: String(item.name || query),
      query,
      quantity,
      requirement,
      category: String(item.category || ""),
      targetSize: String(item.targetSize || ""),
      targetMeasure: requestedSize ? { label: requestedSize } : null,
      results,
      bestStoreId: priced[0]?.storeId || null,
      bestStoreName: priced[0]?.storeName || null,
      bestEffectivePrice: priced[0]?.normalizedPrice ?? null,
    });
  }

  const basketTotals: Record<string, {
    storeId: string;
    storeName: string;
    knownSubtotalCents: number;
    knownSubtotal: number;
    total: number;
    matchedItemCount: number;
    missingItemCount: number;
    missing: number;
    isComplete: boolean;
  }> = {};
  for (const retailer of enabledRetailers) {
    const summary = summarizeRetailerBasket(scans.map((scan) => {
      const result = scan.results.find((entry) => entry.storeId === retailer.id);
      return result?.lineTotalCents ?? null;
    }));
    basketTotals[retailer.id] = {
      storeId: retailer.id,
      storeName: retailer.name,
      ...summary,
      total: summary.knownSubtotal,
      missing: summary.missingItemCount,
    };
  }
  const bestBasket = Object.values(basketTotals).filter((entry) => entry.isComplete).sort((left, right) => left.knownSubtotalCents - right.knownSubtotalCents)[0];
  return json(request, env, {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "catalogue-cache",
    locationApplied: Boolean(location),
    scans,
    basketTotals,
    bestBasketStoreId: bestBasket?.storeId || null,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json(request, env, {
        ok: true,
        service: "randbasket-api",
        message: "RandBasket API is online.",
        endpoints: {
          health: "/v1/health",
          catalogue: "/v1/catalogue?q=milk",
          categories: "/v1/catalogue/categories",
          specials: "/v1/specials",
        },
      });
    }

    if (
      request.method === "GET" &&
      ["/v1/health", "/health"].includes(url.pathname)
    ) {
      return json(request, env, {
        ok: true,
        service: "randbasket-api",
        now: new Date().toISOString(),
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/v1/admin/vector-index"
    ) {
      return indexProductVectorsResponse(request, env);
    }

    if (
      request.method === "GET" &&
      ["/v1/catalogue", "/api/catalogue"].includes(url.pathname)
    ) {
      return catalogueResponse(request, env, url);
    }

    if (
      request.method === "GET" &&
      ["/v1/catalogue/categories", "/api/catalogue/categories"].includes(
        url.pathname,
      )
    ) {
      return categoriesResponse(request, env);
    }

    if (
      request.method === "GET" &&
      ["/v1/specials", "/api/specials"].includes(url.pathname)
    ) {
      return specialsResponse(request, env, url);
    }

    if (
      request.method === "POST" &&
      ["/v1/catalogue/request", "/api/catalogue/request"].includes(
        url.pathname,
      )
    ) {
      return queueRequest(request, env);
    }

    if (
      request.method === "POST" &&
      ["/v1/feedback", "/api/feedback"].includes(url.pathname)
    ) {
      return submitFeedback(request, env);
    }

    if (
      request.method === "POST" &&
      ["/v1/scan/catalogue", "/api/scan/catalogue"].includes(url.pathname)
    ) {
      return scanBasket(request, env);
    }

    return json(request, env, {
      ok: false,
      error: "Not found",
    }, 404);
  },
};
