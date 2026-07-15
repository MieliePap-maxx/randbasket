const state = {
  items: [],
  settings: {},
  stores: [],
  latest: null,
  pnpProgressTimer: null,
  mobileUrl: "",
  catalogueResults: [],
  catalogueRetailerMatches: [],
  cataloguePage: 1,
  catalogueHasMore: false,
};

const API_ORIGIN = "https://api.randbasket.co.za";
const STORAGE_KEY = "randbasket-web-state-v1";
const defaultStores = [
  { id: "pick-n-pay", name: "Pick n Pay" },
  { id: "checkers", name: "Checkers" },
  { id: "woolworths", name: "Woolworths" },
];

const moneyFmt = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const responseText = await response.text();
  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload.error || `RandBasket service unavailable (${response.status})`);
  }
  return payload;
}

function formatMoney(value) {
  return value == null ? "-" : moneyFmt.format(value);
}

const windows1252Bytes = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function mojibakeScore(value) {
  return (String(value).match(/[\u00c2\u00c3\u00c5\u00e2\u00f0\ufffd]/g) || []).length;
}

function decodeMojibakePass(value) {
  const bytes = [];
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code <= 0xff) bytes.push(code);
    else if (windows1252Bytes.has(code)) bytes.push(windows1252Bytes.get(code));
    else return value;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

