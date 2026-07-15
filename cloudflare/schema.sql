CREATE TABLE IF NOT EXISTS catalogue_products (
  id TEXT PRIMARY KEY,
  retailer_id TEXT NOT NULL,
  retailer_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  size_label TEXT,
  price_cents INTEGER,
  regular_price_cents INTEGER,
  promo_text TEXT,
  image_url TEXT,
  product_url TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalogue_retailer_name
  ON catalogue_products(retailer_id, product_name);

CREATE INDEX IF NOT EXISTS idx_catalogue_published_at
  ON catalogue_products(published_at);

CREATE TABLE IF NOT EXISTS search_requests (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  source TEXT NOT NULL
);
