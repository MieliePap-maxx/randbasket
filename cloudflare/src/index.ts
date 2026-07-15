export interface Env {
  APP_ORIGIN: string;
  DB: D1Database;
  FEEDBACK_EMAIL: {
    send(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
    }): Promise<{ messageId?: string }>;
  };
  FEEDBACK_FROM: string;
  FEEDBACK_TO: string;
}

type ProductRow = {
  id: string;
  canonical_name: string;
  category: string | null;
  target_size: string | null;
  search_terms_json: string;
  search_text: string;
};

type OfferRow = {
  product_id: string;
  retailer_id: string;
  retailer_name: string;
  product_name: string;
  brand: string | null;
  size_label: string | null;
  unit_label: string | null;
  price_cents: number | null;
  regular_price_cents: number | null;
  normalized_price_cents: number | null;
  promo_text: string | null;
  promo_type: string | null;
  promo_applied: number;
  image_url: string | null;
  product_url: string;
  last_seen_at: string | null;
};

type SearchProfileRow = {
  term: string;
  category: string | null;
  search_text: string | null;
  exclude_terms_json: string;
  preferred_terms_json: string;
};

type BasketItem = {
  id?: string;
  name?: string;
  query?: string;
  targetSize?: string;
  quantity?: number;
  category?: string;
  links?: Record<string, string>;
};

type BasketSettings = {
  stores?: Record<string, boolean>;
};

const retailers = [
  { id: "pick-n-pay", name: "Pick n Pay" },
  { id: "checkers", name: "Checkers" },
  { id: "woolworths", name: "Woolworths" },
  { id: "spar", name: "SPAR" },
  { id: "makro", name: "Makro" },
];

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin");
  const allowed = [env.APP_ORIGIN, "https://randbasket.co.za", "https://www.randbasket.co.za"];
  return {
    "access-control-allow-origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "Origin",
  };
}

