CREATE TABLE IF NOT EXISTS product_embedding_status (
  product_id TEXT PRIMARY KEY,
  embedding_hash TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedded_at TEXT NOT NULL,
  FOREIGN KEY(product_id) REFERENCES catalogue_products(id)
);

CREATE INDEX IF NOT EXISTS idx_product_embedding_status_model
  ON product_embedding_status(embedding_model, embedded_at);
