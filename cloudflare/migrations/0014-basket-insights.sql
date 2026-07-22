CREATE TABLE IF NOT EXISTS basket_events (
  id TEXT PRIMARY KEY,
  subject_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  retailer_id TEXT,
  retailer_name TEXT,
  basket_item_id TEXT,
  quantity INTEGER NOT NULL,
  price_cents INTEGER,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_basket_events_subject
  ON basket_events(subject_hash, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_basket_events_retailer
  ON basket_events(retailer_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_basket_events_expiry
  ON basket_events(expires_at);
