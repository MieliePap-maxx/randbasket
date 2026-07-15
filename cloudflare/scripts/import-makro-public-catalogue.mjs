import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [profilesPath, outputDir, limitArg = "20", delayArg = "1200", offsetArg = "0"] = process.argv.slice(2);
if (!profilesPath || !outputDir) {
  throw new Error("Usage: node import-makro-public-catalogue.mjs <profiles.json> <output-dir> [term-limit] [delay-ms] [term-offset]");
}

const termLimit = Math.max(1, Number.parseInt(limitArg, 10) || 20);
const delayMs = Math.max(500, Number.parseInt(delayArg, 10) || 1200);
const termOffset = Math.max(0, Number.parseInt(offsetArg, 10) || 0);
const profiles = JSON.parse((await readFile(profilesPath, "utf8")).replace(/^\uFEFF/, ""));
const allTerms = [...new Set(profiles.map((profile) => String(profile.term || "").trim()).filter(Boolean))];
const terms = allTerms.slice(termOffset, termOffset + termLimit);
const profileByTerm = new Map(profiles.map((profile) => [String(profile.term || "").trim(), profile]));
const products = new Map();

const clean = (value) => String(value || "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const cents = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function initialState(html) {
  const marker = "window.__INITIAL_STATE__ = ";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const bodyStart = start + marker.length;
  const end = html.indexOf("</script>", bodyStart);
  if (end < 0) return null;
  return JSON.parse(html.slice(bodyStart, end).trim().replace(/;$/, ""));
}

function productValues(root) {
  const values = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.productInfo?.value?.pricing && value.productInfo.value.id) {
      values.push(value.productInfo.value);
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

let missingStateStreak = 0;
let successfulTerms = 0;
for (let index = 0; index < terms.length; index += 1) {
  const term = terms[index];
  const profile = profileByTerm.get(term);
  const url = `https://www.makro.co.za/search?q=${encodeURIComponent(term)}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RandBasketCatalogue/1.0; +https://randbasket.co.za)" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = initialState(await response.text());
    if (!state) throw new Error("catalogue state missing");
    missingStateStreak = 0;
    successfulTerms += 1;
    let found = 0;
    for (const value of productValues(state)) {
      const title = String(value.titles?.title || value.titles?.newTitle || "").trim();
      const price = Number(value.pricing?.finalPrice?.value);
      if (!title || !Number.isFinite(price) || price <= 0) continue;
      const id = `makro-${String(value.id).toLowerCase()}`;
      const existing = products.get(id);
      const searchTerms = new Set(existing?.searchTerms || []);
      searchTerms.add(term);
      const regularPrice = Number(value.pricing?.mrp?.value);
      const discount = Number(value.pricing?.totalDiscount || value.pricing?.finalPrice?.discount || 0);
      products.set(id, {
        id,
        retailerProductId: String(value.id),
        title,
        brand: String(value.productBrand || value.titles?.superTitle || "").trim(),
        size: String(value.titles?.subtitle || "").trim(),
        category: String(existing?.category || profile?.category || value.analyticsData?.subCategory || value.analyticsData?.category || value.analyticsData?.superCategory || "Groceries"),
        price,
        regularPrice: Number.isFinite(regularPrice) && regularPrice > price ? regularPrice : null,
        promoText: discount > 0 ? `${discount}% off` : null,
        promoApplied: discount > 0 || (Number.isFinite(regularPrice) && regularPrice > price),
        available: value.availability?.displayState === "IN_STOCK",
        image: imageUrl(value.media?.images?.[0]?.url),
        url: new URL(value.baseUrl || value.smartUrl, "https://www.makro.co.za").href,
        searchTerms: [...searchTerms],
      });
      found += 1;
    }
    console.log(`[${index + 1}/${terms.length}] ${term}: ${found} priced products (${products.size} unique)`);
  } catch (error) {
    console.warn(`[${index + 1}/${terms.length}] ${term}: ${error.message}`);
    if (error.message === "catalogue state missing") missingStateStreak += 1;
    if (missingStateStreak >= 3) {
      console.warn("Makro verification is active; stopping this batch for a later resume.");
      break;
    }
  }
  if (index < terms.length - 1) await sleep(delayMs);
}

await mkdir(outputDir, { recursive: true });
const now = new Date().toISOString();
const rows = [...products.values()];
const files = [];
for (let start = 0, part = 1; start < rows.length; start += 250, part += 1) {
  const statements = [];
  for (const product of rows.slice(start, start + 250)) {
    const searchText = clean([product.title, product.brand, product.size, product.category, ...product.searchTerms].join(" "));
    statements.push(`INSERT OR REPLACE INTO catalogue_products (id, canonical_name, category, target_size, search_terms_json, search_text, updated_at) VALUES (${[
      sql(product.id), sql(product.title), sql(product.category), sql(product.size), sql(JSON.stringify(product.searchTerms)), sql(searchText), sql(now),
    ].join(", ")});`);
    statements.push(`INSERT OR REPLACE INTO catalogue_offers (id, product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label, price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type, promo_applied, image_url, product_url, location_key, store_code, store_display_name, latitude, longitude, last_seen_at, updated_at) VALUES (${[
      sql(`makro:${product.retailerProductId}`), sql(product.id), sql("makro"), sql("Makro"), sql(product.title), sql(product.brand), sql(product.size), sql("each"),
      cents(product.price), cents(product.regularPrice), "NULL", sql(product.promoText), sql(product.promoApplied ? "discount" : null), product.promoApplied ? 1 : 0,
      sql(product.image), sql(product.url), "NULL", "NULL", "NULL", "NULL", "NULL", sql(now), sql(now),
    ].join(", ")});`);
  }
  const name = `makro-${String(part).padStart(3, "0")}.sql`;
  await writeFile(join(outputDir, name), `${statements.join("\n")}\n`, "utf8");
  files.push(name);
}
await writeFile(join(outputDir, "manifest.json"), JSON.stringify({ generatedAt: now, termOffset, requestedTerms: terms.length, successfulTerms, products: rows.length, files }, null, 2));
console.log(`Created ${files.length} D1 batches for ${rows.length} Makro products.`);
