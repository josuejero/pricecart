import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";
import { fetchWithRetry, HttpError, RetryOptions, TimeoutError } from "../lib/http";
import { noteProviderOutcome } from "../lib/providerMetrics";

const PROVIDER = "nominatim";
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

async function performGet(env: ProviderEnv, url: string) {
  const timeoutMs = getTimeoutMs(env);
  const res = await fetchWithRetry(
    url,
    {
      method: "GET",
      headers: buildHeaders(env)
    },
    { timeoutMs, retry: RETRY_OPTIONS }
  );

  if (!res.ok) {
    throw new HttpError(`Nominatim HTTP ${res.status}`, res.status, url);
  }

  return res;
}

export type GeocodeResult = { lat: number; lon: number; display_name?: string };

export async function geocode(env: ProviderEnv, location: string): Promise<GeocodeResult> {
  const provider = PROVIDER;
  if (await isOpen(env.DB, provider)) throw new Error("PROVIDER_OPEN");
  const enabled = env.METRICS_ENABLED === "1";

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", location);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  try {
    const res = await performGet(env, url.toString());
    const json = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;

    if (!json[0]) {
      await recordSuccess(env.DB, provider);
      throw new Error("NOT_FOUND");
    }

    await recordSuccess(env.DB, provider);
    await noteProviderOutcome({ db: env.DB, enabled, provider, outcome: "success" });
    return {
      lat: Number(json[0].lat),
      lon: Number(json[0].lon),
      display_name: json[0].display_name
    };
  } catch (e) {
    await noteProviderOutcome({ db: env.DB, enabled, provider, outcome: classifyError(e) });
    await recordFailure(env.DB, provider);
    throw e;
  }
}
