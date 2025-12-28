import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";
import { fetchWithRetry, HttpError, RetryOptions, TimeoutError } from "../lib/http";
import { noteProviderOutcome } from "../lib/providerMetrics";

export type OverpassStore = {
  external_id: string;
  name: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
};

const PROVIDER = "overpass";
const ENDPOINT = "https://overpass-api.de/api/interpreter";
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

function buildHeaders(env: ProviderEnv) {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
    "User-Agent": env.OUTBOUND_USER_AGENT || "PriceCart/0.1 (phase6)",
    Referer: env.OUTBOUND_REFERER || "https://example.invalid"
  };
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

async function performQuery(env: ProviderEnv, body: string) {
  const timeoutMs = getTimeoutMs(env);
  const res = await fetchWithRetry(
    ENDPOINT,
    {
      method: "POST",
      headers: buildHeaders(env),
      body
    },
    { timeoutMs, retry: RETRY_OPTIONS, isIdempotent: true }
  );

  if (!res.ok) {
    throw new HttpError(`Overpass HTTP ${res.status}`, res.status, ENDPOINT);
  }

  return res;
}

export async function queryNearbyStores(
  env: ProviderEnv,
  center: { lat: number; lon: number },
  radiusM: number
): Promise<OverpassStore[]> {
  if (await isOpen(env.DB, PROVIDER)) throw new Error("PROVIDER_OPEN");
  const enabled = env.METRICS_ENABLED === "1";

  const query = `
[out:json][timeout:25];
(
  node[shop=supermarket](around:${radiusM},${center.lat},${center.lon});
  node[shop=convenience](around:${radiusM},${center.lat},${center.lon});
  node[shop=greengrocer](around:${radiusM},${center.lat},${center.lon});
);
out body;
`;

  try {
    const body = new URLSearchParams({ data: query }).toString();
    const res = await performQuery(env, body);
    const json = (await res.json()) as {
      elements: Array<{ type: string; id: number; lat: number; lon: number; tags?: Record<string, string> }>;
    };

    const stores: OverpassStore[] = (json.elements || [])
      .filter((e) => e.type === "node")
      .map((e) => {
        const tags = e.tags || {};
        const name = tags.name || tags.brand || "Unnamed store";
        return {
          external_id: `osm:${e.type}/${e.id}`,
          name,
          lat: e.lat,
          lon: e.lon,
          tags
        };
      });

    await recordSuccess(env.DB, PROVIDER);
    await noteProviderOutcome({ db: env.DB, enabled, provider: PROVIDER, outcome: "success" });
    return stores;
  } catch (e) {
    await noteProviderOutcome({ db: env.DB, enabled, provider: PROVIDER, outcome: classifyError(e) });
    await recordFailure(env.DB, PROVIDER);
    throw e;
  }
}
