const state = {
  items: [],
  settings: {},
  stores: [],
  latest: null,
  pnpProgressTimer: null,
  catalogueResults: [],
  catalogueRetailerMatches: [],
  catalogueQuery: "",
  activeCatalogueRetailer: "pick-n-pay",
  activeBasketRetailer: "",
  specials: [],
  specialsLoaded: false,
  autoScanTimer: null,
  scanInFlight: false,
  scanQueued: false,
  itemSuggestionTimer: null,
  itemSuggestionController: null,
  catalogueNoticeTimer: null,
};

const API_ORIGIN = "https://api.randbasket.co.za";
const STORAGE_KEY = "randbasket-web-state-v1";
const SAVED_BASKETS_KEY = "randbasket-saved-baskets-v1";
const ITEM_SEARCH_HISTORY_KEY = "randbasket-item-search-history-v1";
const FEEDBACK_EMAIL = "randbasketzar@gmail.com";
const TURNSTILE_SITE_KEY = "0x4AAAAAAD3NsfAYMYxlQRFS";
let feedbackTurnstileWidgetId = null;
let feedbackTurnstileToken = "";
const defaultStores = [
  { id: "pick-n-pay", name: "Pick n Pay" },
  { id: "checkers", name: "Checkers" },
  { id: "woolworths", name: "Woolworths" },
  { id: "spar", name: "SPAR" },
  { id: "makro", name: "Makro" },
];
const defaultItemSuggestions = [
  "Full cream milk 2L",
  "White bread 700g",
  "Eggs 18 pack",
  "Beef mince 1kg",
  "Chicken portions 1kg",
  "Cake flour 2.5kg",
  "Plain yoghurt 1kg",
  "Streaky bacon 200g",
  "White sugar 2.5kg",
  "Rice 2kg",
  "Sunflower oil 2L",
  "Instant coffee 200g",
  "Black tea 100 bags",
  "Toothpaste 100ml",
];

const moneyFmt = new Intl.NumberFormat("en-ZA", {
  style: "currency",
  currency: "ZAR",
});

const $ = (selector) => document.querySelector(selector);
const setText = (selector, value) => {
  const element = $(selector);
  if (element) element.textContent = value;
};

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

function wholeQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(1, Math.round(quantity)) : 1;
}

function setCatalogueNotice(message, tone = "info", autoClearMs = 0) {
  const status = $("#catalogueStatus");
  if (state.catalogueNoticeTimer) {
    window.clearTimeout(state.catalogueNoticeTimer);
    state.catalogueNoticeTimer = null;
  }
  status.textContent = message;
  status.className = `catalogue-status notice-${tone}`;
  if (autoClearMs > 0) {
    state.catalogueNoticeTimer = window.setTimeout(() => {
      status.textContent = "";
      status.className = "catalogue-status";
      state.catalogueNoticeTimer = null;
    }, autoClearMs);
  }
}

function clearCatalogueNotice() {
  setCatalogueNotice("");
}

function getItemSearchHistory() {
  try {
    const history = JSON.parse(localStorage.getItem(ITEM_SEARCH_HISTORY_KEY) || "[]");
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function rememberItemSearch(query) {
  const value = cleanDisplayText(query);
  if (!value) return;
  const history = getItemSearchHistory().filter((entry) => entry.toLowerCase() !== value.toLowerCase());
  localStorage.setItem(ITEM_SEARCH_HISTORY_KEY, JSON.stringify([value, ...history].slice(0, 15)));
}

function renderItemSuggestions(extraSuggestions = []) {
  const list = $("#itemSuggestions");
  if (!list) return;
  const catalogueSuggestions = state.catalogueResults.flatMap((product) => [
    product.canonicalName,
    ...(product.stores || []).map((store) => store.productName),
  ]);
  const suggestions = [
    ...extraSuggestions,
    ...getItemSearchHistory(),
    ...state.items.flatMap((item) => [item.comparisonQuery, item.name]),
    ...catalogueSuggestions,
    ...defaultItemSuggestions,
  ];
  const seen = new Set();
  list.innerHTML = "";
  suggestions.forEach((suggestion) => {
    const value = cleanDisplayText(suggestion);
    const key = value.toLowerCase();
    if (!value || seen.has(key) || seen.size >= 50) return;
    seen.add(key);
    const option = document.createElement("option");
    option.value = value;
    list.appendChild(option);
  });
}

function scheduleItemSuggestions() {
  if (state.itemSuggestionTimer) window.clearTimeout(state.itemSuggestionTimer);
  state.itemSuggestionController?.abort();
  const query = $("#catalogueSearchInput").value.trim();
  renderItemSuggestions();
  if (query.length < 3) return;
  state.itemSuggestionTimer = window.setTimeout(async () => {
    const controller = new AbortController();
    state.itemSuggestionController = controller;
    try {
      const payload = await api(`/v1/catalogue?q=${encodeURIComponent(query)}&perRetailer=2${locationQuery()}`, {
        signal: controller.signal,
      });
      if ($("#catalogueSearchInput").value.trim() !== query) return;
      const suggestions = (payload.products || []).flatMap((product) => [
        product.canonicalName,
        ...(product.stores || []).map((store) => store.productName),
      ]);
      renderItemSuggestions(suggestions);
    } catch (error) {
      if (error?.name !== "AbortError") renderItemSuggestions();
    } finally {
      if (state.itemSuggestionController === controller) state.itemSuggestionController = null;
    }
  }, 450);
}

function locationQuery() {
  const location = state.settings.location;
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return "";
  return `&latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}`;
}

function renderLocation() {
  const location = state.settings.location;
  const enabled = location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
  $("#locationStatus").textContent = enabled ? "Enabled for nearby store pricing" : "Not shared";
  $("#locationBtn").textContent = enabled ? "Update location" : "Use my location";
}

function saveDeviceState() {
  const { location: _sessionLocation, ...savedSettings } = state.settings;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    items: state.items,
    settings: savedSettings,
    latest: state.latest,
  }));
}

function requestLocation() {
  if (!("geolocation" in navigator)) {
    $("#locationStatus").textContent = "Location is unavailable in this browser";
    return;
  }
  $("#locationStatus").textContent = "Waiting for permission...";
  navigator.geolocation.getCurrentPosition((position) => {
    state.settings.locationPermission = "granted";
    state.settings.location = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      updatedAt: new Date().toISOString(),
    };
    saveDeviceState();
    renderLocation();
    if (state.items.length) scheduleBasketScan(150);
    if ($("#locationDialog").open) $("#locationDialog").close();
  }, (error) => {
    state.settings.locationPermission = error.code === error.PERMISSION_DENIED ? "denied" : "unavailable";
    saveDeviceState();
    $("#locationStatus").textContent = error.code === error.PERMISSION_DENIED
      ? "Permission declined - national prices will be used"
      : "Could not determine your location";
    if ($("#locationDialog").open) $("#locationDialog").close();
  }, { enableHighAccuracy: false, maximumAge: 900000, timeout: 12000 });
}

