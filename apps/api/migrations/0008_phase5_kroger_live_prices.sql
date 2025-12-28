-- Phase 5: Kroger live-price support (store -> provider location mapping)

CREATE TABLE IF NOT EXISTS store_provider_mappings (
  store_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_location_id TEXT NOT NULL,
  match_method TEXT NOT NULL,
  match_score REAL NOT NULL,
  created_at INTEGER NOT NULL,
  verified_at INTEGER NOT NULL,
  PRIMARY KEY (store_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_store_provider_mappings_provider_location
  ON store_provider_mappings(provider, provider_location_id);

CREATE INDEX IF NOT EXISTS idx_store_provider_mappings_verified
  ON store_provider_mappings(provider, verified_at);
