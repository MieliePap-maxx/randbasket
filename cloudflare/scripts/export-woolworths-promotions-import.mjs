import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const [outputDirectory] = process.argv.slice(2);
if (!outputDirectory) {
  throw new Error("Usage: node export-woolworths-promotions-import.mjs <output-directory>");
}

const endpoint = "https://wpkmgeuco-zone.cnstrc.com/browse/subtype/foods";
const apiKey = "key_tw9hKe0fkfgEf36D";
const pageSize = 200;
const output = resolve(outputDirectory);
const clientId = crypto.randomUUID();
const now = new Date().toISOString();

const sql = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const cents = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
};
const text = (value) => {
  const input = String(value || "").trim();
  if (!/[\u00c2\u00c3\u00e2]/.test(input)) return input;
  const repaired = Buffer.from(input, "latin1").toString("utf8");
  return repaired.includes("\ufffd") ? input : repaired;
};

function promotionText(data) {
  const messages = (Array.isArray(data.promo) ? data.promo : [data.promo])
    .map(text)
    .filter(Boolean);
  if (messages.length) return [...new Set(messages)].join(" | ");
  if (data.badges?.SAVE) return "Woolworths promotion";
  if (data.badges?.LOWERPRICE) return "Woolworths lower price";
  return "Woolworths current offer";
}

async function fetchPage(page) {
  const url = new URL(endpoint);
  url.searchParams.set("key", apiKey);
  url.searchParams.append("filters[visibility]", "all");
  url.searchParams.append("filters[visibility]", "web and app");
  url.searchParams.set("filters[onpromo]", "1");
  url.searchParams.set("num_results_per_page", String(pageSize));
  url.searchParams.set("page", String(page));
  url.searchParams.set("us", "default");
  url.searchParams.set("i", clientId);
  url.searchParams.set("s", "1");
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RandBasketCatalogue/1.0; +https://randbasket.co.za)",
      Origin: "https://www.woolworths.co.za",
      Referer: "https://www.woolworths.co.za/",
    },
  });
  if (!response.ok) throw new Error(`Woolworths promotion feed returned HTTP ${response.status}`);
  return response.json();
}

const first = await fetchPage(1);
const total = Number(first.response?.total_num_results || 0);
const totalPages = Math.max(1, Math.ceil(total / pageSize));
const results = [...(first.response?.results || [])];
for (let page = 2; page <= totalPages; page += 1) {
  const payload = await fetchPage(page);
  results.push(...(payload.response?.results || []));
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const files = [];
const batchSize = 250;
for (let start = 0, part = 1; start < results.length; start += batchSize, part += 1) {
  const statements = [];
  if (start === 0) {
    statements.push(
      `UPDATE catalogue_offers SET promo_text = NULL, promo_type = NULL, promo_applied = 0, updated_at = ${sql(now)} WHERE retailer_id = 'woolworths';`,
    );
  }
  for (const result of results.slice(start, start + batchSize)) {
    const data = result.data || {};
    const productId = text(data.id);
    if (!productId) continue;
    const price = cents(data.p10 ?? data.p30 ?? data.p60);
    const assignments = [
      `product_name = ${sql(text(result.value || data.description))}`,
      price == null ? null : `price_cents = ${price}`,
      `promo_text = ${sql(promotionText(data))}`,
      "promo_type = 'promotion'",
      "promo_applied = 1",
      `last_seen_at = ${sql(now)}`,
      `updated_at = ${sql(now)}`,
    ].filter(Boolean);
    statements.push(
      `UPDATE catalogue_offers SET ${assignments.join(", ")} WHERE retailer_id = 'woolworths' AND product_url LIKE ${sql(`%/A-${productId}`)};`,
    );
  }
  const name = `woolworths-promotions-${String(part).padStart(3, "0")}.sql`;
  await writeFile(join(output, name), `${statements.join("\n")}\n`, "utf8");
  files.push(name);
}

await writeFile(join(output, "manifest.json"), JSON.stringify({
  generatedAt: now,
  advertisedPromotions: total,
  downloadedPromotions: results.length,
  files,
}, null, 2));
console.log(`Created ${files.length} D1 batches for ${results.length} Woolworths promotions.`);