function json(request: Request, env: Env, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request, env),
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function clean(text: unknown) {
  return String(text || "")
    .replace(/(?<=\d)(?=[a-zA-Z])/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(text: string) {
  return [...new Set(clean(text).split(" ").filter((term) => term.length > 1))];
}

function measureFromQuery(text: string) {
  const match = clean(text).match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  return match ? `${match[1]} ${match[2]}` : "";
}

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function scoreProduct(query: string, product: ProductRow, profiles: SearchProfileRow[]) {
  const normalizedQuery = clean(query);
  const searchText = product.search_text || "";
  const queryTokens = tokens(query);
  const hits = queryTokens.filter((term) => searchText.includes(term)).length;
  if (!hits) return -999;

  let score = hits / Math.max(queryTokens.length, 1);
  const canonical = clean(product.canonical_name);
  if (canonical === normalizedQuery) score += 5;
  else if (canonical.startsWith(normalizedQuery)) score += 2.5;
  else if (canonical.includes(normalizedQuery)) score += 1.25;
  if (product.target_size && normalizedQuery.includes(clean(product.target_size))) score += 2;

  const longestProfile = profiles
    .filter((profile) => normalizedQuery.includes(clean(profile.term)))
    .sort((a, b) => clean(b.term).length - clean(a.term).length)[0];
  if (longestProfile) {
    if (longestProfile.category && product.category === longestProfile.category) score += 3;
    else if (longestProfile.category && product.category) score -= 1.5;
    for (const term of parseJsonArray(longestProfile.exclude_terms_json)) {
      const excluded = clean(term);
      if (excluded && !normalizedQuery.includes(excluded) && searchText.includes(excluded)) score -= 5;
    }
    for (const term of parseJsonArray(longestProfile.preferred_terms_json)) {
      const preferred = clean(term);
      if (preferred && searchText.includes(preferred)) score += 2;
    }
  }
  return score;
}

function scoreStore(query: string, product: ProductRow, store: { productName: string; brand?: string; size?: string }, profiles: SearchProfileRow[]) {
  const normalizedQuery = clean(query);
  const offerText = clean([store.productName, store.brand, store.size].join(" "));
  const profile = profiles
    .filter((entry) => normalizedQuery.includes(clean(entry.term)))
    .sort((a, b) => clean(b.term).length - clean(a.term).length)[0];
  const queryTokens = tokens(query);
  const coreTokens = queryTokens.filter((term) => !["kg", "g", "ml", "l"].includes(term) && !/^\d+(?:\.\d+)?$/.test(term));
  const coreHits = coreTokens.filter((term) => offerText.includes(term)).length;
  if (coreHits < Math.max(1, coreTokens.length - 1)) return -999;

  const requestedMeasure = measureFromQuery(query);
  const offeredMeasure = measureFromQuery(store.size || store.productName);
  if (requestedMeasure && offeredMeasure && requestedMeasure !== offeredMeasure) return -999;

  let score = scoreProduct(query, product, profiles) + coreHits * 3;
  if (requestedMeasure && offeredMeasure === requestedMeasure) score += 5;
  if (profile) {
    for (const term of parseJsonArray(profile.exclude_terms_json)) {
      const excluded = clean(term);
      if (excluded && !normalizedQuery.includes(excluded) && offerText.includes(excluded)) score -= 15;
    }
    for (const term of parseJsonArray(profile.preferred_terms_json)) {
      const preferred = clean(term);
      if (preferred && offerText.includes(preferred)) score += 2;
    }
  }
  return score;
}

function isStoreEligible(query: string, productCategory: string | undefined, store: { productName: string; brand?: string; size?: string }, profiles: SearchProfileRow[]) {
  const normalizedQuery = clean(query);
  const requestedMeasure = measureFromQuery(query);
  const offeredMeasure = measureFromQuery(store.size || store.productName);
  if (requestedMeasure && offeredMeasure && requestedMeasure !== offeredMeasure) return false;
  const profile = profiles
    .filter((entry) => normalizedQuery.includes(clean(entry.term)))
    .sort((a, b) => clean(b.term).length - clean(a.term).length)[0];
  if (!profile) return true;
  if (profile.category && productCategory && profile.category !== productCategory) return false;
  const offerText = clean([store.productName, store.brand, store.size].join(" "));
  const hasExcludedTerm = parseJsonArray(profile.exclude_terms_json).some((term) => {
    const excluded = clean(term);
    return excluded && !normalizedQuery.includes(excluded) && offerText.includes(excluded);
  });
  if (hasExcludedTerm) return false;
  const preferredTerms = parseJsonArray(profile.preferred_terms_json).map(clean).filter(Boolean);
  if (normalizedQuery === clean(profile.term) && preferredTerms.length) {
    return preferredTerms.some((term) => offerText.includes(term));
  }
  return true;
}

function centsToPrice(cents: number | null) {
  return cents == null ? null : Number((cents / 100).toFixed(2));
}

type Measure = { amount: number; kind: "mass" | "volume" };

function parseMeasure(value: string | undefined) {
  const match = String(value || "").toLowerCase().match(/\b(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "kg") return { amount: amount * 1000, kind: "mass" } satisfies Measure;
  if (unit === "g") return { amount, kind: "mass" } satisfies Measure;
  if (unit === "l") return { amount: amount * 1000, kind: "volume" } satisfies Measure;
  return { amount, kind: "volume" } satisfies Measure;
}

function normaliseForTarget(price: number | null, offeredSize: string | undefined, targetSize: string | undefined) {
  if (price == null) return null;
  const offered = parseMeasure(offeredSize);
  const target = parseMeasure(targetSize);
  if (!offered || !target || offered.kind !== target.kind) return price;
  return Number((price * target.amount / offered.amount).toFixed(2));
}

function offerToStore(offer: OfferRow) {
  const priceCents = offer.normalized_price_cents ?? offer.price_cents;
  const price = priceCents && priceCents > 0 ? centsToPrice(priceCents) : null;
  const regularPrice = centsToPrice(offer.regular_price_cents);
  return {
    storeId: offer.retailer_id,
    storeName: offer.retailer_name,
    productName: offer.product_name,
    brand: offer.brand || undefined,
    size: offer.size_label || undefined,
    unit: offer.unit_label || undefined,
    price,
    regularPrice,
    promoText: offer.promo_text || undefined,
    promoApplied: Boolean(offer.promo_applied),
    imageUrl: offer.image_url || undefined,
    status: price == null ? "catalogue-price-missing" : "cached",
    url: offer.product_url,
    lastSeenAt: offer.last_seen_at || undefined,
  };
}

async function findCatalogue(env: Env, query: string, page: number, pageSize: number) {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return { products: [], retailerMatches: [], hasMore: false };

  // This broad candidate lookup keeps search flexible when stores phrase a pack
  // size or product title differently. Fine ranking happens in the Worker.
  const coreTokens = queryTokens.filter((term) => !["kg", "g", "ml", "l"].includes(term) && !/^\d+(?:\.\d+)?$/.test(term));
  const strictTerms = coreTokens.length ? coreTokens : queryTokens;
  const strictClauses = strictTerms.map(() => "search_text LIKE ?").join(" AND ");
  const strictStatement = env.DB.prepare(
    `SELECT id, canonical_name, category, target_size, search_terms_json, search_text
     FROM catalogue_products WHERE ${strictClauses} LIMIT 350`,
  ).bind(...strictTerms.map((term) => `%${term}%`));
  const [{ results: strictResults }, { results: profiles }] = await Promise.all([
    strictStatement.all<ProductRow>(),
    env.DB.prepare(
      "SELECT term, category, search_text, exclude_terms_json, preferred_terms_json FROM search_profiles",
    ).all<SearchProfileRow>(),
  ]);
  let results = strictResults;
  if (!results.length && queryTokens.length > 1) {
    const broadClauses = queryTokens.map(() => "search_text LIKE ?").join(" OR ");
    const broad = await env.DB.prepare(
      `SELECT id, canonical_name, category, target_size, search_terms_json, search_text
       FROM catalogue_products WHERE ${broadClauses} LIMIT 350`,
    ).bind(...queryTokens.map((term) => `%${term}%`)).all<ProductRow>();
    results = broad.results;
  }
  const scored = results
    .map((product) => ({ product, score: scoreProduct(query, product, profiles) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.product.canonical_name.localeCompare(b.product.canonical_name));

  const productIds = scored.map(({ product }) => product.id);
  const offerMap = new Map<string, OfferRow[]>();
  if (productIds.length) {
    // D1 limits parameters on a prepared statement. Search can deliberately
    // produce hundreds of broad candidates, so retrieve offers in safe chunks.
    for (let start = 0; start < productIds.length; start += 90) {
      const ids = productIds.slice(start, start + 90);
      const placeholders = ids.map(() => "?").join(",");
      const { results: offers } = await env.DB.prepare(
        `SELECT product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label,
                price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type,
                promo_applied, image_url, product_url, last_seen_at
         FROM catalogue_offers WHERE product_id IN (${placeholders})`,
      ).bind(...ids).all<OfferRow>();
      for (const offer of offers) {
        const group = offerMap.get(offer.product_id) || [];
        group.push(offer);
        offerMap.set(offer.product_id, group);
      }
    }
  }

  const materialized = scored.map(({ product, score }) => ({
    id: product.id,
    canonicalName: product.canonical_name,
    category: product.category || undefined,
    targetSize: product.target_size || undefined,
    searchTerms: parseJsonArray(product.search_terms_json),
    stores: (offerMap.get(product.id) || []).map(offerToStore),
    score: Number(score.toFixed(3)),
  }));

  const retailerMatches = retailers.flatMap((retailer) => {
    const seen = new Set<string>();
    return materialized
      .flatMap((product) => product.stores
        .filter((store) => store.storeId === retailer.id && store.price != null)
        .filter((store) => isStoreEligible(query, product.category, store, profiles))
        .map((store) => ({ product, store })))
      .filter((entry) => {
        const key = clean(entry.store.productName);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 3)
      .map((entry) => ({ ...entry.product, stores: [entry.store] }));
  });
  const start = (page - 1) * pageSize;
  return {
    products: materialized.slice(start, start + pageSize),
    retailerMatches: page === 1 ? retailerMatches : [],
    hasMore: materialized.length > start + pageSize,
  };
}

async function catalogueResponse(request: Request, env: Env, url: URL) {
  const query = (url.searchParams.get("q") || "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "10", 10) || 10));
  const result = await findCatalogue(env, query, page, pageSize);
  return json(request, env, { ok: true, query, page, pageSize, ...result });
}

async function categoriesResponse(request: Request, env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT category, COUNT(*) AS count FROM catalogue_products
     WHERE category IS NOT NULL AND category <> '' GROUP BY category ORDER BY category`,
  ).all<{ category: string; count: number }>();
  return json(request, env, { ok: true, categories: results.map((row) => ({ name: row.category, count: row.count, products: [] })) });
}

async function queueRequest(request: Request, env: Env) {
  const body = await request.json<{ query?: string; source?: string }>().catch(() => ({}));
  const query = String(body.query || "").trim();
  if (!query) return json(request, env, { ok: false, error: "Missing catalogue request query." }, 400);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO search_requests (id, query, source, status, requested_at, updated_at)
     VALUES (?1, ?2, ?3, 'queued', ?4, ?4)`,
  ).bind(id, query, String(body.source || "public-app"), now).run();
  return json(request, env, { ok: true, request: { id, query, source: body.source || "public-app", status: "queued", createdAt: now, updatedAt: now } }, 202);
}

async function submitFeedback(request: Request, env: Env) {
  const body = await request.json<{
    name?: string;
    email?: string;
    feedbackType?: string;
    message?: string;
    page?: string;
    honeypot?: string;
  }>().catch(() => ({}));
  if (String(body.honeypot || "").trim()) return json(request, env, { ok: true }, 202);

  const name = String(body.name || "").trim().slice(0, 120);
  const email = String(body.email || "").trim().slice(0, 254);
  const feedbackType = String(body.feedbackType || "Other").trim().slice(0, 80);
  const message = String(body.message || "").trim().slice(0, 5000);
  const page = String(body.page || "RandBasket web app").trim().slice(0, 500);
  if (message.length < 5) return json(request, env, { ok: false, error: "Please enter a longer suggestion." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(request, env, { ok: false, error: "Please enter a valid email address." }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO feedback_submissions
      (id, name, email, feedback_type, message, page, delivery_status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)`,
  ).bind(id, name, email, feedbackType, message, page, now).run();

  const text = [
    `Type: ${feedbackType}`,
    `Name: ${name || "Not provided"}`,
    `Reply email: ${email || "Not provided"}`,
    `Page: ${page}`,
    "",
    message,
    "",
    `Submission ID: ${id}`,
  ].join("\n");

  try {
    const delivery = await env.FEEDBACK_EMAIL.send({
      from: env.FEEDBACK_FROM,
      to: env.FEEDBACK_TO,
      subject: `RandBasket suggestion: ${feedbackType.replace(/[\r\n]+/g, " ")}`,
      text,
    });
    await env.DB.prepare(
      `UPDATE feedback_submissions SET delivery_status = 'sent', email_message_id = ?2, updated_at = ?3 WHERE id = ?1`,
    ).bind(id, String(delivery.messageId || ""), new Date().toISOString()).run();
    return json(request, env, { ok: true, id });
  } catch (error) {
    console.error("Feedback email delivery failed", id, error);
    await env.DB.prepare(
      `UPDATE feedback_submissions SET delivery_status = 'failed', updated_at = ?2 WHERE id = ?1`,
    ).bind(id, new Date().toISOString()).run();
    return json(request, env, {
      ok: false,
      saved: true,
      error: "Your suggestion was saved, but the email notification could not be sent yet.",
    }, 503);
  }
}

async function exactOffer(env: Env, retailerId: string, productUrl: string) {
  if (!productUrl) return null;
  return env.DB.prepare(
    `SELECT product_id, retailer_id, retailer_name, product_name, brand, size_label, unit_label,
            price_cents, regular_price_cents, normalized_price_cents, promo_text, promo_type,
            promo_applied, image_url, product_url, last_seen_at
     FROM catalogue_offers WHERE retailer_id = ?1 AND product_url = ?2 LIMIT 1`,
  ).bind(retailerId, productUrl).first<OfferRow>();
}

async function scanBasket(request: Request, env: Env) {
  const body = await request.json<{ items?: BasketItem[]; settings?: BasketSettings }>().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  if (!items.length) return json(request, env, { ok: false, error: "Add at least one item before checking prices." }, 400);
  const enabledRetailers = retailers.filter((retailer) => body.settings?.stores?.[retailer.id] !== false);
  const scans = [];

  for (const item of items) {
    const query = String(item.query || item.name || "").trim();
    const quantity = Math.max(0.01, Number(item.quantity || 1));
    const lookup = query ? await findCatalogue(env, query, 1, 10) : { retailerMatches: [] as Array<{ stores: ReturnType<typeof offerToStore>[] }> };
    const results = [];
    for (const retailer of enabledRetailers) {
      const linkedOffer = await exactOffer(env, retailer.id, String(item.links?.[retailer.id] || ""));
      const fallback = lookup.retailerMatches
        .find((product) => product.stores[0]?.storeId === retailer.id)?.stores[0];
      const store = linkedOffer ? offerToStore(linkedOffer) : fallback;
      const effectivePrice = store?.price ?? null;
      const normalizedPrice = normaliseForTarget(effectivePrice, store?.size, item.targetSize);
      results.push({
        storeId: retailer.id,
        storeName: retailer.name,
        status: store?.status || "catalogue-store-missing",
        queryUrl: store?.url,
        price: effectivePrice,
        effectivePrice,
        normalizedPrice,
        lineTotal: normalizedPrice == null ? null : Number((normalizedPrice * quantity).toFixed(2)),
        productName: store?.productName || null,
        productUrl: store?.url || null,
        regularPrice: store?.regularPrice ?? null,
        savings: store?.regularPrice && effectivePrice != null ? Number((store.regularPrice - effectivePrice).toFixed(2)) : null,
        promoText: store?.promoText,
        promoApplied: store?.promoApplied,
      });
    }
    const priced = results.filter((result) => result.effectivePrice != null).sort((left, right) => left.effectivePrice - right.effectivePrice);
    scans.push({
      itemId: String(item.id || crypto.randomUUID()),
      name: String(item.name || query),
      query,
      quantity,
      category: String(item.category || ""),
      targetSize: String(item.targetSize || ""),
      targetMeasure: item.targetSize ? { label: item.targetSize } : null,
      results,
      bestStoreId: priced[0]?.storeId || null,
      bestStoreName: priced[0]?.storeName || null,
      bestEffectivePrice: priced[0]?.effectivePrice ?? null,
    });
  }

  const basketTotals: Record<string, { storeId: string; storeName: string; total: number; missing: number }> = {};
  for (const retailer of enabledRetailers) {
    let total = 0;
    let missing = 0;
    for (const scan of scans) {
      const result = scan.results.find((entry) => entry.storeId === retailer.id);
      if (!result || result.lineTotal == null) missing += 1;
      else total += result.lineTotal;
    }
    basketTotals[retailer.id] = { storeId: retailer.id, storeName: retailer.name, total: Number(total.toFixed(2)), missing };
  }
  const bestBasket = Object.values(basketTotals).filter((entry) => entry.missing === 0).sort((left, right) => left.total - right.total)[0];
  return json(request, env, {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    source: "catalogue-cache",
    scans,
    basketTotals,
    bestBasketStoreId: bestBasket?.storeId || null,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (request.method === "GET" && ["/v1/health", "/health"].includes(url.pathname)) {
      return json(request, env, { ok: true, service: "randbasket-api", now: new Date().toISOString() });
    }
    if (request.method === "GET" && ["/v1/catalogue", "/api/catalogue"].includes(url.pathname)) return catalogueResponse(request, env, url);
    if (request.method === "GET" && ["/v1/catalogue/categories", "/api/catalogue/categories"].includes(url.pathname)) return categoriesResponse(request, env);
    if (request.method === "POST" && ["/v1/catalogue/request", "/api/catalogue/request"].includes(url.pathname)) return queueRequest(request, env);
    if (request.method === "POST" && ["/v1/feedback", "/api/feedback"].includes(url.pathname)) return submitFeedback(request, env);
    if (request.method === "POST" && ["/v1/scan/catalogue", "/api/scan/catalogue"].includes(url.pathname)) return scanBasket(request, env);
    return json(request, env, { ok: false, error: "Not found" }, 404);
  },
};
