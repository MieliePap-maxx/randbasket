import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { addVocabularyText, vocabularySqlStatements } from "./search-vocabulary.mjs";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error("Usage: node export-spar-regional-import.mjs <reviewed-offers.json> <output.sql>");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const clean = (value) => String(value || "")
  .toLowerCase()
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();
const now = source.reviewedAt;
const statements = [
  `-- Reviewed SPAR regional specials valid ${source.validFrom} to ${source.validTo}.`,
  "-- Every offer is tied to the official flipbook and representative store coordinates.",
];
const vocabulary = new Map();

for (const region of source.regions) {
  for (const item of region.items) {
    const productId = `spar-${region.key}-${item.id}-${source.campaign}`;
    const offerId = `spar:${region.key}:${item.id}:${source.campaign}`;
    const terms = [...new Set([...(item.terms || []), item.name])];
    const searchText = clean([item.name, item.size, item.category, ...terms].join(" "));
    addVocabularyText(vocabulary, item.name, searchText, terms, item.brand || "SPAR");
    statements.push(`INSERT OR REPLACE INTO catalogue_products (id, canonical_name, category, target_size, search_terms_json, search_text, updated_at) VALUES (${[
      sql(productId), sql(item.name), sql(item.category), sql(item.size), sql(JSON.stringify(terms)), sql(searchText), sql(now),
    ].join(", ")});`);
    statements.push(`INSERT OR REPLACE INTO catalogue_offers (id, product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label, price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type, promo_applied, image_url, product_url, location_key, store_code, store_display_name, latitude, longitude, last_seen_at, updated_at) VALUES (${[
      sql(offerId), sql(productId), sql("spar"), sql("SPAR"), sql(item.name), sql(item.brand || "SPAR"), sql(item.size), sql(item.unit || "each"),
      item.priceCents, item.regularPriceCents ?? "NULL", "NULL", sql(`Valid ${source.validFrom} to ${source.validTo}; selected stores while stocks last`),
      sql("regional-special"), 1, "NULL", sql(`https://www.spar.co.za/specials/flipbook/${region.flipbook}`), sql(region.key), sql(region.storeCode),
      sql(region.storeName), region.latitude, region.longitude, sql(now), sql(now),
    ].join(", ")});`);
  }
}
statements.push(...vocabularySqlStatements(vocabulary));

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${statements.join("\n")}\n`, "utf8");
console.log(`Created ${outputPath} with ${source.regions.reduce((sum, region) => sum + region.items.length, 0)} reviewed SPAR offers.`);
