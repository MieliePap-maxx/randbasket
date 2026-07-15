import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
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

import {
  AppStatePayload,
  CatalogueProduct,
  CatalogueRequestResponse,
  CatalogueResponse,
  getDefaultApiUrl,
  GroceryItem,
  ItemScan,
  requestJson,
  ScanEntry,
  ScanJobResponse,
  Settings,
  Store,
} from "./src/api";
import { money, niceDate } from "./src/format";

const blankLinks: Record<string, string> = {
  "pick-n-pay": "",
  checkers: "",
  woolworths: "",
};

const defaultSettings: Settings = {
  maxResultsPerStore: 6,
  stores: {
    "pick-n-pay": true,
    checkers: true,
    woolworths: true,
  },
};

type AppView = "basket" | "scanning" | "results";

const scanSteps = [
  "Saving your basket",
  "Reading cached catalogue prices",
  "Checking missing prices",
  "Normalising pack sizes",
  "Preparing your fresh results",
];

function getItemLinkCount(item: GroceryItem) {
  return Object.values({ ...blankLinks, ...(item.links || {}) }).filter(Boolean).length;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function App() {
  const [apiUrl, setApiUrl] = useState(getDefaultApiUrl());
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [stores, setStores] = useState<Store[]>([
    { id: "pick-n-pay", name: "Pick n Pay" },
    { id: "checkers", name: "Checkers" },
    { id: "woolworths", name: "Woolworths" },
  ]);
  const [latest, setLatest] = useState<ScanEntry | null>(null);
  const [view, setView] = useState<AppView>("basket");
  const [hydrated, setHydrated] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [loading, setLoading] = useState(false);
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
  const [status, setStatus] = useState("Enter your price server link, then connect.");

  const bestBasket = useMemo(() => {
    if (!latest?.bestBasketStoreId) return null;
    return latest.basketTotals[latest.bestBasketStoreId] || null;
  }, [latest]);

  const enabledStoreCount = useMemo(() => {
    return stores.filter((store) => settings.stores?.[store.id] !== false).length;
  }, [settings.stores, stores]);

  const scanWorkCount = Math.max(1, items.length * Math.max(1, enabledStoreCount));

  useEffect(() => {
    Animated.timing(progressAnim, {
      duration: 350,
      toValue: scanProgress,
      useNativeDriver: false,
    }).start();
  }, [progressAnim, scanProgress]);

  useEffect(() => {
    if (!hydrated || !apiUrl.trim() || scanning) return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setAutoSaveStatus("Saving...");
      saveAll(items, settings, true)
        .then(() => setAutoSaveStatus("Saved"))
        .catch(() => setAutoSaveStatus("Not saved"));
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [apiUrl, hydrated, items, scanning, settings]);

  async function loadState() {
    if (!apiUrl.trim()) {
      Alert.alert("Price server link needed", "Use the phone link from the desktop app while we are developing.");
      return;
    }
    setLoading(true);
    setStatus("Connecting to price checker...");
    try {
      const payload = await requestJson<AppStatePayload>(apiUrl, "/api/state");
      setItems(payload.items || []);
      setSettings(payload.settings || defaultSettings);
      setStores(payload.stores || stores);
      setLatest(payload.history?.[0] || null);
      setHydrated(true);
      setAutoSaveStatus("Saved");
      setStatus(`Connected to ${payload.mobileUrl || payload.localUrl || apiUrl}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not connect");
    } finally {
      setLoading(false);
    }
  }

  async function saveAll(nextItems = items, nextSettings = settings, silent = false) {
    await requestJson(apiUrl, "/api/items", {
      method: "POST",
      body: JSON.stringify({ items: nextItems }),
    });
    const saved = await requestJson<{ settings: Settings }>(apiUrl, "/api/settings", {
      method: "POST",
      body: JSON.stringify({ settings: nextSettings }),
    });
    if (!silent) {
      setSettings(saved.settings);
      setAutoSaveStatus("Saved");
    }
  }

  async function pollScanJob(jobId: string) {
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const payload = await requestJson<ScanJobResponse>(
        apiUrl,
        `/api/scan/status?id=${encodeURIComponent(jobId)}`,
      );
      const job = payload.job;
      const progress = Number(job.progress || 0);
      setScanProgress(progress);
      setScanStepIndex(Math.min(scanSteps.length - 1, Math.floor((progress / 100) * scanSteps.length)));
      setScanStatusMessage(job.message || `${job.currentStore || "Retailers"} ${job.currentItem || ""}`.trim() || scanSteps[1]);

      if (job.status === "complete" && job.result) {
        return job.result;
      }
      if (job.status === "error") {
        throw new Error(job.error || job.message || "Scan failed");
      }
      await wait(1200);
    }
    throw new Error("The scan is taking too long. Please try again.");
  }

  async function scanPrices() {
    if (!apiUrl.trim()) {
      Alert.alert("Price server link needed", "Connect to your price server first.");
      return;
    }
    if (items.length === 0) {
      Alert.alert("Basket is empty", "Add at least one grocery item before scanning prices.");
      return;
    }
    const unverified = items.filter((item) => getItemLinkCount(item) === 0);
    if (unverified.length > 0) {
      Alert.alert(
        "Catalogue match needed",
        `${unverified[0].name || "This item"} does not have retailer product links yet. Search the catalogue and pick an exact product, or request it if it is missing.`,
      );
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
        body: "{}",
      });
      setScanProgress(100);
      setScanStepIndex(scanSteps.length - 1);
      setScanStatusMessage("Catalogue price check complete");
      setLatest(entry);
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
    if (!apiUrl.trim()) {
      Alert.alert("Price server link needed", "Connect to your price server first.");
      return;
    }
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
        `/api/catalogue?q=${encodeURIComponent(query)}&limit=10&page=${page}`,
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
    setItems((current) => [
      ...current,
      {
        id: `${product.id}-${Date.now()}`,
        name: product.canonicalName,
        query: product.canonicalName,
        targetSize: product.targetSize || "",
        quantity: 1,
        category: product.category || "",
        links,
      },
    ]);
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
    setItems((current) => [
      ...current,
      {
        id: `catalogue-${Date.now()}`,
        name,
        query: name,
        targetSize: "",
        quantity: 1,
        category: "",
        links,
      },
    ]);
    setCatalogueSearch("");
    setCatalogueResults([]);
    setCatalogueRetailerMatches([]);
    setCataloguePage(1);
    setCatalogueHasMore(false);
    setStatus(`${name} added to basket`);
  }

  function updateItem(id: string, patch: Partial<GroceryItem>) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
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
            <Text style={styles.subtitle}>Compare your real basket across Pick n Pay, Checkers, and Woolworths.</Text>
          </View>

          <View style={styles.panel}>
            <Text style={styles.label}>Price server link</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={setApiUrl}
              placeholder="http://192.168.x.x:8765"
              style={styles.input}
              value={apiUrl}
            />
            <View style={styles.row}>
              <Button disabled={loading} label={loading ? "Connecting..." : "Connect"} onPress={loadState} />
              <Text style={styles.status}>{status}</Text>
            </View>
            {hydrated ? <Text style={styles.saveStatus}>Basket sync: {autoSaveStatus || "Watching changes"}</Text> : null}
          </View>

          {view !== "scanning" ? (
            <View style={styles.tabRow}>
              <Pressable onPress={() => setView("basket")} style={[styles.tab, view === "basket" && styles.activeTab]}>
                <Text style={[styles.tabText, view === "basket" && styles.activeTabText]}>Basket</Text>
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
                <View style={styles.sectionHead}>
                  <Text style={styles.sectionTitle}>Stores</Text>
                  <Button label="Save" variant="quiet" onPress={() => saveAll().then(() => setStatus("Saved"))} />
                </View>
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
                      onRemove={(id) => setItems((current) => current.filter((entry) => entry.id !== id))}
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
  const retailerOrder = ["pick-n-pay", "checkers", "woolworths"];
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

function RetailerMatchComparison({
  matches,
  onAddProduct,
  query,
}: {
  matches: CatalogueProduct[];
  onAddProduct: (product: CatalogueProduct) => void;
  query: string;
}) {
  const retailerOrder = ["pick-n-pay", "checkers", "woolworths"];
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
          const isSpecial = Boolean(store.promoApplied || (store.regularPrice && store.price && store.regularPrice > store.price));
          return (
            <View key={`${product.id}-${store.storeId}`} style={styles.retailerPriceRow}>
              {store.imageUrl ? <Image resizeMode="contain" source={{ uri: store.imageUrl }} style={styles.retailerThumb} /> : null}
              <View style={styles.flex}>
                <Text style={styles.retailerName}>{store.storeName}</Text>
                <Text numberOfLines={2} style={styles.productName}>{store.productName || product.canonicalName}</Text>
                <Text style={styles.catalogueMeta}>{store.size || product.targetSize || ""}</Text>
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
          keyboardType="decimal-pad"
          onChangeText={(value) => onChange(item.id, { quantity: Number(value || 1) })}
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
});
