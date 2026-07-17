import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const BASE_URL = "https://www.spar.co.za/Assets/Our-Brands/In-Store/Our-Brands-Microsite/Products";
const outputPath = resolve(process.argv[2] || "data/spar-own-brand-catalogue.json");
const concurrency = Math.min(6, Math.max(1, Number(process.env.SPAR_CRAWL_CONCURRENCY) || 4));

function decodeHtml(value = "") {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return String(value)
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function text(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : "";
}

function extractLinks(html) {
  const links = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = attribute(match[1], "href");
    if (!/[?&](?:catId|categoryId)=\d+/i.test(href)) continue;
    links.push({ href: new URL(href, BASE_URL).href, label: text(match[2]) });
  }
  return links;
}

function classContent(block, className) {
  const pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  return text(block.match(pattern)?.[1] || "");
}

function extractProducts(html, category, url) {
  const ids = [...new Set([...html.matchAll(/loadProduct\((\d+)\)/g)].map((match) => match[1]))];
  return ids.map((id) => {
    const modalIndex = html.indexOf(`prodModalLabel_${id}`);
    const modal = modalIndex >= 0 ? html.slice(modalIndex, modalIndex + 12000) : "";
    const title = modal.match(new RegExp(`id=["']prodModalLabel_${id}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"));
    const imageTag = html.match(new RegExp(`<img\\b[^>]*id=["']prodModalImg_${id}["'][^>]*>`, "i"))?.[0] || "";
    const cardIndex = html.indexOf(`loadProduct(${id})`);
    const card = cardIndex >= 0 ? html.slice(cardIndex, cardIndex + 2500) : "";
    const cardTitle = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "";
    const name = text(title?.[1] || cardTitle.replace(/<span[\s\S]*$/i, ""));
    const size = classContent(modal, "item-itemsize") || text(cardTitle.match(/<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "").replace(/[()]/g, "");
    const imagePath = attribute(imageTag, "src");
    return {
      id,
      name,
      size,
      description: classContent(modal, "item-description"),
      extra: classContent(modal, "item-desc"),
      imageUrl: imagePath ? new URL(imagePath, BASE_URL).href : "",
      category,
      url,
    };
  }).filter((product) => product.id && product.name);
}

async function fetchHtml(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "RandBasket catalogue indexer (+https://www.randbasket.co.za)",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } catch (error) {
    if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 750));
    return fetchHtml(url, attempt + 1);
  }
}

async function mapLimit(entries, worker) {
  const results = new Array(entries.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (nextIndex < entries.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(entries[index], index);
    }
  }));
  return results;
}

const categoryQueue = [BASE_URL];
const categoryPages = new Set();
const leafCategories = new Map();
while (categoryQueue.length) {
  const url = categoryQueue.shift();
  if (categoryPages.has(url)) continue;
  categoryPages.add(url);
  const html = await fetchHtml(url);
  for (const link of extractLinks(html)) {
    if (/[?&]categoryId=\d+/i.test(link.href)) leafCategories.set(link.href, link.label.replace(/\s+\d+$/, "").trim());
    else if (!categoryPages.has(link.href)) categoryQueue.push(link.href);
  }
}

const categoryEntries = [...leafCategories.entries()];
const productGroups = await mapLimit(categoryEntries, async ([url, category]) => extractProducts(await fetchHtml(url), category, url));
const products = [...new Map(productGroups.flat().map((product) => [product.id, product])).values()]
  .sort((left, right) => Number(left.id) - Number(right.id));
const dataset = {
  source: BASE_URL,
  capturedAt: new Date().toISOString(),
  categoryCount: leafCategories.size,
  productCount: products.length,
  products,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
console.log(`Captured ${products.length} SPAR products across ${leafCategories.size} categories in ${outputPath}`);
