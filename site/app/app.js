const state = {
  items: [],
  settings: {},
  stores: [],
  latest: null,
  pnpProgressTimer: null,
  catalogueResults: [],
  catalogueRetailerMatches: [],
  cataloguePage: 1,
  catalogueHasMore: false,
};

const API_ORIGIN = "https://api.randbasket.co.za";
const STORAGE_KEY = "randbasket-web-state-v1";
const FEEDBACK_EMAIL = "randbasketzar@gmail.com";
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
  $("#itemCount").textContent = state.items.length;
  $("#maxResultsInput").value = state.settings.maxResultsPerStore || 6;

  const latest = state.latest;
  const bestId = latest?.bestBasketStoreId;
  const best = bestId ? latest.basketTotals[bestId] : null;
  $("#bestBasket").textContent = best ? `${best.storeName} ${formatMoney(best.total)}` : "No scan yet";
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
      .map((store) => ({ product, store, comparison: getUnitComparison(product, store) })))
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
  if (state.cataloguePage === 1) {
    matches.sort((left, right) => {
      const suggestedOrder = Number(isBestValue(right)) - Number(isBestValue(left));
      if (suggestedOrder) return suggestedOrder;
      if (left.comparison && right.comparison && left.comparison.dimension === right.comparison.dimension) {
        return left.comparison.unitPrice - right.comparison.unitPrice;
      }
      if (left.comparison && !right.comparison) return -1;
      if (!left.comparison && right.comparison) return 1;
      return comparisonStoreOrder.indexOf(left.store.storeId) - comparisonStoreOrder.indexOf(right.store.storeId);
    });
  }

  matches.forEach((match) => {
    const article = document.createElement("article");
    const { product, store, comparison } = match;
    const isBestPrice = isBestValue(match);
    const isSuggested = state.cataloguePage === 1 && isBestPrice;
    const ranking = comparison ? rankings.get(comparison.dimension) : null;
    const saving = isBestPrice && ranking?.next ? ranking.next - ranking.best : 0;
    article.className = `catalogue-store-result${isBestPrice ? " best-price-result" : ""}`;
    const was = store.regularPrice && store.regularPrice > store.price ? `<span class="was-price">${formatMoney(store.regularPrice)}</span>` : "";
    const special = store.promoText ? `<small class="catalogue-special">${escapeHtml(store.promoText)}</small>` : "";
    const bestPriceBadge = isBestPrice
      ? `<span class="best-price-badge">${isSuggested ? "Suggested - " : ""}Best price per ${comparison.comparisonUnit}${saving > 0 ? ` - ${formatMoney(saving)}/${comparison.comparisonUnit} less` : ""}</span>`
      : "";
    const unitPrice = comparison
      ? `<small class="catalogue-unit-price">${formatMoney(comparison.unitPrice)} / ${comparison.comparisonUnit}</small>`
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
      <div class="catalogue-price">${was}<strong>${formatMoney(store.price)}</strong>${unitPrice}<button type="button" class="catalogue-add-btn">Add to basket</button></div>
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
    const payload = await api(`/v1/catalogue?q=${encodeURIComponent(query)}&limit=10&page=${page}${locationQuery()}`);
    state.catalogueResults = payload.products || [];
    state.catalogueRetailerMatches = payload.retailerMatches || [];
    state.cataloguePage = payload.page || page;
    state.catalogueHasMore = Boolean(payload.hasMore);
    $("#catalogueStatus").textContent = state.catalogueResults.length
      ? `Comparable unit prices for ${query}`
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

function openFeedback() {
  const dialog = $("#feedbackDialog");
  $("#feedbackContext").value = `${window.location.origin}${window.location.pathname}`;
  $("#feedbackStatus").innerHTML = `Prefer email? <a href="mailto:${FEEDBACK_EMAIL}">${FEEDBACK_EMAIL}</a>`;
  if (!dialog.open) dialog.showModal();
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
  button.disabled = true;
  button.textContent = "Sending...";
  status.textContent = "Sending your suggestion to RandBasket...";
  const fields = Object.fromEntries(new FormData(form).entries());
  api("/v1/feedback", {
    method: "POST",
    body: JSON.stringify(fields),
  }).then(() => {
    form.reset();
    status.textContent = "Thank you - your suggestion has been emailed to RandBasket.";
    button.textContent = "Sent";
    window.setTimeout(() => {
      button.textContent = "Send another suggestion";
      button.disabled = false;
    }, 1400);
  }).catch((error) => {
    status.textContent = error.message;
    button.textContent = "Try again";
    button.disabled = false;
  });
}

function wireEvents() {
  $("#addItemBtn").addEventListener("click", addItem);
  $("#saveBtn").addEventListener("click", async () => {
    $("#scanStatus").textContent = "Saving...";
    await saveAll();
    $("#scanStatus").textContent = "Saved";
  });
  $("#scanBtn").addEventListener("click", runScan);
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
  delete state.settings.location;
  state.stores = defaultStores;
  state.latest = saved.latest || null;
  renderStores();
  renderLocation();
  renderItems();
  renderResults();
  updateSummary();
  wireEvents();
  if (window.location.hash === "#suggestions") {
    openFeedback();
  } else if (!state.settings.locationPermission) {
    $("#locationDialog").showModal();
  }
}

init().catch((error) => {
  $("#scanStatus").textContent = error.message;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js?v=18").catch(() => {});
  });
}
