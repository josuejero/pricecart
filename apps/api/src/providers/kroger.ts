import { z } from "zod";
import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";

const PROVIDER = "kroger";

function b64(s: string) {
  const g: any = globalThis as any;
  if (typeof g.btoa === "function") return g.btoa(s);
  return Buffer.from(s, "utf8").toString("base64");
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toCents(v: unknown): number | null {
  const n = toNumber(v);
  if (n === null) return null;
  return Math.round(n * 100);
}

/** ---------------- Token ---------------- */
const TokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.string().optional(),
    expires_in: z.union([z.number(), z.string()]).optional(),
    scope: z.string().optional()
  })
  .passthrough();

export type KrogerToken = {
  access_token: string;
  expires_in_sec: number | null;
  scope: string | null;
};

export function parseKrogerTokenResponse(json: unknown): KrogerToken {
  const r = TokenResponseSchema.parse(json);
  const exp = toNumber(r.expires_in);
  return {
    access_token: r.access_token,
    expires_in_sec: exp === null ? null : Math.floor(exp),
    scope: r.scope ?? null
  };
}

/** ---------------- Locations ---------------- */
const KrogerLocationSchema = z
  .object({
    locationId: z.string(),
    name: z.string().optional().nullable(),
    chain: z.string().optional().nullable(),
    geolocation: z
      .object({
        latitude: z.union([z.number(), z.string()]).optional(),
        longitude: z.union([z.number(), z.string()]).optional()
      })
      .optional()
      .nullable(),
    latitude: z.union([z.number(), z.string()]).optional(),
    longitude: z.union([z.number(), z.string()]).optional()
  })
  .passthrough();

const KrogerLocationsResponseSchema = z
  .object({
    data: z.array(KrogerLocationSchema).default([])
  })
  .passthrough();

export type KrogerLocation = {
  locationId: string;
  name: string | null;
  chain: string | null;
  lat: number;
  lon: number;
};

export function parseKrogerLocationsResponse(json: unknown): KrogerLocation[] {
  const r = KrogerLocationsResponseSchema.parse(json);
  const out: KrogerLocation[] = [];

  for (const loc of r.data) {
    const lat =
      toNumber(loc.geolocation?.latitude) ??
      toNumber(loc.latitude) ??
      null;
    const lon =
      toNumber(loc.geolocation?.longitude) ??
      toNumber(loc.longitude) ??
      null;

    if (lat === null || lon === null) continue;

    out.push({
      locationId: loc.locationId,
      name: loc.name ?? null,
      chain: loc.chain ?? null,
      lat,
      lon
    });
  }

  return out;
}

/** ---------------- Product details ---------------- */
const KrogerPriceSchema = z
  .object({
    regular: z.union([z.number(), z.string()]).optional(),
    promo: z.union([z.number(), z.string()]).optional()
  })
  .passthrough();

const KrogerItemSchema = z
  .object({
    price: KrogerPriceSchema.optional().nullable()
  })
  .passthrough();

const KrogerProductSchema = z
  .object({
    upc: z.string().optional(),
    items: z.array(KrogerItemSchema).optional().nullable()
  })
  .passthrough();

const KrogerProductDetailsResponseSchema = z
  .object({
    data: z.union([KrogerProductSchema, z.array(KrogerProductSchema)]).optional()
  })
  .passthrough();

export type KrogerProductPrice = {
  upc: string;
  price_cents: number | null;
};

export function parseKrogerProductDetailsResponse(json: unknown, upcFallback: string): KrogerProductPrice {
  const r = KrogerProductDetailsResponseSchema.parse(json);
  const data = Array.isArray(r.data) ? r.data[0] : r.data;
  if (!data) return { upc: upcFallback, price_cents: null };

  const upc = data.upc ?? upcFallback;
  const item = data.items?.[0];
  const price = item?.price ?? null;

  const promo = price ? toCents(price.promo) : null;
  const regular = price ? toCents(price.regular) : null;

  return { upc, price_cents: promo ?? regular ?? null };
}

