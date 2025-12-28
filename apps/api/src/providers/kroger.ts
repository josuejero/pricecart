import { z } from "zod";
import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";
import { fetchWithRetry, HttpError, RetryOptions, TimeoutError } from "../lib/http";
import { noteProviderOutcome } from "../lib/providerMetrics";

const PROVIDER = "kroger";

function b64(s: string) {
  const globalScope = globalThis as typeof globalThis & { btoa?: (input: string) => string };
  if (typeof globalScope.btoa === "function") return globalScope.btoa(s);
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

const RETRY_OPTIONS: RetryOptions = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2000,
  retryOnStatuses: [429, 500, 502, 503, 504]
};

type ProviderEnv = {
  DB: D1Database;
  OUTBOUND_USER_AGENT?: string;
  OUTBOUND_REFERER?: string;
  METRICS_ENABLED?: string;
  PROVIDER_TIMEOUT_MS?: string;
};

function getTimeoutMs(env: ProviderEnv) {
  const parsed = Number(env.PROVIDER_TIMEOUT_MS ?? "6000");
  return Number.isFinite(parsed) ? parsed : 6000;
}

function classifyError(err: unknown): string {
  if (err instanceof TimeoutError) return "timeout";
  if (err instanceof HttpError) {
    if (err.status === 429) return "rate_limited";
    if (err.status >= 500) return "http_5xx";
    if (err.status >= 400) return "http_4xx";
  }
  if (err instanceof SyntaxError) return "parse_error";
  return "other";
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
  env: ProviderEnv,
  opts: {
    client_id: string;
    client_secret: string;
    token_url?: string;
    scope?: string;
    user_agent?: string;
    referer?: string;
  }
): Promise<KrogerToken> {
  if (await isOpen(env.DB, PROVIDER)) throw new Error("KROGER_CIRCUIT_OPEN");
  const enabled = env.METRICS_ENABLED === "1";
  const tokenUrl = opts.token_url ?? "https://api.kroger.com/v1/connect/oauth2/token";
  const scope = opts.scope ?? "product.compact";
  const auth = b64(`${opts.client_id}:${opts.client_secret}`);
  const timeoutMs = getTimeoutMs(env);

  try {
    const res = await fetchWithRetry(
      tokenUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          ...(opts.user_agent ? { "User-Agent": opts.user_agent } : {}),
          ...(opts.referer ? { Referer: opts.referer } : {}),
          ...(env.OUTBOUND_USER_AGENT && !opts.user_agent ? { "User-Agent": env.OUTBOUND_USER_AGENT } : {}),
          ...(env.OUTBOUND_REFERER && !opts.referer ? { Referer: env.OUTBOUND_REFERER } : {})
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope
        }).toString()
      },
      { timeoutMs, retry: RETRY_OPTIONS, isIdempotent: true }
    );

    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(`KROGER_TOKEN_HTTP_${res.status}: ${text.slice(0, 300)}`, res.status, tokenUrl);
    }

    const json = JSON.parse(text);
    const parsed = parseKrogerTokenResponse(json);
    await recordSuccess(env.DB, PROVIDER);
    await noteProviderOutcome({ db: env.DB, enabled, provider: "kroger_token", outcome: "success" });
    return parsed;
  } catch (e) {
    await noteProviderOutcome({
      db: env.DB,
      enabled,
      provider: "kroger_token",
      outcome: classifyError(e)
    });
    await recordFailure(env.DB, PROVIDER);
    throw e;
  }
}

export async function fetchKrogerLocations(
  env: ProviderEnv,
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
  if (await isOpen(env.DB, PROVIDER)) throw new Error("KROGER_CIRCUIT_OPEN");
  const enabled = env.METRICS_ENABLED === "1";
  const timeoutMs = getTimeoutMs(env);
  const baseUrl = opts.base_url ?? "https://api.kroger.com/v1";
  const radius = opts.radius_miles ?? 2;
  const limit = opts.limit ?? 10;

  const url = new URL(`${baseUrl}/locations`);
  url.searchParams.set("filter.latLong.near", `${opts.lat},${opts.lon}`);
  url.searchParams.set("filter.radiusInMiles", String(radius));
  url.searchParams.set("filter.limit", String(limit));

  try {
    const res = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${opts.access_token}`,
          Accept: "application/json",
          ...(opts.user_agent ? { "User-Agent": opts.user_agent } : {}),
          ...(opts.referer ? { Referer: opts.referer } : {}),
          ...(env.OUTBOUND_USER_AGENT && !opts.user_agent ? { "User-Agent": env.OUTBOUND_USER_AGENT } : {}),
          ...(env.OUTBOUND_REFERER && !opts.referer ? { Referer: env.OUTBOUND_REFERER } : {})
        }
      },
      { timeoutMs, retry: RETRY_OPTIONS }
    );

    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(`KROGER_LOCATIONS_HTTP_${res.status}: ${text.slice(0, 300)}`, res.status, url.toString());
    }

    const json = JSON.parse(text);
    const parsed = parseKrogerLocationsResponse(json);
    await recordSuccess(env.DB, PROVIDER);
    await noteProviderOutcome({ db: env.DB, enabled, provider: "kroger_locations", outcome: "success" });
    return parsed;
  } catch (e) {
    await noteProviderOutcome({
      db: env.DB,
      enabled,
      provider: "kroger_locations",
      outcome: classifyError(e)
    });
    await recordFailure(env.DB, PROVIDER);
    throw e;
  }
}

export async function fetchKrogerProductDetails(
  env: ProviderEnv,
  opts: {
    access_token: string;
    base_url?: string;
    location_id: string;
    upc: string;
    user_agent?: string;
    referer?: string;
  }
): Promise<KrogerProductPrice> {
  if (await isOpen(env.DB, PROVIDER)) throw new Error("KROGER_CIRCUIT_OPEN");
  const enabled = env.METRICS_ENABLED === "1";
  const timeoutMs = getTimeoutMs(env);
  const baseUrl = opts.base_url ?? "https://api.kroger.com/v1";
  const url = new URL(`${baseUrl}/products/${encodeURIComponent(opts.upc)}`);
  url.searchParams.set("filter.locationId", opts.location_id);

  try {
    const res = await fetchWithRetry(
      url.toString(),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${opts.access_token}`,
          Accept: "application/json",
          ...(opts.user_agent ? { "User-Agent": opts.user_agent } : {}),
          ...(opts.referer ? { Referer: opts.referer } : {}),
          ...(env.OUTBOUND_USER_AGENT && !opts.user_agent ? { "User-Agent": env.OUTBOUND_USER_AGENT } : {}),
          ...(env.OUTBOUND_REFERER && !opts.referer ? { Referer: env.OUTBOUND_REFERER } : {})
        }
      },
      { timeoutMs, retry: RETRY_OPTIONS }
    );

    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(`KROGER_PRODUCT_HTTP_${res.status}: ${text.slice(0, 300)}`, res.status, url.toString());
    }

    const json = JSON.parse(text);
    const parsed = parseKrogerProductDetailsResponse(json, opts.upc);
    await recordSuccess(env.DB, PROVIDER);
    await noteProviderOutcome({ db: env.DB, enabled, provider: "kroger_products", outcome: "success" });
    return parsed;
  } catch (e) {
    await noteProviderOutcome({
      db: env.DB,
      enabled,
      provider: "kroger_products",
      outcome: classifyError(e)
    });
    await recordFailure(env.DB, PROVIDER);
    throw e;
  }
}