function declineLocation() {
  state.settings.locationPermission = "declined";
  saveDeviceState();
  if ($("#locationDialog").open) $("#locationDialog").close();
  renderLocation();
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

const comparisonStoreOrder = ["pick-n-pay", "checkers", "woolworths", "spar", "makro"];
const retailerAliases = [
  "pick n pay",
  "pick and pay",
  "pnp",
  "checkers",
  "woolworths",
  "woolies",
  "spar",
  "makro",
];

const measurementUnits = {
  mg: { dimension: "mass", baseMultiplier: 0.001, comparisonAmount: 1000, comparisonUnit: "kg" },
  g: { dimension: "mass", baseMultiplier: 1, comparisonAmount: 1000, comparisonUnit: "kg" },
  kg: { dimension: "mass", baseMultiplier: 1000, comparisonAmount: 1000, comparisonUnit: "kg" },
  ml: { dimension: "volume", baseMultiplier: 1, comparisonAmount: 1000, comparisonUnit: "L" },
  l: { dimension: "volume", baseMultiplier: 1000, comparisonAmount: 1000, comparisonUnit: "L" },
};

function normaliseMeasurementUnit(unit) {
  const value = String(unit || "").toLowerCase();
  if (value.startsWith("kilo")) return "kg";
  if (value.startsWith("milli") && value.includes("lit")) return "ml";
  if (value.startsWith("lit")) return "l";
  if (value.startsWith("milli") && value.includes("gram")) return "mg";
  if (value.startsWith("gram")) return "g";
  return value;
}

function parseMeasurement(...values) {
  const text = cleanDisplayText(values.filter(Boolean).join(" "))
    .toLowerCase()
    .replaceAll(",", ".");
  const unitPattern = "kg|kilograms?|g|grams?|mg|milligrams?|l|litres?|liters?|ml|millilitres?|milliliters?";
  const multipack = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x\\u00d7]\\s*(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})\\b`, "i"));
  const single = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})\\b`, "i"));
  const perUnit = text.match(new RegExp(`\\bper\\s+(${unitPattern})\\b`, "i"));

  if (multipack || single || perUnit) {
    const amount = multipack ? Number(multipack[1]) * Number(multipack[2]) : single ? Number(single[1]) : 1;
    const unit = normaliseMeasurementUnit((multipack || single || perUnit)[multipack ? 3 : single ? 2 : 1]);
    const definition = measurementUnits[unit];
    if (definition && amount > 0) {
      return {
        dimension: definition.dimension,
        baseAmount: amount * definition.baseMultiplier,
        comparisonAmount: definition.comparisonAmount,
        comparisonUnit: definition.comparisonUnit,
      };
    }
  }

  const count = text.match(/(?:pack\s+of\s+)?(\d+(?:\.\d+)?)\s*(?:ea|each|pack|pk|pieces?|count|ct|units?)\b/i);
  if (count && Number(count[1]) > 0) {
    return {
      dimension: "count",
      baseAmount: Number(count[1]),
      comparisonAmount: 1,
      comparisonUnit: "item",
    };
  }
  if (/\bdozen\b/i.test(text)) {
    return { dimension: "count", baseAmount: 12, comparisonAmount: 1, comparisonUnit: "item" };
  }
  return null;
}

function getUnitComparison(product, store) {
  const measurement = parseMeasurement(store.size, store.productName, product.canonicalName);
  const price = Number(store.price);
  if (!measurement || !Number.isFinite(price)) return null;
  return {
    ...measurement,
    unitPrice: (price * measurement.comparisonAmount) / measurement.baseAmount,
  };
}

function stripComparisonBranding(value, brand = "") {
  let text = cleanDisplayText(value).toLowerCase();
  [...retailerAliases, brand]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .forEach((term) => {
      const escaped = String(term).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`\\b${escaped}\\b`, "gi"), " ");
    });
  return text
    .replace(/[^a-z0-9.,]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function buildComparisonQuery(product, store, preferredQuery = "") {
  const searchTerms = Array.isArray(product.searchTerms) ? [...product.searchTerms].filter(Boolean) : [];
  const source = preferredQuery
    || searchTerms.sort((left, right) => String(right).length - String(left).length)[0]
    || product.canonicalName
    || store.productName
    || "product";
  let query = stripComparisonBranding(source, store.brand);
  const targetSize = cleanDisplayText(store.size || product.targetSize || "");
  if (targetSize && !parseMeasurement(query)) query = `${query} ${targetSize}`.trim();
  return query;
}

function productImageMarkup(imageUrl, productName, className) {
  const initial = cleanDisplayText(productName).charAt(0).toUpperCase() || "R";
  const image = imageUrl
    ? `<img data-product-image src="${escapeAttr(imageUrl)}" alt="${escapeAttr(productName)}" loading="lazy" />`
    : "";
  return `
    <span class="${className}">
      <span class="product-image-fallback" aria-hidden="true">${escapeHtml(initial)}</span>
      ${image}
    </span>
  `;
}

function watchProductImages(root = document) {
  root.querySelectorAll("img[data-product-image]").forEach((image) => {
    image.addEventListener("error", () => {
      image.hidden = true;
    }, { once: true });
  });
}

function updateSummary() {
  setText("#itemCount", state.items.length);
  const maxResultsInput = $("#maxResultsInput");
  if (maxResultsInput) maxResultsInput.value = state.settings.maxResultsPerStore || 6;

  const latest = state.latest;
  const bestId = latest?.bestBasketStoreId;
  const best = bestId ? latest.basketTotals[bestId] : null;
  setText("#bestBasket", best ? `${best.storeName} ${formatMoney(best.total)}` : "No scan yet");
}

function updateBasketActions() {
  const shareButton = $("#shareBtn");
  if (!shareButton) return;
  const hasCurrentBasket = state.items.length > 0;
  const hasSavedBasket = getSavedBaskets().some((basket) => Array.isArray(basket.items) && basket.items.length > 0);
  shareButton.disabled = !hasCurrentBasket && !hasSavedBasket;
  shareButton.title = shareButton.disabled
    ? "Add or save a basket before sharing."
    : hasCurrentBasket
      ? "Share your current basket."
      : "Load a saved basket to share it.";
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
    <td class="item-name" data-label="Product">
      <div class="basket-product-layout">
        ${productImageMarkup(item.imageUrl, item.name, "basket-product-image")}
        <div class="basket-product"><strong>${escapeHtml(item.name)}</strong>${details ? `<span>${escapeHtml(details)}</span>` : ""}</div>
      </div>
    </td>
    <td class="basket-store-cell" data-label="Retailer"><span class="basket-store">${escapeHtml(storeName)}</span></td>
    <td class="basket-price-cell" data-label="Price"><strong class="basket-price">${formatMoney(item.selectedPrice)}</strong></td>
    <td class="quantity" data-label="Qty"><input data-field="quantity" aria-label="Quantity for ${escapeAttr(item.name)}" type="number" inputmode="numeric" min="1" step="1" value="${wholeQuantity(item.quantity)}" /></td>
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
  watchProductImages(body);
  $(".table-wrap").hidden = state.items.length === 0;
  updateBasketActions();
}

function matchingBasketItem(store, product = null) {
  return state.items.find((item) => (
    (store.url && item.links?.[store.storeId] === store.url)
    || (product?.id && item.selectedStoreId === store.storeId && item.selectedProductId === product.id)
  ));
}

function visiblePromoText(store) {
  const hasVerifiedReduction = store.regularPrice && store.price != null && store.regularPrice > store.price;
  const promoText = cleanDisplayText(store.promoText);
  if (!promoText || (!store.promoApplied && !hasVerifiedReduction)) return "";
  const advertisedNowPrice = promoText.match(/\bnow\s+r?\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (advertisedNowPrice && store.price != null) {
    const advertisedPrice = Number(advertisedNowPrice[1].replace(",", "."));
    if (Number.isFinite(advertisedPrice) && Math.abs(advertisedPrice - store.price) > 0.02) return "";
  }
  return promoText;
}

function quantityControlMarkup(existing, label, compact = false, addLabel = "Add") {
  if (!existing) {
    return `<button type="button" class="catalogue-add-btn catalogue-item-control">${escapeHtml(addLabel)}</button>`;
  }
  return `
    <div class="quantity-stepper catalogue-item-control${compact ? " is-compact" : ""}" aria-label="${escapeAttr(`Quantity for ${label}`)}">
      <button type="button" data-quantity-action="decrease" aria-label="${escapeAttr(`Decrease ${label} quantity`)}">&minus;</button>
      <strong aria-label="Current quantity">${wholeQuantity(existing.quantity)}</strong>
      <button type="button" data-quantity-action="increase" aria-label="${escapeAttr(`Increase ${label} quantity`)}">&plus;</button>
    </div>
  `;
}

async function adjustCatalogueProductQuantity(product, store, delta, preferredQuery = "") {
  const existing = matchingBasketItem(store, product);
  if (!existing && delta > 0) {
    await addCatalogueProductToBasket(product, store, preferredQuery);
    return;
  }
  if (!existing) return;
  const nextQuantity = wholeQuantity(existing.quantity) + delta;
  if (nextQuantity <= 0) {
    state.items = state.items.filter((item) => item.id !== existing.id);
  } else {
    existing.quantity = nextQuantity;
  }
  state.latest = null;
  clearCatalogueNotice();
  renderItems();
  renderResults();
  await saveAll();
  renderCatalogueResults();
  if (state.specialsLoaded) renderSpecials();
  scheduleBasketScan(150);
}

function wireQuantityControl(root, product, store, preferredQuery = "", onChange = null) {
  const addButton = root.querySelector(".catalogue-add-btn");
  if (addButton) {
    addButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      await addCatalogueProductToBasket(product, store, preferredQuery);
      onChange?.();
    });
  }
  root.querySelectorAll("[data-quantity-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const delta = button.dataset.quantityAction === "increase" ? 1 : -1;
      await adjustCatalogueProductQuantity(product, store, delta, preferredQuery);
      onChange?.();
    });
  });
}