function cleanDisplayText(value) {
  let cleaned = String(value ?? "");
  for (let pass = 0; pass < 6; pass += 1) {
    const decoded = decodeMojibakePass(cleaned);
    if (decoded === cleaned || mojibakeScore(decoded) >= mojibakeScore(cleaned)) break;
    cleaned = decoded;
  }
  return cleaned
    .replace(/(?:\u00c2|\u00c3|\u00c5|\u00e2|\u00f0|\ufffd)[^\s]*/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const comparisonStoreOrder = ["pick-n-pay", "checkers", "woolworths"];

function updateSummary() {
  $("#itemCount").textContent = state.items.length;
  $("#maxResultsInput").value = state.settings.maxResultsPerStore || 6;

  const latest = state.latest;
  const bestId = latest?.bestBasketStoreId;
  const best = bestId ? latest.basketTotals[bestId] : null;
  $("#bestBasket").textContent = best ? `${best.storeName} ${formatMoney(best.total)}` : "No scan yet";
  $("#mobileUrl").textContent = "Your basket stays on this device";
}

function renderStores() {
  const wrap = $("#storeToggles");
  wrap.innerHTML = "";
  const enabled = state.settings.stores || {};
  state.stores.forEach((store) => {
    const label = document.createElement("label");
    label.className = "toggle";
    label.innerHTML = `
      <input type="checkbox" data-store="${store.id}" ${enabled[store.id] !== false ? "checked" : ""} />
      <span>${store.name}</span>
    `;
    wrap.appendChild(label);
  });
  $("#sourceNote").textContent =
    "Choose a product above and RandBasket keeps the retailer link behind the scenes.";
}

function itemRow(item) {
  const tr = document.createElement("tr");
  tr.dataset.id = item.id;
  const linkedStoreId = Object.keys(item.links || {}).find((storeId) => item.links[storeId]);
  const storeName = item.selectedStoreName
    || defaultStores.find((store) => store.id === (item.selectedStoreId || linkedStoreId))?.name
    || "Choose from search";
  const details = [item.targetSize, item.category].filter(Boolean).join(" - ");
  tr.innerHTML = `
    <td class="item-name" data-label="Product"><div class="basket-product"><strong>${escapeHtml(item.name)}</strong>${details ? `<span>${escapeHtml(details)}</span>` : ""}</div></td>
    <td class="basket-store-cell" data-label="Retailer"><span class="basket-store">${escapeHtml(storeName)}</span></td>
    <td class="basket-price-cell" data-label="Price"><strong class="basket-price">${formatMoney(item.selectedPrice)}</strong></td>
    <td class="quantity" data-label="Qty"><input data-field="quantity" aria-label="Quantity for ${escapeAttr(item.name)}" type="number" min="0.1" step="0.1" value="${item.quantity || 1}" /></td>
    <td class="remove" data-label="Remove"><button type="button" data-remove="${item.id}">Remove</button></td>
  `;
  return tr;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderItems() {
  const body = $("#itemsBody");
  body.innerHTML = "";
  state.items.forEach((item) => body.appendChild(itemRow(item)));
}

function renderCatalogueResults() {
  const wrap = $("#catalogueResults");
  const pagination = $("#cataloguePagination");
  wrap.innerHTML = "";
  pagination.hidden = state.catalogueResults.length === 0;
  $("#cataloguePreviousBtn").disabled = state.cataloguePage <= 1;
  $("#catalogueMoreBtn").disabled = !state.catalogueHasMore;
  $("#cataloguePageLabel").textContent = `Page ${state.cataloguePage}`;
  if (!state.catalogueResults.length) return;

  const retailerMatches = state.cataloguePage === 1 && state.catalogueRetailerMatches.length
    ? state.catalogueRetailerMatches
    : state.catalogueResults;
  const seenMatches = new Set();
  const matches = retailerMatches
    .flatMap((product) => (product.stores || [])
      .filter((store) => store.price != null)
      .map((store) => ({ product, store })))
    .filter(({ product, store }) => {
      const key = `${store.storeId}|${store.url || product.id}|${store.price}`;
      if (seenMatches.has(key)) return false;
      seenMatches.add(key);
      return true;
    })
    .sort((left, right) => comparisonStoreOrder.indexOf(left.store.storeId) - comparisonStoreOrder.indexOf(right.store.storeId));

  if (!matches.length) {
    wrap.innerHTML = `<div class="empty">No close priced catalogue matches on this page.</div>`;
    return;
  }

  const rankedPrices = [...new Set(matches.map(({ store }) => Number(store.price)).filter(Number.isFinite))]
    .sort((left, right) => left - right);
  const bestPrice = rankedPrices[0];
  const nextPrice = rankedPrices.find((price) => price > bestPrice);
  if (state.cataloguePage === 1) {
    matches.sort((left, right) =>
      Number(Number(right.store.price) === bestPrice) - Number(Number(left.store.price) === bestPrice));
  }

  matches.forEach((match) => {
    const article = document.createElement("article");
    const { product, store } = match;
    const isBestPrice = Number(store.price) === bestPrice;
    const isSuggested = state.cataloguePage === 1 && isBestPrice;
    const saving = isBestPrice && nextPrice ? nextPrice - bestPrice : 0;
    article.className = `catalogue-store-result${isBestPrice ? " best-price-result" : ""}`;
    const was = store.regularPrice && store.regularPrice > store.price ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : "";
    const special = store.promoText ? `<small class="catalogue-special">${escapeHtml(store.promoText)}</small>` : "";
    const bestPriceBadge = isBestPrice
      ? `<span class="best-price-badge">${isSuggested ? "Suggested - " : ""}Best price${saving > 0 ? ` - ${formatMoney(saving)} less` : ""}</span>`
      : "";
    const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
    const image = store.imageUrl ? `<img src="${escapeAttr(store.imageUrl)}" alt="${escapeAttr(productName)}" />` : `<div class="catalogue-image-placeholder">Photo pending</div>`;
    const link = store.url ? `<a href="${escapeAttr(store.url)}" target="_blank" rel="noopener">View retailer product</a>` : "";
    article.innerHTML = `
      <div class="catalogue-image">${image}</div>
      <div class="catalogue-product-copy">
        ${bestPriceBadge}
        <strong>${escapeHtml(store.storeName)}</strong>
        <span>${escapeHtml(productName)}</span>
        <small>${escapeHtml([store.size, product.category].filter(Boolean).join(" - "))}</small>
        ${special}
        ${link}
      </div>
      <div class="catalogue-price">${was}<strong>${formatMoney(store.price)}</strong><button type="button" class="catalogue-add-btn">Add to basket</button></div>
    `;
    article.querySelector(".catalogue-add-btn").addEventListener("click", () => addCatalogueProductToBasket(product, store));
    wrap.appendChild(article);
  });
}

async function addCatalogueProductToBasket(product, store) {
  const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
  const existing = state.items.find((item) => item.links?.[store.storeId] === store.url);
  if (existing) {
    $("#catalogueStatus").textContent = `${productName} is already in the basket.`;
    return;
  }
  state.items.push({
    id: `${product.id}-${store.storeId}-${Date.now()}`,
    name: productName,
    query: productName,
    targetSize: store.size || product.targetSize || "",
    quantity: 1,
    category: product.category || "",
    selectedStoreId: store.storeId,
    selectedStoreName: store.storeName,
    selectedPrice: store.price,
    links: { [store.storeId]: store.url || "" },
  });
  renderItems();
  await saveAll();
  $("#catalogueStatus").textContent = `${productName} added to the basket.`;
}

async function searchCatalogue(page = 1) {
  const query = $("#catalogueSearchInput").value.trim();
  if (!query) {
    $("#catalogueStatus").textContent = "Type a product to compare.";
    return;
  }
  const button = $("#catalogueSearchBtn");
  button.disabled = true;
  $("#catalogueStatus").textContent = "Finding the closest retailer matches...";
  try {
    const payload = await api(`/v1/catalogue?q=${encodeURIComponent(query)}&limit=10&page=${page}`);
    state.catalogueResults = payload.products || [];
    state.catalogueRetailerMatches = payload.retailerMatches || [];
    state.cataloguePage = payload.page || page;
    state.catalogueHasMore = Boolean(payload.hasMore);
    $("#catalogueStatus").textContent = state.catalogueResults.length
      ? `Closest priced matches for ${query}`
      : "No priced catalogue matches yet.";
    renderCatalogueResults();
  } catch (error) {
    $("#catalogueStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function readItemsFromDom() {
  const rows = new Map([...$("#itemsBody").querySelectorAll("tr")].map((row) => [row.dataset.id, row]));
  state.items = state.items.map((item) => {
    const quantityInput = rows.get(item.id)?.querySelector('[data-field="quantity"]');
    return { ...item, quantity: Number(quantityInput?.value || item.quantity || 1) };
  });
}

function readSettingsFromDom() {
  state.settings.maxResultsPerStore = Number($("#maxResultsInput").value || 6);
  state.settings.stores = {};
  $("#storeToggles")
    .querySelectorAll("input[type='checkbox']")
    .forEach((input) => {
      state.settings.stores[input.dataset.store] = input.checked;
    });
}

async function saveAll() {
  readItemsFromDom();
  readSettingsFromDom();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    items: state.items,
    settings: state.settings,
    latest: state.latest,
  }));
  updateSummary();
}

function renderBasketTotals(scan) {
  const wrap = $("#basketTotals");
  wrap.innerHTML = "";
  if (!scan) return;
  Object.values(scan.basketTotals).forEach((total) => {
    const chip = document.createElement("div");
    chip.className = `total-chip ${scan.bestBasketStoreId === total.storeId ? "best" : ""}`;
    const label = total.missing
      ? `${total.storeName} known total, ${total.missing} missing`
      : `${total.storeName} full basket`;
    chip.innerHTML = `
      <span>${label}</span>
      <strong>${total.total ? formatMoney(total.total) : "-"}</strong>
    `;
    wrap.appendChild(chip);
  });
}

function renderResults() {
  const wrap = $("#results");
  wrap.innerHTML = "";
  renderBasketTotals(state.latest);
  $("#copyLinksBtn").disabled = !state.latest;
  if (!state.latest) {
    wrap.innerHTML = `<div class="empty">Run a scan to compare this week's shelf prices.</div>`;
    return;
  }
  state.latest.scans.forEach((scan) => {
    const card = document.createElement("article");
    card.className = "result-card";
    const rows = scan.results
      .map((result) => {
        const isBest = scan.bestStoreId === result.storeId;
        const adjustment = result.valueAdjustments?.length
          ? ` after ${result.valueAdjustments.map((a) => a.label).join(", ")}`
          : "";
        const hasPrice = result.effectivePrice != null;
        const measure = result.productMeasure?.label ? ` (${result.productMeasure.label})` : "";
        const normalized = hasPrice && result.normalizedPrice != null && result.normalizedPrice !== result.effectivePrice
          ? ` -> ${formatMoney(result.normalizedPrice)} target`
          : "";
        const dealLine = result.promoText
          ? `<small class="deal-line ${result.promoApplied ? "applied" : "note"}">${escapeHtml(result.promoText)}</small>`
          : "";
        const wasPrice = hasPrice && result.regularPrice && result.regularPrice > result.price
          ? `<span class="was-price">${formatMoney(result.regularPrice)}</span>`
          : "";
        const product = hasPrice
          ? `${result.productName || "Matched product"}${measure}${adjustment}${normalized}`
          : "Price not readable - direct supplier link:";
        const link = hasPrice ? result.productUrl || result.queryUrl : result.queryUrl || result.productUrl;
        const linkHtml = link
          ? `<a class="direct-url" href="${escapeAttr(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>`
          : `<span class="direct-url muted">No direct link available</span>`;
        return `
          <div class="price-row ${isBest ? "best" : ""}">
            <div class="supplier-result">
              <strong>${result.storeName}</strong>
              <small>${escapeHtml(product)}</small>
              ${dealLine}
              ${linkHtml}
            </div>
            <div class="price">${wasPrice}${formatMoney(result.effectivePrice)}</div>
          </div>
        `;
      })
      .join("");
    card.innerHTML = `
      <div class="result-head">
        <div>
          <h3>${escapeHtml(scan.name)}</h3>
          <div class="status">${escapeHtml(scan.query)}${scan.targetMeasure?.label ? ` - target ${escapeHtml(scan.targetMeasure.label)}` : ""} - qty ${scan.quantity}</div>
        </div>
        <span class="badge">${scan.bestStoreName || "No match"}</span>
      </div>
      ${rows}
    `;
    wrap.appendChild(card);
  });
}

function buildDirectLinksText() {
  if (!state.latest) return "";
  return state.latest.scans
    .map((scan) => {
      const links = scan.results
        .map((result) => `${result.storeName}: ${result.queryUrl || result.productUrl || ""}`)
        .join("\n");
      return `${scan.name}\n${links}`;
    })
    .join("\n\n");
}

async function copyDirectLinks() {
  const text = buildDirectLinksText();
  if (!text) {
    $("#scanStatus").textContent = "Run a scan first";
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  $("#scanStatus").textContent = "Direct links copied";
}

async function copyMobileUrl() {
  const appUrl = window.location.href;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(appUrl);
    $("#scanStatus").textContent = "App link copied";
    return;
  }
  $("#scanStatus").textContent = appUrl;
}

function escapeHtml(value) {
  return cleanDisplayText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function getPickNPayProgressPlan() {
  readItemsFromDom();
  readSettingsFromDom();
  const enabled = state.settings.stores?.["pick-n-pay"] !== false;
  if (!enabled) return { count: 0, expectedMs: 0 };
  const count = state.items.filter((item) => item.links?.["pick-n-pay"]).length;
  return {
    count,
    expectedMs: Math.max(count * 30000, 30000),
  };
}

function setPickNPayProgress(percent, label) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  $("#pnpProgress").hidden = false;
  $("#pnpProgressBar").style.width = `${clamped}%`;
  $("#pnpProgressPercent").textContent = `${clamped}%`;
  $("#pnpProgressLabel").textContent = label;
}

function stopPickNPayProgress(complete = true) {
  if (state.pnpProgressTimer) {
    window.clearInterval(state.pnpProgressTimer);
    state.pnpProgressTimer = null;
  }
  if (complete && !$("#pnpProgress").hidden) {
    setPickNPayProgress(100, "Pick n Pay scan complete");
  }
}

function startPickNPayProgress() {
  stopPickNPayProgress(false);
  const plan = getPickNPayProgressPlan();
  if (!plan.count) {
    $("#pnpProgress").hidden = true;
    return;
  }
  const started = Date.now();
  const update = () => {
    const elapsed = Date.now() - started;
    const percent = Math.min(92, (elapsed / plan.expectedMs) * 92);
    const currentItem = Math.min(plan.count, Math.max(1, Math.floor(elapsed / 30000) + 1));
    setPickNPayProgress(percent, `Pick n Pay ${currentItem} of ${plan.count} product pages`);
  };
  update();
  state.pnpProgressTimer = window.setInterval(update, 1000);
}

async function runScan() {
  const button = $("#scanBtn");
  button.disabled = true;
  $("#scanStatus").textContent = "Saving basket...";
  try {
    await saveAll();
    $("#scanStatus").textContent = "Checking retailer prices...";
    state.latest = await api("/v1/scan/catalogue", {
      method: "POST",
      body: JSON.stringify({ items: state.items, settings: state.settings }),
    });
    await saveAll();
    $("#scanStatus").textContent = `Updated ${new Date(state.latest.createdAt).toLocaleString()}`;
    updateSummary();
    renderResults();
  } catch (error) {
    $("#scanStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function addItem() {
  $("#catalogueSearchInput").focus();
  $("#catalogueSearchInput").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#catalogueStatus").textContent = "Search for a product, then select Add to basket.";
}

function wireEvents() {
  $("#addItemBtn").addEventListener("click", addItem);
  $("#saveBtn").addEventListener("click", async () => {
    $("#scanStatus").textContent = "Saving...";
    await saveAll();
    $("#scanStatus").textContent = "Saved";
  });
  $("#copyLinksBtn").addEventListener("click", copyDirectLinks);
  $("#copyMobileUrlBtn").addEventListener("click", copyMobileUrl);
  $("#scanBtn").addEventListener("click", runScan);
  $("#catalogueSearchBtn").addEventListener("click", () => searchCatalogue(1));
  $("#catalogueSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchCatalogue(1);
  });
  $("#cataloguePreviousBtn").addEventListener("click", () => searchCatalogue(state.cataloguePage - 1));
  $("#catalogueMoreBtn").addEventListener("click", () => searchCatalogue(state.cataloguePage + 1));
  $("#itemsBody").addEventListener("click", (event) => {
    const removeId = event.target.dataset.remove;
    if (!removeId) return;
    readItemsFromDom();
    state.items = state.items.filter((item) => item.id !== removeId);
    renderItems();
    updateSummary();
  });
}

async function init() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    saved = {};
  }
  state.items = Array.isArray(saved.items) ? saved.items : [];
  state.settings = saved.settings || {
    maxResultsPerStore: 6,
    stores: Object.fromEntries(defaultStores.map((store) => [store.id, true])),
  };
  state.stores = defaultStores;
  state.mobileUrl = window.location.href;
  state.latest = saved.latest || null;
  renderStores();
  renderItems();
  renderResults();
  updateSummary();
  wireEvents();
}

init().catch((error) => {
  $("#scanStatus").textContent = error.message;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=9").catch(() => {});
  });
}

