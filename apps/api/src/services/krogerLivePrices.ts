import { cacheGet, cachePut } from "../lib/cache";
import { distanceMeters } from "../lib/geo";
import { takeToken } from "../lib/rateLimit";
import { nowSec } from "../lib/time";
import {
  fetchKrogerLocations,
  fetchKrogerProductDetails,
  fetchKrogerToken,
  type KrogerLocation
} from "../providers/kroger";

type EnvLike = {
  DB: D1Database;
  OUTBOUND_USER_AGENT?: string;
  OUTBOUND_REFERER?: string;

  KROGER_LIVE_PRICES_ENABLED?: string;
  KROGER_CLIENT_ID?: string;
  KROGER_CLIENT_SECRET?: string;
  KROGER_BASE_URL?: string;
  KROGER_TOKEN_URL?: string;
};

export type LivePriceOverlayInput = {
  session_id: string;
  store: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    tags: Record<string, unknown>;
  };
  upcs: string[];
  t: number;
};

export type LivePriceOverlayResult = {
  prices_by_upc: Map<string, { price_cents: number; observed_at: number; confidence: number }>;
  warnings: string[];
};

const MAX_UPCS_PER_QUOTE = 25;

const TOKEN_CACHE_KEY = "kroger:token:product.compact";
const TOKEN_MIN_TTL_SEC = 60;

const PRICE_CACHE_TTL_SEC = 10 * 60; // 10 minutes
const LOCATION_CACHE_MIN_FRESH_SEC = 90 * 24 * 60 * 60; // 90 days

const LOCATION_RADIUS_MILES = 2;
const MATCH_THRESHOLD_METERS = 700; // conservative match threshold

// Budgets (per session)
const RL_LOCATIONS = { capacity: 3, refillPerSec: 1 / 30, cost: 1 };
const RL_PRODUCTS  = { capacity: 25, refillPerSec: 1 / 2, cost: 1 };
const RL_TOKEN     = { capacity: 2, refillPerSec: 1 / 60, cost: 1 };

