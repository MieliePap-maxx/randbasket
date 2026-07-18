import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { addVocabularyText, vocabularySqlStatements } from "./search-vocabulary.mjs";

const [
  outputDir,
  limitArg = "20",
  delayArg = "1800",
  offsetArg = "0",
  maxPagesArg = "4",
  categoryFilterArg = "",
] = process.argv.slice(2);
if (!outputDir) {
  throw new Error(
    "Usage: node import-makro-category-catalogue.mjs <output-dir> [category-limit] [delay-ms] [category-offset] [max-pages] [category-filter]",
  );
}

const categoryLimit = Math.max(1, Number.parseInt(limitArg, 10) || 20);
const delayMs = Math.max(750, Number.parseInt(delayArg, 10) || 1800);
const categoryOffset = Math.max(0, Number.parseInt(offsetArg, 10) || 0);
const maxPages = Math.max(1, Number.parseInt(maxPagesArg, 10) || 4);
const sitemapUrl = "https://www.makro.co.za/sitemap_s_store-browse.xml.gz";
const allowedRoots = new Set(["food-products", "food-nutrition"]);
const userAgent = "Mozilla/5.0 (compatible; RandBasketCatalogue/1.0; +https://randbasket.co.za)";
const products = new Map();

const clean = (value) => String(value || "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const categoryFilter = clean(categoryFilterArg);
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const cents = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeXml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function sitemapLocations(xml) {
  return [...String(xml).matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(Boolean);
}

function categoryDetails(rawUrl) {
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean).filter((part) => part !== "pr");
  const root = segments[0] || "";
  const labels = segments.map((segment) => segment.replaceAll("-", " "));
  const text = clean(labels.join(" "));
  let category = "Pantry";
  if (/\b(?:milk|dairy|cheese|yogh?urt|butter|cream)\b/.test(text)) category = "Dairy";
  else if (/\b(?:bread|bakery|rolls?|cakes?|pastr)\b/.test(text)) category = "Bakery";
  else if (/\b(?:meat|chicken|beef|pork|lamb|fish|seafood|mince|sausages?)\b/.test(text)) category = "Meat";
  else if (/\b(?:fruit|vegetables?|salads?|produce)\b/.test(text)) category = "Fresh Fruit & Vegetables";
  else if (/\b(?:beverages?|coffee|tea|water|juice|drinks?)\b/.test(text)) category = "Beverages";
  else if (/\b(?:health|nutrition|supplements?|vitamins?)\b/.test(text)) category = "Health & Nutrition";
  return {
    url: url.href,
    root,
    category,
    searchTerms: [...new Set(labels.slice(1).filter(Boolean))],
    query: labels.at(-1) === root.replaceAll("-", " ") ? "" : labels.at(-1) || "",
  };
}

function initialState(html) {
  const marker = "window.__INITIAL_STATE__ = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = start + marker.length;
  const end = html.indexOf("</script>", bodyStart);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(bodyStart, end).trim().replace(/;$/, ""));
  } catch {
    return null;
  }
}

