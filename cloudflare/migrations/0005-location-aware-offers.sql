ALTER TABLE catalogue_offers ADD COLUMN location_key TEXT;
ALTER TABLE catalogue_offers ADD COLUMN store_code TEXT;
ALTER TABLE catalogue_offers ADD COLUMN store_display_name TEXT;
ALTER TABLE catalogue_offers ADD COLUMN latitude REAL;
ALTER TABLE catalogue_offers ADD COLUMN longitude REAL;

CREATE INDEX IF NOT EXISTS idx_catalogue_offers_location
  ON catalogue_offers(retailer_id, location_key);
