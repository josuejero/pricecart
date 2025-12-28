-- Phase 2: product identity (Open Food Facts)

CREATE TABLE IF NOT EXISTS products (
  upc TEXT PRIMARY KEY,
  source TEXT NOT NULL,              -- openfoodfacts | seed
  off_product_id TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  quantity_value REAL,
  quantity_unit TEXT,
  normalized_name TEXT NOT NULL,
  image_url TEXT,
  source_url TEXT,
  updated_at INTEGER NOT NULL,
  raw_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_normalized_name
  ON products(normalized_name);

-- Optional: store raw payload + hash for drift detection
CREATE TABLE IF NOT EXISTS product_provider_payloads (
  provider TEXT NOT NULL,
  upc TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (provider, upc)
);