/** ---------------- HTTP calls (with circuit breaker) ---------------- */
export async function fetchKrogerToken(
  db: D1Database,
  opts: {
    client_id: string;
    client_secret: string;
    token_url?: string;
    scope?: string;
    user_agent?: string;
    referer?: string;
  }
): Promise<KrogerToken> {
  if (await isOpen(db, PROVIDER)) throw new Error("KROGER_CIRCUIT_OPEN");

  const tokenUrl = opts.token_url ?? "https://api.kroger.com/v1/connect/oauth2/token";
  const scope = opts.scope ?? "product.compact";
  const auth = b64(`${opts.client_id}:${opts.client_secret}`);

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(opts.user_agent ? { "User-Agent": opts.user_agent } : {}),
        ...(opts.referer ? { Referer: opts.referer } : {})
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope
      }).toString()
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`KROGER_TOKEN_HTTP_${res.status}: ${text.slice(0, 300)}`);

    const json = JSON.parse(text);
    const parsed = parseKrogerTokenResponse(json);
    await recordSuccess(db, PROVIDER);
    return parsed;
  } catch (e) {
    await recordFailure(db, PROVIDER);
    throw e;
  }
}

export async function fetchKrogerLocations(
  db: D1Database,
  opts: {
    access_token: string;
    base_url?: string;
    lat: number;
    lon: number;
    radius_miles?: number;
    limit?: number;
    user_agent?: string;
    referer?: string;
  }
): Promise<KrogerLocation[]> {
  if (await isOpen(db, PROVIDER)) throw new Error("KROGER_CIRCUIT_OPEN");

  const baseUrl = opts.base_url ?? "https://api.kroger.com/v1";
  const radius = opts.radius_miles ?? 2;
  const limit = opts.limit ?? 10;

  const url = new URL(`${baseUrl}/locations`);
  url.searchParams.set("filter.latLong.near", `${opts.lat},${opts.lon}`);
  url.searchParams.set("filter.radiusInMiles", String(radius));
  url.searchParams.set("filter.limit", String(limit));

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${opts.access_token}`,
        Accept: "application/json",
        ...(opts.user_agent ? { "User-Agent": opts.user_agent } : {}),
        ...(opts.referer ? { Referer: opts.referer } : {})
      }
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`KROGER_LOCATIONS_HTTP_${res.status}: ${text.slice(0, 300)}`);

    const json = JSON.parse(text);
    const parsed = parseKrogerLocationsResponse(json);
    await recordSuccess(db, PROVIDER);
    return parsed;
  } catch (e) {
    await recordFailure(db, PROVIDER);
    throw e;
  }
}

export async function fetchKrogerProductDetails(
  db: D1Database,
  opts: {
    access_token: string;
    base_url?: string;
    location_id: string;
    upc: string;
    user_agent?: string;
    referer?: string;
  }
): Promise<KrogerProductPrice> {
  if (await isOpen(db, PROVIDER)) throw new Error("KROGER_CIRCUIT_OPEN");

  const baseUrl = opts.base_url ?? "https://api.kroger.com/v1";
  const url = new URL(`${baseUrl}/products/${encodeURIComponent(opts.upc)}`);
  url.searchParams.set("filter.locationId", opts.location_id);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${opts.access_token}`,
        Accept: "application/json",
        ...(opts.user_agent ? { "User-Agent": opts.user_agent } : {}),
        ...(opts.referer ? { Referer: opts.referer } : {})
      }
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`KROGER_PRODUCT_HTTP_${res.status}: ${text.slice(0, 300)}`);

    const json = JSON.parse(text);
    const parsed = parseKrogerProductDetailsResponse(json, opts.upc);
    await recordSuccess(db, PROVIDER);
    return parsed;
  } catch (e) {
    await recordFailure(db, PROVIDER);
    throw e;
  }
}
