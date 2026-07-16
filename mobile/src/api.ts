export type Store = {
  id: string;
  name: string;
  notes?: string;
};

declare const process: {
  env: Record<string, string | undefined>;
};

export type ItemLinks = Record<string, string>;

export type GroceryItem = {
  id: string;
  name: string;
  query: string;
  targetSize?: string;
  quantity: number;
  category?: string;
  links?: ItemLinks;
};

export type CatalogueStoreMatch = {
  storeId: string;
  storeName: string;
  productName: string;
  brand?: string;
  size?: string;
  unit?: string;
  price?: number | null;
  regularPrice?: number | null;
  promoText?: string;
  promoApplied?: boolean;
  imageUrl?: string;
  status?: string;
  ingredients?: string;
  quantity?: string;
  url?: string;
  lastSeenAt?: string;
};

export type CatalogueProduct = {
  id: string;
  canonicalName: string;
  category?: string;
  targetSize?: string;
  searchTerms?: string[];
  stores: CatalogueStoreMatch[];
  score?: number;
};

export type CatalogueResponse = {
  ok: boolean;
  query: string;
  correctedQuery?: string;
  correctionApplied?: boolean;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  semanticSearchApplied?: boolean;
  semanticCandidateCount?: number;
  products: CatalogueProduct[];
  retailerMatches?: CatalogueProduct[];
};

export type SpecialOffer = {
  id: string;
  productId: string;
  canonicalName: string;
  category?: string;
  targetSize?: string;
  saving?: number | null;
  discountPercent?: number | null;
  store: CatalogueStoreMatch;
};

export type SpecialsResponse = {
  ok: boolean;
  page: number;
  pageSize: number;
  hasMore: boolean;
  locationApplied?: boolean;
  specials: SpecialOffer[];
};

export type CatalogueCategory = {
  name: string;
  count: number;
  products: CatalogueProduct[];
};

export type CatalogueCategoriesResponse = {
  ok: boolean;
  categories: CatalogueCategory[];
};

export type CatalogueRequest = {
  id: string;
  query: string;
  name: string;
  source: string;
  status: "queued" | "running" | "complete" | "no-results" | "error" | "requested";
  foundCount?: number;
  publishedCount?: number;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CatalogueRequestResponse = {
  ok: boolean;
  request: CatalogueRequest;
};

export type Settings = {
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    updatedAt?: string;
  };
  locationPermission?: "granted" | "denied" | "declined" | "unavailable";
  maxResultsPerStore: number;
  preferredStore?: string;
  stores: Record<string, boolean>;
};

export type ScanResult = {
  storeId: string;
  storeName: string;
  status: string;
  queryUrl?: string;
  price?: number | null;
  effectivePrice?: number | null;
  normalizedPrice?: number | null;
  lineTotal?: number | null;
  productName?: string | null;
  productUrl?: string | null;
  regularPrice?: number | null;
  savings?: number | null;
  promoText?: string;
  promoApplied?: boolean;
};

export type ItemScan = {
  itemId: string;
  name: string;
  query: string;
  quantity: number;
  category?: string;
  targetSize?: string;
  targetMeasure?: { label?: string } | null;
  results: ScanResult[];
  bestStoreId?: string | null;
  bestStoreName?: string | null;
  bestEffectivePrice?: number | null;
};

export type BasketTotal = {
  storeId: string;
  storeName: string;
  total: number;
  missing: number;
};

export type ScanEntry = {
  id: string;
  createdAt: string;
  scans: ItemScan[];
  basketTotals: Record<string, BasketTotal>;
  bestBasketStoreId?: string | null;
};

export type ScanJob = {
  id: string;
  status: "queued" | "running" | "complete" | "error";
  progress: number;
  completedChecks: number;
  totalChecks: number;
  currentItem?: string;
  currentStore?: string;
  message?: string;
  createdAt?: string;
  updatedAt?: string;
  result?: ScanEntry | null;
  error?: string;
};

export type ScanJobResponse = {
  ok: boolean;
  job: ScanJob;
};

export type AppStatePayload = {
  items: GroceryItem[];
  settings: Settings;
  history: ScanEntry[];
  stores: Store[];
  localUrl?: string;
  mobileUrl?: string;
};

function trimBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "");
}

export async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${trimBaseUrl(baseUrl)}${path}`;
  const extraHeaders = (options.headers || {}) as Record<string, string>;
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...extraHeaders },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload as T;
}

export function getDefaultApiUrl() {
  return process.env.EXPO_PUBLIC_API_URL || "https://api.randbasket.co.za";
}
