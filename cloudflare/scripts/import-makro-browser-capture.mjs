import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { addVocabularyText, vocabularySqlStatements } from "./search-vocabulary.mjs";

const [profilesPath, outputDir, ...capturePaths] = process.argv.slice(2);
if (!profilesPath || !outputDir || !capturePaths.length) {
  throw new Error("Usage: node import-makro-browser-capture.mjs <profiles.json> <output-dir> <capture.json> [...capture.json]");
}

const clean = (value) => String(value || "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;

function pricesFromTexts(texts) {
  const prices = [];
  for (const text of texts || []) {
    for (const match of String(text).matchAll(/R\s*([\d][\d\s,.]*?)(?=R|\d+%|$)/gi)) {
      const digits = match[1].replace(/\D/g, "");
      if (digits.length >= 3) prices.push(Number.parseInt(digits, 10));
    }
  }
  return [...new Set(prices)].filter((price) => price > 0);
}

function sizeFromTitle(title) {
  const matches = [...String(title).matchAll(/(?:\d+\s*x\s*)?\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/gi)];
  return matches.at(-1)?.[0]?.replace(/\s+/g, " ") || "";
}

function stableProductUrl(rawUrl) {
  const url = new URL(rawUrl);
  const pid = url.searchParams.get("pid");
  url.search = pid ? `?pid=${encodeURIComponent(pid)}` : "";
  return url.href;
}

const profiles = JSON.parse((await readFile(profilesPath, "utf8")).replace(/^\uFEFF/, ""));
const profileByTerm = new Map(profiles.map((profile) => [clean(profile.term), profile]));
const products = new Map();

for (const capturePath of capturePaths) {
  const rows = JSON.parse((await readFile(capturePath, "utf8")).replace(/^\uFEFF/, ""));
  for (const row of rows) {
    const title = String(row.title || "").trim();
    const pid = String(row.pid || "").trim();
    const term = String(row.searchTerm || "").trim();
    const profile = profileByTerm.get(clean(term));
    const titleText = clean(title);
    if (!title || !pid || !row.url || !row.image) continue;
    if ((profile?.exclude || []).some((word) => titleText.includes(clean(word)))) continue;

    const prices = pricesFromTexts(row.texts);
    if (!prices.length) continue;
    const currentPrice = Math.min(...prices);
    const regularPrice = Math.max(...prices) > currentPrice ? Math.max(...prices) : null;
    const discount = String(row.texts || []).match(/(\d+)%\s*off/i)?.[1];
    const id = `makro-${pid.toLowerCase()}`;
    const existing = products.get(id);
    const searchTerms = new Set(existing?.searchTerms || []);
    searchTerms.add(term);
    products.set(id, {
      id,
      pid,
      title,
      brand: title.split(/\s+/)[0] || "",
      size: sizeFromTitle(title),
      category: existing?.category || row.category || profile?.category || "Groceries",
      currentPrice,
      regularPrice,
      promoText: discount ? `${discount}% off` : null,
      image: String(row.image),
      url: stableProductUrl(row.url),
      searchTerms: [...searchTerms],
    });
  }
}

await mkdir(outputDir, { recursive: true });
const now = new Date().toISOString();
const rows = [...products.values()];
const files = [];
const vocabulary = new Map();
for (let start = 0, part = 1; start < rows.length; start += 250, part += 1) {
  const statements = [];
  for (const product of rows.slice(start, start + 250)) {
    const searchText = clean([product.title, product.size, product.category, ...product.searchTerms].join(" "));
    addVocabularyText(vocabulary, product.title, searchText, product.searchTerms, product.brand);
    statements.push(`INSERT OR REPLACE INTO catalogue_products (id, canonical_name, category, target_size, search_terms_json, search_text, updated_at) VALUES (${[
      sql(product.id), sql(product.title), sql(product.category), sql(product.size), sql(JSON.stringify(product.searchTerms)), sql(searchText), sql(now),
    ].join(", ")});`);
    statements.push(`INSERT OR REPLACE INTO catalogue_offers (id, product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label, price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type, promo_applied, image_url, product_url, location_key, store_code, store_display_name, latitude, longitude, last_seen_at, updated_at) VALUES (${[
      sql(`makro:${product.pid}`), sql(product.id), sql("makro"), sql("Makro"), sql(product.title), sql(product.brand), sql(product.size), sql("each"),
      product.currentPrice, product.regularPrice ?? "NULL", "NULL", sql(product.promoText), sql(product.promoText ? "discount" : null), product.promoText ? 1 : 0,
      sql(product.image), sql(product.url), "NULL", "NULL", "NULL", "NULL", "NULL", sql(now), sql(now),
    ].join(", ")});`);
  }
  const name = `makro-browser-${String(part).padStart(3, "0")}.sql`;
  await writeFile(join(outputDir, name), `${statements.join("\n")}\n`, "utf8");
  files.push(name);
}
const vocabularyFile = "makro-browser-vocabulary.sql";
await writeFile(join(outputDir, vocabularyFile), `${vocabularySqlStatements(vocabulary).join("\n")}\n`, "utf8");
files.push(vocabularyFile);

await writeFile(join(outputDir, "manifest.json"), JSON.stringify({
  generatedAt: now,
  captures: capturePaths.map((capturePath) => basename(capturePath)),
  products: rows.length,
  vocabularyTerms: vocabulary.size,
  files,
}, null, 2));
console.log(`Created ${files.length} D1 batches for ${rows.length} reviewed Makro browser products.`);