function productValues(root) {
  const values = [];
  const visited = new WeakSet();
  const visit = (value) => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (value.productInfo?.value?.pricing && value.productInfo.value.id) {
      values.push(value.productInfo.value);
      return;
    }
    if (value.pricing && value.id && (value.titles?.title || value.titles?.newTitle)) {
      values.push(value);
      return;
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(root?.pageDataV4?.page?.data || root);
  return values;
}

function imageUrl(value) {
  return String(value || "")
    .replace("{@width}", "400")
    .replace("{@height}", "400")
    .replace("{@quality}", "70");
}

function pageUrl(details, page) {
  const url = new URL("/search", "https://www.makro.co.za");
  url.searchParams.set("q", details.query);
  if (page > 1) url.searchParams.set("page", String(page));
  return url.href;
}

function addProduct(value, details) {
  const title = String(value.titles?.title || value.titles?.newTitle || "").trim();
  const price = Number(value.pricing?.finalPrice?.value);
  if (!title || !Number.isFinite(price) || price <= 0) return false;
  const id = `makro-${String(value.id).toLowerCase()}`;
  const existing = products.get(id);
  const searchTerms = new Set(existing?.searchTerms || []);
  details.searchTerms.forEach((term) => searchTerms.add(term));
  const regularPrice = Number(value.pricing?.mrp?.value);
  const discount = Number(value.pricing?.totalDiscount || value.pricing?.finalPrice?.discount || 0);
  products.set(id, {
    id,
    retailerProductId: String(value.id),
    title,
    brand: String(value.productBrand || value.titles?.superTitle || "").trim(),
    size: String(value.titles?.subtitle || "").trim(),
    category: existing?.category || details.category,
    price,
    regularPrice: Number.isFinite(regularPrice) && regularPrice > price ? regularPrice : null,
    promoText: discount > 0 ? `${discount}% off` : null,
    promoApplied: discount > 0 || (Number.isFinite(regularPrice) && regularPrice > price),
    image: imageUrl(value.media?.images?.[0]?.url),
    url: new URL(value.baseUrl || value.smartUrl, "https://www.makro.co.za").href,
    searchTerms: [...searchTerms],
  });
  return !existing;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      "Accept-Language": "en-ZA,en;q=0.9",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const sitemapResponse = await fetch(sitemapUrl, { headers: { "User-Agent": userAgent } });
if (!sitemapResponse.ok) throw new Error(`Makro category sitemap returned HTTP ${sitemapResponse.status}`);
const sitemapXml = gunzipSync(Buffer.from(await sitemapResponse.arrayBuffer())).toString("utf8");
const categoryByQuery = new Map();
for (const details of sitemapLocations(sitemapXml)
  .map(categoryDetails)
  .filter((details) => allowedRoots.has(details.root))
  .filter((details) => details.query)
  .sort((left, right) => left.url.localeCompare(right.url))) {
  const key = clean(details.query);
  const existing = categoryByQuery.get(key);
  if (existing) {
    existing.searchTerms = [...new Set([...existing.searchTerms, ...details.searchTerms])];
  } else {
    categoryByQuery.set(key, details);
  }
}
const allCategories = [...categoryByQuery.values()];
const filteredCategories = categoryFilter
  ? allCategories.filter((details) => clean(details.query).includes(categoryFilter))
  : allCategories;
const categories = filteredCategories.slice(categoryOffset, categoryOffset + categoryLimit);
if (!categories.length) throw new Error(`No Makro food categories found at offset ${categoryOffset}`);

let successfulCategories = 0;
let failedCategories = 0;
let attemptedCategories = 0;
const incompleteCategoryOffsets = [];
let verificationStreak = 0;
let verificationStopped = false;
const categoryProductCounts = {};
for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
  const details = categories[categoryIndex];
  attemptedCategories += 1;
  let categoryProducts = 0;
  let categorySucceeded = false;
  let categoryIncomplete = false;
  for (let page = 1; page <= maxPages; page += 1) {
    try {
      const state = initialState(await fetchText(pageUrl(details, page)));
      if (!state) throw new Error("catalogue state missing");
      verificationStreak = 0;
      categorySucceeded = true;
      const pageProducts = productValues(state);
      if (!pageProducts.length) break;
      let newProducts = 0;
      for (const value of pageProducts) {
        if (addProduct(value, details)) newProducts += 1;
      }
      categoryProducts += newProducts;
    } catch (error) {
      console.warn(`[${categoryIndex + 1}/${categories.length}] ${details.url}: ${error.message}`);
      if (error.message === "catalogue state missing") verificationStreak += 1;
      categoryIncomplete = true;
      break;
    }
    await sleep(delayMs);
  }
  categoryProductCounts[details.url] = categoryProducts;
  if (categorySucceeded) successfulCategories += 1;
  else failedCategories += 1;
  if (categoryIncomplete || !categorySucceeded) {
    incompleteCategoryOffsets.push(categoryOffset + categoryIndex);
  }
  console.log(
    `[${categoryIndex + 1}/${categories.length}] ${details.query}: ${categoryProducts} new (${products.size} unique)`,
  );
  if (verificationStreak >= 3) {
    verificationStopped = true;
    console.warn("Makro verification is active; stopping this resumable category batch.");
    break;
  }
  if (categoryIndex < categories.length - 1) await sleep(delayMs);
}

await mkdir(outputDir, { recursive: true });
const now = new Date().toISOString();
const rows = [...products.values()];
const files = [];
const vocabulary = new Map();
for (let start = 0, part = 1; start < rows.length; start += 250, part += 1) {
  const statements = [];
  for (const product of rows.slice(start, start + 250)) {
    const searchText = clean([product.title, product.brand, product.size, product.category, ...product.searchTerms].join(" "));
    addVocabularyText(vocabulary, product.title, searchText, product.searchTerms, product.brand);
    statements.push(`INSERT OR REPLACE INTO catalogue_products (id, canonical_name, category, target_size, search_terms_json, search_text, updated_at) VALUES (${[
      sql(product.id), sql(product.title), sql(product.category), sql(product.size), sql(JSON.stringify(product.searchTerms)), sql(searchText), sql(now),
    ].join(", ")});`);
    statements.push(`INSERT OR REPLACE INTO catalogue_offers (id, product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label, price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type, promo_applied, image_url, product_url, location_key, store_code, store_display_name, latitude, longitude, last_seen_at, updated_at) VALUES (${[
      sql(`makro:${product.retailerProductId}`), sql(product.id), sql("makro"), sql("Makro"), sql(product.title), sql(product.brand), sql(product.size), sql("each"),
      cents(product.price), cents(product.regularPrice), "NULL", sql(product.promoText), sql(product.promoApplied ? "discount" : null), product.promoApplied ? 1 : 0,
      sql(product.image), sql(product.url), "NULL", "NULL", "NULL", "NULL", "NULL", sql(now), sql(now),
    ].join(", ")});`);
  }
  const name = `makro-category-${String(part).padStart(3, "0")}.sql`;
  await writeFile(join(outputDir, name), `${statements.join("\n")}\n`, "utf8");
  files.push(name);
}
const vocabularyFile = "makro-category-vocabulary.sql";
await writeFile(join(outputDir, vocabularyFile), `${vocabularySqlStatements(vocabulary).join("\n")}\n`, "utf8");
files.push(vocabularyFile);
await writeFile(join(outputDir, "manifest.json"), JSON.stringify({
  source: "makro-category-sitemap",
  generatedAt: now,
  sitemapUrl,
  totalFoodCategories: allCategories.length,
  categoryFilter: categoryFilter || null,
  categoryOffset,
  requestedCategories: categories.length,
  attemptedCategories,
  incompleteCategoryOffsets,
  nextCategoryOffset: incompleteCategoryOffsets[0] ?? categoryOffset + attemptedCategories,
  successfulCategories,
  failedCategories,
  verificationStopped,
  maxPages,
  categoryProductCounts,
  products: rows.length,
  vocabularyTerms: vocabulary.size,
  files,
}, null, 2));
console.log(`Created ${files.length} D1 batches for ${rows.length} Makro food-category products.`);
