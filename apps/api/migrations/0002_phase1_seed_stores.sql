INSERT OR REPLACE INTO seed_meta (k, v) VALUES ('seed_version', 'phase1-v1');

-- Seed stores (example: Manhattan-ish). Replace/expand as desired.
INSERT OR REPLACE INTO stores (id, source, external_id, name, lat, lon, tags_json, last_seen_at) VALUES
('seed-1', 'seed', NULL, 'Seed Market A', 40.748400, -73.985700, '{"shop":"supermarket"}', strftime('%s','now')),
('seed-2', 'seed', NULL, 'Seed Grocery B', 40.742000, -73.992000, '{"shop":"supermarket"}', strftime('%s','now')),
('seed-3', 'seed', NULL, 'Seed Convenience C', 40.754000, -73.977500, '{"shop":"convenience"}', strftime('%s','now'));