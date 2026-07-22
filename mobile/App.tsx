import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import {
  CatalogueProduct,
  CatalogueRequestResponse,
  CatalogueResponse,
  getDefaultApiUrl,
  GroceryItem,
  ItemScan,
  requestJson,
  ScanEntry,
  SpecialOffer,
  SpecialsResponse,
  Settings,
  Store,
} from "./src/api";
import { money, niceDate } from "./src/format";
import {
  clearLocalTrends,
  flushBasketEvents,
  loadSmartSettings,
  loadUsuals,
  recordLocalTrend,
  retryPendingBasketDeletion,
  saveSmartSettings,
  setBasketSharing,
  SmartSettings,
  SmartUsual,
  trackBasketEvent,
} from "./src/smartBasket";

const storageKey = "randbasket-device-state-v1";
const legalLinks = {
  privacy: "https://randbasket.co.za/privacy.html",
  terms: "https://randbasket.co.za/terms.html",
  support: "https://randbasket.co.za/support.html",
};

const blankLinks: Record<string, string> = {
  "pick-n-pay": "",
  checkers: "",
  woolworths: "",
  spar: "",
  makro: "",
};

const defaultSettings: Settings = {
  maxResultsPerStore: 6,
  stores: {
    "pick-n-pay": true,
    checkers: true,
    woolworths: true,
    spar: true,
    makro: true,
  },
};

type AppView = "basket" | "specials" | "scanning" | "results";

const scanSteps = [
  "Saving your basket",
  "Reading cached catalogue prices",
  "Checking missing prices",
  "Normalising pack sizes",
  "Preparing your fresh results",
];

function locationQuery(settings: Settings) {
  const location = settings.location;
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return "";
  return `&latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}`;
}

function settingsForStorage(settings: Settings): Settings {
  const { location: _sessionLocation, ...savedSettings } = settings;
  return savedSettings;
}

