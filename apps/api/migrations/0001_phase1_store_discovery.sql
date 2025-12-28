CREATE TABLE IF NOT EXISTS query_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache(expires_at);

-- Per-session token buckets for provider guardrails
CREATE TABLE IF NOT EXISTS rate_limits (
  rl_key TEXT PRIMARY KEY,
  tokens REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Provider circuit breaker state
CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL,
  open_until INTEGER NOT NULL
);

-- Stores table (seed + OSM)
CREATE TABLE IF NOT EXISTS stores (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,              -- osm | seed
  external_id TEXT,                  -- e.g., osm:node/123
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  tags_json TEXT,
  last_seen_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stores_source_external
  ON stores(source, external_id);

-- Seed data marker
CREATE TABLE IF NOT EXISTS seed_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);