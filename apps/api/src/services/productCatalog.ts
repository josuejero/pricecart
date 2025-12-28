import type { Product, ProductLookupResponse, ProductSearchResponse } from "@pricecart/shared";
import { normalizeProductName, parseQuantity } from "@pricecart/shared";
import { cachePeek, cachePut } from "../lib/cache";
import { sha256Base64Url } from "../lib/hash";
import { takeToken } from "../lib/rateLimit";
import { nowSec } from "../lib/time";
import { OFF_ATTRIBUTION, offLookupByUpc, offSearch, type OffProductRaw } from "../providers/openFoodFacts";

const TTL_UPC_SEC = 60 * 60 * 24 * 7; // 7 days
const TTL_SEARCH_SEC = 60 * 60 * 6;   // 6 hours

// Conservative budgets (per session) - tune later
const RL_OFF_LOOKUP = { capacity: 10, refillPerSec: 1 / 6, cost: 1 }; // ~10/min
const RL_OFF_SEARCH = { capacity: 5, refillPerSec: 1 / 12, cost: 1 }; // ~5/min

function pickBrand(brands: string | null): string | null {
  if (!brands) return null;
  const first = brands.split(",")[0]?.trim();
  return first || null;
}

function toCanonicalProduct(raw: OffProductRaw): Product {
  const brand = pickBrand(raw.brands);
  const name = raw.product_name?.trim() || "Unknown product";

  return {
    upc: raw.code,
    name,
    brand,
    normalized_name: normalizeProductName({ name, brand }),
    quantity: parseQuantity(raw.quantity),
    image_url: raw.image_front_url,
    source: "openfoodfacts",
    source_url: raw.url,
    updated_at: nowSec()
  };
}