function openProductFocus(product, store, comparison, contextQuery = "") {
  const dialog = $("#productFocusDialog");
  const content = $("#productFocusContent");
  const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
  const existing = matchingBasketItem(store, product);
  const wasPrice = store.regularPrice && store.regularPrice > store.price
    ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>`
    : "";
  const unitPrice = comparison
    ? `${formatMoney(comparison.unitPrice)} per ${escapeHtml(comparison.comparisonUnit)}`
    : "";
  const promoText = visiblePromoText(store);
  const facts = [
    store.brand && `<span><strong>Brand</strong>${escapeHtml(store.brand)}</span>`,
    (store.size || product.targetSize) && `<span><strong>Pack size</strong>${escapeHtml(store.size || product.targetSize)}</span>`,
    product.category && `<span><strong>Category</strong>${escapeHtml(product.category)}</span>`,
    unitPrice && `<span><strong>Comparable price</strong>${unitPrice}</span>`,
  ].filter(Boolean).join("");
  content.innerHTML = `
    <div class="product-focus-layout">
      ${productImageMarkup(store.imageUrl, productName, "product-focus-image")}
      <div class="product-focus-copy">
        <p class="eyebrow">${escapeHtml(store.storeName)}</p>
        <h2 id="productFocusTitle">${escapeHtml(productName)}</h2>
        <p class="product-focus-description">Matched to your search for <strong>${escapeHtml(contextQuery || state.catalogueQuery || product.canonicalName || productName)}</strong>. Check the pack size and current price before adding it to your basket.</p>
        <div class="product-focus-facts">${facts}</div>
        ${promoText ? `<p class="product-focus-promo">${escapeHtml(promoText)}</p>` : ""}
        <div class="product-focus-actions">
          <div class="product-focus-price">${wasPrice}<strong>${formatMoney(store.price)}</strong></div>
          <div class="product-focus-control">${quantityControlMarkup(existing, productName, false, "Add to basket")}</div>
        </div>
      </div>
    </div>
  `;
  watchProductImages(content);
  wireQuantityControl(content, product, store, contextQuery || state.catalogueQuery, () => {
    openProductFocus(product, store, comparison, contextQuery);
  });
  if (!dialog.open) dialog.showModal();
}

function renderCatalogueResults() {
  const wrap = $("#catalogueResults");
  const tabs = $("#catalogueRetailerTabs");
  wrap.innerHTML = "";
  tabs.innerHTML = "";
  tabs.hidden = state.catalogueResults.length === 0;
  if (!state.catalogueResults.length) return;

  const retailerMatches = state.catalogueRetailerMatches.length
    ? state.catalogueRetailerMatches
    : state.catalogueResults;
  const seenMatches = new Set();
  const matches = retailerMatches
    .flatMap((product) => (product.stores || [])
      .filter((store) => store.price != null)
      .map((store) => ({ product, store, comparison: getUnitComparison(product, store) })))
    .filter(({ product, store }) => {
      const key = `${store.storeId}|${store.url || product.id}|${store.price}`;
      if (seenMatches.has(key)) return false;
      seenMatches.add(key);
      return true;
    })
    .sort((left, right) => comparisonStoreOrder.indexOf(left.store.storeId) - comparisonStoreOrder.indexOf(right.store.storeId));

  if (!matches.length) {
    wrap.innerHTML = `<div class="empty">No close priced catalogue matches yet.</div>`;
    return;
  }

  const comparisonPrices = new Map();
  matches.forEach(({ comparison }) => {
    if (!comparison) return;
    const prices = comparisonPrices.get(comparison.dimension) || [];
    prices.push(comparison.unitPrice);
    comparisonPrices.set(comparison.dimension, prices);
  });
  const rankings = new Map([...comparisonPrices].map(([dimension, prices]) => {
    const ranked = [...new Set(prices)].sort((left, right) => left - right);
    return [dimension, { best: ranked[0], next: ranked.find((price) => price > ranked[0]) }];
  }));
  const isBestValue = ({ comparison }) => comparison
    && comparison.unitPrice === rankings.get(comparison.dimension)?.best;
  const groupedMatches = new Map(defaultStores.map((retailer) => [retailer.id, []]));
  matches.forEach((match) => groupedMatches.get(match.store.storeId)?.push(match));
  groupedMatches.forEach((retailerMatches) => retailerMatches.sort((left, right) => {
    const suggestedOrder = Number(isBestValue(right)) - Number(isBestValue(left));
    if (suggestedOrder) return suggestedOrder;
    if (left.comparison && right.comparison && left.comparison.dimension === right.comparison.dimension) {
      return left.comparison.unitPrice - right.comparison.unitPrice;
    }
    if (left.comparison && !right.comparison) return -1;
    if (!left.comparison && right.comparison) return 1;
    return left.store.productName.localeCompare(right.store.productName);
  }));

  const storesWithMatches = defaultStores.filter((retailer) => groupedMatches.get(retailer.id)?.length);
  if (!storesWithMatches.some((retailer) => retailer.id === state.activeCatalogueRetailer)) {
    state.activeCatalogueRetailer = storesWithMatches[0]?.id || defaultStores[0].id;
  }

  defaultStores.forEach((retailer) => {
    const retailerMatches = groupedMatches.get(retailer.id) || [];
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "catalogue-retailer-tab";
    tab.dataset.retailerTab = retailer.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(state.activeCatalogueRetailer === retailer.id));
    tab.innerHTML = `<span>${escapeHtml(retailer.name)}</span><strong>${retailerMatches.length}</strong>`;
    tab.addEventListener("click", () => {
      state.activeCatalogueRetailer = retailer.id;
      renderCatalogueResults();
    });
    tabs.appendChild(tab);

    const column = document.createElement("section");
    column.className = `catalogue-retailer-column retailer-${retailer.id}`;
    column.dataset.retailerColumn = retailer.id;
    column.setAttribute("role", "tabpanel");
    column.classList.toggle("is-active", state.activeCatalogueRetailer === retailer.id);
    column.innerHTML = `
      <header class="catalogue-retailer-heading">
        <span class="retailer-initial" aria-hidden="true">${escapeHtml(retailer.name.charAt(0))}</span>
        <div><h3>${escapeHtml(retailer.name)}</h3><p>${retailerMatches.length ? `${retailerMatches.length} closest matches` : "No priced matches yet"}</p></div>
      </header>
      <div class="catalogue-retailer-matches"></div>
    `;
    const columnMatches = column.querySelector(".catalogue-retailer-matches");
    if (!retailerMatches.length) {
      columnMatches.innerHTML = `<div class="catalogue-retailer-empty">No close match is currently held for this retailer.</div>`;
    }

    retailerMatches.forEach((match) => {
      const article = document.createElement("article");
      const { product, store, comparison } = match;
      const isBestPrice = isBestValue(match);
      const ranking = comparison ? rankings.get(comparison.dimension) : null;
      const saving = isBestPrice && ranking?.next ? ranking.next - ranking.best : 0;
      article.className = `catalogue-store-result${isBestPrice ? " best-price-result" : ""}`;
      const was = store.regularPrice && store.regularPrice > store.price ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : "";
      const promoText = visiblePromoText(store);
      const special = promoText ? `<small class="catalogue-special">${escapeHtml(promoText)}</small>` : "";
      const bestPriceBadge = isBestPrice
        ? `<span class="best-price-badge">Best value${saving > 0 ? ` - ${formatMoney(saving)}/${comparison.comparisonUnit} less` : ""}</span>`
        : "";
      const unitPrice = comparison
        ? `<small class="catalogue-unit-price">${formatMoney(comparison.unitPrice)} / ${comparison.comparisonUnit}</small>`
        : "";
      const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
      const existing = matchingBasketItem(store, product);
      article.tabIndex = 0;
      article.setAttribute("role", "button");
      article.setAttribute("aria-label", `Show details for ${productName} at ${store.storeName}`);
      article.innerHTML = `
        ${productImageMarkup(store.imageUrl, productName, "catalogue-image")}
        <div class="catalogue-product-copy">
          ${bestPriceBadge}
          <span>${escapeHtml(productName)}</span>
          <small>${escapeHtml([store.size, product.category].filter(Boolean).join(" - "))}</small>
          ${special}
          <small class="catalogue-detail-hint">View product details</small>
        </div>
        <div class="catalogue-price">${was}<strong>${formatMoney(store.price)}</strong>${unitPrice}${quantityControlMarkup(existing, productName, true)}</div>
      `;
      article.addEventListener("click", (event) => {
        if (event.target.closest(".catalogue-item-control")) return;
        openProductFocus(product, store, comparison);
      });
      article.addEventListener("keydown", (event) => {
        if (event.target.closest(".catalogue-item-control")) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openProductFocus(product, store, comparison);
      });
      wireQuantityControl(article, product, store, state.catalogueQuery);
      columnMatches.appendChild(article);
    });
    wrap.appendChild(column);
  });
  watchProductImages(wrap);
}

async function addCatalogueProductToBasket(product, store, preferredQuery = "") {
  const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
  const existing = matchingBasketItem(store, product);
  if (existing) {
    existing.quantity = wholeQuantity(existing.quantity) + 1;
    state.latest = null;
    renderItems();
    renderResults();
    await saveAll();
    clearCatalogueNotice();
    document.querySelector(`[data-id="${CSS.escape(existing.id)}"]`)?.classList.add("just-updated");
    renderCatalogueResults();
    if (state.specialsLoaded) renderSpecials();
    scheduleBasketScan(150);
    return;
  }
  const item = {
    id: `${product.id}-${store.storeId}-${Date.now()}`,
    name: productName,
    query: productName,
    comparisonQuery: buildComparisonQuery(product, store, preferredQuery),
    targetSize: store.size || product.targetSize || "",
    quantity: 1,
    category: product.category || "",
    selectedProductId: product.id,
    selectedProductName: productName,
    selectedBrand: store.brand || "",
    imageUrl: store.imageUrl || "",
    selectedStoreId: store.storeId,
    selectedStoreName: store.storeName,
    selectedPrice: store.price,
    links: { [store.storeId]: store.url || "" },
  };
  state.items.push(item);
  state.latest = null;
  renderItems();
  renderResults();
  await saveAll();
  setCatalogueNotice(`${productName} added to your basket.`, "success", 3200);
  document.querySelector(`[data-id="${CSS.escape(item.id)}"]`)?.classList.add("just-updated");
  renderCatalogueResults();
  if (state.specialsLoaded) renderSpecials();
  scheduleBasketScan(150);
}

async function searchCatalogue() {
  const query = $("#catalogueSearchInput").value.trim();
  if (!query) {
    setCatalogueNotice("Type a product to compare.");
    return;
  }
  const button = $("#catalogueSearchBtn");
  rememberItemSearch(query);
  state.catalogueQuery = query;
  readSettingsFromDom();
  const matchesPerRetailer = Math.min(12, Math.max(1, Number(state.settings.maxResultsPerStore || 6)));
  button.disabled = true;
  $("#catalogueLoading").hidden = false;
  setCatalogueNotice("Finding the closest retailer matches...");
  try {
    const payload = await api(`/v1/catalogue?q=${encodeURIComponent(query)}&perRetailer=${matchesPerRetailer}${locationQuery()}`);
    state.catalogueResults = payload.products || [];
    state.catalogueRetailerMatches = payload.retailerMatches || [];
    const matchedRetailers = new Set(state.catalogueRetailerMatches
      .flatMap((product) => product.stores || [])
      .filter((store) => store.price != null)
      .map((store) => store.storeId));
    setCatalogueNotice(state.catalogueResults.length
      ? `${state.catalogueResults.length} close matches across ${matchedRetailers.size} retailers`
      : "No priced catalogue matches yet.");
    renderItemSuggestions();
    renderCatalogueResults();
  } catch (error) {
    $("#catalogueStatus").className = "catalogue-status notice-warning";
    $("#catalogueStatus").innerHTML = `We could not load product matches. <button class="inline-retry" type="button">Try again</button>`;
    $("#catalogueStatus .inline-retry")?.addEventListener("click", searchCatalogue);
  } finally {
    button.disabled = false;
    $("#catalogueLoading").hidden = true;
  }
}

function readItemsFromDom() {
  const rows = new Map([...$("#itemsBody").querySelectorAll("tr")].map((row) => [row.dataset.id, row]));
  state.items = state.items.map((item) => {
    const quantityInput = rows.get(item.id)?.querySelector('[data-field="quantity"]');
    const quantity = wholeQuantity(quantityInput?.value || item.quantity || 1);
    if (quantityInput) quantityInput.value = String(quantity);
    return { ...item, quantity };
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
  saveDeviceState();
  updateSummary();
}

function renderBasketTotals(scan) {
  const wrap = $("#basketTotals");
  wrap.innerHTML = "";
  if (!scan) return;
  const totals = Object.values(scan.basketTotals || {}).sort((left, right) => {
    const leftComplete = left.missing === 0;
    const rightComplete = right.missing === 0;
    if (leftComplete !== rightComplete) return leftComplete ? -1 : 1;
    if (!leftComplete && left.missing !== right.missing) return left.missing - right.missing;
    return left.total - right.total;
  });
  if (!totals.some((total) => total.storeId === state.activeBasketRetailer)) {
    state.activeBasketRetailer = totals[0]?.storeId || "";
  }
  totals.forEach((total) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = [
      "total-chip",
      scan.bestBasketStoreId === total.storeId ? "best" : "",
      total.missing ? "incomplete" : "",
      state.activeBasketRetailer === total.storeId ? "is-active" : "",
    ].filter(Boolean).join(" ");
    chip.setAttribute("aria-pressed", String(state.activeBasketRetailer === total.storeId));
    const label = total.missing
      ? `${total.missing} ${total.missing === 1 ? "item" : "items"} missing`
      : "Full basket";
    chip.innerHTML = `
      <span class="total-chip-store">${escapeHtml(total.storeName)}</span>
      <strong>${total.total || total.missing === 0 ? formatMoney(total.total) : "No priced items"}</strong>
      <small>${label}</small>
    `;
    chip.addEventListener("click", () => {
      state.activeBasketRetailer = total.storeId;
      renderResults();
    });
    wrap.appendChild(chip);
  });
}

function renderResults() {
  const wrap = $("#results");
  const emptyResults = $("#emptyResults");
  wrap.innerHTML = "";
  emptyResults.innerHTML = "<strong>No basket totals yet.</strong><span>Add a product and RandBasket will compare available totals automatically.</span>";
  renderBasketTotals(state.latest);
  if (!state.latest) {
    emptyResults.hidden = state.items.length > 0;
    if (state.items.length) {
      wrap.innerHTML = state.items.map((item) => `
        <article class="result-card">
          <div class="result-head">
            <div class="result-product-heading">
              ${productImageMarkup(item.imageUrl, item.name, "result-product-image")}
              <div>
              <h3>${escapeHtml(item.name)}</h3>
              <div class="status">${escapeHtml(item.comparisonQuery || item.query || item.name)} - finding closest retailer matches...</div>
              </div>
            </div>
            <span class="badge">Updating</span>
          </div>
        </article>
      `).join("");
      watchProductImages(wrap);
    }
    return;
  }
  emptyResults.hidden = true;
  const total = state.latest.basketTotals?.[state.activeBasketRetailer];
  if (!total) {
    emptyResults.hidden = false;
    emptyResults.innerHTML = "<strong>No retailers selected.</strong><span>Enable at least one retailer in Value Settings to compare this basket.</span>";
    return;
  }
  const basketRows = state.latest.scans.map((scan) => {
    const basketItem = state.items.find((item) => item.id === scan.itemId);
    const result = scan.results.find((entry) => entry.storeId === state.activeBasketRetailer);
    const hasPrice = result?.lineTotal != null;
    const target = [scan.name, scan.targetMeasure?.label].filter(Boolean).join(" - ");
    const matchedName = hasPrice ? cleanDisplayText(result.productName) || "Matched product" : "No close match found";
    const pack = result?.productMeasure?.label || "";
    const normalized = hasPrice && result.normalizedPrice != null && result.normalizedPrice !== result.effectivePrice
      ? `${formatMoney(result.normalizedPrice)} adjusted to target size`
      : "";
    const details = [pack, normalized].filter(Boolean).join(" - ");
    const promoText = result ? visiblePromoText(result) : "";
    const promo = promoText
      ? `<small class="retailer-basket-promo">${escapeHtml(promoText)}</small>`
      : "";
    const wasPrice = hasPrice && result.regularPrice && result.regularPrice > result.price
      ? `<span class="was-price">${formatMoney(result.regularPrice)}</span>`
      : "";
    return `
      <div class="retailer-basket-row${hasPrice ? "" : " is-missing"}">
        <div class="retailer-basket-product" data-label="Product">
          ${productImageMarkup(result?.imageUrl || basketItem?.imageUrl, matchedName, "retailer-basket-image")}
          <div>
            <strong>${escapeHtml(matchedName)}</strong>
            <span>For ${escapeHtml(target)}</span>
            ${details ? `<small>${escapeHtml(details)}</small>` : ""}
            ${promo}
          </div>
        </div>
        <div class="retailer-basket-number" data-label="Unit price">${wasPrice}<strong>${formatMoney(result?.effectivePrice)}</strong></div>
        <div class="retailer-basket-number" data-label="Qty"><strong>${wholeQuantity(scan.quantity)}</strong></div>
        <div class="retailer-basket-number line-total" data-label="Line total"><strong>${formatMoney(result?.lineTotal)}</strong></div>
      </div>
    `;
  }).join("");
  const isBest = state.latest.bestBasketStoreId === total.storeId && total.missing === 0;
  wrap.innerHTML = `
    <section class="retailer-basket-view${isBest ? " best-basket" : ""}${total.missing ? " incomplete-basket" : ""}">
      <header class="retailer-basket-header">
        <div>
          <span>${isBest ? "Cheapest complete basket" : total.missing ? "Incomplete comparison" : "Complete basket"}</span>
          <h3>${escapeHtml(total.storeName)}</h3>
          <p>${total.missing ? `${total.missing} ${total.missing === 1 ? "item is" : "items are"} still missing from this retailer.` : "Every basket item has a close catalogue match."}</p>
        </div>
        <div class="retailer-basket-total">
          <span>${total.missing ? "Known subtotal" : "Basket total"}</span>
          <strong>${formatMoney(total.total)}</strong>
        </div>
      </header>
      <div class="retailer-basket-table">
        <div class="retailer-basket-table-head" aria-hidden="true">
          <span>Product</span><span>Unit price</span><span>Qty</span><span>Line total</span>
        </div>
        ${basketRows}
      </div>
    </section>
  `;
  watchProductImages(wrap);
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

function scheduleBasketScan(delay = 500) {
  readItemsFromDom();
  readSettingsFromDom();
  saveDeviceState();
  updateSummary();
  if (state.autoScanTimer) window.clearTimeout(state.autoScanTimer);

  if (!state.items.length) {
    state.latest = null;
    saveDeviceState();
    renderResults();
    setText("#bestBasket", "No scan yet");
    setText("#scanStatus", "Add an item to begin");
    return;
  }

  setText("#scanStatus", "Basket changed - updating totals...");
  state.autoScanTimer = window.setTimeout(() => {
    state.autoScanTimer = null;
    void runScan({ automatic: true });
  }, delay);
}

function backfillBasketImages(scan) {
  let changed = false;
  state.items = state.items.map((item) => {
    if (item.imageUrl) return item;
    const itemScan = scan?.scans?.find((entry) => entry.itemId === item.id);
    const preferred = itemScan?.results?.find((result) =>
      result.storeId === item.selectedStoreId && result.imageUrl);
    const available = preferred || itemScan?.results?.find((result) => result.imageUrl);
    if (!available?.imageUrl) return item;
    changed = true;
    return { ...item, imageUrl: available.imageUrl };
  });
  return changed;
}

async function runScan({ automatic = false } = {}) {
  readItemsFromDom();
  readSettingsFromDom();
  if (!state.items.length) {
    setText("#scanStatus", "Add an item to begin");
    if (!automatic) $("#weeklyStaples")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  if (state.autoScanTimer) {
    window.clearTimeout(state.autoScanTimer);
    state.autoScanTimer = null;
  }
  if (state.scanInFlight) {
    state.scanQueued = true;
    setText("#scanStatus", "Basket changed - another update is queued...");
    return;
  }

  state.scanInFlight = true;
  const button = $("#scanBtn");
  button.disabled = true;
  $("#scanStatus").textContent = automatic ? "Updating basket totals..." : "Scanning retailer prices...";
  try {
    await saveAll();
    state.latest = await api("/v1/scan/catalogue", {
      method: "POST",
      body: JSON.stringify({ items: state.items, settings: state.settings }),
    });
    if (backfillBasketImages(state.latest)) renderItems();
    await saveAll();
    $("#scanStatus").textContent = `Updated ${new Date(state.latest.createdAt).toLocaleString()}`;
    updateSummary();
    renderResults();
  } catch (error) {
    $("#scanStatus").innerHTML = `Price check failed. <button class="inline-retry" type="button">Try again</button>`;
    $("#scanStatus .inline-retry")?.addEventListener("click", runScan);
  } finally {
    button.disabled = false;
    state.scanInFlight = false;
    if (state.scanQueued) {
      state.scanQueued = false;
      scheduleBasketScan(100);
    }
  }
}

function addItem() {
  $("#catalogueSearchInput").focus();
  $("#catalogueSearchInput").scrollIntoView({ behavior: "smooth", block: "center" });
  setCatalogueNotice("Search for an item, then choose the match you want.");
}

function setSpecialsOpen(open) {
  const panel = $("#specials");
  const content = $("#specialsContent");
  const toggle = $("#specialsToggle");
  panel.classList.toggle("is-open", open);
  content.hidden = !open;
  toggle.setAttribute("aria-expanded", String(open));
  $("#specialsToggleLabel").textContent = open ? "Hide offers" : "View offers";
  if (open && !state.specialsLoaded) void loadSpecials();
}

function renderSpecials() {
  const wrap = $("#specialsGrid");
  wrap.innerHTML = "";
  if (!state.specials.length) {
    wrap.innerHTML = `<div class="empty">No verified catalogue specials are available for this selection yet.</div>`;
    return;
  }
  state.specials.forEach((special) => {
    const store = special.store;
    const product = {
      id: special.productId,
      canonicalName: special.canonicalName,
      category: special.category,
      targetSize: special.targetSize,
    };
    const card = document.createElement("article");
    card.className = "special-card";
    const productName = cleanDisplayText(store.productName || special.canonicalName) || "Special";
    const existing = matchingBasketItem(store, product);
    const promoText = visiblePromoText(store);
    const image = store.imageUrl
      ? `<img src="${escapeAttr(store.imageUrl)}" alt="${escapeAttr(productName)}" />`
      : `<div class="catalogue-image-placeholder">Catalogue offer</div>`;
    card.innerHTML = `
      <div class="special-card-image">${image}</div>
      <div class="special-card-copy">
        <span class="special-pill">${special.discountPercent ? `${special.discountPercent}% off` : "Catalogue special"}</span>
        <strong>${escapeHtml(productName)}</strong>
        <small>${escapeHtml([store.storeName, store.size, special.category].filter(Boolean).join(" - "))}</small>
        ${promoText ? `<p>${escapeHtml(promoText)}</p>` : ""}
      </div>
      <div class="special-card-price">
        ${store.regularPrice && store.regularPrice > store.price ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : ""}
        <strong>${formatMoney(store.price)}</strong>
        ${special.saving ? `<small>Save ${formatMoney(special.saving)}</small>` : ""}
        ${quantityControlMarkup(existing, productName, true, "Add to basket")}
      </div>
    `;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Show details for ${productName} at ${store.storeName}`);
    card.addEventListener("click", (event) => {
      if (event.target.closest(".catalogue-item-control")) return;
      openProductFocus(product, store, getUnitComparison(product, store), special.canonicalName);
    });
    card.addEventListener("keydown", (event) => {
      if (event.target.closest(".catalogue-item-control")) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openProductFocus(product, store, getUnitComparison(product, store), special.canonicalName);
    });
    wireQuantityControl(card, product, store, special.canonicalName);
    wrap.appendChild(card);
  });
}

