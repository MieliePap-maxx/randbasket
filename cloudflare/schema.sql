-- Public RandBasket catalogue. Prices are stored in cents to avoid floating-point
-- rounding errors when calculating a shopper's basket total.
CREATE TABLE IF NOT EXISTS catalogue_products (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  category TEXT,
  target_size TEXT,
  search_terms_json TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalogue_products_search_text
  ON catalogue_products(search_text);

CREATE INDEX IF NOT EXISTS idx_catalogue_products_category
  ON catalogue_products(category);

CREATE TABLE IF NOT EXISTS catalogue_offers (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  retailer_id TEXT NOT NULL,
  retailer_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  size_label TEXT,
  unit_label TEXT,
  price_cents INTEGER,
  regular_price_cents INTEGER,
  normalized_price_cents INTEGER,
  promo_text TEXT,
  promo_type TEXT,
  promo_applied INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  product_url TEXT NOT NULL,
  location_key TEXT,
  store_code TEXT,
  store_display_name TEXT,
  latitude REAL,
  longitude REAL,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(product_id) REFERENCES catalogue_products(id)
);

CREATE INDEX IF NOT EXISTS idx_catalogue_offers_product
  ON catalogue_offers(product_id);

CREATE INDEX IF NOT EXISTS idx_catalogue_offers_retailer
  ON catalogue_offers(retailer_id, product_id);

CREATE INDEX IF NOT EXISTS idx_catalogue_offers_location
  ON catalogue_offers(retailer_id, location_key);

CREATE TABLE IF NOT EXISTS search_profiles (
  term TEXT PRIMARY KEY,
  category TEXT,
  search_text TEXT,
  exclude_terms_json TEXT NOT NULL DEFAULT '[]',
  preferred_terms_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS search_requests (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  requested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_requests_status
  ON search_requests(status, requested_at);

CREATE TABLE IF NOT EXISTS feedback_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  feedback_type TEXT NOT NULL,
  message TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  email_message_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_feedback_submissions_created
  ON feedback_submissions(created_at DESC);
