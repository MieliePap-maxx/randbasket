const APP_SHELL_VERSION = "31";
const appShellReady = Boolean(
  window.RandBasketCore
  && document.getElementById("productDetailsDialog")
  && document.getElementById("specialsToggle")
  && document.getElementById("locationDialog"),
);

if (!appShellReady) {
  const refreshUrl = new URL(window.location.href);
  if (refreshUrl.searchParams.get("release") !== APP_SHELL_VERSION) {
    refreshUrl.searchParams.set("release", APP_SHELL_VERSION);
    window.location.replace(refreshUrl.toString());
  }
  throw new Error("Updating RandBasket application files. The page will reload automatically.");
}

const state = {
  items: [],
  settings: {},
  stores: [],
  latest: null,
  pnpProgressTimer: null,
  catalogueResults: [],
  catalogueRetailerMatches: [],
  catalogueRetailerDiagnostics: {},
  cataloguePage: 1,
  catalogueHasMore: false,
  specials: [],
  specialsLoaded: false,
  autoScanTimer: null,
  scanInFlight: false,
  scanQueued: false,
  catalogueQuery: "",
};

const { availableProductDetails, matchingBasketItem: findMatchingBasketItem, nextQuantity, wholeQuantity } = window.RandBasketCore;
const quantityUpdates = new Set();
let lastProductDetailsTrigger = null;

const API_ORIGIN = "https://api.randbasket.co.za";
const STORAGE_KEY = "randbasket-web-state-v1";
const SAVED_BASKETS_KEY = "randbasket-saved-baskets-v1";
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

function updateSummary() {
  setText("#itemCount", state.items.length);
  const maxResultsInput = $("#maxResultsInput");
  if (maxResultsInput) maxResultsInput.value = state.settings.maxResultsPerStore || 5;

  const latest = state.latest;
  const bestId = latest?.bestBasketStoreId;
  const best = bestId ? latest.basketTotals[bestId] : null;
  setText("#bestBasket", best ? `${best.storeName} ${formatMoney(best.total)}` : "No scan yet");
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
    <td class="quantity" data-label="Qty"><input data-field="quantity" aria-label="Quantity for ${escapeAttr(item.name)}" type="number" min="1" step="1" value="${wholeQuantity(item.quantity)}" /></td>
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
  $("#emptyBasket").hidden = state.items.length > 0;
  $(".table-wrap").hidden = state.items.length === 0;
}

function matchingBasketItem(store, product = null) {
  return findMatchingBasketItem(state.items, product, store);
}

function productIdentity(product, store) {
  return `${store.storeId}|${product?.id || ""}|${store.url || ""}`;
}

function productImageMarkup(imageUrl, productName, className, interactive = false) {
  const initial = cleanDisplayText(productName).charAt(0).toUpperCase() || "R";
  const image = imageUrl
    ? `<img data-product-image src="${escapeAttr(imageUrl)}" alt="" loading="lazy" />`
    : "";
  const content = `<span class="product-image-fallback" aria-hidden="true">${escapeHtml(initial)}</span>${image}`;
  return interactive
    ? `<button type="button" class="${className} product-image-button" aria-label="${escapeAttr(`View details for ${productName}`)}">${content}</button>`
    : `<span class="${className}">${content}</span>`;
}

function watchProductImages(root = document) {
  root.querySelectorAll("img[data-product-image]").forEach((image) => {
    image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  });
}

function quantityControlMarkup(existing, label, compact = false) {
  if (!existing) {
    return `<button type="button" class="catalogue-add-btn catalogue-item-control" aria-label="Add product to basket">Add to basket</button>`;
  }
  return `
    <div class="quantity-stepper catalogue-item-control${compact ? " is-compact" : ""}" aria-label="${escapeAttr(`Quantity for ${label}`)}">
      <button type="button" data-quantity-action="decrease" aria-label="Decrease quantity">&minus;</button>
      <strong aria-label="Current quantity">${wholeQuantity(existing.quantity)}</strong>
      <button type="button" data-quantity-action="increase" aria-label="Increase quantity">&plus;</button>
    </div>
  `;
}