async function upsertProduct(db: D1Database, p: Product, rawHash: string | null) {
  await db
    .prepare(
      `INSERT OR REPLACE INTO products (
        upc, source, off_product_id, name, brand,
        quantity_value, quantity_unit,
        normalized_name, image_url, source_url,
        updated_at, raw_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      p.upc,
      p.source,
      p.source === "openfoodfacts" ? `off:${p.upc}` : null,
      p.name,
      p.brand,
      p.quantity.value,
      p.quantity.unit,
      p.normalized_name,
      p.image_url,
      p.source_url,
      p.updated_at,
      rawHash
    )
    .run();
}

async function recordRawPayload(db: D1Database, provider: string, upc: string, rawJson: unknown, rawHash: string) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO product_provider_payloads (provider, upc, raw_json, raw_hash, fetched_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(provider, upc, JSON.stringify(rawJson), rawHash, nowSec())
    .run();
}

async function readProductFromDb(db: D1Database, upc: string): Promise<Product | null> {
  const row = await db
    .prepare(
      "SELECT upc, source, name, brand, quantity_value, quantity_unit, normalized_name, image_url, source_url, updated_at FROM products WHERE upc = ? LIMIT 1"
    )
    .bind(upc)
    .first<{
      upc: string;
      source: "openfoodfacts" | "seed";
      name: string;
      brand: string | null;
      quantity_value: number | null;
      quantity_unit: string | null;
      normalized_name: string;
      image_url: string | null;
      source_url: string | null;
      updated_at: number;
    }>();

  if (!row) return null;
  return {
    upc: row.upc,
    name: row.name,
    brand: row.brand,
    normalized_name: row.normalized_name,
    quantity: { raw: null, value: row.quantity_value, unit: row.quantity_unit },
    image_url: row.image_url,
    source: row.source,
    source_url: row.source_url,
    updated_at: row.updated_at
  };
}

function validateUpc(upc: string): string {
  const u = upc.trim();
  if (!/^\d{8,14}$/.test(u)) throw new Error("INVALID_UPC");
  return u;
}

export async function lookupProduct(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string; OFF_BASE_URL?: string },
  input: { upc: string; session_id: string },
  execCtx?: ExecutionContext
): Promise<ProductLookupResponse> {
  const upc = validateUpc(input.upc);
  const cacheKey = `off:product:${upc}`;

  const peek = await cachePeek<ProductLookupResponse>(env.DB, cacheKey);
  if (peek?.is_fresh) {
    return { ...peek.payload, data_mode: "cache", cache_state: "fresh" };
  }
  if (peek && !peek.is_fresh) {
    // stale-while-revalidate
    execCtx?.waitUntil(refreshLookup(env, upc, input.session_id).catch(() => {}));
    return { ...peek.payload, data_mode: "cache", cache_state: "stale" };
  }

  // No cache at all, try live (with fallback)
  try {
    return await refreshLookup(env, upc, input.session_id);
  } catch (e) {
    const fallback = await readProductFromDb(env.DB, upc);
    if (fallback) {
      return {
        data_mode: fallback.source === "seed" ? "seed" : "cache",
        product: fallback,
        attribution: OFF_ATTRIBUTION
      };
    }
    throw e;
  }
}

async function refreshLookup(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string; OFF_BASE_URL?: string },
  upc: string,
  sessionId: string
): Promise<ProductLookupResponse> {
  const ok = await takeToken(env.DB, `rl:${sessionId}:openfoodfacts:lookup`, RL_OFF_LOOKUP);
  if (!ok) throw new Error("RATE_LIMIT_OFF_LOOKUP");

  const provider = "openfoodfacts";
  const raw = await offLookupByUpc(env, upc);

  // Hash raw-ish fields for drift detection (keep stable across irrelevant changes)
  const hashInput = JSON.stringify({
    code: raw.code,
    product_name: raw.product_name,
    brands: raw.brands,
    quantity: raw.quantity,
    image_front_url: raw.image_front_url,
    url: raw.url,
    last_modified_t: raw.last_modified_t
  });
  const rawHash = await sha256Base64Url(hashInput);

  const p = toCanonicalProduct(raw);
  await upsertProduct(env.DB, p, rawHash);
  await recordRawPayload(env.DB, provider, upc, raw, rawHash);

  const resp: ProductLookupResponse = {
    data_mode: "live",
    cache_state: "fresh",
    product: p,
    attribution: OFF_ATTRIBUTION
  };

  await cachePut(env.DB, `off:product:${upc}`, resp, TTL_UPC_SEC);
  return resp;
}

export async function searchProducts(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string; OFF_BASE_URL?: string },
  input: { q: string; page: number; page_size: number; session_id: string },
  execCtx?: ExecutionContext
): Promise<ProductSearchResponse> {
  const q = input.q.trim();
  if (q.length < 2) throw new Error("INVALID_QUERY");

  const page = Math.max(1, Math.min(input.page, 25));
  const pageSize = Math.max(1, Math.min(input.page_size, 25));

  const qKey = await sha256Base64Url(q.toLowerCase());
  const cacheKey = `off:search:${qKey}:p=${page}:s=${pageSize}`;

  const peek = await cachePeek<ProductSearchResponse>(env.DB, cacheKey);
  if (peek?.is_fresh) return { ...peek.payload, data_mode: "cache", cache_state: "fresh" };
  if (peek && !peek.is_fresh) {
    execCtx?.waitUntil(refreshSearch(env, q, page, pageSize, input.session_id, cacheKey).catch(() => {}));
    return { ...peek.payload, data_mode: "cache", cache_state: "stale" };
  }

  return await refreshSearch(env, q, page, pageSize, input.session_id, cacheKey);
}

async function refreshSearch(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string; OFF_BASE_URL?: string },
  q: string,
  page: number,
  pageSize: number,
  sessionId: string,
  cacheKey: string
): Promise<ProductSearchResponse> {
  const ok = await takeToken(env.DB, `rl:${sessionId}:openfoodfacts:search`, RL_OFF_SEARCH);
  if (!ok) throw new Error("RATE_LIMIT_OFF_SEARCH");

  const result = await offSearch(env, q, page, pageSize);

  const products = result.products
    .filter((p) => /^\d{8,14}$/.test(p.code))
    .map((p) => toCanonicalProduct(p));

  // Opportunistic upsert of search results
  for (const p of products) {
    await upsertProduct(env.DB, p, null);
  }

  const resp: ProductSearchResponse = {
    data_mode: "live",
    cache_state: "fresh",
    query: q,
    page,
    page_size: pageSize,
    total: result.total,
    products,
    attribution: OFF_ATTRIBUTION
  };

  await cachePut(env.DB, cacheKey, resp, TTL_SEARCH_SEC);
  return resp;
}