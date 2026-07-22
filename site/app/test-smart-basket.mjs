import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const values = new Map();
const requests = [];
let sequence = 0;
const localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
const context = {
  localStorage,
  navigator: { onLine: true },
  crypto: { randomUUID: () => `event_${String(++sequence).padStart(24, "0")}` },
  fetch: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return { ok: true, status: 202 };
  },
  setTimeout,
};
context.window = context;
vm.runInNewContext(fs.readFileSync(new URL("./smart-basket.js", import.meta.url), "utf8"), context);

const smart = context.RandBasketSmart;
assert.deepEqual({ ...smart.settings() }, { personalise: true, shareInsights: false });

const milk = {
  id: "milk-1",
  name: "PnP Full Cream Fresh Milk 2L",
  comparisonQuery: "full cream fresh milk 2l",
  targetSize: "2 L",
  category: "Dairy",
  selectedProductId: "milk-product",
  selectedStoreId: "pick-n-pay",
  selectedStoreName: "Pick n Pay",
  selectedPrice: 34.99,
};
smart.recordLocal(milk, 1);
smart.recordLocal(milk, 2);
assert.equal(smart.usuals()[0].addCount, 2);
assert.equal(smart.usuals()[0].totalQuantity, 3);

smart.track("https://api.example", "basket_add", milk, 1);
assert.equal(requests.length, 0, "sharing must remain off by default");

await smart.setSharing("https://api.example", true);
smart.track("https://api.example", "basket_add", milk, 1);
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(requests[0].url, "https://api.example/v1/events/basket");
assert.equal(requests[0].body.consentVersion, "basket-insights-v1");
assert.equal(requests[0].body.events[0].productName, milk.name);
assert.equal("location" in requests[0].body.events[0], false);
assert.equal("email" in requests[0].body.events[0], false);

await smart.setSharing("https://api.example", false);
assert.equal(requests.at(-1).url, "https://api.example/v1/privacy/delete");
assert.equal(smart.settings().shareInsights, false);

smart.clearProfile();
assert.equal(smart.usuals().length, 0);
console.log("Smart Basket web tests passed.");
