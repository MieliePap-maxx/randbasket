import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./comparison-core.js", import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: "comparison-core.js" });
const {
  wholeQuantity,
  nextQuantity,
  sameCatalogueProduct,
  matchingBasketItem,
  availableProductDetails,
} = sandbox.RandBasketCore;

assert.equal(wholeQuantity(undefined), 1);
assert.equal(wholeQuantity(2.7), 3);
assert.equal(nextQuantity(0, 1), 1, "adding a new product starts at one");
assert.equal(nextQuantity(1, -1), 0, "decrementing one removes the product");
assert.equal(nextQuantity(2, -1), 1);
assert.equal(nextQuantity(2, 1), 3);

const product = { id: "milk-2l" };
const store = { storeId: "pick-n-pay", productName: "PnP Full Cream Milk 2L", url: "https://example.test/milk" };
const items = [{
  id: "basket-line-1",
  quantity: 3,
  selectedProductId: "milk-2l",
  links: { "pick-n-pay": "https://example.test/milk" },
}];
assert.equal(sameCatalogueProduct(items[0], product, store), true);
assert.equal(matchingBasketItem(items, product, store).quantity, 3, "duplicate product cards must resolve to one shared basket line");
assert.equal(sameCatalogueProduct(items[0], { id: "bread-700g" }, { storeId: "checkers", url: "https://example.test/bread" }), false);

const details = availableProductDetails(
  { id: "milk-2l", canonicalName: "Full cream milk", category: "Dairy" },
  {
    storeName: "Checkers",
    productName: "Housebrand Full Cream Milk 2L",
    size: "2L",
    price: 34.99,
    howToUse: ["Keep refrigerated", "Use within three days"],
    matchReasons: ["Same product family", "Matching pack size"],
  },
);
assert.equal(details.name, "Housebrand Full Cream Milk 2L");
assert.equal(details.description, "", "missing descriptions must remain absent");
assert.equal(details.facts.some(([label]) => label === "Package size"), true);
assert.equal(details.facts.some(([label]) => label === "Description"), false);
assert.equal(details.sections.find(([label]) => label === "How to use")[1], "Keep refrigerated\nUse within three days");
assert.equal(details.matchReasons.length, 2);

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("./app.js", import.meta.url), "utf8");
const serviceWorkerSource = await readFile(new URL("./service-worker.js", import.meta.url), "utf8");
assert.match(html, /<dialog id="productDetailsDialog"[^>]*aria-labelledby="productDetailsTitle"/);
assert.match(html, /aria-label="Close product details"/);
assert.match(appSource, /class=\"product-details-name\"/, "product names must open details");
assert.match(appSource, /Why this result is shown/, "details must explain the product match");
assert.match(appSource, /No extended description has been supplied/, "missing retailer content must have an honest fallback");
assert.match(appSource, /lastProductDetailsTrigger\?\.focus\?\.\(\)/, "focus must return to the opening image");
assert.match(appSource, /localStorage\.setItem\(STORAGE_KEY/, "basket persistence must remain enabled");
assert.match(appSource, /&page=\$\{Math\.max\(1, page\)\}/, "catalogue pagination must be sent to the API");
assert.match(appSource, /View retailer product/, "retailer product links must remain available");
assert.match(appSource, /window\.location\.replace\(refreshUrl\.toString\(\)\)/, "stale HTML shells must refresh automatically");
assert.match(appSource, /service-worker\.js\?v=31/, "the page must request the latest service worker");
assert.match(serviceWorkerSource, /self\.skipWaiting\(\)/, "a repaired service worker must activate immediately");
assert.match(serviceWorkerSource, /self\.clients\.claim\(\)/, "the repaired service worker must control existing tabs");
assert.match(serviceWorkerSource, /cache: "no-store"/, "application updates must bypass stale HTTP caches");

console.log("Shared catalogue quantity tests passed.");