async function adjustCatalogueProductQuantity(product, store, delta, preferredQuery = "") {
  const key = productIdentity(product, store);
  if (quantityUpdates.has(key)) return;
  quantityUpdates.add(key);
  try {
    const existing = matchingBasketItem(store, product);
    if (!existing && delta > 0) {
      await addCatalogueProductToBasket(product, store, preferredQuery);
      return;
    }
    if (!existing) return;
    const quantity = nextQuantity(existing.quantity, delta);
    if (quantity === 0) state.items = state.items.filter((item) => item.id !== existing.id);
    else existing.quantity = quantity;
    state.latest = null;
    renderItems();
    renderResults();
    await saveAll();
    renderCatalogueResults();
    if (state.specialsLoaded) renderSpecials();
    scheduleBasketScan(150);
  } finally {
    quantityUpdates.delete(key);
  }
}

function wireQuantityControl(root, product, store, preferredQuery = "", onChange = null) {
  const addButton = root.querySelector(".catalogue-add-btn");
  addButton?.addEventListener("click", async (event) => {
    event.stopPropagation();
    await adjustCatalogueProductQuantity(product, store, 1, preferredQuery);
    onChange?.();
  });
  root.querySelectorAll("[data-quantity-action]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      root.querySelectorAll(".catalogue-item-control button").forEach((control) => { control.disabled = true; });
      const delta = button.dataset.quantityAction === "increase" ? 1 : -1;
      await adjustCatalogueProductQuantity(product, store, delta, preferredQuery);
      onChange?.();
    });
  });
}

function openProductDetails(product, store, comparison, trigger) {
  const dialog = $("#productDetailsDialog");
  const content = $("#productDetailsContent");
  const details = availableProductDetails(
    product,
    store,
    comparison ? `${formatMoney(comparison.unitPrice)} / ${comparison.comparisonUnit}` : null,
  );
  const productName = cleanDisplayText(details.name) || "Product";
  const description = cleanDisplayText(details.description);
  const lastChecked = details.lastSeenAt && !Number.isNaN(Date.parse(details.lastSeenAt))
    ? new Date(details.lastSeenAt).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })
    : "";
  const matchNotes = [...details.matchReasons, details.alternativeReason].filter(Boolean);
  const regularPrice = Number(details.regularPrice) > Number(details.price)
    ? `<span class="product-details-was">Usually ${formatMoney(details.regularPrice)}</span>`
    : "";
  const promotion = details.promoText
    ? `<div class="product-details-promotion"><strong>Current offer</strong><span>${escapeHtml(details.promoText)}</span></div>`
    : "";
  const informationSections = details.sections.map(([heading, value]) => `
    <section class="product-details-section">
      <h3>${escapeHtml(heading)}</h3>
      <p>${escapeHtml(value).replace(/\n/g, "<br>")}</p>
    </section>
  `).join("");
  const emptyDescription = !description && !informationSections
    ? `<p class="product-details-empty">No extended description has been supplied for this product yet. Check the retailer page for ingredients, usage and dietary information.</p>`
    : "";
  const retailerLink = details.productUrl
    ? `<a class="primary product-details-link" href="${escapeAttr(details.productUrl)}" target="_blank" rel="noopener">View retailer product</a>`
    : "";
  content.innerHTML = `
    <div class="product-details-layout">
      ${productImageMarkup(details.imageUrl, productName, "product-details-image")}
      <div class="product-details-copy">
        <p class="eyebrow">${escapeHtml(details.retailer)}</p>
        <h2 id="productDetailsTitle">${escapeHtml(productName)}</h2>
        ${description ? `<p class="product-details-description">${escapeHtml(description)}</p>` : ""}
        <dl class="product-details-facts">${details.facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
        ${promotion}
        <div class="product-details-price"><span>Current price${regularPrice}</span><strong>${details.price == null ? "Unavailable" : formatMoney(details.price)}</strong></div>
        ${lastChecked ? `<p class="product-details-updated">Price last checked ${escapeHtml(lastChecked)}</p>` : ""}
        ${retailerLink}
      </div>
    </div>
    ${matchNotes.length ? `<section class="product-details-match"><h3>Why this result is shown</h3><ul>${matchNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></section>` : ""}
    ${informationSections}
    ${emptyDescription}
  `;
  watchProductImages(content);
  lastProductDetailsTrigger = trigger || document.activeElement;
  if (!dialog.open) dialog.showModal();
}

function closeProductDetails() {
  const dialog = $("#productDetailsDialog");
  if (dialog.open) dialog.close();
}

