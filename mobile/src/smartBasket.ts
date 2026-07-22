import AsyncStorage from "@react-native-async-storage/async-storage";

import { GroceryItem, requestJson } from "./api";

const profileKey = "randbasket-smart-profile-v1";
const settingsKey = "randbasket-smart-settings-v1";
const clientKey = "randbasket-insights-client-v1";
const queueKey = "randbasket-insights-queue-v1";
const pendingDeleteKey = "randbasket-insights-pending-delete-v1";
export const basketConsentVersion = "basket-insights-v1";

export type SmartSettings = { personalise: boolean; shareInsights: boolean };
export type SmartUsual = {
  name: string;
  query: string;
  category: string;
  targetSize: string;
  addCount: number;
  totalQuantity: number;
  lastAddedAt: string;
};
export type BasketEventType = "basket_add" | "basket_quantity_increase" | "basket_quantity_decrease" | "basket_remove" | "retailer_link_opened";

type BasketEvent = {
  id: string;
  eventType: BasketEventType;
  productId: string;
  productName: string;
  category: string;
  retailerId: string;
  retailerName: string;
  basketItemId: string;
  quantity: number;
  priceCents: number | null;
  occurredAt: string;
};

const retailerWords = /\b(?:pick\s*n\s*pay|pick\s*and\s*pay|pnp|checkers|woolworths|woolies|spar|makro)\b/gi;

function randomId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export async function loadSmartSettings(): Promise<SmartSettings> {
  return { personalise: true, shareInsights: false, ...await readJson<Partial<SmartSettings>>(settingsKey, {}) };
}

export async function saveSmartSettings(settings: SmartSettings) {
  await AsyncStorage.setItem(settingsKey, JSON.stringify(settings));
}

function profileKeyFor(item: GroceryItem) {
  return String(item.comparisonQuery || item.query || item.name || "")
    .toLowerCase().replace(retailerWords, " ").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 160);
}

export async function recordLocalTrend(item: GroceryItem, amount = 1) {
  const settings = await loadSmartSettings();
  if (!settings.personalise || amount <= 0) return;
  const key = profileKeyFor(item);
  if (!key) return;
  const profile = await readJson<Record<string, SmartUsual>>(profileKey, {});
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
  await AsyncStorage.setItem(profileKey, JSON.stringify(trimmed));
}

export async function loadUsuals(limit = 6): Promise<SmartUsual[]> {
  const settings = await loadSmartSettings();
  if (!settings.personalise) return [];
  const profile = await readJson<Record<string, SmartUsual>>(profileKey, {});
  const now = Date.now();
  return Object.values(profile).sort((left, right) => {
    const leftAge = Math.max(0, (now - new Date(left.lastAddedAt).getTime()) / 86400000);
    const rightAge = Math.max(0, (now - new Date(right.lastAddedAt).getTime()) / 86400000);
    return (right.addCount * 12 + Math.max(0, 30 - rightAge)) - (left.addCount * 12 + Math.max(0, 30 - leftAge));
  }).slice(0, limit);
}

export async function clearLocalTrends() {
  await AsyncStorage.removeItem(profileKey);
}

async function getClientId(create = false) {
  let value = await AsyncStorage.getItem(clientKey) || "";
  if (!value && create) {
    value = randomId();
    await AsyncStorage.setItem(clientKey, value);
  }
  return value;
}

function eventFor(eventType: BasketEventType, item: GroceryItem, quantity: number): BasketEvent {
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

export async function flushBasketEvents(apiUrl: string) {
  const settings = await loadSmartSettings();
  const queue = await readJson<BasketEvent[]>(queueKey, []);
  if (!settings.shareInsights || !queue.length) return;
  const clientId = await getClientId(true);
  await requestJson(apiUrl, "/v1/events/basket", {
    method: "POST",
    body: JSON.stringify({ clientId, consentVersion: basketConsentVersion, source: "mobile", events: queue.slice(0, 50) }),
  });
  await AsyncStorage.setItem(queueKey, JSON.stringify(queue.slice(50)));
}

export async function trackBasketEvent(apiUrl: string, eventType: BasketEventType, item: GroceryItem, quantity: number) {
  const settings = await loadSmartSettings();
  if (!settings.shareInsights) return;
  const queue = await readJson<BasketEvent[]>(queueKey, []);
  queue.push(eventFor(eventType, item, quantity));
  await AsyncStorage.setItem(queueKey, JSON.stringify(queue.slice(-200)));
  try { await flushBasketEvents(apiUrl); } catch { /* Retry on the next event or launch. */ }
}

export async function setBasketSharing(apiUrl: string, enabled: boolean) {
  const current = await loadSmartSettings();
  await saveSmartSettings({ ...current, shareInsights: enabled });
  if (enabled) {
    await getClientId(true);
    return;
  }
  const clientId = await getClientId(false);
  await AsyncStorage.removeItem(queueKey);
  if (clientId) {
    await AsyncStorage.setItem(pendingDeleteKey, clientId);
    await requestJson(apiUrl, "/v1/privacy/delete", { method: "POST", body: JSON.stringify({ clientId }) });
    await AsyncStorage.removeItem(pendingDeleteKey);
    await AsyncStorage.removeItem(clientKey);
  }
}

export async function retryPendingBasketDeletion(apiUrl: string) {
  const clientId = await AsyncStorage.getItem(pendingDeleteKey);
  if (!clientId) return true;
  try {
    await requestJson(apiUrl, "/v1/privacy/delete", { method: "POST", body: JSON.stringify({ clientId }) });
    await AsyncStorage.multiRemove([pendingDeleteKey, clientKey]);
    return true;
  } catch {
    return false;
  }
}