async function loadSpecials() {
  const retailer = $("#specialsRetailer").value;
  $("#specialsRefreshBtn").disabled = true;
  $("#specialsStatus").textContent = "Loading current verified offers...";
  try {
    const retailerQuery = retailer ? `&retailer=${encodeURIComponent(retailer)}` : "";
    const balancedQuery = retailer ? "" : "&perRetailer=6";
    const payload = await api(`/v1/specials?limit=30${balancedQuery}${retailerQuery}${locationQuery()}`);
    state.specials = payload.specials || [];
    state.specialsLoaded = true;
    $("#specialsStatus").textContent = state.specials.length
      ? `${state.specials.length} verified offers. These prices are included in matching Price Checker results.`
      : "No verified specials are available for this selection yet.";
    renderSpecials();
  } catch {
    $("#specialsStatus").textContent = "Specials could not be loaded. Try again shortly.";
  } finally {
    $("#specialsRefreshBtn").disabled = false;
  }
}

function getSavedBaskets() {
  try { return JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) || "[]"); } catch { return []; }
}

function renderSavedBaskets() {
  const wrap = $("#savedBasketList");
  const baskets = getSavedBaskets();
  wrap.innerHTML = baskets.length ? "" : `<div class="empty saved-empty">You have not saved a basket yet.</div>`;
  baskets.forEach((basket) => {
    const row = document.createElement("div");
    row.className = "saved-basket-row";
    row.innerHTML = `<div><strong>${escapeHtml(basket.name)}</strong><span>${basket.items.length} items - ${new Date(basket.updatedAt).toLocaleDateString()}</span></div><div><button type="button" data-load="${basket.id}">Load</button><button type="button" data-delete="${basket.id}">Delete</button></div>`;
    wrap.appendChild(row);
  });
}

