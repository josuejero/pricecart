import type {
  Cart,
  CartAddItemRequest,
  CartQuoteRequest,
  CartQuoteResponse,
  CartSetItemRequest,
  PriceSubmitRequest,
  PriceSubmitResponse,
  ProductLookupResponse,
  ProductSearchResponse,
  StoreSearchResponse
} from "@pricecart/shared";
import { getSessionId } from "./session";

type FetchJsonInit = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

function apiBase(): string {
  // Recommended dev value: http://localhost:8787/api
  return import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/api";
}

export class ApiError extends Error {
  public readonly code: string;
  public readonly requestId: string | null;

  constructor(code: string, requestId: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.requestId = requestId;
  }
}

type ApiErrorPayload = {
  code?: string;
  message?: string;
  request_id?: string;
};

function extractApiErrorPayload(value: unknown): ApiErrorPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { error } = value as { error?: ApiErrorPayload };
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return error;
}

function newRequestId() {
  return crypto.randomUUID();
}

async function apiFetch<T>(url: string, init: FetchJsonInit = {}) {
  const requestId = newRequestId();
  const { json, body: providedBody, ...rest } = init;
  const headers = new Headers(init.headers);
  headers.set("x-pricecart-session", getSessionId());
  headers.set("x-request-id", requestId);

  if (json !== undefined) {
    headers.set("content-type", "application/json");
  }

  const body: BodyInit | undefined = json !== undefined ? JSON.stringify(json) : providedBody;

  const res = await fetch(url, { ...rest, headers, body });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  const serverRequestId = res.headers.get("x-request-id") || requestId;

  if (!res.ok) {
    const errorPayload = extractApiErrorPayload(parsed);
    const code = (errorPayload?.code as string) ?? `HTTP_${res.status}`;
    const message =
      (errorPayload?.message as string) ??
      (errorPayload?.code as string) ??
      `HTTP_${res.status}`;
    const requestIdFromPayload = (errorPayload?.request_id as string) ?? serverRequestId;
    throw new ApiError(code, requestIdFromPayload ?? null, message);
  }

  return { data: parsed as T, requestId: serverRequestId };
}

async function fetchJson<T>(url: string, init: FetchJsonInit = {}): Promise<T> {
  const { data } = await apiFetch<T>(url, init);
  return data;
}

export async function fetchStores(params: { location: string; radius_m?: number }): Promise<StoreSearchResponse> {
  const base = apiBase();
  const url = new URL(base + "/stores/search");
  url.searchParams.set("location", params.location);
  url.searchParams.set("radius_m", String(params.radius_m ?? 1500));
  return fetchJson<StoreSearchResponse>(url.toString());
}

export async function lookupProductByUpc(upc: string): Promise<ProductLookupResponse> {
  const base = apiBase();
  const url = new URL(base + `/products/lookup/${encodeURIComponent(upc)}`);
  return fetchJson<ProductLookupResponse>(url.toString());
}

export async function searchProducts(params: { q: string; page?: number; page_size?: number }): Promise<ProductSearchResponse> {
  const base = apiBase();
  const url = new URL(base + "/products/search");
  url.searchParams.set("q", params.q);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("page_size", String(params.page_size ?? 10));
  return fetchJson<ProductSearchResponse>(url.toString());
}

// -------------------------
// Phase 3: Cart
// -------------------------

export async function getCart(): Promise<Cart> {
  const base = apiBase();
  const url = new URL(base + "/cart");
  return fetchJson<Cart>(url.toString());
}

export async function addCartItem(req: CartAddItemRequest): Promise<Cart> {
  const base = apiBase();
  const url = new URL(base + "/cart/items");
  return fetchJson<Cart>(url.toString(), { method: "POST", json: req });
}

export async function setCartItem(upc: string, req: CartSetItemRequest): Promise<Cart> {
  const base = apiBase();
  const url = new URL(base + `/cart/items/${encodeURIComponent(upc)}`);
  return fetchJson<Cart>(url.toString(), { method: "PATCH", json: req });
}

export async function removeCartItem(upc: string): Promise<Cart> {
  const base = apiBase();
  const url = new URL(base + `/cart/items/${encodeURIComponent(upc)}`);
  return fetchJson<Cart>(url.toString(), { method: "DELETE" });
}

export async function clearCart(): Promise<Cart> {
  const base = apiBase();
  const url = new URL(base + "/cart/clear");
  return fetchJson<Cart>(url.toString(), { method: "POST", json: {} });
}

export async function quoteCart(req: CartQuoteRequest): Promise<CartQuoteResponse> {
  const base = apiBase();
  const url = new URL(base + "/cart/quote");
  return fetchJson<CartQuoteResponse>(url.toString(), { method: "POST", json: req });
}

export async function submitPrice(req: PriceSubmitRequest): Promise<PriceSubmitResponse> {
  const base = apiBase();
  const url = new URL(base + "/prices/submit");
  return fetchJson<PriceSubmitResponse>(url.toString(), { method: "POST", json: req });
}
