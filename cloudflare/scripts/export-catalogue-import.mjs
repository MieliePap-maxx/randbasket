import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [cataloguePath, profilesPath, outputDirectory] = process.argv.slice(2);

if (!cataloguePath || !profilesPath || !outputDirectory) {
  throw new Error("Usage: node export-catalogue-import.mjs <catalogue.json> <profiles.json> <output-directory>");
}

async function readJson(path) {
  return JSON.parse((await readFile(resolve(path), "utf8")).replace(/^\uFEFF/, ""));
}

const catalogue = await readJson(cataloguePath);
const profiles = await readJson(profilesPath);
const output = resolve(outputDirectory);
const batchSize = 350;

function sql(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function clean(value) {
  return String(value || "")
    .replace(/(?<=\d)(?=[a-zA-Z])/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const now = new Date().toISOString();
const files = [];
for (let start = 0, part = 1; start < catalogue.length; start += batchSize, part += 1) {
  const products = catalogue.slice(start, start + batchSize);
  const statements = ["PRAGMA foreign_keys = ON;"];
  for (const product of products) {
    const searchTerms = Array.isArray(product.searchTerms) ? product.searchTerms : [];
    const searchText = clean([product.canonicalName, product.targetSize, product.category, ...searchTerms].join(" "));
    statements.push(
      `INSERT OR REPLACE INTO catalogue_products (id, canonical_name, category, target_size, search_terms_json, search_text, updated_at) VALUES (${[
        sql(product.id), sql(product.canonicalName), sql(product.category), sql(product.targetSize), sql(JSON.stringify(searchTerms)), sql(searchText), sql(now),
      ].join(", ")});`,
    );
    for (const [index, offer] of (product.stores || []).entries()) {
      const id = `${product.id}:${offer.storeId || "unknown"}:${index}`;
      statements.push(
        `INSERT OR REPLACE INTO catalogue_offers (id, product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label, price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type, promo_applied, image_url, product_url, last_seen_at, updated_at) VALUES (${[
          sql(id), sql(product.id), sql(offer.storeId), sql(offer.storeName), sql(offer.productName), sql(offer.brand), sql(offer.size), sql(offer.unit),
          sql(cents(offer.price)), sql(cents(offer.regularPrice)), sql(cents(offer.normalisedPriceForTarget)), sql(offer.promoText), sql(offer.promoType),
          offer.promoApplied ? "1" : "0", sql(offer.imageUrl), sql(offer.url), sql(offer.lastSeenAt), sql(now),
        ].join(", ")});`,
      );
    }
  }
  const name = `catalogue-${String(part).padStart(4, "0")}.sql`;
  await writeFile(join(output, name), `${statements.join("\n")}\n`, "utf8");
  files.push(name);
}

const profileStatements = profiles.map((profile) =>
  `INSERT OR REPLACE INTO search_profiles (term, category, search_text, exclude_terms_json, preferred_terms_json) VALUES (${[
    sql(clean(profile.term)), sql(profile.category), sql(profile.searchText), sql(JSON.stringify(profile.exclude || [])), sql(JSON.stringify(profile.prefer || [])),
  ].join(", ")});`,
);
await writeFile(join(output, "search-profiles.sql"), `${profileStatements.join("\n")}\n`, "utf8");
await writeFile(join(output, "manifest.json"), JSON.stringify({ generatedAt: now, products: catalogue.length, batches: files, profiles: profiles.length }, null, 2), "utf8");
console.log(`Created ${files.length} catalogue SQL batches and ${profiles.length} search profiles in ${output}`);
