import type { Product, ProductLookupResponse, ProductSearchResponse, StoreSearchResponse } from "@pricecart/shared";
import "leaflet/dist/leaflet.css";
import { useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { fetchStores, lookupProductByUpc, searchProducts } from "./lib/api";
import { useCart } from "./lib/cart";

function formatErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function qtyLabel(p: { quantity?: { raw: string | null; value: number | null; unit: string | null } | null }) {
  const q = p.quantity;
  if (!q) return "";
  if (q.raw) return q.raw;
  if (q.value && q.unit) return `${q.value} ${q.unit}`;
  return "";
}

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

  const mapCenter = useMemo(() => {
    const first = stores?.stores?.[0];
    return first ? { lat: first.lat, lon: first.lon } : { lat: 40.7484, lon: -73.9967 }; // Midtown fallback
  }, [stores]);

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

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>PriceCart</h2>
        <nav style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setView("stores")} disabled={view === "stores"}>
            Stores
          </button>
          <button onClick={() => setView("products")} disabled={view === "products"}>
            Products
          </button>
          <button onClick={() => setView("cart")} disabled={view === "cart"}>
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
            <button onClick={onSearchStores}>Search</button>
          </div>

          {sStatus && <p>{sStatus}</p>}

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
              <button onClick={onLookupUpc}>Lookup</button>
              {lookup?.product && (
                <button onClick={() => addProductToCart(lookup.product)}>Add to cart</button>
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
              <button onClick={onSearchProducts}>Search</button>
            </div>

            {pStatus && <p>{pStatus}</p>}

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
                      <button onClick={() => cart.add(p.upc, 1)}>Add</button>
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

          {cart.status === "loading" && <p>Loading...</p>}
          {cart.status === "error" && <p>Error: {cart.error}</p>}

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
                      <button onClick={() => cart.setQuantity(it.upc, Math.max(1, it.count - 1))} aria-label="Decrease">
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
                      <button onClick={() => cart.setQuantity(it.upc, Math.min(99, it.count + 1))} aria-label="Increase">
                        +
                      </button>
                      <button onClick={() => cart.remove(it.upc)}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>

              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button onClick={cart.clear}>Clear cart</button>
                <button onClick={() => alert("Phase 4: Compare prices (quote endpoint)")}>Compare prices</button>
              </div>
            </>
          )}
        </section>
      )}

      <footer style={{ marginTop: 24, opacity: 0.75 }}>
        <small>
          Tip: Open your browser devtools Network tab to verify cart calls. If you hit rate limits, wait briefly and try again.
        </small>
      </footer>
    </div>
  );
}