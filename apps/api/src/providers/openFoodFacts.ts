import { z } from "zod";
import { isOpen, recordFailure, recordSuccess } from "../lib/circuitBreaker";
import { fetchWithRetry, HttpError, RetryOptions, TimeoutError } from "../lib/http";
import { noteProviderOutcome } from "../lib/providerMetrics";

export const OFF_ATTRIBUTION = {
  text: "Data from Open Food Facts",
  links: [
    { label: "Open Food Facts", href: "https://world.openfoodfacts.org" },
    { label: "API", href: "https://openfoodfacts.github.io/openfoodfacts-server/api/" }
  ]
};

export type OffProductRaw = {
  code: string;
  product_name: string | null;
  brands: string | null;
  quantity: string | null;
  image_front_url: string | null;
  url: string | null;
  last_modified_t: number | null;
};

const OffProductSchema = z
  .object({
    code: z.string().optional(),
    product_name: z.string().optional(),
    brands: z.string().optional(),
    quantity: z.string().optional(),
    image_front_url: z.string().url().optional(),
    url: z.string().url().optional(),
    last_modified_t: z.number().optional()
  })
  .passthrough();

const OffLookupSchema = z
  .object({
    status: z.number(),
    status_verbose: z.string().optional(),
    product: OffProductSchema.optional()
  })
  .passthrough();

const OffSearchSchema = z
  .object({
    count: z.number().optional(),
    page: z.number().optional(),
    page_size: z.number().optional(),
    products: z.array(OffProductSchema).default([])
  })
  .passthrough();

export function parseOffLookupResponse(json: unknown, upc: string): OffProductRaw {
  const parsed = OffLookupSchema.safeParse(json);
  if (!parsed.success) throw new Error("OFF_SCHEMA");

  if (parsed.data.status !== 1 || !parsed.data.product) throw new Error("NOT_FOUND");

  const p = parsed.data.product;
  return {
    code: String(p.code ?? upc),
    product_name: p.product_name ?? null,
    brands: p.brands ?? null,
    quantity: p.quantity ?? null,
    image_front_url: p.image_front_url ?? null,
    url: p.url ?? null,
    last_modified_t: p.last_modified_t ?? null
  };
}

export function parseOffSearchResponse(json: unknown): {
  total: number;
  page: number;
  page_size: number;
  products: OffProductRaw[];
} {
  const parsed = OffSearchSchema.safeParse(json);
  if (!parsed.success) throw new Error("OFF_SCHEMA");

  const total = parsed.data.count ?? parsed.data.products.length;
  const page = parsed.data.page ?? 1;
  const page_size = parsed.data.page_size ?? parsed.data.products.length;

  const products: OffProductRaw[] = parsed.data.products.map((p) => ({
    code: String(p.code ?? ""),
    product_name: p.product_name ?? null,
    brands: p.brands ?? null,
    quantity: p.quantity ?? null,
    image_front_url: p.image_front_url ?? null,
    url: p.url ?? null,
    last_modified_t: p.last_modified_t ?? null
  }));

  return { total, page, page_size, products };
}

const PROVIDER = "openfoodfacts";
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
  OFF_BASE_URL?: string;
  METRICS_ENABLED?: string;
  PROVIDER_TIMEOUT_MS?: string;
};

function getTimeoutMs(env: ProviderEnv) {
  const parsed = Number(env.PROVIDER_TIMEOUT_MS ?? "6000");
  return Number.isFinite(parsed) ? parsed : 6000;
}

function buildHeaders(env: ProviderEnv) {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": env.OUTBOUND_USER_AGENT || "PriceCart/0.1 (phase6)"
  };
  if (env.OUTBOUND_REFERER) {
    headers.Referer = env.OUTBOUND_REFERER;
  }
  return headers;
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

async function fetchJsonWithRetry(env: ProviderEnv, url: string) {
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
    throw new HttpError(`OFF_HTTP_${res.status}`, res.status, url);
  }

  return res.json();
}

export async function offLookupByUpc(env: ProviderEnv, upc: string): Promise<OffProductRaw> {
  const provider = PROVIDER;
  if (await isOpen(env.DB, provider)) throw new Error("PROVIDER_OPEN");
  const enabled = env.METRICS_ENABLED === "1";

  const base = (env.OFF_BASE_URL || "https://world.openfoodfacts.org").replace(/\/+$/, "");
  const url = new URL(`${base}/api/v2/product/${encodeURIComponent(upc)}.json`);
  url.searchParams.set("fields", "code,product_name,brands,quantity,image_front_url,url,last_modified_t");

  try {
    const json = await fetchJsonWithRetry(env, url.toString());
    const product = parseOffLookupResponse(json, upc);
    await recordSuccess(env.DB, provider);
    await noteProviderOutcome({ db: env.DB, enabled, provider, outcome: "success" });
    return product;
  } catch (e) {
    await noteProviderOutcome({ db: env.DB, enabled, provider, outcome: classifyError(e) });
    await recordFailure(env.DB, provider);
    throw e;
  }
}

export async function offSearch(
  env: ProviderEnv,
  q: string,
  page: number,
  pageSize: number
): Promise<{ total: number; page: number; page_size: number; products: OffProductRaw[] }> {
  const provider = PROVIDER;
  if (await isOpen(env.DB, provider)) throw new Error("PROVIDER_OPEN");
  const enabled = env.METRICS_ENABLED === "1";

  const base = (env.OFF_BASE_URL || "https://world.openfoodfacts.org").replace(/\/+$/, "");
  const url = new URL(`${base}/api/v2/search`);
  url.searchParams.set("search_terms", q);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));
  url.searchParams.set("fields", "code,product_name,brands,quantity,image_front_url,url,last_modified_t");

  try {
    const json = await fetchJsonWithRetry(env, url.toString());
    const parsed = parseOffSearchResponse(json);
    await recordSuccess(env.DB, provider);
    await noteProviderOutcome({ db: env.DB, enabled, provider, outcome: "success" });
    return { total: parsed.total, page: parsed.page, page_size: parsed.page_size, products: parsed.products };
  } catch (e) {
    await noteProviderOutcome({ db: env.DB, enabled, provider, outcome: classifyError(e) });
    await recordFailure(env.DB, provider);
    throw e;
  }
}