function openBasketDialog(message = "") {
  renderSavedBaskets();
  setText("#basketDialogStatus", message);
  if (!$("#basketDialog").open) $("#basketDialog").showModal();
}

function saveNamedBasket() {
  readItemsFromDom();
  readSettingsFromDom();
  if (!state.items.length) { setText("#basketDialogStatus", "Add at least one item before saving this basket."); return; }
  const name = $("#basketNameInput").value.trim();
  if (!name) { setText("#basketDialogStatus", "Enter a basket name to save it."); return; }
  const baskets = getSavedBaskets();
  const old = baskets.find((basket) => basket.name.toLowerCase() === name.toLowerCase());
  const entry = { id: old?.id || `${Date.now()}`, name, items: state.items, settings: state.settings, latest: state.latest, updatedAt: new Date().toISOString() };
  localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([entry, ...baskets.filter((basket) => basket.id !== entry.id)].slice(0, 20)));
  setText("#basketDialogStatus", `"${name}" is saved on this device.`);
  renderSavedBaskets();
  updateBasketActions();
}

function loadSavedBasket(id) {
  const basket = getSavedBaskets().find((entry) => entry.id === id);
  if (!basket) return;
  state.items = (basket.items || []).map((item) => ({ ...item, quantity: wholeQuantity(item.quantity) }));
  state.settings = basket.settings || state.settings;
  state.latest = basket.latest || null;
  state.activeBasketRetailer = "";
  renderStores(); renderLocation(); renderItems(); renderResults(); updateSummary(); saveDeviceState();
  $("#basketDialog").close();
  scheduleBasketScan(150);
}

