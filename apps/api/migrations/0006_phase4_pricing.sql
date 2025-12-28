-- Phase 4: pricing snapshots (Open Prices + community)

CREATE TABLE IF NOT EXISTS price_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  upc TEXT NOT NULL,

  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,

  observed_at INTEGER NOT NULL,   -- when the price was observed
  source TEXT NOT NULL,           -- open_prices | community | kroger
  evidence_type TEXT NOT NULL,    -- dataset | manual | receipt_text

  confidence REAL NOT NULL,       -- 0.0 - 1.0 (simple, explainable)
  submitter_session_id TEXT,      -- only for community submissions (anonymous)

  flags_json TEXT,                -- optional moderation/outlier info
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_store_upc_observed
  ON price_snapshots(store_id, upc, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_upc_observed
  ON price_snapshots(upc, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_source_observed
  ON price_snapshots(source, observed_at DESC);