function stripComparisonBranding(value, brand = "") {
  let text = cleanDisplayText(value).toLowerCase();
  [...retailerAliases, brand]
    .filter(Boolean)
    .sort((left, right) => String(right).length - String(left).length)
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

function buildBasketRequirement(product, store, comparisonQuery) {
  const targetSize = cleanDisplayText(store.size || product.targetSize || "");
  const measure = parseMeasurement(targetSize, comparisonQuery);
  const normalized = cleanDisplayText(`${product.category || ""} ${product.productFamily || ""} ${comparisonQuery}`).toLowerCase();
  const productFamily = [
    ["milk", /\b(?:milk|maas|amasi)\b/],
    ["bread", /\b(?:bread|loaf)\b/],
    ["eggs", /\beggs?\b/],
    ["mince", /\b(?:mince|minced meat|ground beef)\b/],
    ["chicken", /\bchicken\b/],
    ["flour", /\bflour\b/],
    ["rice", /\brice\b/],
    ["sugar", /\bsugar\b/],
    ["oil", /\b(?:cooking|sunflower|canola|vegetable) oil\b/],
  ].find(([, pattern]) => pattern.test(normalized))?.[0] || cleanDisplayText(product.category || "product").toLowerCase();
  return {
    id: `requirement-${product.id}-${store.storeId}`,
    productFamily,
    query: comparisonQuery,
    attributes: {},
    desiredAmount: measure?.baseAmount || null,
    normalizedUnit: measure?.dimension || null,
    requestedQuantity: 1,
    brandPreference: null,
    brandRequired: false,
    sourceProductId: product.id,
    sourceRetailerId: store.storeId,
    sourceProductName: cleanDisplayText(store.productName || product.canonicalName) || null,
    displayLabel: cleanDisplayText(store.productName || product.canonicalName) || "Product",
  };
}

function renderCatalogueResults() {
  const wrap = $("#catalogueResults");
  const pagination = $("#cataloguePagination");
  wrap.innerHTML = "";
  pagination.hidden = state.catalogueResults.length === 0;
  $("#cataloguePreviousBtn").disabled = state.cataloguePage <= 1;
  $("#catalogueMoreBtn").disabled = !state.catalogueHasMore;
  $("#cataloguePageLabel").textContent = `Page ${state.cataloguePage}`;
  if (!state.catalogueResults.length && !state.catalogueQuery) return;

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
  groupedMatches.forEach((storeMatches) => storeMatches.sort((left, right) => {
    const tierOrder = Number(left.store.matchTier || 5) - Number(right.store.matchTier || 5);
    if (tierOrder) return tierOrder;
    const scoreOrder = Number(right.store.matchScore || 0) - Number(left.store.matchScore || 0);
    if (scoreOrder) return scoreOrder;
    const suggestedOrder = Number(isBestValue(right)) - Number(isBestValue(left));
    if (suggestedOrder) return suggestedOrder;
    if (left.comparison && right.comparison && left.comparison.dimension === right.comparison.dimension) {
      return left.comparison.unitPrice - right.comparison.unitPrice;
    }
    if (left.comparison && !right.comparison) return -1;
    if (!left.comparison && right.comparison) return 1;
    return left.store.productName.localeCompare(right.store.productName);
  }));

  defaultStores.forEach((retailer) => {
    const storeMatches = groupedMatches.get(retailer.id) || [];
    const diagnostics = state.catalogueRetailerDiagnostics[retailer.id] || {};
    const column = document.createElement("section");
    column.className = `catalogue-retailer-column retailer-${retailer.id}`;
    column.dataset.retailerColumn = retailer.id;
    column.innerHTML = `
      <header class="catalogue-retailer-heading">
        <span class="retailer-initial" aria-hidden="true">${escapeHtml(retailer.name.charAt(0))}</span>
        <div><h3>${escapeHtml(retailer.name)}</h3><p>${storeMatches.length ? `${storeMatches.length} ranked matches` : "No priced matches yet"}</p></div>
      </header>
      <div class="catalogue-retailer-matches"></div>
    `;
    const columnMatches = column.querySelector(".catalogue-retailer-matches");
    if (!storeMatches.length) {
      columnMatches.innerHTML = `<div class="catalogue-retailer-empty">${escapeHtml(diagnostics.emptyReason || "No current comparable product is held for this retailer.")}</div>`;
    }

    storeMatches.forEach((match) => {
      const article = document.createElement("article");
      const { product, store, comparison } = match;
      const tierLabels = {
        1: "Exact match",
        2: "Equivalent quantity",
        3: "Closest compatible size",
        4: "Related variant",
        5: "Category alternative",
      };
      const tier = Number(store.matchTier || 5);
      const tierBadge = `<span class="match-tier-badge tier-${tier}">${escapeHtml(tierLabels[tier] || "Alternative")}</span>`;
      const isBestPrice = isBestValue(match);
      const ranking = comparison ? rankings.get(comparison.dimension) : null;
      const saving = isBestPrice && ranking?.next ? ranking.next - ranking.best : 0;
      article.className = `catalogue-store-result${isBestPrice ? " best-price-result" : ""}`;
      const was = store.regularPrice && store.regularPrice > store.price ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : "";
      const special = store.promoText ? `<small class="catalogue-special">${escapeHtml(store.promoText)}</small>` : "";
      const bestPriceBadge = isBestPrice
        ? `<span class="best-price-badge">Best value${saving > 0 ? ` - ${formatMoney(saving)}/${comparison.comparisonUnit} less` : ""}</span>`
        : "";
      const unitPrice = comparison
        ? `<small class="catalogue-unit-price">${formatMoney(comparison.unitPrice)} / ${comparison.comparisonUnit}</small>`
        : "";
      const effectivePrice = store.unitsRequired > 1 && store.effectiveTotalPrice != null
        ? `<small class="catalogue-effective-price">${store.unitsRequired} packs: ${formatMoney(store.effectiveTotalPrice)}</small>`
        : "";
      const alternative = store.isAlternative && store.alternativeReason
        ? `<small class="catalogue-alternative-reason">${escapeHtml(store.alternativeReason)}</small>`
        : "";
      const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
      const link = store.url ? `<a href="${escapeAttr(store.url)}" target="_blank" rel="noopener">View retailer product</a>` : "";
      const existing = matchingBasketItem(store, product);
      article.innerHTML = `
        ${productImageMarkup(store.imageUrl, productName, "catalogue-image", true)}
        <div class="catalogue-product-copy">
          ${tierBadge}
          ${bestPriceBadge}
          <button type="button" class="product-details-name">${escapeHtml(productName)}</button>
          <small>${escapeHtml([store.size, product.category].filter(Boolean).join(" - "))}</small>
          ${special}
          ${alternative}
          ${link}
        </div>
        <div class="catalogue-price">${was}<strong>${formatMoney(store.price)}</strong>${unitPrice}${effectivePrice}${quantityControlMarkup(existing, productName, true)}</div>
      `;
      const imageButton = article.querySelector(".product-image-button");
      const detailsTriggers = [imageButton, article.querySelector(".product-details-name")].filter(Boolean);
      detailsTriggers.forEach((detailsTrigger) => detailsTrigger.addEventListener("click", (event) => {
        event.stopPropagation();
        openProductDetails(product, store, comparison, detailsTrigger);
      }));
      wireQuantityControl(article, product, store, state.catalogueQuery || $("#catalogueSearchInput").value.trim());
      columnMatches.appendChild(article);
    });
    wrap.appendChild(column);
  });
}

async function addCatalogueProductToBasket(product, store, preferredQuery = "") {
  const productName = cleanDisplayText(store.productName || product.canonicalName) || "Product";
  const existing = state.items.find((item) => item.links?.[store.storeId] === store.url);
  if (existing) {
    existing.quantity = wholeQuantity(existing.quantity) + 1;
    state.latest = null;
    renderItems();
    renderResults();
    await saveAll();
    renderCatalogueResults();
    if (state.specialsLoaded) renderSpecials();
    scheduleBasketScan(150);
    return;
  }
  const comparisonQuery = buildComparisonQuery(product, store, preferredQuery);
  state.items.push({
    id: `${product.id}-${store.storeId}-${Date.now()}`,
    name: productName,
    query: comparisonQuery,
    comparisonQuery,
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
    requirement: buildBasketRequirement(product, store, comparisonQuery),
  });
  state.latest = null;
  renderItems();
  renderResults();
  await saveAll();
  $("#catalogueStatus").textContent = `${productName} added to the basket.`;
  renderCatalogueResults();
  if (state.specialsLoaded) renderSpecials();
  scheduleBasketScan(150);
}

async function searchCatalogue(page = 1) {
  const query = $("#catalogueSearchInput").value.trim();
  if (!query) {
    $("#catalogueStatus").textContent = "Type a product to compare.";
    return;
  }
  const button = $("#catalogueSearchBtn");
  state.catalogueQuery = query;
  button.disabled = true;
  $("#catalogueLoading").hidden = false;
  $("#catalogueStatus").textContent = "Finding the closest retailer matches...";
  try {
    readSettingsFromDom();
    const matchesPerRetailer = Math.min(5, Math.max(1, Number(state.settings.maxResultsPerStore || 5)));
    const payload = await api(`/v1/catalogue?q=${encodeURIComponent(query)}&perRetailer=${matchesPerRetailer}&page=${Math.max(1, page)}${locationQuery()}`);
    state.catalogueResults = payload.products || [];
    state.catalogueRetailerMatches = payload.retailerMatches || [];
    state.catalogueRetailerDiagnostics = payload.retailerDiagnostics || {};
    state.cataloguePage = payload.page || Math.max(1, page);
    state.catalogueHasMore = Boolean(payload.hasMore || Object.values(payload.retailerHasMore || {}).some(Boolean));
    $("#catalogueStatus").textContent = state.catalogueResults.length
      ? `Comparable unit prices for ${query}`
      : "No priced catalogue matches yet.";
    renderCatalogueResults();
  } catch (error) {
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
    return { ...item, quantity: Number(quantityInput?.value || item.quantity || 1) };
  });
}

