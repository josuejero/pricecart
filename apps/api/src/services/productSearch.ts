import { cacheGet, cachePut } from "../lib/cache";
import { sha256Base64Url } from "../lib/hash";
import { takeToken } from "../lib/rateLimit";

const TTL_OFF_SEARCH_SEC = 60 * 60; // 1 hour cache
const RL_OFF_SEARCH = { capacity: 10, refillPerSec: 1 / 6, cost: 1 }; // ~10/min per session

type OffSearchResponse = {
  products?: unknown[];
  count?: number | string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

type EnvLike = {
  DB: D1Database;
  OUTBOUND_USER_AGENT?: string;
  OUTBOUND_REFERER?: string;
  OFF_BASE_URL?: string; // optional
};

export type ProductSummary = {
  code: string;
  product_name?: string;
  brands?: string;
  quantity?: string;
  image_url?: string;
  nutriscore_grade?: string;
};

export type ProductSearchResponse = {
  q: string;
  page: number;
  page_size: number;
  total_count: number;
  products: ProductSummary[];
  attribution: {
    text: string;
    links: { label: string; href: string }[];
  };
};

export async function productSearch(
  env: EnvLike,
  input: { q: string; page: number; page_size: number; session_id: string }
): Promise<ProductSearchResponse> {
  const q = input.q.trim();
  const page = Math.max(1, input.page);
  const pageSize = Math.min(Math.max(1, input.page_size), 50);

  const cacheKey = `off:search:${await sha256Base64Url(
    `${q.toLowerCase()}|p=${page}|s=${pageSize}`
  )}`;

  const cached = await cacheGet<ProductSearchResponse>(env.DB, cacheKey);
  if (cached) return cached;

  const ok = await takeToken(env.DB, `rl:${input.session_id}:off_search`, RL_OFF_SEARCH);
  if (!ok) throw new Error("RATE_LIMIT_OFF_SEARCH");

  const base = (env.OFF_BASE_URL || "https://world.openfoodfacts.org").replace(/\/+$/, "");
  const url = new URL(`${base}/cgi/search.pl`);
  url.searchParams.set("action", "process");
  url.searchParams.set("search_terms", q);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("json", "1");
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(pageSize));

  const headers = new Headers();
  // OFF asks for a custom User-Agent to identify your app. :contentReference[oaicite:2]{index=2}
  headers.set("User-Agent", env.OUTBOUND_USER_AGENT || "PriceCart/0.1 (dev)");
  if (env.OUTBOUND_REFERER) headers.set("Referer", env.OUTBOUND_REFERER);

  const resp = await fetch(url.toString(), { headers });
  if (resp.status === 429) throw new Error("RATE_LIMIT_OFF_REMOTE");
  if (!resp.ok) throw new Error(`OFF_HTTP_${resp.status}`);

  const rawData = await resp.json();
  const data = isRecord(rawData) ? (rawData as OffSearchResponse) : {};
  const productsRaw: unknown[] = Array.isArray(data.products) ? data.products : [];

  const products: ProductSummary[] = productsRaw
    .map((p) => {
      if (!isRecord(p)) return null;
      const code = toStringValue(p["code"])?.trim();
      if (!code) return null;

      return {
        code,
        product_name: toStringValue(p["product_name"]) ?? toStringValue(p["product_name_en"]),
        brands: toStringValue(p["brands"]),
        quantity: toStringValue(p["quantity"]),
        image_url: toStringValue(p["image_url"]),
        nutriscore_grade: toStringValue(p["nutriscore_grade"])
      } satisfies ProductSummary;
    })
    .filter(Boolean) as ProductSummary[];

  const out: ProductSearchResponse = {
    q,
    page,
    page_size: pageSize,
    total_count: toNumberValue(data.count) ?? products.length,
    products,
    attribution: {
      text: "Data from Open Food Facts",
      links: [{ label: "Open Food Facts", href: "https://world.openfoodfacts.org/" }]
    }
  };

  await cachePut(env.DB, cacheKey, out, TTL_OFF_SEARCH_SEC);
  return out;
}
