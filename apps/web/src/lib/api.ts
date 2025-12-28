import type { ProductLookupResponse, ProductSearchResponse, StoreSearchResponse } from "@pricecart/shared";
import { getSessionId } from "./session";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      "x-pricecart-session": getSessionId()
    }
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `HTTP_${res.status}`);
  }

  return (await res.json()) as T;
}

export async function fetchStores(params: { location: string; radius_m: number }): Promise<StoreSearchResponse> {
  const base = import.meta.env.VITE_API_BASE_URL;
  const url = new URL(base + "/stores/search");
  url.searchParams.set("location", params.location);
  url.searchParams.set("radius_m", String(params.radius_m));
  return fetchJson<StoreSearchResponse>(url.toString());
}

export async function lookupProductByUpc(upc: string): Promise<ProductLookupResponse> {
  const base = import.meta.env.VITE_API_BASE_URL;
  const url = new URL(base + `/products/lookup/${encodeURIComponent(upc)}`);
  return fetchJson<ProductLookupResponse>(url.toString());
}

export async function searchProducts(params: { q: string; page?: number; page_size?: number }): Promise<ProductSearchResponse> {
  const base = import.meta.env.VITE_API_BASE_URL;
  const url = new URL(base + "/products/search");
  url.searchParams.set("q", params.q);
  url.searchParams.set("page", String(params.page ?? 1));
  url.searchParams.set("page_size", String(params.page_size ?? 10));
  return fetchJson<ProductSearchResponse>(url.toString());
}