export default function App() {
  const apiUrl = getDefaultApiUrl();
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [stores, setStores] = useState<Store[]>([
    { id: "pick-n-pay", name: "Pick n Pay" },
    { id: "checkers", name: "Checkers" },
    { id: "woolworths", name: "Woolworths" },
    { id: "spar", name: "SPAR" },
    { id: "makro", name: "Makro" },
  ]);
  const [latest, setLatest] = useState<ScanEntry | null>(null);
  const [view, setView] = useState<AppView>("basket");
  const [hydrated, setHydrated] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStepIndex, setScanStepIndex] = useState(0);
  const [scanStatusMessage, setScanStatusMessage] = useState(scanSteps[0]);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [catalogueResults, setCatalogueResults] = useState<CatalogueProduct[]>([]);
  const [catalogueRetailerMatches, setCatalogueRetailerMatches] = useState<CatalogueProduct[]>([]);
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueHasMore, setCatalogueHasMore] = useState(false);
  const [lastRequestedQuery, setLastRequestedQuery] = useState("");
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [status, setStatus] = useState("Loading your saved basket...");
  const [specials, setSpecials] = useState<SpecialOffer[]>([]);
  const [specialsLoading, setSpecialsLoading] = useState(false);
  const [smartSettings, setSmartSettings] = useState<SmartSettings>({ personalise: true, shareInsights: false });
  const [usuals, setUsuals] = useState<SmartUsual[]>([]);
  const [smartStatus, setSmartStatus] = useState("Your shopping patterns stay on this phone.");

  const bestBasket = useMemo(() => {
    if (!latest?.bestBasketStoreId) return null;
    return latest.basketTotals[latest.bestBasketStoreId] || null;
  }, [latest]);

  const enabledStoreCount = useMemo(() => {
    return stores.filter((store) => settings.stores?.[store.id] !== false).length;
  }, [settings.stores, stores]);

  const scanWorkCount = Math.max(1, items.length * Math.max(1, enabledStoreCount));

  async function openWebsite(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Link unavailable", "Please visit randbasket.co.za for RandBasket support and policies.");
    }
  }

  async function recordMobileActivity(
    eventType: "basket_add" | "basket_quantity_increase" | "basket_quantity_decrease" | "basket_remove",
    item: GroceryItem,
    quantity: number,
    addedAmount = 0,
  ) {
    if (addedAmount > 0) await recordLocalTrend(item, addedAmount);
    setUsuals(await loadUsuals());
    await trackBasketEvent(apiUrl, eventType, item, quantity);
  }

  useEffect(() => {
    Animated.timing(progressAnim, {
      duration: 350,
      toValue: scanProgress,
      useNativeDriver: false,
    }).start();
  }, [progressAnim, scanProgress]);

  useEffect(() => {
    if (!hydrated || scanning) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setAutoSaveStatus("Saving on this device...");
      saveAll(items, settings, true)
        .then(() => setAutoSaveStatus("Saved"))
        .catch(() => setAutoSaveStatus("Not saved"));
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [hydrated, items, scanning, settings]);

  useEffect(() => {
    async function loadDeviceState() {
      try {
        const saved = await AsyncStorage.getItem(storageKey);
        let savedSettings = defaultSettings;
        if (saved) {
          const payload = JSON.parse(saved) as { items?: GroceryItem[]; settings?: Settings; latest?: ScanEntry | null };
          setItems(payload.items || []);
          savedSettings = settingsForStorage(payload.settings || defaultSettings);
          setSettings(savedSettings);
          setLatest(payload.latest || null);
        }
        const loadedSmartSettings = await loadSmartSettings();
        setSmartSettings(loadedSmartSettings);
        setUsuals(await loadUsuals());
        if (loadedSmartSettings.shareInsights) void flushBasketEvents(apiUrl).catch(() => {});
        else void retryPendingBasketDeletion(apiUrl);
        if (!savedSettings.locationPermission) {
          setTimeout(() => {
            Alert.alert(
              "Use your shopping location?",
              "SPAR and other grocers can show different prices by branch. RandBasket uses your approximate location only for searches and price checks while the app is open. We do not save your coordinates, create a location history, or track you in the background.",
              [
                { text: "Not now", style: "cancel", onPress: () => setSettings((current) => ({ ...current, locationPermission: "declined" })) },
                { text: "Use location", onPress: () => void requestShopperLocation() },
              ],
            );
          }, 500);
        }
        setStatus("Ready to compare current catalogue prices.");
      } catch {
        setStatus("Ready to compare current catalogue prices.");
      } finally {
        setHydrated(true);
      }
    }
    void loadDeviceState();
  }, []);

  async function loadState() {
    setLoading(true);
    setStatus("Refreshing the catalogue connection...");
    try {
      await requestJson<{ ok: boolean }>(apiUrl, "/v1/health");
      setStatus("Connected. Your basket stays saved on this phone.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect");
    } finally {
      setLoading(false);
    }
  }

  async function saveAll(nextItems = items, nextSettings = settings, silent = false) {
    await AsyncStorage.setItem(storageKey, JSON.stringify({ items: nextItems, settings: settingsForStorage(nextSettings), latest }));
    if (!silent) {
      setAutoSaveStatus("Saved");
    }
  }

  async function requestShopperLocation() {
    setLocationLoading(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setSettings((current) => ({ ...current, locationPermission: "denied", location: undefined }));
        Alert.alert("Location not shared", "RandBasket will continue using national fallback prices.");
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setSettings((previous) => ({
        ...previous,
        locationPermission: "granted",
        location: {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
          accuracy: current.coords.accuracy || undefined,
          updatedAt: new Date().toISOString(),
        },
      }));
      setStatus("Location enabled for nearby store pricing.");
    } catch {
      setSettings((current) => ({ ...current, locationPermission: "unavailable" }));
      Alert.alert("Location unavailable", "RandBasket could not determine your location. National prices will still work.");
    } finally {
      setLocationLoading(false);
    }
  }

  async function scanPrices() {
    if (items.length === 0) {
      Alert.alert("Basket is empty", "Add at least one grocery item before scanning prices.");
      return;
    }
    setScanning(true);
    setView("scanning");
    setScanProgress(8);
    setScanStepIndex(0);
    setScanStatusMessage("Saving your basket");
    setStatus("Saving basket...");
    try {
      await saveAll();
      setScanProgress(35);
      setScanStepIndex(1);
      setScanStatusMessage("Reading cached catalogue prices");
      setStatus("Checking cached catalogue prices...");
      const entry = await requestJson<ScanEntry>(apiUrl, "/api/scan/catalogue", {
        method: "POST",
        body: JSON.stringify({ items, settings }),
      });
      setScanProgress(100);
      setScanStepIndex(scanSteps.length - 1);
      setScanStatusMessage("Catalogue price check complete");
      setLatest(entry);
      await AsyncStorage.setItem(storageKey, JSON.stringify({ items, settings: settingsForStorage(settings), latest: entry }));
      setStatus(`Updated ${niceDate(entry.createdAt)}`);
      setView("results");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Scan failed");
      setView("basket");
    } finally {
      setScanning(false);
    }
  }

  async function searchCatalogue(page = 1) {
    const query = catalogueSearch.trim();
    if (!query) {
      setCatalogueResults([]);
      Alert.alert("Search for a product", "Type the grocery item you want to compare.");
      return;
    }
    setCatalogueLoading(true);
    try {
      const payload = await requestJson<CatalogueResponse>(
        apiUrl,
        `/api/catalogue?q=${encodeURIComponent(query)}&perRetailer=5&page=${page}${locationQuery(settings)}`,
      );
      setCatalogueResults(payload.products || []);
      setCatalogueRetailerMatches(payload.retailerMatches || []);
      setCataloguePage(payload.page || page);
      setCatalogueHasMore(Boolean(payload.hasMore));
      if (payload.products?.length) {
        setStatus(`Showing page ${payload.page || page} of catalogue matches`);
        return;
      }
      if (page > 1) {
        setStatus("No more catalogue matches.");
        return;
      }
      setStatus("No catalogue matches yet. Starting background discovery...");
      if (query && query.toLowerCase() !== lastRequestedQuery.toLowerCase()) {
        await requestMissingCatalogueItem(query, true);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Catalogue search failed");
    } finally {
      setCatalogueLoading(false);
    }
  }

  async function loadSpecials() {
    setSpecialsLoading(true);
    try {
      const payload = await requestJson<SpecialsResponse>(apiUrl, `/v1/specials?limit=30${locationQuery(settings)}`);
      setSpecials(payload.specials || []);
      setStatus(payload.specials?.length ? "Showing current verified catalogue specials." : "No verified specials are available yet.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load specials");
    } finally {
      setSpecialsLoading(false);
    }
  }

  async function requestMissingCatalogueItem(queryOverride?: string, silent = false) {
    const query = (queryOverride || catalogueSearch).trim();
    if (!query) {
      Alert.alert("Search first", "Type the product you want us to add.");
      return;
    }
    try {
      const payload = await requestJson<CatalogueRequestResponse>(apiUrl, "/api/catalogue/request", {
        method: "POST",
        body: JSON.stringify({ query, name: query, source: "mobile" }),
      });
      setLastRequestedQuery(query);
      const requestStatus = payload.request?.status || "queued";
      setStatus(`${query} discovery ${requestStatus}. Check again in a few minutes.`);
      if (!silent) {
        Alert.alert("Discovery started", `${query} is being searched in the background. Try the search again in a few minutes.`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save request");
    }
  }

  function addCatalogueProduct(product: CatalogueProduct, keepResults = false) {
    const links: Record<string, string> = { ...blankLinks };
    product.stores.forEach((store) => {
      if (store.url) links[store.storeId] = store.url;
    });
    const selectedStore = product.stores.find((store) => store.price != null) || product.stores[0];
    const item: GroceryItem = {
        id: `${product.id}-${Date.now()}`,
        name: product.canonicalName,
        query: product.canonicalName,
        comparisonQuery: product.canonicalName,
        targetSize: product.targetSize || "",
        quantity: 1,
        category: product.category || "",
        links,
        selectedProductId: product.id,
        selectedProductName: selectedStore?.productName || product.canonicalName,
        selectedStoreId: selectedStore?.storeId || "",
        selectedStoreName: selectedStore?.storeName || "",
        selectedPrice: selectedStore?.price ?? null,
      };
    setItems((current) => [...current, item]);
    void recordMobileActivity("basket_add", item, 1, 1);
    if (!keepResults) {
      setCatalogueSearch("");
      setCatalogueResults([]);
      setCatalogueRetailerMatches([]);
      setCataloguePage(1);
      setCatalogueHasMore(false);
    }
    setStatus(`${product.canonicalName} added to basket`);
  }

  function addRetailerComparison(matches: CatalogueProduct[]) {
    const links: Record<string, string> = { ...blankLinks };
    matches.forEach((product) => {
      product.stores.forEach((store) => {
        if (store.url && !links[store.storeId]) links[store.storeId] = store.url;
      });
    });
    const name = catalogueSearch.trim();
    const selectedProduct = matches[0];
    const selectedStore = selectedProduct?.stores[0];
    const item: GroceryItem = {
        id: `catalogue-${Date.now()}`,
        name,
        query: name,
        comparisonQuery: name,
        targetSize: "",
        quantity: 1,
        category: "",
        links,
        selectedProductId: selectedProduct?.id || "",
        selectedProductName: selectedStore?.productName || name,
        selectedStoreId: selectedStore?.storeId || "",
        selectedStoreName: selectedStore?.storeName || "",
        selectedPrice: selectedStore?.price ?? null,
      };
    setItems((current) => [...current, item]);
    void recordMobileActivity("basket_add", item, 1, 1);
    setCatalogueSearch("");
    setCatalogueResults([]);
    setCatalogueRetailerMatches([]);
    setCataloguePage(1);
    setCatalogueHasMore(false);
    setStatus(`${name} added to basket`);
  }

  function updateItem(id: string, patch: Partial<GroceryItem>) {
    const existing = items.find((item) => item.id === id);
    const normalizedPatch = patch.quantity == null ? patch : { ...patch, quantity: Math.max(1, Math.floor(Number(patch.quantity) || 1)) };
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...normalizedPatch } : item)));
    if (existing && normalizedPatch.quantity != null && normalizedPatch.quantity !== existing.quantity) {
      const nextItem = { ...existing, ...normalizedPatch };
      void recordMobileActivity(
        normalizedPatch.quantity > existing.quantity ? "basket_quantity_increase" : "basket_quantity_decrease",
        nextItem,
        normalizedPatch.quantity,
        Math.max(0, normalizedPatch.quantity - existing.quantity),
      );
    }
  }

  function removeItem(id: string) {
    const item = items.find((entry) => entry.id === id);
    if (item) void recordMobileActivity("basket_remove", item, 0);
    setItems((current) => current.filter((entry) => entry.id !== id));
  }

  async function togglePersonalisation(value: boolean) {
    const next = { ...smartSettings, personalise: value };
    setSmartSettings(next);
    await saveSmartSettings(next);
    setUsuals(value ? await loadUsuals() : []);
    setSmartStatus(value ? "Smart shortcuts are learning on this phone." : "Personalised shortcuts are paused.");
  }

  async function toggleBasketSharing(value: boolean) {
    setSmartSettings((current) => ({ ...current, shareInsights: value }));
    setSmartStatus(value ? "Enabling anonymous basket activity..." : "Deleting anonymous basket activity...");
    try {
      await setBasketSharing(apiUrl, value);
      setSmartStatus(value
        ? "Anonymous basket activity is enabled. You can switch it off at any time."
        : "Anonymous basket activity has been switched off and deleted.");
    } catch {
      setSmartSettings((current) => ({ ...current, shareInsights: false }));
      await saveSmartSettings({ ...smartSettings, shareInsights: false });
      setSmartStatus(value
        ? "Anonymous basket activity could not be enabled."
        : "Sharing is off. Server deletion is pending and will retry when you are online.");
    }
  }

  function toggleStore(storeId: string, value: boolean) {
    setSettings((current) => ({
      ...current,
      stores: { ...(current.stores || {}), [storeId]: value },
    }));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.safe}>
        <ScrollView contentContainerStyle={styles.page}>
          <View style={styles.hero}>
            <Text style={styles.kicker}>South African grocery value</Text>
            <Text style={styles.title}>Grocery Price Checker</Text>
            <Text style={styles.subtitle}>Compare your real basket across Pick n Pay, Checkers, Woolworths, SPAR, and Makro.</Text>
          </View>

          <View style={styles.panel}>
            <View style={styles.row}>
              <Button disabled={loading} label={loading ? "Checking..." : "Check connection"} onPress={loadState} />
              <Text style={styles.status}>{status}</Text>
            </View>
            {hydrated ? <Text style={styles.saveStatus}>Basket: {autoSaveStatus || "Saved on this phone"}</Text> : null}
          </View>

          {view !== "scanning" ? (
            <View style={styles.tabRow}>
              <Pressable onPress={() => setView("basket")} style={[styles.tab, view === "basket" && styles.activeTab]}>
                <Text style={[styles.tabText, view === "basket" && styles.activeTabText]}>Basket</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setView("specials");
                  if (!specials.length) void loadSpecials();
                }}
                style={[styles.tab, view === "specials" && styles.activeTab]}
              >
                <Text style={[styles.tabText, view === "specials" && styles.activeTabText]}>Specials</Text>
              </Pressable>
              <Pressable
                disabled={!latest}
                onPress={() => setView("results")}
                style={[styles.tab, view === "results" && styles.activeTab, !latest && styles.disabledTab]}
              >
                <Text style={[styles.tabText, view === "results" && styles.activeTabText]}>Results</Text>
              </Pressable>
            </View>
          ) : null}

          {view === "scanning" ? (
            <ScanProgressPanel
              animatedValue={progressAnim}
              itemCount={items.length}
              progress={scanProgress}
              step={scanSteps[scanStepIndex]}
              statusMessage={scanStatusMessage}
              storeCount={enabledStoreCount}
              workCount={scanWorkCount}
            />
          ) : null}

          {view === "basket" ? (
            <>
              <View style={styles.summaryGrid}>
                <Metric label="Basket items" value={`${items.length}`} />
                <Metric label="Retailers enabled" value={`${enabledStoreCount}`} />
                <Metric label="Last check" value={latest ? niceDate(latest.createdAt) : "Not yet"} />
              </View>

              <View style={styles.panel}>
                <Text style={styles.sectionTitle}>Smart Basket</Text>
                <View style={styles.smartRow}>
                  <View style={styles.flex}>
                    <Text style={styles.storeName}>Personalise shortcuts on this phone</Text>
                    <Text style={styles.smartCopy}>Learns which groceries you add most often. This profile never leaves this phone.</Text>
                  </View>
                  <Switch value={smartSettings.personalise} onValueChange={(value) => void togglePersonalisation(value)} />
                </View>
                <View style={styles.smartRow}>
                  <View style={styles.flex}>
                    <Text style={styles.storeName}>Share anonymous basket activity</Text>
                    <Text style={styles.smartCopy}>Optional. Shares product, retailer, quantity and listed price. No name, email or location.</Text>
                  </View>
                  <Switch value={smartSettings.shareInsights} onValueChange={(value) => void toggleBasketSharing(value)} />
                </View>
                <Text style={styles.smartCopy}>Anonymous activity is kept for up to 365 days. An add is shopping intent, not proof of purchase.</Text>
                <Text style={styles.saveStatus}>{smartStatus}</Text>
                <Button label="Clear Smart Basket data" variant="quiet" onPress={() => void clearLocalTrends().then(async () => { setUsuals([]); setSmartStatus("On-device Smart Basket history cleared."); })} />
              </View>

              <View style={styles.panel}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Stores</Text>
                  <Button
                    disabled={locationLoading}
                    label={locationLoading ? "Locating..." : settings.location ? "Update location" : "Use location"}
                    variant="quiet"
                    onPress={() => void requestShopperLocation()}
                  />
                </View>
                <Text style={styles.saveStatus}>
                  {settings.location ? "Nearby store pricing enabled" : "National fallback prices"}
                </Text>
                <View style={styles.storeList}>
                  {stores.map((store) => (
                    <View key={store.id} style={styles.storeToggle}>
                      <Text style={styles.storeName}>{store.name}</Text>
                      <Switch
                        onValueChange={(value) => toggleStore(store.id, value)}
                        value={settings.stores?.[store.id] !== false}
                      />
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.panel}>
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Basket</Text>
                  <Button
                    disabled={catalogueLoading}
                    label={catalogueLoading ? "Searching..." : "Search"}
                    variant="quiet"
                    onPress={searchCatalogue}
                  />
                </View>
                <Text style={styles.label}>Add groceries from catalogue</Text>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={(value) => {
                    setCatalogueSearch(value);
                    if (!value.trim()) {
                      setCatalogueResults([]);
                      setCatalogueRetailerMatches([]);
                      setCataloguePage(1);
                      setCatalogueHasMore(false);
                    }
                  }}
                  onSubmitEditing={() => searchCatalogue()}
                  placeholder="Search milk, bread, mince, potatoes..."
                  style={styles.input}
                  value={catalogueSearch}
                />
                {usuals.length ? (
                  <View style={styles.usualsWrap}>
                    <Text style={styles.label}>Your usuals</Text>
                    <View style={styles.usualsRow}>
                      {usuals.map((usual) => (
                        <Pressable key={usual.query} onPress={() => setCatalogueSearch(usual.query)} style={styles.usualChip}>
                          <Text style={styles.usualChipText}>{usual.name}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : null}
                {catalogueRetailerMatches.length > 0 ? (
                  <RetailerMatchComparison
                    matches={catalogueRetailerMatches}
                    query={catalogueSearch.trim()}
                    onAddProduct={(product) => addCatalogueProduct(product, true)}
                  />
                ) : null}
                {catalogueResults.length > 0 && catalogueRetailerMatches.length === 0 ? (
                  <View style={styles.catalogueList}>
                    {catalogueResults.map((product) => (
                      <CatalogueResult key={product.id} product={product} onAdd={() => addCatalogueProduct(product)} />
                    ))}
                    <View style={styles.paginationRow}>
                      <Button disabled={catalogueLoading || cataloguePage <= 1} label="Previous" variant="quiet" onPress={() => searchCatalogue(cataloguePage - 1)} />
                      <Text style={styles.paginationText}>Page {cataloguePage}</Text>
                      <Button disabled={catalogueLoading || !catalogueHasMore} label="More" variant="quiet" onPress={() => searchCatalogue(cataloguePage + 1)} />
                    </View>
                  </View>
                ) : null}
                {catalogueSearch.trim() && !catalogueLoading && catalogueResults.length === 0 ? (
                  <View style={styles.requestBox}>
                    <Text style={styles.requestText}>
                      No verified catalogue match yet for "{catalogueSearch.trim()}". A background search will keep looking and add matches when it finds them.
                    </Text>
                    <Button label="Run discovery again" variant="quiet" onPress={() => requestMissingCatalogueItem()} />
                  </View>
                ) : null}
                {items.length === 0 ? (
                  <Text style={styles.empty}>Connect to your price server or add your first item.</Text>
                ) : (
                  items.map((item) => (
                    <ItemCard
                      item={item}
                      key={item.id}
                      onChange={updateItem}
                      onRemove={removeItem}
                    />
                  ))
                )}
              </View>

              <Pressable disabled={scanning || items.length === 0} onPress={scanPrices} style={[styles.scanButton, (scanning || items.length === 0) && styles.disabled]}>
                <Text style={styles.scanText}>Scan Fresh Prices</Text>
              </Pressable>
            </>
          ) : null}

          {view === "results" ? (
            <View style={styles.panel}>
              <View style={styles.sectionHead}>
                <View style={styles.flex}>
                  <Text style={styles.sectionTitle}>Fresh price check</Text>
                  <Text style={styles.resultMeta}>{latest ? `Updated ${niceDate(latest.createdAt)}` : "No scan yet"}</Text>
                </View>
                <Button label="Edit" variant="quiet" onPress={() => setView("basket")} />
              </View>
              {bestBasket ? (
                <View style={styles.winnerBanner}>
                  <Text style={styles.winnerLabel}>Best full basket</Text>
                  <Text style={styles.winnerValue}>{bestBasket.storeName} {money(bestBasket.total)}</Text>
                </View>
              ) : null}
              <BasketTotals latest={latest} />
              {latest ? latest.scans.map((scan) => <ResultCard key={scan.itemId} scan={scan} />) : <Text style={styles.empty}>No scan yet.</Text>}
              <Pressable disabled={scanning || items.length === 0} onPress={scanPrices} style={[styles.scanButton, scanning && styles.disabled]}>
                <Text style={styles.scanText}>Rescan Prices</Text>
              </Pressable>
            </View>
          ) : null}

          {view === "specials" ? (
            <View style={styles.panel}>
              <View style={styles.sectionHead}>
                <View style={styles.flex}>
                  <Text style={styles.sectionTitle}>Catalogues & Specials</Text>
                  <Text style={styles.resultMeta}>Verified offers already count in Price Checker totals.</Text>
                </View>
                <Button disabled={specialsLoading} label={specialsLoading ? "Loading..." : "Refresh"} variant="quiet" onPress={loadSpecials} />
              </View>
              {specialsLoading && !specials.length ? <ActivityIndicator color="#17694c" /> : null}
              {specials.map((special) => (
                <SpecialCard
                  key={special.id}
                  special={special}
                  onAdd={() => addCatalogueProduct({
                    id: special.productId,
                    canonicalName: special.canonicalName,
                    category: special.category,
                    targetSize: special.targetSize,
                    stores: [special.store],
                  })}
                />
              ))}
              {!specialsLoading && !specials.length ? <Text style={styles.empty}>No verified specials are available yet.</Text> : null}
            </View>
          ) : null}

          <View style={styles.footer}>
            <Text style={styles.footerBrand}>RandBasket</Text>
            <Text style={styles.footerNotice}>
              Prices and availability can vary by location, retailer, stock and promotion. Confirm the final details with the retailer before buying.
            </Text>
            <View style={styles.footerLinks}>
              <Pressable accessibilityRole="link" onPress={() => void openWebsite(legalLinks.privacy)}>
                <Text style={styles.footerLink}>Privacy</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void openWebsite(legalLinks.terms)}>
                <Text style={styles.footerLink}>Terms</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => void openWebsite(legalLinks.support)}>
                <Text style={styles.footerLink}>Support</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Button({
  disabled,
  label,
  onPress,
  variant = "solid",
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant?: "solid" | "quiet";
}) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.button, variant === "quiet" && styles.quietButton]}>
      <Text style={[styles.buttonText, variant === "quiet" && styles.quietButtonText]}>{label}</Text>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function CatalogueResult({ product, onAdd }: { product: CatalogueProduct; onAdd: () => void }) {
  const imageUrl = product.stores.find((store) => store.imageUrl)?.imageUrl;
  const retailerOrder = ["pick-n-pay", "checkers", "woolworths", "spar", "makro"];
  const matchesByRetailer = new Map<string, CatalogueProduct["stores"][number]>();
  product.stores.forEach((store) => {
    const current = matchesByRetailer.get(store.storeId);
    const currentPrice = current?.price ?? Number.POSITIVE_INFINITY;
    const nextPrice = store.price ?? Number.POSITIVE_INFINITY;
    if (!current || nextPrice < currentPrice) matchesByRetailer.set(store.storeId, store);
  });
  const storeMatches = [...matchesByRetailer.values()].sort(
    (left, right) => retailerOrder.indexOf(left.storeId) - retailerOrder.indexOf(right.storeId),
  );

  return (
    <View style={styles.catalogueItem}>
      <View style={styles.productTop}>
        {imageUrl ? (
          <Image accessibilityLabel={product.canonicalName} resizeMode="contain" source={{ uri: imageUrl }} style={styles.productImage} />
        ) : (
          <View style={[styles.productImage, styles.imagePlaceholder]}>
            <Text style={styles.imagePlaceholderText}>Photo pending</Text>
          </View>
        )}
        <View style={styles.flex}>
          <Text style={styles.catalogueName}>{product.canonicalName}</Text>
          <Text style={styles.catalogueMeta}>{[product.category, product.targetSize].filter(Boolean).join(" - ")}</Text>
        </View>
      </View>
      <View style={styles.retailerPrices}>
        {storeMatches.map((store) => {
          const isSpecial = Boolean(store.promoApplied || (store.regularPrice && store.price && store.regularPrice > store.price));
          return (
            <View key={`${product.id}-${store.storeId}`} style={styles.retailerPriceRow}>
              <View style={styles.flex}>
                <Text style={styles.retailerName}>{store.storeName}</Text>
                {store.promoText ? <Text numberOfLines={2} style={styles.specialText}>{store.promoText}</Text> : null}
              </View>
              <View style={styles.priceColumn}>
                <Text style={[styles.retailerPrice, isSpecial && styles.specialPrice]}>
                  {store.price != null ? money(store.price) : "Price updating"}
                </Text>
                {isSpecial && store.regularPrice ? <Text style={styles.regularPrice}>{money(store.regularPrice)}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      <Button label="Add to basket" onPress={onAdd} />
    </View>
  );
}

function SpecialCard({ special, onAdd }: { special: SpecialOffer; onAdd: () => void }) {
  const store = special.store;
  return (
    <View style={styles.catalogueItem}>
      <View style={styles.productTop}>
        {store.imageUrl ? <Image resizeMode="contain" source={{ uri: store.imageUrl }} style={styles.productImage} /> : null}
        <View style={styles.flex}>
          <Text style={styles.specialBadge}>{special.discountPercent ? `${special.discountPercent}% OFF` : "CATALOGUE SPECIAL"}</Text>
          <Text style={styles.catalogueName}>{store.productName || special.canonicalName}</Text>
          <Text style={styles.catalogueMeta}>{[store.storeName, store.size, special.category].filter(Boolean).join(" · ")}</Text>
          {store.promoText ? <Text style={styles.specialText}>{store.promoText}</Text> : null}
        </View>
        <View style={styles.priceColumn}>
          {store.regularPrice ? <Text style={styles.regularPrice}>{money(store.regularPrice)}</Text> : null}
          <Text style={styles.retailerPrice}>{money(store.price)}</Text>
          {special.saving ? <Text style={styles.savingText}>Save {money(special.saving)}</Text> : null}
        </View>
      </View>
      <Button label="Add special to basket" onPress={onAdd} />
    </View>
  );
}

function RetailerMatchComparison({
  matches,
  onAddProduct,
  query,
}: {
  matches: CatalogueProduct[];
  onAddProduct: (product: CatalogueProduct) => void;
  query: string;
}) {
  const retailerOrder = ["pick-n-pay", "checkers", "woolworths", "spar", "makro"];
  const ordered = [...matches].sort((left, right) => {
    const leftId = left.stores[0]?.storeId || "";
    const rightId = right.stores[0]?.storeId || "";
    return retailerOrder.indexOf(leftId) - retailerOrder.indexOf(rightId);
  });
  return (
    <View style={styles.catalogueItem}>
      <Text style={styles.catalogueName}>Closest retailer matches</Text>
      <Text style={styles.catalogueMeta}>Each store is matched independently for {query}</Text>
      <View style={styles.retailerPrices}>
        {ordered.map((product) => {
          const store = product.stores[0];
          if (!store) return null;
          const tierLabel = ({
            1: "Exact match",
            2: "Equivalent quantity",
            3: "Closest compatible size",
            4: "Related variant",
            5: "Category alternative",
          } as Record<number, string>)[store.matchTier || 5];
          const isSpecial = Boolean(store.promoApplied || (store.regularPrice && store.price && store.regularPrice > store.price));
          return (
            <View key={`${product.id}-${store.storeId}`} style={styles.retailerPriceRow}>
              {store.imageUrl ? <Image resizeMode="contain" source={{ uri: store.imageUrl }} style={styles.retailerThumb} /> : null}
              <View style={styles.flex}>
                <Text style={styles.retailerName}>{store.storeName}</Text>
                <Text style={styles.matchTier}>{tierLabel}</Text>
                <Text numberOfLines={2} style={styles.productName}>{store.productName || product.canonicalName}</Text>
                <Text style={styles.catalogueMeta}>{store.size || product.targetSize || ""}</Text>
                {store.unitsRequired && store.unitsRequired > 1 && store.effectiveTotalPrice != null ? (
                  <Text style={styles.catalogueMeta}>{store.unitsRequired} packs: {money(store.effectiveTotalPrice)}</Text>
                ) : null}
                {store.isAlternative && store.alternativeReason ? <Text style={styles.alternativeText}>{store.alternativeReason}</Text> : null}
                {store.promoText ? <Text numberOfLines={2} style={styles.specialText}>{store.promoText}</Text> : null}
              </View>
              <View style={styles.priceColumn}>
                <Text style={[styles.retailerPrice, isSpecial && styles.specialPrice]}>{store.price != null ? money(store.price) : "Price updating"}</Text>
                {isSpecial && store.regularPrice ? <Text style={styles.regularPrice}>{money(store.regularPrice)}</Text> : null}
                <Button label="Add" variant="quiet" onPress={() => onAddProduct(product)} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ScanProgressPanel({
  animatedValue,
  itemCount,
  progress,
  step,
  statusMessage,
  storeCount,
  workCount,
}: {
  animatedValue: Animated.Value;
  itemCount: number;
  progress: number;
  step: string;
  statusMessage: string;
  storeCount: number;
  workCount: number;
}) {
  const width = animatedValue.interpolate({
    inputRange: [0, 100],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={styles.progressPanel}>
      <View style={styles.progressIcon}>
        <ActivityIndicator color="#17694c" />
      </View>
      <Text style={styles.progressTitle}>Fetching fresh prices</Text>
      <Text style={styles.progressSubtitle}>
        Checking {itemCount} item{itemCount === 1 ? "" : "s"} across {storeCount} retailer{storeCount === 1 ? "" : "s"} from the saved catalogue.
      </Text>
      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, { width }]} />
      </View>
      <View style={styles.progressMetaRow}>
        <Text style={styles.progressStep}>{statusMessage || step}</Text>
        <Text style={styles.progressPercent}>{Math.round(progress)}%</Text>
      </View>
      <Text style={styles.progressHint}>
        Normal scans use cached prices, so they should be quick. Live retailer pages are only needed when refreshing the catalogue.
      </Text>
    </View>
  );
}

function ItemCard({
  item,
  onChange,
  onRemove,
}: {
  item: GroceryItem;
  onChange: (id: string, patch: Partial<GroceryItem>) => void;
  onRemove: (id: string) => void;
}) {
  const linkCount = Object.values({ ...blankLinks, ...(item.links || {}) }).filter(Boolean).length;
  return (
    <View style={styles.itemCard}>
      <View style={styles.itemTop}>
        <TextInput
          onChangeText={(value) => onChange(item.id, { name: value })}
          placeholder="Item name"
          style={[styles.input, styles.itemNameInput]}
          value={item.name}
        />
        <Pressable onPress={() => onRemove(item.id)} style={styles.removeButton}>
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      </View>
      <TextInput
        onChangeText={(value) => onChange(item.id, { query: value })}
        placeholder="Matching phrase"
        style={styles.input}
        value={item.query}
      />
      <View style={styles.twoCols}>
        <TextInput
          onChangeText={(value) => onChange(item.id, { targetSize: value })}
          placeholder="Target size"
          style={[styles.input, styles.flex]}
          value={item.targetSize || ""}
        />
        <TextInput
          keyboardType="number-pad"
          onChangeText={(value) => onChange(item.id, { quantity: Math.max(1, Math.floor(Number(value.replace(/\D/g, "")) || 1)) })}
          placeholder="Qty"
          style={[styles.input, styles.qtyInput]}
          value={String(item.quantity || 1)}
        />
      </View>
      <Text style={styles.linkSummary}>{linkCount} retailer match{linkCount === 1 ? "" : "es"} saved</Text>
    </View>
  );
}

function BasketTotals({ latest }: { latest: ScanEntry | null }) {
  if (!latest) return null;
  return (
    <View style={styles.totals}>
      {Object.values(latest.basketTotals).map((total) => {
        const isBest = latest.bestBasketStoreId === total.storeId;
        return (
          <View key={total.storeId} style={[styles.totalChip, isBest && styles.bestTotal]}>
            <Text style={[styles.totalStore, isBest && styles.bestTotalText]}>{total.storeName}</Text>
            <Text style={[styles.totalValue, isBest && styles.bestTotalText]}>{money(total.total)}</Text>
            {total.missing > 0 ? <Text style={styles.missing}>{total.missing} missing</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

function ResultCard({ scan }: { scan: ItemScan }) {
  return (
    <View style={styles.resultCard}>
      <View style={styles.resultHead}>
        <View style={styles.flex}>
          <Text style={styles.resultTitle}>{scan.name}</Text>
          <Text style={styles.resultMeta}>
            {scan.targetMeasure?.label ? `${scan.targetMeasure.label} target` : scan.query} - qty {scan.quantity}
          </Text>
        </View>
        <Text style={styles.bestBadge}>{scan.bestStoreName || "No match"}</Text>
      </View>
      {scan.results.map((result) => {
        const best = result.storeId === scan.bestStoreId;
        return (
          <View key={result.storeId} style={[styles.priceRow, best && styles.bestPriceRow]}>
            <View style={styles.flex}>
              <Text style={styles.storeName}>{result.storeName}</Text>
              <Text style={styles.productName}>{result.productName || "No readable price"}</Text>
              {result.promoText ? (
                <Text style={[styles.promo, result.promoApplied && styles.promoApplied]}>{result.promoText}</Text>
              ) : null}
              <Text numberOfLines={2} style={styles.urlText}>
                {result.productUrl || result.queryUrl || ""}
              </Text>
            </View>
            <View style={styles.priceBlock}>
              {result.regularPrice && result.regularPrice > (result.price || 0) ? (
                <Text style={styles.wasPrice}>{money(result.regularPrice)}</Text>
              ) : null}
              <Text style={styles.price}>{money(result.lineTotal ?? result.effectivePrice)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f4f2eb",
  },
  page: {
    padding: 18,
    paddingBottom: 40,
    gap: 14,
  },
  hero: {
    backgroundColor: "#124536",
    borderRadius: 8,
    padding: 22,
  },
  kicker: {
    color: "#b8dbc8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  title: {
    color: "#fff",
    fontSize: 31,
    fontWeight: "800",
    marginTop: 6,
  },
  subtitle: {
    color: "#dbe9df",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  panel: {
    backgroundColor: "#fff",
    borderColor: "#ded8ca",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  label: {
    color: "#5d625c",
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    backgroundColor: "#fbfaf6",
    borderColor: "#d6d0c2",
    borderRadius: 7,
    borderWidth: 1,
    color: "#15251e",
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#17694c",
    borderRadius: 7,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  quietButton: {
    backgroundColor: "#edf5ef",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "800",
  },
  quietButtonText: {
    color: "#17694c",
  },
  status: {
    color: "#697168",
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  saveStatus: {
    color: "#697168",
    fontSize: 12,
    fontWeight: "800",
  },
  tabRow: {
    backgroundColor: "#e7e2d5",
    borderRadius: 8,
    flexDirection: "row",
    padding: 4,
  },
  tab: {
    alignItems: "center",
    borderRadius: 6,
    flex: 1,
    minHeight: 42,
    justifyContent: "center",
  },
  activeTab: {
    backgroundColor: "#fff",
  },
  disabledTab: {
    opacity: 0.45,
  },
  tabText: {
    color: "#667064",
    fontSize: 14,
    fontWeight: "900",
  },
  activeTabText: {
    color: "#17694c",
  },
  summaryGrid: {
    gap: 10,
  },
  metric: {
    backgroundColor: "#fff",
    borderColor: "#ded8ca",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  metricLabel: {
    color: "#697168",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#16241e",
    fontSize: 19,
    fontWeight: "800",
    marginTop: 5,
  },
  sectionHead: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#17251f",
    fontSize: 20,
    fontWeight: "800",
  },
  storeList: {
    gap: 6,
  },
  storeToggle: {
    alignItems: "center",
    backgroundColor: "#f7f6f1",
    borderRadius: 7,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 10,
  },
  storeName: {
    color: "#1e2c25",
    fontSize: 15,
    fontWeight: "800",
  },
  smartRow: {
    alignItems: "flex-start",
    backgroundColor: "#f7f6f1",
    borderRadius: 7,
    flexDirection: "row",
    gap: 12,
    padding: 10,
  },
  smartCopy: {
    color: "#697168",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  usualsWrap: {
    gap: 7,
  },
  usualsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  usualChip: {
    backgroundColor: "#edf5ef",
    borderColor: "#c8ddd0",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  usualChipText: {
    color: "#17694c",
    fontSize: 12,
    fontWeight: "800",
  },
  empty: {
    color: "#697168",
    fontSize: 14,
    lineHeight: 20,
  },
  catalogueList: {
    gap: 8,
  },
  paginationRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
  },
  paginationText: {
    color: "#697168",
    fontSize: 13,
    fontWeight: "800",
  },
  catalogueItem: {
    backgroundColor: "#fff",
    borderColor: "#e1dccf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  productTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  productImage: {
    backgroundColor: "#f7f6f1",
    borderRadius: 7,
    height: 86,
    width: 86,
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  imagePlaceholderText: {
    color: "#777d77",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  catalogueName: {
    color: "#17251f",
    fontSize: 15,
    fontWeight: "900",
  },
  catalogueMeta: {
    color: "#697168",
    fontSize: 12,
    marginTop: 2,
  },
  retailerPrices: {
    borderTopColor: "#ece8dd",
    borderTopWidth: 1,
  },
  retailerPriceRow: {
    alignItems: "center",
    borderBottomColor: "#ece8dd",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 54,
    paddingVertical: 8,
  },
  retailerThumb: {
    height: 42,
    width: 42,
  },
  retailerName: {
    color: "#27342e",
    fontSize: 14,
    fontWeight: "800",
  },
  priceColumn: {
    alignItems: "flex-end",
    minWidth: 98,
  },
  retailerPrice: {
    color: "#17251f",
    fontSize: 15,
    fontWeight: "900",
  },
  specialPrice: {
    color: "#b64720",
  },
  regularPrice: {
    color: "#777d77",
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  specialText: {
    color: "#a04422",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  requestBox: {
    backgroundColor: "#fff7e8",
    borderColor: "#edd3a7",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  requestText: {
    color: "#7a541f",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
  itemCard: {
    backgroundColor: "#f8f6ef",
    borderColor: "#e1dccf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 9,
    padding: 10,
  },
  itemTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  itemNameInput: {
    flex: 1,
    fontWeight: "800",
  },
  removeButton: {
    backgroundColor: "#f0ded9",
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  removeText: {
    color: "#99402d",
    fontWeight: "800",
  },
  linkSummary: {
    color: "#697168",
    fontSize: 12,
    fontWeight: "800",
  },
  twoCols: {
    flexDirection: "row",
    gap: 9,
  },
  flex: {
    flex: 1,
  },
  qtyInput: {
    width: 82,
  },
  scanButton: {
    alignItems: "center",
    backgroundColor: "#d85b2a",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 54,
  },
  disabled: {
    opacity: 0.75,
  },
  scanText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "900",
  },
  progressPanel: {
    alignItems: "stretch",
    backgroundColor: "#fff",
    borderColor: "#ded8ca",
    borderRadius: 8,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  progressIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#e7f2e7",
    borderRadius: 999,
    height: 54,
    justifyContent: "center",
    width: 54,
  },
  progressTitle: {
    color: "#17251f",
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  progressSubtitle: {
    color: "#5d625c",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  progressTrack: {
    backgroundColor: "#e7e2d5",
    borderRadius: 999,
    height: 14,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: "#17694c",
    borderRadius: 999,
    height: "100%",
  },
  progressMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  progressStep: {
    color: "#17251f",
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
  },
  progressPercent: {
    color: "#17694c",
    fontSize: 14,
    fontWeight: "900",
  },
  progressHint: {
    backgroundColor: "#f8f6ef",
    borderRadius: 7,
    color: "#697168",
    fontSize: 13,
    lineHeight: 19,
    padding: 12,
    textAlign: "center",
  },
  totals: {
    gap: 8,
  },
  totalChip: {
    backgroundColor: "#f7f6f1",
    borderRadius: 7,
    padding: 11,
  },
  bestTotal: {
    backgroundColor: "#17694c",
  },
  totalStore: {
    color: "#4c554f",
    fontWeight: "800",
  },
  totalValue: {
    color: "#15251e",
    fontSize: 20,
    fontWeight: "900",
    marginTop: 3,
  },
  bestTotalText: {
    color: "#fff",
  },
  missing: {
    color: "#a25d27",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  winnerBanner: {
    backgroundColor: "#17694c",
    borderRadius: 8,
    padding: 14,
  },
  winnerLabel: {
    color: "#d5eadc",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  winnerValue: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  resultCard: {
    borderColor: "#e1dccf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 9,
    padding: 11,
  },
  resultHead: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  resultTitle: {
    color: "#17251f",
    fontSize: 17,
    fontWeight: "900",
  },
  resultMeta: {
    color: "#697168",
    fontSize: 12,
    marginTop: 2,
  },
  bestBadge: {
    backgroundColor: "#e7f2e7",
    borderRadius: 999,
    color: "#17694c",
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  priceRow: {
    backgroundColor: "#faf9f4",
    borderRadius: 7,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  bestPriceRow: {
    backgroundColor: "#edf7ee",
  },
  productName: {
    color: "#425047",
    fontSize: 13,
    marginTop: 2,
  },
  promo: {
    color: "#9c561e",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  promoApplied: {
    color: "#17694c",
  },
  urlText: {
    color: "#778079",
    fontSize: 11,
    marginTop: 4,
  },
  priceBlock: {
    alignItems: "flex-end",
    minWidth: 84,
  },
  wasPrice: {
    color: "#8f968f",
    fontSize: 12,
    textDecorationLine: "line-through",
  },
  price: {
    color: "#16241e",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 2,
  },
  matchTier: {
    alignSelf: "flex-start",
    backgroundColor: "#e8f5ed",
    borderRadius: 9,
    color: "#17694c",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 3,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  alternativeText: {
    color: "#785d38",
    fontSize: 10,
    marginTop: 2,
  },
  specialBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#dfff78",
    borderRadius: 999,
    color: "#124536",
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 5,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  savingText: {
    color: "#17694c",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 3,
  },
  footer: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  footerBrand: {
    color: "#124536",
    fontSize: 16,
    fontWeight: "900",
  },
  footerNotice: {
    color: "#697168",
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 520,
    textAlign: "center",
  },
  footerLinks: {
    flexDirection: "row",
    gap: 22,
  },
  footerLink: {
    color: "#17694c",
    fontSize: 13,
    fontWeight: "900",
    textDecorationLine: "underline",
  },
});
