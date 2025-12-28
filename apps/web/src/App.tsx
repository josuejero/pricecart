import type { CartLine, CartQuoteResponse, Product, ProductLookupResponse, ProductSearchResponse, StoreSearchResponse } from "@pricecart/shared";
import "leaflet/dist/leaflet.css";
import { useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { ApiError, fetchStores, lookupProductByUpc, quoteCart, searchProducts, submitPrice } from "./lib/api";
import { useCart } from "./lib/cart";
import { AttributionFooter } from "./components/AttributionFooter";

function formatErrorMessage(err: unknown) {
  if (err instanceof ApiError) {
    const friendly =
      err.code === "RATE_LIMITED" || err.code === "HTTP_429"
        ? "Provider is busy; please retry shortly."
        : err.message;
    return `${friendly} (Request ID: ${err.requestId ?? "unknown"})`;
  }
  return err instanceof Error ? err.message : String(err);
}

function qtyLabel(p: { quantity?: { raw: string | null; value: number | null; unit: string | null } | null }) {
  const q = p.quantity;
  if (!q) return "";
  if (q.raw) return q.raw;
  if (q.value && q.unit) return `${q.value} ${q.unit}`;
  return "";
}

function formatObservedAt(observedAt: number | null | undefined) {
  if (!observedAt) return "";
  try {
    return new Date(observedAt * 1000).toLocaleString();
  } catch {
    return "";
  }
}

function sourceLabel(source: string | null | undefined) {
  if (source === "kroger") return "Live price (Kroger)";
  if (source === "open_prices") return "Dataset (Open Prices)";
  if (source === "community") return "Community";
  if (source === "seed") return "Seed";
  return "";
}

const ATTRIBUTION_META = {
  osm: {
    text: "© OpenStreetMap contributors",
    href: "https://www.openstreetmap.org/copyright"
  },
  nominatim: {
    text: "Geocoding by Nominatim (OpenStreetMap)",
    href: "https://operations.osmfoundation.org/policies/nominatim/"
  },
  overpass: {
    text: "POI search via Overpass API (OpenStreetMap)",
    href: "https://dev.overpass-api.de/overpass-doc/en/preface/commons.html"
  },
  openfoodfacts: {
    text: "Data © Open Food Facts contributors",
    href: "https://world.openfoodfacts.org/terms-of-use"
  },
  openprices: {
    text: "Price data © Open Prices contributors",
    href: "https://prices.openfoodfacts.org"
  },
  kroger: {
    text: "Live prices via Kroger API (where available)",
    href: "https://developer.kroger.com/"
  }
} as const;

const ATTRIBUTION_ORDER = ["osm", "nominatim", "overpass", "openfoodfacts", "openprices", "kroger"] as const;

type AttributionId = (typeof ATTRIBUTION_ORDER)[number];

export default function App() {
  const [view, setView] = useState<"stores" | "products" | "cart">("stores");

  // Phase 1: Stores
  const [location, setLocation] = useState("10001");
  const [radius, setRadius] = useState(1500);
  const [stores, setStores] = useState<StoreSearchResponse | null>(null);
  const [sStatus, setSStatus] = useState<string>("");

  // Phase 2: Products
  const [upc, setUpc] = useState("");
  const [lookup, setLookup] = useState<ProductLookupResponse | null>(null);
  const [q, setQ] = useState("");
  const [search, setSearch] = useState<ProductSearchResponse | null>(null);
  const [pStatus, setPStatus] = useState<string>("");

  // Phase 3: Cart
  const cart = useCart();
  const cartItemByUpc = useMemo(() => {
    const m = new Map<string, CartLine>();
    for (const it of cart.cart?.items ?? []) m.set(it.upc, it);
    return m;
  }, [cart.cart]);
  const [quote, setQuote] = useState<CartQuoteResponse | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<string>("");
  const [submitStoreId, setSubmitStoreId] = useState<string>("");
  const [submitUpc, setSubmitUpc] = useState<string>("");
  const [submitPriceCents, setSubmitPriceCents] = useState<number>(0);
  const [submitStatus, setSubmitStatus] = useState<string>("");

  const mapCenter = useMemo(() => {
    const first = stores?.stores?.[0];
    return first ? { lat: first.lat, lon: first.lon } : { lat: 40.7484, lon: -73.9967 }; // Midtown fallback
  }, [stores]);

  const attributionItems = useMemo(() => {
    const selection = new Set<AttributionId>();
    if (stores) {
      selection.add("osm");
      selection.add("nominatim");
      selection.add("overpass");
    }
    if (lookup?.product || (search?.products.length ?? 0) > 0) {
      selection.add("openfoodfacts");
    }
    const sources = new Set<string>();
    for (const store of quote?.stores ?? []) {
      for (const line of store.lines) {
        if (line.source) sources.add(line.source);
      }
    }
    if (sources.has("open_prices")) {
      selection.add("openprices");
    }
    if (sources.has("kroger")) {
      selection.add("kroger");
    }

    return ATTRIBUTION_ORDER
      .filter((id) => selection.has(id))
      .map((id) => ({ id, ...ATTRIBUTION_META[id] }));
  }, [stores, lookup, quote, search]);

  async function onSearchStores() {
    setSStatus("Loading...");
    setStores(null);
    try {
      const res = await fetchStores({ location, radius_m: radius });
      setStores(res);
      setSStatus("");
    } catch (err) {
      setSStatus(formatErrorMessage(err));
    }
  }

  async function onLookupUpc() {
    setPStatus("Loading...");
    setLookup(null);
    try {
      const res = await lookupProductByUpc(upc.trim());
      setLookup(res);
      setPStatus("");
    } catch (err) {
      setPStatus(formatErrorMessage(err));
    }
  }

  async function onSearchProducts() {
    setPStatus("Loading...");
    setSearch(null);
    try {
      const res = await searchProducts({ q: q.trim(), page: 1, page_size: 10 });
      setSearch(res);
      setPStatus("");
    } catch (err) {
      setPStatus(formatErrorMessage(err));
    }
  }

  async function addProductToCart(p: Product) {
    await cart.add(p.upc, 1);
    setView("cart");
  }

  async function onComparePrices() {
    setQuoteStatus("Loading...");
    setQuote(null);

    try {
      const storeIds = (stores?.stores ?? []).slice(0, 3).map((s) => s.id);
      if (storeIds.length === 0) {
        setQuoteStatus("Search stores first (Phase 1). Then compare.");
        return;
      }

      const res = await quoteCart({ store_ids: storeIds });
      setQuote(res);
      setQuoteStatus("");

      // helpful default for submission UI
      setSubmitStoreId(storeIds[0] ?? "");
    } catch (err) {
      setQuoteStatus(formatErrorMessage(err));
    }
  }

  async function onSubmitPrice() {
    setSubmitStatus("Submitting...");
    try {
      await submitPrice({
        store_id: submitStoreId,
        upc: submitUpc.trim(),
        price_cents: submitPriceCents,
        currency: "USD",
        evidence_type: "manual"
      });

      setSubmitStatus("Saved. Re-run compare to see updates.");
    } catch (err) {
      setSubmitStatus(formatErrorMessage(err));
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>PriceCart</h2>
        <nav style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setView("stores")} disabled={view === "stores"}>
            Stores
          </button>
          <button type="button" onClick={() => setView("products")} disabled={view === "products"}>
            Products
          </button>
          <button type="button" onClick={() => setView("cart")} disabled={view === "cart"}>
            Cart {cart.cart ? `(${cart.cart.item_count})` : ""}
          </button>
        </nav>
      </header>

      <hr />

      {view === "stores" && (
        <section>
          <h3>Find nearby stores</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label>
              Location
              <input value={location} onChange={(e) => setLocation(e.target.value)} style={{ marginLeft: 8 }} />
            </label>
            <label>
              Radius (m)
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                style={{ marginLeft: 8, width: 120 }}
              />
            </label>
            <button type="button" onClick={onSearchStores}>
              Search
            </button>
          </div>

          {sStatus && (
            <p role="status" aria-live="polite">
              {sStatus}
            </p>
          )}

          {stores && (
            <>
              <p>
                Data: <b>{stores.data_mode}</b>
              </p>

              <div style={{ height: 360, borderRadius: 12, overflow: "hidden", border: "1px solid #ddd" }}>
                <MapContainer center={[mapCenter.lat, mapCenter.lon]} zoom={14} style={{ height: "100%" }}>
                  <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {stores.stores.map((s) => (
                    <Marker key={s.id} position={[s.lat, s.lon]}>
                      <Popup>
                        <b>{s.name}</b>
                        <div>{Math.round(s.distance_m)}m away</div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>

              <h4>Results</h4>
              <ul>
                {stores.stores.map((s) => (
                  <li key={s.id}>
                    <b>{s.name}</b> - {Math.round(s.distance_m)}m
                  </li>
                ))}
              </ul>

              <small>
                {stores.attribution.text} {stores.attribution.links.map((l) => (
                  <a key={l.href} href={l.href} target="_blank" rel="noreferrer" style={{ marginLeft: 8 }}>
                    {l.label}
                  </a>
                ))}
              </small>
            </>
          )}
        </section>
      )}

      {view === "products" && (
        <section>
          <h3>Find products</h3>

          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                UPC
                <input value={upc} onChange={(e) => setUpc(e.target.value)} style={{ marginLeft: 8 }} />
              </label>
              <button type="button" onClick={onLookupUpc}>
                Lookup
              </button>
              {lookup?.product && (
                <button type="button" onClick={() => addProductToCart(lookup.product)}>
                  Add to cart
                </button>
              )}
            </div>

            {lookup && (
              <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
                <b>{lookup.product.name}</b>
                <div>{lookup.product.brand ?? ""}</div>
                <div style={{ opacity: 0.8 }}>{qtyLabel(lookup.product)}</div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                Search
                <input value={q} onChange={(e) => setQ(e.target.value)} style={{ marginLeft: 8, width: 260 }} />
              </label>
              <button type="button" onClick={onSearchProducts}>
                Search
              </button>
            </div>

            {pStatus && (
              <p role="status" aria-live="polite">
                {pStatus}
              </p>
            )}

            {search && (
              <>
                <p>
                  Results: <b>{search.total}</b>
                </p>
                <ul style={{ display: "grid", gap: 8, paddingLeft: 16 }}>
                  {search.products.map((p) => (
                    <li key={p.upc} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ flex: 1 }}>
                        <b>{p.name}</b> {p.brand ? <span style={{ opacity: 0.8 }}>({p.brand})</span> : null}
                      </span>
                      <button type="button" onClick={() => cart.add(p.upc, 1)}>
                        Add
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>
      )}

      {view === "cart" && (
        <section>
          <h3>Your cart</h3>

          {cart.status === "loading" && (
            <p role="status" aria-live="polite">
              Loading...
            </p>
          )}
          {cart.status === "error" && (
            <p role="status" aria-live="polite">
              Error: {cart.error}
            </p>
          )}

          {cart.cart && cart.cart.item_count === 0 && <p>Your cart is empty. Add items from the Products tab.</p>}

          {cart.cart && cart.cart.item_count > 0 && (
            <>
              <p>
                Items: <b>{cart.cart.item_count}</b> | Total units: <b>{cart.cart.total_units}</b>
              </p>

              <ul style={{ display: "grid", gap: 12, paddingLeft: 16 }}>
                {cart.cart.items.map((it) => (
                  <li key={it.upc} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <div>
                      <b>{it.name}</b>
                      <div style={{ opacity: 0.8 }}>
                        {it.brand ?? ""} {it.quantity?.value && it.quantity?.unit ? `- ${it.quantity.value} ${it.quantity.unit}` : ""}
                      </div>
                      <div style={{ opacity: 0.7, fontSize: 12 }}>{it.upc}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => cart.setQuantity(it.upc, Math.max(1, it.count - 1))}
                        aria-label="Decrease"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={it.count}
                        onChange={(e) => cart.setQuantity(it.upc, Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                        style={{ width: 64 }}
                      />
                      <button
                        type="button"
                        onClick={() => cart.setQuantity(it.upc, Math.min(99, it.count + 1))}
                        aria-label="Increase"
                      >
                        +
                      </button>
                      <button type="button" onClick={() => cart.remove(it.upc)}>
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button type="button" onClick={cart.clear}>
                  Clear cart
                </button>
                <button type="button" onClick={onComparePrices}>
                  Compare prices
                </button>
              </div>

              {quoteStatus && (
                <p role="status" aria-live="polite">
                  {quoteStatus}
                </p>
              )}

              {quote && (
                <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
                  <h4 style={{ marginTop: 0 }}>Price comparison</h4>

                  {quote.cheapest_store_id ? (
                    <p>
                      Cheapest (by completeness, then adjusted total): <b>{quote.cheapest_store_id}</b>
                    </p>
                  ) : null}

                  {quote.warnings?.length ? (
                    <p style={{ opacity: 0.8 }}>
                      Warnings: {quote.warnings.join(", ")}
                    </p>
                  ) : null}

                  <ul style={{ display: "grid", gap: 12, paddingLeft: 16 }}>
                    {[...quote.stores]
                      .sort((a, b) => a.adjusted_total_cents - b.adjusted_total_cents)
                      .map((s) => (
                        <li key={s.store_id}>
                          <b>{s.store_name}</b> ({s.store_id})
                          <div>
                            Total: <b>${(s.total_cents / 100).toFixed(2)}</b> | Missing: <b>{s.missing_count}</b> | Completeness:{" "}
                            <b>{Math.round(s.completeness * 100)}%</b>
                          </div>
                          <div style={{ opacity: 0.8 }}>
                            Adjusted total: <b>${(s.adjusted_total_cents / 100).toFixed(2)}</b>
                          </div>
                          <details style={{ marginTop: 8 }}>
                            <summary>Line items</summary>
                            <ul style={{ paddingLeft: 16, marginTop: 8, display: "grid", gap: 6 }}>
                              {s.lines.map((ln) => {
                                const item = cartItemByUpc.get(ln.upc);
                                const title = item ? `${item.name}${item.brand ? ` (${item.brand})` : ""}` : ln.upc;
                                const when = formatObservedAt(ln.observed_at ?? null);
                                const src = sourceLabel(ln.source ?? null);
                                const metaParts: string[] = [];
                                if (src) metaParts.push(src);
                                if (when) metaParts.push(when);
                                const meta = metaParts.join(" • ");

                                return (
                                  <li key={ln.upc}>
                                    <div>
                                      <b>{title}</b> x{ln.quantity} {item ? qtyLabel(item) : ""}
                                    </div>
                                    {ln.missing ? (
                                      <div style={{ opacity: 0.8 }}>Missing price</div>
                                    ) : (
                                      <div style={{ opacity: 0.9 }}>
                                        ${(ln.extended_price_cents! / 100).toFixed(2)}{" "}
                                        {meta && (
                                          <span style={{ opacity: 0.75 }}>
                                            ({meta})
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        </li>
                      ))}
                  </ul>

                  <hr />

                  <h4>Submit a missing price (manual)</h4>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <label>
                      Store
                      <select value={submitStoreId} onChange={(e) => setSubmitStoreId(e.target.value)} style={{ marginLeft: 8 }}>
                        {(stores?.stores ?? []).slice(0, 10).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.id})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      UPC
                      <input value={submitUpc} onChange={(e) => setSubmitUpc(e.target.value)} style={{ marginLeft: 8, width: 160 }} />
                    </label>

                    <label>
                      Price (cents)
                      <input
                        type="number"
                        value={submitPriceCents}
                        onChange={(e) => setSubmitPriceCents(Number(e.target.value))}
                        style={{ marginLeft: 8, width: 120 }}
                      />
                    </label>

                    <button type="button" onClick={onSubmitPrice}>
                      Submit
                    </button>
                  </div>

                  {submitStatus && (
                    <p role="status" aria-live="polite">
                      {submitStatus}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <AttributionFooter items={attributionItems} />

      <footer style={{ marginTop: 24, opacity: 0.75 }}>
        <small>
          Tip: Open your browser devtools Network tab to verify cart calls. If you hit rate limits, wait briefly and try again.
        </small>
      </footer>
    </div>
  );
}