function readSettingsFromDom() {
  state.settings.maxResultsPerStore = Number($("#maxResultsInput").value || 5);
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
  Object.values(scan.basketTotals).forEach((total) => {
    const chip = document.createElement("div");
    chip.className = `total-chip ${scan.bestBasketStoreId === total.storeId ? "best" : ""}`;
    const missing = total.missingItemCount ?? total.missing ?? 0;
    const matched = total.matchedItemCount ?? Math.max(0, (scan.scans?.length || 0) - missing);
    const subtotal = total.knownSubtotal ?? total.total ?? 0;
    const label = missing
      ? `${total.storeName} known subtotal`
      : `${total.storeName} complete basket`;
    chip.innerHTML = `
      <span>${label}</span>
      <strong>${matched ? formatMoney(subtotal) : "No matches"}</strong>
      <small>${matched} matched${missing ? ` · ${missing} missing` : ""}</small>
    `;
    wrap.appendChild(chip);
  });
}

function formatSuppliedAmount(value, kind) {
  if (value == null) return "";
  if (kind === "volume") return value >= 1000 ? `${Number((value / 1000).toFixed(2))} L` : `${value} ml`;
  if (kind === "mass") return value >= 1000 ? `${Number((value / 1000).toFixed(2))} kg` : `${value} g`;
  return `${value} item${value === 1 ? "" : "s"}`;
}