function isEnabled(env: EnvLike) {
  const v = (env.KROGER_LIVE_PRICES_ENABLED ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function hasCreds(env: EnvLike) {
  return !!(env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;

  const workers = new Array(Math.max(1, limit)).fill(null).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return out;
}

async function getAccessToken(env: EnvLike, session_id: string): Promise<string> {
  const cached = await cacheGet<{ access_token: string; expires_at: number }>(env.DB, TOKEN_CACHE_KEY);
  const now = nowSec();
  if (cached && cached.expires_at > now + TOKEN_MIN_TTL_SEC) return cached.access_token;

  const ok = await takeToken(env.DB, `kroger:${session_id}:token`, RL_TOKEN);
  if (!ok) throw new Error("KROGER_RATE_LIMITED_TOKEN");

  const token = await fetchKrogerToken(env.DB, {
    client_id: env.KROGER_CLIENT_ID!,
    client_secret: env.KROGER_CLIENT_SECRET!,
    token_url: env.KROGER_TOKEN_URL,
    scope: "product.compact",
    user_agent: env.OUTBOUND_USER_AGENT,
    referer: env.OUTBOUND_REFERER
  });

  const ttl = Math.max(TOKEN_MIN_TTL_SEC, (token.expires_in_sec ?? 1800) - 60);
  const payload = {
    access_token: token.access_token,
    expires_at: now + ttl
  };
  await cachePut(env.DB, TOKEN_CACHE_KEY, payload, ttl);

  return token.access_token;
}

async function getMappedLocationId(env: EnvLike, store_id: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT provider_location_id, verified_at
     FROM store_provider_mappings
     WHERE store_id = ? AND provider = 'kroger'
     LIMIT 1`
  )
    .bind(store_id)
    .first<{ provider_location_id: string; verified_at: number }>();

  if (!row) return null;
  if (nowSec() - row.verified_at < LOCATION_CACHE_MIN_FRESH_SEC) return row.provider_location_id;
  return null;
}

async function upsertLocationId(
  env: EnvLike,
  store_id: string,
  location_id: string,
  match_method: string,
  match_score: number
) {
  const t = nowSec();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO store_provider_mappings
      (store_id, provider, provider_location_id, match_method, match_score, created_at, verified_at)
     VALUES (?, 'kroger', ?, ?, ?, COALESCE((SELECT created_at FROM store_provider_mappings WHERE store_id = ? AND provider='kroger'), ?), ?)`
  )
    .bind(store_id, location_id, match_method, match_score, store_id, t, t)
    .run();
}

function pickBestLocation(store: LivePriceOverlayInput["store"], locations: KrogerLocation[]) {
  let best: { location: KrogerLocation; dist_m: number } | null = null;
  for (const loc of locations) {
    const d = distanceMeters(store.lat, store.lon, loc.lat, loc.lon);
    if (!best || d < best.dist_m) best = { location: loc, dist_m: d };
  }
  return best;
}

async function resolveLocationId(env: EnvLike, input: LivePriceOverlayInput): Promise<string | null> {
  const memo = await getMappedLocationId(env, input.store.id);
  if (memo) return memo;

  const ok = await takeToken(env.DB, `kroger:${input.session_id}:locations`, RL_LOCATIONS);
  if (!ok) return null;

  const token = await getAccessToken(env, input.session_id);
  const locations = await fetchKrogerLocations(env.DB, {
    access_token: token,
    base_url: env.KROGER_BASE_URL,
    lat: input.store.lat,
    lon: input.store.lon,
    radius_miles: LOCATION_RADIUS_MILES,
    limit: 10,
    user_agent: env.OUTBOUND_USER_AGENT,
    referer: env.OUTBOUND_REFERER
  });

  const best = pickBestLocation(input.store, locations);
  if (!best) return null;

  if (best.dist_m > MATCH_THRESHOLD_METERS) return null;

  const score = Math.max(0, 1 - best.dist_m / MATCH_THRESHOLD_METERS);
  await upsertLocationId(env, input.store.id, best.location.locationId, "auto_nearest", score);
  return best.location.locationId;
}

export async function getKrogerLivePriceOverlay(env: EnvLike, input: LivePriceOverlayInput): Promise<LivePriceOverlayResult> {
  const warnings: string[] = [];
  const prices_by_upc = new Map<string, { price_cents: number; observed_at: number; confidence: number }>();

  if (!isEnabled(env)) return { prices_by_upc, warnings };
  if (!hasCreds(env)) {
    warnings.push("KROGER_MISCONFIGURED_MISSING_CREDS");
    return { prices_by_upc, warnings };
  }

  const upcs = input.upcs.slice(0, MAX_UPCS_PER_QUOTE);

  let locationId: string | null = null;
  try {
    locationId = await resolveLocationId(env, input);
  } catch {
    warnings.push("KROGER_UNAVAILABLE_LOCATION_LOOKUP");
    return { prices_by_upc, warnings };
  }
  if (!locationId) return { prices_by_upc, warnings };

  let token: string;
  try {
    token = await getAccessToken(env, input.session_id);
  } catch {
    warnings.push("KROGER_UNAVAILABLE_AUTH");
    return { prices_by_upc, warnings };
  }

  const observed_at = nowSec();
  let partial = false;

  await mapLimit(upcs, 4, async (upc) => {
    const cacheKey = `kroger:price:${locationId}:${upc}`;
    const cached = await cacheGet<{ price_cents: number; observed_at: number }>(env.DB, cacheKey);

    if (cached && Number.isFinite(cached.price_cents)) {
      prices_by_upc.set(upc, { price_cents: cached.price_cents, observed_at: cached.observed_at, confidence: 0.95 });
      return;
    }

    const ok = await takeToken(env.DB, `kroger:${input.session_id}:products`, RL_PRODUCTS);
    if (!ok) {
      partial = true;
      return;
    }

    try {
      const r = await fetchKrogerProductDetails(env.DB, {
        access_token: token,
        base_url: env.KROGER_BASE_URL,
        location_id: locationId!,
        upc,
        user_agent: env.OUTBOUND_USER_AGENT,
        referer: env.OUTBOUND_REFERER
      });

      if (r.price_cents == null) {
        partial = true;
        return;
      }

      await cachePut(env.DB, cacheKey, { price_cents: r.price_cents, observed_at }, PRICE_CACHE_TTL_SEC);
      prices_by_upc.set(upc, { price_cents: r.price_cents, observed_at, confidence: 0.95 });
    } catch {
      partial = true;
    }
  });

  if (partial) warnings.push("KROGER_PARTIAL_OR_RATE_LIMITED");
  return { prices_by_upc, warnings };
}
