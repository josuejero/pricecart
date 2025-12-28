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

type FetchJsonInit = Omit<RequestInit, "body"> & { json?: unknown };

function apiBase(): string {
  // Recommended dev value: http://localhost:8787/api
  return (import.meta as any).env?.VITE_API_BASE_URL ?? "http://localhost:8787/api";
}

async function fetchJson<T>(url: string, init: FetchJsonInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-pricecart-session", getSessionId());

  let body: BodyInit | undefined = undefined;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }

  const res = await fetch(url, { ...init, headers, body });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload?.error || `HTTP_${res.status}`);
  }

  return (await res.json()) as T;
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