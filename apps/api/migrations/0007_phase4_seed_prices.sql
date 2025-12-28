-- Phase 4 seed pricing for demo + tests

-- Use the same seed stores from 0002 and seed products from 0004
-- UPCs:
-- 0000000000001 Seed Whole Milk
-- 0000000000002 Seed Peanut Butter
-- 012345678905  Seed Honeycrisp Apples

-- Store A (seed-1): cheapest overall
INSERT OR REPLACE INTO price_snapshots (
  id, store_id, upc, price_cents, currency, observed_at, source, evidence_type,
  confidence, submitter_session_id, flags_json, created_at
) VALUES
(
  'op-seed-1-milk', 'seed-1', '0000000000001', 399, 'USD', strftime('%s','now') - 86400,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
),
(
  'op-seed-1-pb', 'seed-1', '0000000000002', 549, 'USD', strftime('%s','now') - 172800,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
),
(
  'op-seed-1-apples', 'seed-1', '012345678905', 699, 'USD', strftime('%s','now') - 259200,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
);

-- Store B (seed-2): slightly more expensive
INSERT OR REPLACE INTO price_snapshots (
  id, store_id, upc, price_cents, currency, observed_at, source, evidence_type,
  confidence, submitter_session_id, flags_json, created_at
) VALUES
(
  'op-seed-2-milk', 'seed-2', '0000000000001', 429, 'USD', strftime('%s','now') - 86400,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
),
(
  'op-seed-2-pb', 'seed-2', '0000000000002', 599, 'USD', strftime('%s','now') - 172800,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
),
(
  'op-seed-2-apples', 'seed-2', '012345678905', 749, 'USD', strftime('%s','now') - 259200,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
);

-- Store C (seed-3): missing apples initially (forces missing-item behavior)
INSERT OR REPLACE INTO price_snapshots (
  id, store_id, upc, price_cents, currency, observed_at, source, evidence_type,
  confidence, submitter_session_id, flags_json, created_at
) VALUES
(
  'op-seed-3-milk', 'seed-3', '0000000000001', 409, 'USD', strftime('%s','now') - 86400,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
),
(
  'op-seed-3-pb', 'seed-3', '0000000000002', 579, 'USD', strftime('%s','now') - 172800,
  'open_prices', 'dataset', 0.75, NULL, NULL, strftime('%s','now')
);

-- OPTIONAL: a seeded community submission example
INSERT OR REPLACE INTO price_snapshots (
  id, store_id, upc, price_cents, currency, observed_at, source, evidence_type,
  confidence, submitter_session_id, flags_json, created_at
) VALUES
(
  'community-seed-3-apples', 'seed-3', '012345678905', 799, 'USD', strftime('%s','now') - 43200,
  'community', 'manual', 0.45, 'seed-session', '{"note":"seeded manual price"}', strftime('%s','now')
);