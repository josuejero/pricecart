-- Phase 6: observability + metrics tables

-- Route-level metrics (minute buckets + latency histogram)
CREATE TABLE IF NOT EXISTS route_metrics (
  day TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  status_class INTEGER NOT NULL,

  count INTEGER NOT NULL DEFAULT 0,
  sum_ms INTEGER NOT NULL DEFAULT 0,
  max_ms INTEGER NOT NULL DEFAULT 0,

  b_50  INTEGER NOT NULL DEFAULT 0,
  b_100 INTEGER NOT NULL DEFAULT 0,
  b_250 INTEGER NOT NULL DEFAULT 0,
  b_500 INTEGER NOT NULL DEFAULT 0,
  b_1000 INTEGER NOT NULL DEFAULT 0,
  b_inf INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (day, minute_bucket, route, method, status_class)
);

CREATE INDEX IF NOT EXISTS idx_route_metrics_recent
  ON route_metrics(day, minute_bucket);

-- Provider failure counters (minute buckets)
CREATE TABLE IF NOT EXISTS provider_metrics (
  day TEXT NOT NULL,
  minute_bucket INTEGER NOT NULL,
  provider TEXT NOT NULL,
  outcome TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (day, minute_bucket, provider, outcome)
);

CREATE INDEX IF NOT EXISTS idx_provider_metrics_recent
  ON provider_metrics(day, minute_bucket);
