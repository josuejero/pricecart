INSERT OR REPLACE INTO seed_meta (k, v) VALUES ('seed_products_version', 'phase2-v1');

INSERT OR REPLACE INTO products (
  upc, source, off_product_id, name, brand, quantity_value, quantity_unit,
  normalized_name, image_url, source_url, updated_at, raw_hash
) VALUES
(
  '0000000000001', 'seed', NULL,
  'Seed Whole Milk', 'Seed Brand',
  1.0, 'l',
  'seed brand seed whole milk',
  NULL, NULL,
  strftime('%s','now'),
  NULL
),
(
  '0000000000002', 'seed', NULL,
  'Seed Peanut Butter', 'Seed Brand',
  16.0, 'oz',
  'seed brand seed peanut butter',
  NULL, NULL,
  strftime('%s','now'),
  NULL
),
(
  '012345678905', 'seed', NULL,
  'Seed Honeycrisp Apples', 'Seed Brand',
  3.0, 'lb',
  'seed brand seed honeycrisp apples',
  NULL, NULL,
  strftime('%s','now'),
  NULL
);
