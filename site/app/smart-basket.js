(function attachSmartBasket(global) {
  const PROFILE_KEY = "randbasket-smart-profile-v1";
  const SETTINGS_KEY = "randbasket-smart-settings-v1";
  const CLIENT_KEY = "randbasket-insights-client-v1";
  const QUEUE_KEY = "randbasket-insights-queue-v1";
  const PENDING_DELETE_KEY = "randbasket-insights-pending-delete-v1";
  const CONSENT_VERSION = "basket-insights-v1";
  const retailerWords = /\b(?:pick\s*n\s*pay|pick\s*and\s*pay|pnp|checkers|woolworths|woolies|spar|makro)\b/gi;

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") || fallback; } catch { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be unavailable. */ }
  }

  function settings() {
    return { personalise: true, shareInsights: false, ...read(SETTINGS_KEY, {}) };
  }

  function setSettings(patch) {
    const next = { ...settings(), ...patch };
    write(SETTINGS_KEY, next);
    return next;
  }

  function keyFor(item) {
    return String(item.comparisonQuery || item.query || item.name || "")
      .toLowerCase().replace(retailerWords, " ").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
  }

  function recordLocal(item, amount = 1) {
    if (!settings().personalise || amount <= 0) return;
    const key = keyFor(item);
    if (!key) return;
    const profile = read(PROFILE_KEY, {});
    const current = profile[key] || { addCount: 0, totalQuantity: 0 };
    profile[key] = {
      name: String(item.name || item.query || key).slice(0, 120),
      query: String(item.comparisonQuery || item.query || item.name || key).slice(0, 160),
      category: String(item.category || "").slice(0, 80),
      targetSize: String(item.targetSize || "").slice(0, 60),
      addCount: current.addCount + 1,
      totalQuantity: current.totalQuantity + amount,
      lastAddedAt: new Date().toISOString(),
    };
    const trimmed = Object.fromEntries(Object.entries(profile)
      .sort(([, left], [, right]) => new Date(right.lastAddedAt).getTime() - new Date(left.lastAddedAt).getTime())
      .slice(0, 100));
    write(PROFILE_KEY, trimmed);
  }

  function usuals(limit = 6) {
    if (!settings().personalise) return [];
    const now = Date.now();
    return Object.values(read(PROFILE_KEY, {})).sort((left, right) => {
      const leftAge = Math.max(0, (now - new Date(left.lastAddedAt).getTime()) / 86400000);
      const rightAge = Math.max(0, (now - new Date(right.lastAddedAt).getTime()) / 86400000);
      return (right.addCount * 12 + Math.max(0, 30 - rightAge)) - (left.addCount * 12 + Math.max(0, 30 - leftAge));
    }).slice(0, limit);
  }

  function clearProfile() {
    localStorage.removeItem(PROFILE_KEY);
  }

  function randomId() {
    return global.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  function clientId(create = false) {
    let value = localStorage.getItem(CLIENT_KEY) || "";
    if (!value && create) {
      value = randomId();
      localStorage.setItem(CLIENT_KEY, value);
    }
    return value;
  }

  function eventFor(eventType, item, quantity) {
    const price = Number(item.selectedPrice);
    return {
      id: randomId(),
      eventType,
      productId: item.selectedProductId || "",
      productName: String(item.selectedProductName || item.name || item.query || "Product").slice(0, 240),
      category: item.category || "",
      retailerId: item.selectedStoreId || "",
      retailerName: item.selectedStoreName || "",
      basketItemId: item.id || "",
      quantity: Math.max(0, Math.floor(Number(quantity) || 0)),
      priceCents: Number.isFinite(price) ? Math.max(0, Math.round(price * 100)) : null,
      occurredAt: new Date().toISOString(),
    };
  }

  async function flush(apiOrigin) {
    const current = settings();
    const queue = read(QUEUE_KEY, []);
    if (!current.shareInsights || !queue.length || !navigator.onLine) return false;
    const id = clientId(true);
    const response = await fetch(`${apiOrigin}/v1/events/basket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: id, consentVersion: CONSENT_VERSION, source: "web", events: queue.slice(0, 50) }),
    });
    if (!response.ok) throw new Error("Anonymous basket activity could not be sent");
    write(QUEUE_KEY, queue.slice(50));
    if (read(QUEUE_KEY, []).length) return flush(apiOrigin);
    return true;
  }

  function track(apiOrigin, eventType, item, quantity) {
    if (!settings().shareInsights) return;
    const queue = read(QUEUE_KEY, []);
    queue.push(eventFor(eventType, item, quantity));
    write(QUEUE_KEY, queue.slice(-200));
    void flush(apiOrigin).catch(() => {});
  }

  async function setSharing(apiOrigin, enabled) {
    const existingId = clientId(false);
    setSettings({ shareInsights: Boolean(enabled) });
    if (enabled) {
      clientId(true);
      return;
    }
    localStorage.removeItem(QUEUE_KEY);
    if (existingId) {
      localStorage.setItem(PENDING_DELETE_KEY, existingId);
      const response = await fetch(`${apiOrigin}/v1/privacy/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: existingId }),
      });
      if (!response.ok && response.status !== 503) throw new Error("Could not delete anonymous basket activity");
      localStorage.removeItem(PENDING_DELETE_KEY);
      localStorage.removeItem(CLIENT_KEY);
    }
  }

  async function retryDeletion(apiOrigin) {
    const pendingId = localStorage.getItem(PENDING_DELETE_KEY) || "";
    if (!pendingId) return true;
    const response = await fetch(`${apiOrigin}/v1/privacy/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: pendingId }),
    });
    if (!response.ok && response.status !== 503) return false;
    localStorage.removeItem(PENDING_DELETE_KEY);
    localStorage.removeItem(CLIENT_KEY);
    return true;
  }

  global.RandBasketSmart = {
    CONSENT_VERSION,
    settings,
    setSettings,
    recordLocal,
    usuals,
    clearProfile,
    track,
    flush,
    setSharing,
    retryDeletion,
  };
})(window);
