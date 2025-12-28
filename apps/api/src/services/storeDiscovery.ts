import type { StoreSearchResponse } from "@pricecart/shared";
import { cacheGet, cachePut } from "../lib/cache";
import { distanceMeters } from "../lib/geo";
import { sha256Base64Url } from "../lib/hash";
import { takeToken } from "../lib/rateLimit";
import { nowSec } from "../lib/time";
import { geocode } from "../providers/nominatim";
import { queryNearbyStores } from "../providers/overpass";

const TTL_GEOCODE_SEC = 60 * 60 * 24 * 30; // 30 days
const TTL_STORES_SEC = 60 * 60 * 24;      // 1 day

// Budgets (demo-friendly, provider-friendly)
const RL_GEOCODE = { capacity: 10, refillPerSec: 1 / 10, cost: 1 };   // ~10/min max per session
const RL_OVERPASS = { capacity: 10, refillPerSec: 1 / 30, cost: 1 };  // ~10/5min max per session

export async function storeSearch(
  env: { DB: D1Database; OUTBOUND_USER_AGENT?: string; OUTBOUND_REFERER?: string },
  input: { location: string; radius_m: number; session_id: string }
): Promise<StoreSearchResponse> {
  const radius = Math.min(Math.max(input.radius_m, 250), 20000); // clamp 250m..20km

  // 1) Geocode with caching + rate limit
  const locNorm = input.location.trim().toLowerCase();
  const geoKey = `geo:${await sha256Base64Url(locNorm)}`;
  let center = await cacheGet<{ lat: number; lon: number }>(env.DB, geoKey);

  if (!center) {
    const ok = await takeToken(env.DB, `rl:${input.session_id}:nominatim`, RL_GEOCODE);
    if (!ok) throw new Error("RATE_LIMIT_GEOCODE");

    try {
      const g = await geocode(env, input.location);
      center = { lat: g.lat, lon: g.lon };
      await cachePut(env.DB, geoKey, center, TTL_GEOCODE_SEC);
    } catch (geocodeErr) {
      try {
        const fallback = await seedResponse(env, radius);
        console.log(
          JSON.stringify({
            level: "warn",
            message: "geocode failed, falling back to seeded stores",
            err: String(geocodeErr)
          })
        );
        return fallback;
      } catch {
        throw geocodeErr;
      }
    }
  }

  // 2) Store query with caching + rate limit + fallback
  const storesKey = `stores:${await sha256Base64Url(
    `${center.lat.toFixed(3)},${center.lon.toFixed(3)}:r=${radius}`
  )}`;

  const cached = await cacheGet<{ stores: StoreSearchResponse["stores"] }>(env.DB, storesKey);
  if (cached?.stores?.length) {
    return {
      center,
      radius_m: radius,
      data_mode: "cache",
      stores: cached.stores,
      attribution: osmAttribution()
    };
  }

  // Try live Overpass, else seed fallback.
  try {
    const ok = await takeToken(env.DB, `rl:${input.session_id}:overpass`, RL_OVERPASS);
    if (!ok) throw new Error("RATE_LIMIT_OVERPASS");

    const raw = await queryNearbyStores(env, center, radius);

    const stores = raw
      .map((s) => ({
        id: s.external_id,
        name: s.name,
        lat: s.lat,
        lon: s.lon,
        distance_m: Math.round(distanceMeters(center, { lat: s.lat, lon: s.lon })),
        tags: s.tags
      }))
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 50);

    await cachePut(env.DB, storesKey, { stores }, TTL_STORES_SEC);

    // Opportunistic upsert into stores table (useful later, not required to return)
    const t = nowSec();
    const stmt = env.DB.prepare(
      "INSERT OR REPLACE INTO stores (id, source, external_id, name, lat, lon, tags_json, last_seen_at) VALUES (?, 'osm', ?, ?, ?, ?, ?, ?)"
    );
    const batch = stores.map((st) =>
      stmt.bind(st.id, st.id, st.name, st.lat, st.lon, JSON.stringify(st.tags ?? {}), t)
    );
    await env.DB.batch(batch);

    return {
      center,
      radius_m: radius,
      data_mode: "live",
      stores,
      attribution: osmAttribution()
    };
  } catch {
    return seedResponse(env, radius, center);
  }
}

function safeJson(s: string | null | undefined): Record<string, string> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, string>;
  } catch {
    return {};
  }
}

function osmAttribution() {
  return {
    text: "© OpenStreetMap contributors",
    links: [{ label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }]
  };
}

async function seedResponse(
  env: { DB: D1Database },
  radius: number,
  centerOverride?: { lat: number; lon: number }
): Promise<StoreSearchResponse> {
  const seed = await env.DB
    .prepare("SELECT id, name, lat, lon, tags_json FROM stores WHERE source = 'seed'")
    .all<{ id: string; name: string; lat: number; lon: number; tags_json: string }>();

  const rows = seed.results || [];
  const center =
    centerOverride ?? (rows.length ? centerFromSeedRows(rows) : null);

  if (!center) throw new Error("NO_SEED_STORES");

  const stores = rows
    .map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      distance_m: Math.round(distanceMeters(center, { lat: s.lat, lon: s.lon })),
      tags: safeJson(s.tags_json)
    }))
    .sort((a, b) => a.distance_m - b.distance_m);

  return {
    center,
    radius_m: radius,
    data_mode: "seed",
    stores,
    attribution: osmAttribution()
  };
}

function centerFromSeedRows(rows: Array<{ lat: number; lon: number }>) {
  if (!rows.length) return null;

  const { lat, lon } = rows.reduce(
    (acc, row) => {
      acc.lat += row.lat;
      acc.lon += row.lon;
      return acc;
    },
    { lat: 0, lon: 0 }
  );

  return { lat: lat / rows.length, lon: lon / rows.length };
}