function deleteSavedBasket(id) {
  localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify(getSavedBaskets().filter((entry) => entry.id !== id)));
  renderSavedBaskets();
  updateBasketActions();
}

function encodeSharedBasket(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeSharedBasket(value) {
  const base64 = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function fallbackCopyShareLink(url) {
  const input = document.createElement("textarea");
  input.value = url;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (copied) {
    setText("#scanStatus", "Share link copied");
    return;
  }
  window.prompt("Copy this basket link:", url);
}

async function shareBasket() {
  readItemsFromDom();
  if (!state.items.length) {
    if (getSavedBaskets().some((basket) => basket.items?.length)) {
      openBasketDialog("Load a saved basket first, then select Share basket again.");
    } else {
      setText("#scanStatus", "Add or save a basket before sharing.");
    }
    return;
  }
  const cleanSettings = { ...state.settings };
  delete cleanSettings.location;
  const payload = encodeSharedBasket({ items: state.items, settings: cleanSettings });
  const url = `${location.origin}${location.pathname}?basket=${payload}`;
  try {
    if (navigator.share) {
      await navigator.share({
        title: "My RandBasket grocery basket",
        text: "Compare this grocery basket on RandBasket.",
        url,
      });
      setText("#scanStatus", "Basket shared");
      return;
    }
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      setText("#scanStatus", "Share link copied");
      return;
    }
    fallbackCopyShareLink(url);
  } catch (error) {
    if (error?.name === "AbortError") return;
    fallbackCopyShareLink(url);
  }
}

function importSharedBasket() {
  const payload = new URLSearchParams(location.search).get("basket");
  if (!payload) return;
  try {
    let shared;
    try {
      shared = decodeSharedBasket(payload);
    } catch {
      shared = JSON.parse(decodeURIComponent(escape(atob(payload))));
    }
    if (!Array.isArray(shared.items)) return;
    if (state.items.length && !window.confirm("Replace your current basket with the shared basket?")) {
      history.replaceState({}, "", location.pathname + location.hash);
      return;
    }
    state.items = shared.items.map((item) => ({ ...item, quantity: wholeQuantity(item.quantity) }));
    state.settings = { ...state.settings, ...(shared.settings || {}) };
    state.latest = null;
    state.activeBasketRetailer = "";
    saveDeviceState();
    history.replaceState({}, "", location.pathname + location.hash);
    setText("#scanStatus", "Shared basket loaded");
  } catch { setText("#scanStatus", "This shared basket link could not be opened."); }
}

function renderFeedbackTurnstile(attempt = 0) {
  if (!window.turnstile) {
    if (attempt < 40) window.setTimeout(() => renderFeedbackTurnstile(attempt + 1), 100);
    else $("#feedbackStatus").textContent = "The security check could not load. Please refresh and try again.";
    return;
  }
  if (feedbackTurnstileWidgetId !== null) {
    window.turnstile.reset(feedbackTurnstileWidgetId);
    feedbackTurnstileToken = "";
    return;
  }
  feedbackTurnstileWidgetId = window.turnstile.render("#feedbackTurnstile", {
    sitekey: TURNSTILE_SITE_KEY,
    action: "feedback",
    theme: "auto",
    size: "flexible",
    callback(token) {
      feedbackTurnstileToken = token;
    },
    "expired-callback"() {
      feedbackTurnstileToken = "";
    },
    "error-callback"() {
      feedbackTurnstileToken = "";
      $("#feedbackStatus").textContent = "The security check failed to load. Please try again.";
    },
  });
}

function resetFeedbackTurnstile() {
  feedbackTurnstileToken = "";
  if (window.turnstile && feedbackTurnstileWidgetId !== null) {
    window.turnstile.reset(feedbackTurnstileWidgetId);
  }
}

function openFeedback() {
  const dialog = $("#feedbackDialog");
  $("#feedbackContext").value = `${window.location.origin}${window.location.pathname}`;
  $("#feedbackStatus").innerHTML = `Prefer email? <a href="mailto:${FEEDBACK_EMAIL}">${FEEDBACK_EMAIL}</a>`;
  if (!dialog.open) {
    dialog.showModal();
    renderFeedbackTurnstile();
  }
}

function closeFeedback() {
  const dialog = $("#feedbackDialog");
  if (dialog.open) dialog.close();
}

function submitFeedback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = $("#feedbackSubmitBtn");
  const status = $("#feedbackStatus");
  $("#feedbackContext").value = `${window.location.origin}${window.location.pathname}`;
  if (!feedbackTurnstileToken) {
    status.textContent = "Please complete the security check.";
    return;
  }
  button.disabled = true;
  button.textContent = "Sending...";
  status.textContent = "Sending your suggestion to RandBasket...";
  const fields = Object.fromEntries(new FormData(form).entries());
  fields.turnstileToken = feedbackTurnstileToken;
  api("/v1/feedback", {
    method: "POST",
    body: JSON.stringify(fields),
  }).then(() => {
    form.reset();
    resetFeedbackTurnstile();
    status.textContent = "Thank you - your suggestion has been emailed to RandBasket.";
    button.textContent = "Sent";
    window.setTimeout(() => {
      button.textContent = "Send another suggestion";
      button.disabled = false;
    }, 1400);
  }).catch((error) => {
    resetFeedbackTurnstile();
    status.textContent = error.message;
    button.textContent = "Try again";
    button.disabled = false;
  });
}

