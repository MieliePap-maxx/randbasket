import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inputPath = resolve(process.argv[2] || "data/spar-own-brand-catalogue.json");
const outputPath = resolve(process.argv[3] || "data/spar-own-brand-import.sql");
const dataset = JSON.parse((await readFile(inputPath, "utf8")).replace(/^\uFEFF/, ""));

function sql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function clean(value) {
  return String(value || "")
    .replace(/(?<=\d)(?=[a-zA-Z])/g, " ")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function displaySize(value) {
  const size = String(value || "").trim().replace(/(\d)(kg|g|ml|l)\b/gi, "$1 $2");
  return /^(\d+)\s*s$/i.test(size) ? size.replace(/s$/i, "pack") : size;
}

function titleCase(value) {
  return String(value || "").toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

const statements = [
  "PRAGMA foreign_keys = ON;",
  "DELETE FROM catalogue_offers WHERE id LIKE 'spar:own-brand:%';",
  "DELETE FROM catalogue_products WHERE id LIKE 'spar-own-brand-%' AND NOT EXISTS (SELECT 1 FROM catalogue_offers WHERE catalogue_offers.product_id = catalogue_products.id);",
];

for (const source of dataset.products || []) {
  const productId = `spar-own-brand-${source.id}`;
  const offerId = `spar:own-brand:${source.id}`;
  const size = displaySize(source.size);
  const productName = `SPAR ${titleCase(source.name)}`.replace(/\s+/g, " ").trim();
  const category = String(source.category || "SPAR own brand").replace(/\s+\d+$/, "").trim();
  const terms = [...new Set([source.name, productName, category, source.description, size].filter(Boolean))];
  const searchText = clean(terms.join(" "));
  statements.push(`INSERT OR REPLACE INTO catalogue_products (id, canonical_name, category, target_size, search_terms_json, search_text, updated_at) VALUES (${[
    sql(productId), sql(productName), sql(category), sql(size), sql(JSON.stringify(terms)), sql(searchText), sql(dataset.capturedAt),
  ].join(", ")});`);
  statements.push(`INSERT OR REPLACE INTO catalogue_offers (id, product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label, price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type, promo_applied, image_url, product_url, location_key, store_code, store_display_name, latitude, longitude, last_seen_at, updated_at) VALUES (${[
    sql(offerId), sql(productId), sql("spar"), sql("SPAR"), sql(productName), sql("SPAR"), sql(size), sql("each"),
    "NULL", "NULL", "NULL", "NULL", sql("official-product-catalogue"), "0", sql(source.imageUrl), sql(source.url || dataset.source),
    "NULL", "NULL", "NULL", "NULL", "NULL", sql(dataset.capturedAt), sql(dataset.capturedAt),
  ].join(", ")});`);
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${statements.join("\n")}\n`, "utf8");
console.log(`Created ${outputPath} with ${(dataset.products || []).length} SPAR catalogue products.`);
