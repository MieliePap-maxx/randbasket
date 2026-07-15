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

const moneyFmt = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

function formatMoney(value) {
  return value == null ? "-" : moneyFmt.format(value);
}

const comparisonStoreOrder = ["pick-n-pay", "checkers", "woolworths"];

function updateSummary() {
  $("#itemCount").textContent = state.items.length;
  $("#maxResultsInput").value = state.settings.maxResultsPerStore || 6;

  const latest = state.latest;
  const bestId = latest?.bestBasketStoreId;
  const best = bestId ? latest.basketTotals[bestId] : null;
  $("#bestBasket").textContent = best ? `${best.storeName} ${formatMoney(best.total)}` : "No scan yet";
  $("#mobileUrl").textContent = state.mobileUrl || "Start the app to get your phone link";
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
    "Paste exact product URLs per item for reliable prices. Search phrases are only used when a vendor URL is blank.";
}

function itemRow(item) {
  const tr = document.createElement("tr");
  tr.dataset.id = item.id;
  const links = item.links || {};
  tr.innerHTML = `
    <td class="item-name" data-label="Item"><input data-field="name" value="${escapeAttr(item.name)}" /></td>
    <td class="query" data-label="Search phrase"><input data-field="query" value="${escapeAttr(item.query || item.name)}" /></td>
    <td class="target-size" data-label="Target size"><input data-field="targetSize" placeholder="500g, 2L, 18 pack" value="${escapeAttr(item.targetSize || "")}" /></td>
    <td class="quantity" data-label="Qty"><input data-field="quantity" type="number" min="0.1" step="0.1" value="${item.quantity || 1}" /></td>
    <td class="category" data-label="Category"><input data-field="category" value="${escapeAttr(item.category || "")}" /></td>
    <td class="vendor-url" data-label="Pick n Pay URL"><input data-link="pick-n-pay" placeholder="https://www.pnp.co.za/..." value="${escapeAttr(links["pick-n-pay"] || "")}" /></td>
    <td class="vendor-url" data-label="Checkers URL"><input data-link="checkers" placeholder="https://www.checkers.co.za/..." value="${escapeAttr(links.checkers || "")}" /></td>
    <td class="vendor-url" data-label="Woolworths URL"><input data-link="woolworths" placeholder="https://www.woolworths.co.za/..." value="${escapeAttr(links.woolworths || "")}" /></td>
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
  const matches = retailerMatches
    .flatMap((product) => (product.stores || [])
      .filter((store) => store.price != null)
      .map((store) => ({ product, store })))
    .sort((left, right) => comparisonStoreOrder.indexOf(left.store.storeId) - comparisonStoreOrder.indexOf(right.store.storeId));

  if (!matches.length) {
    wrap.innerHTML = `<div class="empty">No close priced catalogue matches on this page.</div>`;
    return;
  }

  matches.forEach((match) => {
    const article = document.createElement("article");
    article.className = "catalogue-store-result";
    const { product, store } = match;
    const was = store.regularPrice && store.regularPrice > store.price ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : "";
    const special = store.promoText ? `<small class="catalogue-special">${escapeHtml(store.promoText)}</small>` : "";
    const image = store.imageUrl ? `<img src="${escapeAttr(store.imageUrl)}" alt="${escapeAttr(product.canonicalName)}" />` : `<div class="catalogue-image-placeholder">Photo pending</div>`;
    const link = store.url ? `<a href="${escapeAttr(store.url)}" target="_blank" rel="noopener">View retailer product</a>` : "";
    article.innerHTML = `
      <div class="catalogue-image">${image}</div>
      <div class="catalogue-product-copy">
        <strong>${escapeHtml(store.storeName)}</strong>
        <span>${escapeHtml(product.canonicalName)}</span>
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
  const existing = state.items.find((item) => item.links?.[store.storeId] === store.url);
  if (existing) {
    $("#catalogueStatus").textContent = `${store.productName || product.canonicalName} is already in the basket.`;
    return;
  }
  state.items.push({
    id: `${product.id}-${store.storeId}-${Date.now()}`,
    name: store.productName || product.canonicalName,
    query: store.productName || product.canonicalName,
    targetSize: store.size || product.targetSize || "",
    quantity: 1,
    category: product.category || "",
    links: { [store.storeId]: store.url || "" },
  });
  renderItems();
  await saveAll();
  $("#catalogueStatus").textContent = `${store.productName || product.canonicalName} added to the basket.`;
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
    const payload = await api(`/api/catalogue?q=${encodeURIComponent(query)}&limit=10&page=${page}`);
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
  state.items = [...$("#itemsBody").querySelectorAll("tr")].map((row) => {
    const get = (field) => row.querySelector(`[data-field="${field}"]`).value.trim();
    const links = {};
    row.querySelectorAll("[data-link]").forEach((input) => {
      links[input.dataset.link] = input.value.trim();
    });
    return {
      id: row.dataset.id,
      name: get("name"),
      query: get("query"),
      targetSize: get("targetSize"),
      quantity: Number(get("quantity") || 1),
      category: get("category"),
      links,
    };
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
  await api("/api/items", {
    method: "POST",
    body: JSON.stringify({ items: state.items }),
  });
  const settings = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ settings: state.settings }),
  });
  state.settings = settings.settings;
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
  if (!state.mobileUrl) {
    $("#scanStatus").textContent = "Phone link is not ready yet";
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(state.mobileUrl);
    $("#scanStatus").textContent = "Phone link copied";
    return;
  }
  $("#scanStatus").textContent = state.mobileUrl;
}

function escapeHtml(value) {
  return String(value ?? "")
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
  startPickNPayProgress();
  try {
    await saveAll();
    $("#scanStatus").textContent = "Checking retailer prices...";
    state.latest = await api("/api/scan", { method: "POST", body: "{}" });
    stopPickNPayProgress(true);
    $("#scanStatus").textContent = `Updated ${new Date(state.latest.createdAt).toLocaleString()}`;
    updateSummary();
    renderResults();
  } catch (error) {
    stopPickNPayProgress(false);
    $("#scanStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function addItem() {
  readItemsFromDom();
  state.items.push({
    id: crypto.randomUUID(),
    name: "New item",
    query: "new item",
    targetSize: "",
    quantity: 1,
    category: "",
    links: {
      "pick-n-pay": "",
      checkers: "",
      woolworths: "",
    },
  });
  renderItems();
  updateSummary();
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
  const payload = await api("/api/state");
  state.items = payload.items;
  state.settings = payload.settings;
  state.stores = payload.stores;
  state.mobileUrl = payload.mobileUrl || payload.localUrl || "";
  state.latest = payload.history?.[0] || null;
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
    navigator.serviceWorker.register("/service-worker.js?v=3").catch(() => {});
  });
}