function wireEvents() {
  $("#addItemBtn").addEventListener("click", addItem);
  $("#saveBtn").addEventListener("click", () => openBasketDialog());
  $("#shareBtn").addEventListener("click", shareBasket);
  $("#basketDialogClose").addEventListener("click", () => $("#basketDialog").close());
  $("#basketDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) $("#basketDialog").close();
  });
  $("#productFocusCloseBtn").addEventListener("click", () => $("#productFocusDialog").close());
  $("#productFocusDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) $("#productFocusDialog").close();
  });
  $("#basketSaveNamedBtn").addEventListener("click", saveNamedBasket);
  $("#savedBasketList").addEventListener("click", (event) => {
    if (event.target.dataset.load) loadSavedBasket(event.target.dataset.load);
    if (event.target.dataset.delete) deleteSavedBasket(event.target.dataset.delete);
  });
  document.querySelectorAll("[data-starter]").forEach((button) => button.addEventListener("click", () => {
    $("#catalogueSearchInput").value = button.dataset.starter;
    $("#compare").scrollIntoView({ behavior: "smooth" });
    searchCatalogue();
  }));
  $("#appMenuBtn").addEventListener("click", () => {
    const menu = $("#appMobileMenu");
    menu.hidden = !menu.hidden;
    $("#appMenuBtn").setAttribute("aria-expanded", String(!menu.hidden));
  });
  $("#appMobileMenu").addEventListener("click", () => {
    $("#appMobileMenu").hidden = true;
    $("#appMenuBtn").setAttribute("aria-expanded", "false");
  });
  $("#mobileFeedbackBtn").addEventListener("click", openFeedback);
  $("#scanBtn").addEventListener("click", () => runScan());
  $("#feedbackOpenBtn").addEventListener("click", openFeedback);
  $("#feedbackCloseBtn").addEventListener("click", closeFeedback);
  $("#feedbackForm").addEventListener("submit", submitFeedback);
  $("#feedbackDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeFeedback();
  });
  $("#locationBtn").addEventListener("click", requestLocation);
  $("#locationAllowBtn").addEventListener("click", requestLocation);
  $("#locationDeclineBtn").addEventListener("click", declineLocation);
  $("#catalogueSearchBtn").addEventListener("click", searchCatalogue);
  $("#catalogueSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchCatalogue();
  });
  $("#catalogueSearchInput").addEventListener("input", scheduleItemSuggestions);
  $("#catalogueSearchInput").addEventListener("focus", () => renderItemSuggestions());
  $("#specialsToggle").addEventListener("click", () => {
    setSpecialsOpen($("#specialsToggle").getAttribute("aria-expanded") !== "true");
  });
  document.querySelectorAll('a[href="#specials"]').forEach((link) => {
    link.addEventListener("click", () => setSpecialsOpen(true));
  });
  $("#specialsRefreshBtn").addEventListener("click", loadSpecials);
  $("#specialsRetailer").addEventListener("change", loadSpecials);
  $("#maxResultsInput").addEventListener("change", () => {
    scheduleBasketScan();
    if (state.catalogueQuery) searchCatalogue();
  });
  $("#storeToggles").addEventListener("change", () => scheduleBasketScan());
  $("#itemsBody").addEventListener("input", (event) => {
    if (!event.target.matches('[data-field="quantity"]')) return;
    if (event.target.value !== "") event.target.value = String(wholeQuantity(event.target.value));
    clearCatalogueNotice();
    scheduleBasketScan(650);
  });
  $("#itemsBody").addEventListener("change", (event) => {
    if (!event.target.matches('[data-field="quantity"]')) return;
    readItemsFromDom();
    renderCatalogueResults();
    if (state.specialsLoaded) renderSpecials();
  });
  $("#itemsBody").addEventListener("click", (event) => {
    const removeId = event.target.dataset.remove;
    if (!removeId) return;
    readItemsFromDom();
    state.items = state.items.filter((item) => item.id !== removeId);
    clearCatalogueNotice();
    renderItems();
    renderCatalogueResults();
    if (state.specialsLoaded) renderSpecials();
    updateSummary();
    scheduleBasketScan(150);
  });
}

