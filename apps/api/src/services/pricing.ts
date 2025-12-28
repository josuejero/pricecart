import type { CartQuoteResponse, EvidenceType, FreshnessBucket, PriceSource } from "@pricecart/shared";
import { takeToken } from "../lib/rateLimit";
import { nowSec } from "../lib/time";

type EnvLike = { DB: D1Database };

const RL_QUOTE = { capacity: 60, refillPerSec: 1 / 2, cost: 1 };   // ~60/min/session
const RL_SUBMIT = { capacity: 20, refillPerSec: 1 / 60, cost: 1 }; // ~20/min/session

type CartItemRow = { upc: string; quantity: number };

type StoreRow = { id: string; name: string };

type PriceRow = {
  upc: string;
  price_cents: number;
  currency: string;
  observed_at: number;
  source: PriceSource;
  evidence_type: EvidenceType;
  confidence: number;
};

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function freshnessBucket(now: number, observedAt: number): FreshnessBucket {
  const ageSec = Math.max(0, now - observedAt);
  const ageDays = ageSec / 86400;
  if (ageDays <= 2) return "fresh";
  if (ageDays <= 7) return "recent";
  if (ageDays <= 30) return "stale";
  return "old";
}

function adjustedTotal(total: number, completeness: number): number {
  // Penalize missing items. If completeness is low, the total is less trustworthy.
  // This keeps ranking honest: a store missing half the prices should not “win” by default.
  const denom = Math.max(0.25, completeness);
  return Math.round(total / denom);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

export async function quoteCart(
  env: EnvLike,
  input: { session_id: string; store_ids: string[] }
): Promise<CartQuoteResponse> {
  const ok = await takeToken(env.DB, `quote:${input.session_id}`, RL_QUOTE);
  if (!ok) throw new Error("RATE_LIMITED");

  const storeIds = Array.from(new Set(input.store_ids)).slice(0, 20);

  // Load cart items (server-backed)
  const cartRows = await env.DB.prepare(
    `SELECT upc, quantity
     FROM cart_items
     WHERE session_id = ?
     ORDER BY updated_at DESC`
  )
    .bind(input.session_id)
    .all<CartItemRow>();

  const cartItems = cartRows.results;
  const itemCount = cartItems.length;

  const t = nowSec();
  const warnings: string[] = [];

  if (itemCount === 0) {
    warnings.push("CART_EMPTY");
  }

  // Load store names
  const storePlaceholders = storeIds.map(() => "?").join(",");
  const storeRows = await env.DB.prepare(
    `SELECT id, name FROM stores WHERE id IN (${storePlaceholders})`
  )
    .bind(...storeIds)
    .all<StoreRow>();

  const storesById = new Map(storeRows.results.map((s) => [s.id, s]));
  const resolvedStoreIds = storeIds.filter((id) => storesById.has(id));
  const missingStores = storeIds.filter((id) => !storesById.has(id));
  if (missingStores.length) warnings.push(`UNKNOWN_STORES:${missingStores.join(",")}`);

  const upcs = cartItems.map((c) => c.upc);

  const outStores = [] as CartQuoteResponse["stores"];

  for (const store_id of resolvedStoreIds) {
    const store = storesById.get(store_id)!;

    const priceMap = new Map<string, PriceRow>();

    if (upcs.length > 0) {
      const inPlaceholders = upcs.map(() => "?").join(",");
      // Window function: pick the “best” row per UPC by observed_at then confidence
      const rows = await env.DB.prepare(
        `SELECT upc, price_cents, currency, observed_at, source, evidence_type, confidence
         FROM (
           SELECT
             upc, price_cents, currency, observed_at, source, evidence_type, confidence,
             ROW_NUMBER() OVER (PARTITION BY upc ORDER BY observed_at DESC, confidence DESC) AS rn
           FROM price_snapshots
           WHERE store_id = ? AND upc IN (${inPlaceholders})
         )
         WHERE rn = 1`
      )
        .bind(store_id, ...upcs)
        .all<PriceRow>();

      for (const r of rows.results) priceMap.set(r.upc, r);
    }

    let total = 0;
    let matched = 0;
    let missing = 0;

    const lines = cartItems.map((it) => {
      const p = priceMap.get(it.upc);
      if (!p) {
        missing += 1;
        return {
          upc: it.upc,
          quantity: it.quantity,
          unit_price_cents: null,
          extended_price_cents: null,
          missing: true,
          observed_at: null,
          source: null,
          evidence_type: null,
          confidence: null,
          freshness: null
        };
      }

      matched += 1;
      const ext = p.price_cents * it.quantity;
      total += ext;

      return {
        upc: it.upc,
        quantity: it.quantity,
        unit_price_cents: p.price_cents,
        extended_price_cents: ext,
        missing: false,
        observed_at: p.observed_at,
        source: p.source,
        evidence_type: p.evidence_type,
        confidence: clamp01(p.confidence),
        freshness: freshnessBucket(t, p.observed_at)
      };
    });

    const completeness = itemCount === 0 ? 0 : matched / itemCount;

    outStores.push({
      store_id,
      store_name: store.name,
      currency: "USD",
      item_count: itemCount,
      matched_count: matched,
      missing_count: missing,
      completeness,
      total_cents: total,
      adjusted_total_cents: adjustedTotal(total, completeness),
      lines
    });
  }

  // Choose cheapest: prefer higher completeness, then lower adjusted total
  const ranked = [...outStores].sort((a, b) => {
    if (a.completeness !== b.completeness) return b.completeness - a.completeness;
    if (a.adjusted_total_cents !== b.adjusted_total_cents) return a.adjusted_total_cents - b.adjusted_total_cents;
    return a.total_cents - b.total_cents;
  });

  const cheapest = ranked.length ? ranked[0] : null;

  return {
    session_id: input.session_id,
    generated_at: t,
    currency: "USD",
    cheapest_store_id: cheapest ? cheapest.store_id : null,
    stores: outStores,
    warnings
  };
}

export async function submitPrice(
  env: EnvLike,
  input: {
    session_id: string;
    store_id: string;
    upc: string;
    price_cents: number;
    currency: string;
    observed_at?: number;
    evidence_type: EvidenceType;
  }
): Promise<{ snapshot_id: string }> {
  const ok = await takeToken(env.DB, `price_submit:${input.session_id}`, RL_SUBMIT);
  if (!ok) throw new Error("RATE_LIMITED");

  // Store must exist
  const store = await env.DB.prepare("SELECT id FROM stores WHERE id = ?")
    .bind(input.store_id)
    .first<{ id: string }>();
  if (!store) throw new Error("STORE_NOT_FOUND");

  // Product must exist
  const prod = await env.DB.prepare("SELECT upc FROM products WHERE upc = ?")
    .bind(input.upc)
    .first<{ upc: string }>();
  if (!prod) throw new Error("PRODUCT_NOT_FOUND");

  const t = nowSec();
  const observedAt = input.observed_at ?? t;

  // Basic time sanity: allow small clock skew, but block far-future timestamps
  if (observedAt > t + 86400) throw new Error("OBSERVED_AT_IN_FUTURE");

  // Dedupe identical spam: same price within 1 hour
  const dup = await env.DB.prepare(
    `SELECT id FROM price_snapshots
     WHERE store_id = ? AND upc = ? AND price_cents = ?
       AND ABS(observed_at - ?) <= 3600
     LIMIT 1`
  )
    .bind(input.store_id, input.upc, input.price_cents, observedAt)
    .first<{ id: string }>();

  if (dup?.id) return { snapshot_id: dup.id };

  // Outlier check vs median recent history for this store+UPC
  const hist = await env.DB.prepare(
    `SELECT price_cents FROM price_snapshots
     WHERE store_id = ? AND upc = ?
     ORDER BY observed_at DESC
     LIMIT 25`
  )
    .bind(input.store_id, input.upc)
    .all<{ price_cents: number }>();

  const med = median(hist.results.map((r) => r.price_cents));
  if (med !== null) {
    if (input.price_cents < Math.floor(med * 0.3) || input.price_cents > Math.ceil(med * 3.0)) {
      throw new Error("OUTLIER_PRICE");
    }
  }

  const confidenceBase = input.evidence_type === "receipt_text" ? 0.6 : 0.45;
  const confidence = clamp01(confidenceBase);

  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO price_snapshots (
      id, store_id, upc, price_cents, currency, observed_at, source, evidence_type,
      confidence, submitter_session_id, flags_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      input.store_id,
      input.upc,
      input.price_cents,
      input.currency,
      observedAt,
      "community",
      input.evidence_type,
      confidence,
      input.session_id,
      null,
      t
    )
    .run();

  return { snapshot_id: id };
}