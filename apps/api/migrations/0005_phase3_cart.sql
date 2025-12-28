-- Phase 3: server-backed cart (anonymous session)

CREATE TABLE IF NOT EXISTS carts (
  session_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cart_items (
  session_id TEXT NOT NULL,
  upc TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, upc)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_session
  ON cart_items(session_id);