async function init() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    saved = {};
  }
  state.items = Array.isArray(saved.items)
    ? saved.items.map((item) => ({ ...item, quantity: wholeQuantity(item.quantity) }))
    : [];
  state.settings = saved.settings || {
    maxResultsPerStore: 6,
    stores: Object.fromEntries(defaultStores.map((store) => [store.id, true])),
  };
  delete state.settings.location;
  state.stores = defaultStores;
  state.latest = saved.latest || null;
  importSharedBasket();
  renderStores();
  renderLocation();
  renderItems();
  renderItemSuggestions();
  renderResults();
  updateSummary();
  wireEvents();
  if (state.latest?.createdAt) {
    setText("#scanStatus", `Updated ${new Date(state.latest.createdAt).toLocaleString()}`);
  }
  if (state.items.length && (!state.latest || state.items.some((item) => !item.imageUrl))) {
    scheduleBasketScan(250);
  }
  if (window.location.hash === "#suggestions") {
    openFeedback();
  } else if (window.location.hash === "#specials") {
    setSpecialsOpen(true);
  } else if (!state.settings.locationPermission) {
    $("#locationDialog").showModal();
  }
}

init().catch((error) => {
  setText("#scanStatus", error.message);
  console.error(error);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=33").catch(() => {});
  });
}