function comparisonResultCell(scan, store, result) {
  if (!result || result.status !== "matched" || result.lineTotal == null) {
    const reason = result?.status === "price-unavailable"
      ? "A comparable product was found, but its price is unavailable."
      : result?.status === "incompatible-size"
        ? "Available packs cannot safely fulfil this size."
        : "No safe comparable product found.";
    const heading = result?.status === "price-unavailable" ? "Price unavailable" : "No suitable match";
    return `
      <div class="comparison-cell comparison-cell-missing" role="cell">
        <strong>${heading}</strong>
        <span>${escapeHtml(reason)}</span>
      </div>
    `;
  }
  const supplied = formatSuppliedAmount(result.totalSupplied, scan.requirement?.normalizedUnit);
  const packs = `${result.unitsRequired || 1} pack${result.unitsRequired === 1 ? "" : "s"}`;
  const confidence = result.matchConfidence == null ? "" : `${Math.round(result.matchConfidence * 100)}% match`;
  const reasons = Array.isArray(result.matchReasons) ? result.matchReasons.filter(Boolean).slice(0, 3) : [];
  const product = {
    id: result.matchedProductId,
    canonicalName: result.productName,
    category: scan.category,
    targetSize: result.size,
    stores: [{
      ...result,
      storeId: store.id,
      storeName: store.name,
      productName: result.productName,
      url: result.productUrl,
      price: result.price,
    }],
  };
  const detailPayload = escapeAttr(JSON.stringify(product));
  return `
    <div class="comparison-cell ${scan.bestStoreId === store.id ? "comparison-cell-best" : ""}" role="cell">
      <div class="comparison-product">
        <button class="comparison-image-button" type="button" data-comparison-product="${detailPayload}" aria-label="View details for ${escapeAttr(result.productName || "matched product")}">
          ${result.imageUrl ? `<img src="${escapeAttr(result.imageUrl)}" alt="" loading="lazy" />` : `<span aria-hidden="true">R</span>`}
        </button>
        <div>
          <strong>${escapeHtml(result.productName || "Matched product")}</strong>
          <span>${escapeHtml([result.brand, result.size].filter(Boolean).join(" · "))}</span>
        </div>
      </div>
      <div class="comparison-price">
        <strong>${formatMoney(result.lineTotal)}</strong>
        <span>${formatMoney(result.price)} each · ${packs}</span>
        ${result.unitPrice != null ? `<span>${formatMoney(result.unitPrice)}${result.unitPriceLabel ? ` / ${escapeHtml(result.unitPriceLabel)}` : " unit price"}</span>` : ""}
        ${supplied ? `<span>Supplies ${escapeHtml(supplied)} per basket item</span>` : ""}
      </div>
      ${confidence ? `<span class="match-confidence">${escapeHtml(confidence)}</span>` : ""}
      ${reasons.length ? `<ul class="match-reasons">${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
      ${result.productUrl ? `<a href="${escapeAttr(result.productUrl)}" target="_blank" rel="noopener">View at ${escapeHtml(store.name)}</a>` : ""}
    </div>
  `;
}

function renderResults() {
  const wrap = $("#results");
  wrap.innerHTML = "";
  renderBasketTotals(state.latest);
  if (!state.latest) {
    $("#emptyResults").hidden = false;
    return;
  }
  $("#emptyResults").hidden = true;
  const stores = defaultStores;
  const matrix = document.createElement("div");
  matrix.className = "comparison-matrix-wrap";
  matrix.innerHTML = `
    <div class="comparison-matrix" role="table" aria-label="Basket product comparison by retailer" style="--retailer-count:${stores.length}">
      <div class="comparison-head comparison-requirement-head" role="columnheader">Basket requirement</div>
      ${stores.map((store) => `<div class="comparison-head" role="columnheader">${escapeHtml(store.name)}</div>`).join("")}
      ${state.latest.scans.map((scan) => `
        <div class="comparison-requirement" role="rowheader">
          <strong>${escapeHtml(scan.requirement?.displayLabel || scan.name)}</strong>
          <span>${escapeHtml(scan.requirement?.productFamily || scan.category || "Product")}</span>
          <span>${scan.targetMeasure?.label ? `Target ${escapeHtml(scan.targetMeasure.label)} · ` : ""}Qty ${scan.quantity}</span>
        </div>
        ${stores.map((store) => comparisonResultCell(scan, store, scan.results.find((result) => result.storeId === store.id))).join("")}
      `).join("")}
      <div class="comparison-footer-label" role="rowheader">Basket totals</div>
      ${stores.map((store) => {
        const total = state.latest.basketTotals?.[store.id];
        const missing = total?.missingItemCount ?? total?.missing ?? state.latest.scans.length;
        const matched = total?.matchedItemCount ?? Math.max(0, state.latest.scans.length - missing);
        const subtotal = total?.knownSubtotal ?? total?.total ?? 0;
        return `<div class="comparison-footer" role="cell">
          <strong>${matched ? formatMoney(subtotal) : "No matches"}</strong>
          <span>${missing ? `Known subtotal · ${missing} missing` : "Complete basket total"}</span>
        </div>`;
      }).join("")}
    </div>
  `;
  wrap.appendChild(matrix);
  matrix.querySelectorAll("[data-comparison-product]").forEach((button) => {
    button.addEventListener("click", () => {
      try {
        const product = JSON.parse(button.dataset.comparisonProduct || "{}");
        openProductDetails(product, product.stores?.[0], null, button);
      } catch (_error) {
        // Ignore stale or malformed cached scan data.
      }
    });
  });
  watchProductImages(matrix);
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

async function runScan({ automatic = false } = {}) {
  readItemsFromDom();
  readSettingsFromDom();
  if (!state.items.length) {
    setText("#scanStatus", "Add an item to begin");
    if (!automatic) $("#emptyBasket").scrollIntoView({ behavior: "smooth", block: "center" });
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
  $("#catalogueStatus").textContent = "Search for a product, then select Add to basket.";
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
    const card = document.createElement("article");
    card.className = "special-card";
    const productName = cleanDisplayText(store.productName || special.canonicalName) || "Special";
    const product = {
      id: special.productId,
      canonicalName: special.canonicalName,
      category: special.category,
      targetSize: special.targetSize,
    };
    const existing = matchingBasketItem(store, product);
    const comparison = getUnitComparison(product, store);
    card.innerHTML = `
      ${productImageMarkup(store.imageUrl, productName, "special-card-image", true)}
      <div class="special-card-copy">
        <span class="special-pill">${special.discountPercent ? `${special.discountPercent}% off` : "Catalogue special"}</span>
        <button type="button" class="product-details-name">${escapeHtml(productName)}</button>
        <small>${escapeHtml([store.storeName, store.size, special.category].filter(Boolean).join(" · "))}</small>
        ${store.promoText ? `<p>${escapeHtml(store.promoText)}</p>` : ""}
      </div>
      <div class="special-card-price">
        ${store.regularPrice ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : ""}
        <strong>${formatMoney(store.price)}</strong>
        ${special.saving ? `<small>Save ${formatMoney(special.saving)}</small>` : ""}
        ${quantityControlMarkup(existing, productName, true)}
      </div>
    `;
    const imageButton = card.querySelector(".product-image-button");
    [imageButton, card.querySelector(".product-details-name")].filter(Boolean).forEach((detailsTrigger) => {
      detailsTrigger.addEventListener("click", () => openProductDetails(product, store, comparison, detailsTrigger));
    });
    wireQuantityControl(card, product, store, state.catalogueQuery);
    wrap.appendChild(card);
  });
  watchProductImages(wrap);
}

async function loadSpecials() {
  const retailer = $("#specialsRetailer").value;
  $("#specialsRefreshBtn").disabled = true;
  $("#specialsStatus").textContent = "Loading current verified offers...";
  try {
    const retailerQuery = retailer ? `&retailer=${encodeURIComponent(retailer)}` : "";
    const payload = await api(`/v1/specials?limit=30${retailerQuery}${locationQuery()}`);
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
  wrap.innerHTML = baskets.length ? "" : `<div class="empty saved-empty">No named baskets saved yet.</div>`;
  baskets.forEach((basket) => {
    const row = document.createElement("div");
    row.className = "saved-basket-row";
    row.innerHTML = `<div><strong>${escapeHtml(basket.name)}</strong><span>${basket.items.length} items · ${new Date(basket.updatedAt).toLocaleDateString()}</span></div><div><button type="button" data-load="${basket.id}">Load</button><button type="button" data-delete="${basket.id}">Delete</button></div>`;
    wrap.appendChild(row);
  });
}

function openBasketDialog() {
  renderSavedBaskets();
  if (!$("#basketDialog").open) $("#basketDialog").showModal();
}

function saveNamedBasket() {
  readItemsFromDom();
  readSettingsFromDom();
  if (!state.items.length) { setText("#basketDialogStatus", "Add at least one product before saving."); return; }
  const name = $("#basketNameInput").value.trim();
  if (!name) { setText("#basketDialogStatus", "Give this basket a name first."); return; }
  const baskets = getSavedBaskets();
  const old = baskets.find((basket) => basket.name.toLowerCase() === name.toLowerCase());
  const entry = { id: old?.id || `${Date.now()}`, name, items: state.items, settings: state.settings, latest: state.latest, updatedAt: new Date().toISOString() };
  localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([entry, ...baskets.filter((basket) => basket.id !== entry.id)].slice(0, 20)));
  setText("#basketDialogStatus", `${name} saved on this device.`);
  renderSavedBaskets();
}

function loadSavedBasket(id) {
  const basket = getSavedBaskets().find((entry) => entry.id === id);
  if (!basket) return;
  state.items = basket.items || [];
  state.settings = basket.settings || state.settings;
  state.latest = basket.latest || null;
  renderStores(); renderLocation(); renderItems(); renderResults(); updateSummary(); saveDeviceState();
  $("#basketDialog").close();
  scheduleBasketScan(150);
}

function deleteSavedBasket(id) {
  localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify(getSavedBaskets().filter((entry) => entry.id !== id)));
  renderSavedBaskets();
}

function shareBasket() {
  readItemsFromDom();
  if (!state.items.length) { setText("#scanStatus", "Add at least one product before sharing."); return; }
  const cleanSettings = { ...state.settings };
  delete cleanSettings.location;
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ items: state.items, settings: cleanSettings }))));
  const url = `${location.origin}${location.pathname}?basket=${encodeURIComponent(payload)}`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => setText("#scanStatus", "Share link copied"))
      .catch(() => window.prompt("Copy this basket link:", url));
  } else {
    window.prompt("Copy this basket link:", url);
  }
}

function importSharedBasket() {
  const payload = new URLSearchParams(location.search).get("basket");
  if (!payload) return;
  try {
    const shared = JSON.parse(decodeURIComponent(escape(atob(payload))));
    if (!Array.isArray(shared.items)) return;
    if (state.items.length && !window.confirm("Replace your current basket with the shared basket?")) {
      history.replaceState({}, "", location.pathname + location.hash);
      return;
    }
    state.items = shared.items;
    state.settings = { ...state.settings, ...(shared.settings || {}) };
    state.latest = null;
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
  $("#saveBtn").addEventListener("click", openBasketDialog);
  $("#shareBtn").addEventListener("click", shareBasket);
  $("#basketDialogClose").addEventListener("click", () => $("#basketDialog").close());
  $("#basketSaveNamedBtn").addEventListener("click", saveNamedBasket);
  $("#savedBasketList").addEventListener("click", (event) => {
    if (event.target.dataset.load) loadSavedBasket(event.target.dataset.load);
    if (event.target.dataset.delete) deleteSavedBasket(event.target.dataset.delete);
  });
  document.querySelectorAll("[data-starter]").forEach((button) => button.addEventListener("click", () => {
    $("#catalogueSearchInput").value = button.dataset.starter;
    $("#compare").scrollIntoView({ behavior: "smooth" });
    searchCatalogue(1);
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
  $("#catalogueSearchBtn").addEventListener("click", () => searchCatalogue(1));
  $("#catalogueSearchInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchCatalogue(1);
  });
  $("#cataloguePreviousBtn").addEventListener("click", () => searchCatalogue(state.cataloguePage - 1));
  $("#catalogueMoreBtn").addEventListener("click", () => searchCatalogue(state.cataloguePage + 1));
  $("#specialsToggle").addEventListener("click", () => {
    setSpecialsOpen($("#specialsToggle").getAttribute("aria-expanded") !== "true");
  });
  $("#productDetailsCloseBtn").addEventListener("click", closeProductDetails);
  $("#productDetailsDialog").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeProductDetails();
  });
  $("#productDetailsDialog").addEventListener("close", () => {
    lastProductDetailsTrigger?.focus?.();
    lastProductDetailsTrigger = null;
  });
  document.querySelectorAll('a[href="#specials"]').forEach((link) => {
    link.addEventListener("click", () => setSpecialsOpen(true));
  });
  $("#specialsRefreshBtn").addEventListener("click", loadSpecials);
  $("#specialsRetailer").addEventListener("change", loadSpecials);
  $("#maxResultsInput").addEventListener("change", () => scheduleBasketScan());
  $("#storeToggles").addEventListener("change", () => scheduleBasketScan());
  $("#itemsBody").addEventListener("input", (event) => {
    if (event.target.matches('[data-field="quantity"]')) scheduleBasketScan(650);
  });
  $("#itemsBody").addEventListener("click", (event) => {
    const removeId = event.target.dataset.remove;
    if (!removeId) return;
    readItemsFromDom();
    state.items = state.items.filter((item) => item.id !== removeId);
    renderItems();
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
  state.items = Array.isArray(saved.items) ? saved.items : [];
  state.settings = saved.settings || {
    maxResultsPerStore: 5,
    stores: Object.fromEntries(defaultStores.map((store) => [store.id, true])),
  };
  delete state.settings.location;
  state.stores = defaultStores;
  state.latest = saved.latest || null;
  importSharedBasket();
  renderStores();
  renderLocation();
  renderItems();
  renderResults();
  updateSummary();
  wireEvents();
  if (state.latest?.createdAt) {
    setText("#scanStatus", `Updated ${new Date(state.latest.createdAt).toLocaleString()}`);
  } else if (state.items.length) {
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
    navigator.serviceWorker
      .register("./service-worker.js?v=31", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {});
  });
}
